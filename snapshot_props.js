require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

function requireEnv(name) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return raw.trim();
}

const BASE = 'https://api.the-odds-api.com/v4/sports/americanfootball_nfl';
const MARKET = 'player_anytime_td';
const WINDOW_DAYS = 7;

async function main() {
  const SUPABASE_URL = requireEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_KEY = requireEnv('SUPABASE_SERVICE_KEY');
  const ODDS_API_KEY = requireEnv('ODDS_API_KEY');

  // The events endpoint is free and does not draw down the quota, so the
  // window is narrowed here rather than by paying for odds we will discard.
  const evRes = await fetch(`${BASE}/events?apiKey=${ODDS_API_KEY}`);
  if (!evRes.ok) {
    console.error(`Events API ${evRes.status}: ${await evRes.text()}`);
    process.exit(1);
  }
  const now = Date.now();
  const cutoff = now + WINDOW_DAYS * 24 * 3600 * 1000;
  const events = (await evRes.json()).filter((e) => {
    const t = Date.parse(e.commence_time);
    return t >= now && t <= cutoff;
  });

  console.log(`${events.length} events in the next ${WINDOW_DAYS} days.`);
  if (events.length === 0) {
    console.log('Nothing to snapshot.');
    return;
  }

  const rows = [];
  let remaining = evRes.headers.get('x-requests-remaining');
  let failures = 0;

  for (const event of events) {
    const url =
      `${BASE}/events/${event.id}/odds?apiKey=${ODDS_API_KEY}` +
      `&regions=us&markets=${MARKET}&oddsFormat=american`;
    const res = await fetch(url);
    const left = res.headers.get('x-requests-remaining');
    if (left != null) remaining = left;

    if (!res.ok) {
      // A single event without this market should not sink the run.
      console.warn(`  ${event.away_team} @ ${event.home_team}: HTTP ${res.status}`);
      failures += 1;
      continue;
    }

    const data = await res.json();
    for (const book of data.bookmakers || []) {
      for (const market of book.markets || []) {
        if (market.key !== MARKET) continue;
        for (const o of market.outcomes || []) {
          rows.push({
            game_id: data.id,
            commence_time: data.commence_time,
            home_team: data.home_team,
            away_team: data.away_team,
            bookmaker: book.key,
            market: market.key,
            player_name: o.description ?? null, // the player lives in description
            outcome: o.name ?? null,            // "Yes"
            price: o.price ?? null,
            point: o.point ?? null,             // null for anytime TD
          });
        }
      }
    }
  }

  console.log(`x-requests-remaining: ${remaining}`);
  if (failures) console.log(`${failures} events returned no ${MARKET} market.`);

  if (rows.length === 0) {
    console.log('No prop lines returned; nothing inserted.');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { data, error } = await supabase
      .from('chalk_prop_snapshots')
      .insert(rows.slice(i, i + BATCH))
      .select('id');
    if (error) {
      console.error(`Insert failed: ${error.message}`);
      process.exit(1);
    }
    inserted += data.length;
  }

  const players = new Set(rows.map((r) => r.player_name)).size;
  const books = new Set(rows.map((r) => r.bookmaker)).size;
  console.log(`Inserted ${inserted} rows: ${players} players across ${books} books, ${events.length - failures} games.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
