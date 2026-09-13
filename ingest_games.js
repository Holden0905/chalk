require('dotenv').config();
const { Readable } = require('node:stream');
const { parse } = require('csv-parse');
const { createClient } = require('@supabase/supabase-js');

function requireEnv(name) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return raw.trim();
}

// The nflverse games file: every game since 1999, one row each, with the
// closing spread and total alongside the final score. It is a single small CSV
// covering all seasons, so unlike the play-by-play there is nothing to fetch
// per season.
const GAMES_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';

// Chalk's window. Four seasons is enough for a base rate to mean something
// without reaching back past the 17-game schedule, which began in 2021.
const FIRST_SEASON = 2022;

// Regular season only, everywhere. Week 19 and up are the playoffs, and
// game_type marks them too; both are checked because a mislabelled row in
// either column should not slip through.
const LAST_REGULAR_WEEK = 18;

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const bool = (v) => (v === '' || v == null ? null : v === '1' || v === 'TRUE' || v === 'true');

// The NFL season spans two calendar years; January and February belong to the
// season that started the previous autumn.
function currentSeason(now = new Date()) {
  return now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

const etParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hour12: false,
});

/**
 * nflverse publishes gameday as a date and gametime as a wall clock, both in
 * Eastern. Eastern is UTC-4 or UTC-5 depending on the date, so rather than
 * hard-coding a rule for when the clocks change, both offsets are tried and the
 * one that reads back as the published wall clock wins. Kickoffs are never in
 * the ambiguous hour after a fall-back, so exactly one offset ever matches.
 */
function kickoffIso(gameday, gametime) {
  if (!gameday) return null;
  const [y, m, d] = String(gameday).split('-').map(Number);
  const [hh, mm] = String(gametime || '').split(':').map(Number);
  if (![y, m, d].every(Number.isFinite)) return null;
  if (![hh, mm].every(Number.isFinite)) return null;

  for (const offset of [4, 5]) {
    const utc = Date.UTC(y, m - 1, d, hh + offset, mm);
    const p = Object.fromEntries(
      etParts.formatToParts(new Date(utc)).map((x) => [x.type, x.value]),
    );
    if (
      Number(p.year) === y && Number(p.month) === m && Number(p.day) === d &&
      Number(p.hour) === hh && Number(p.minute) === mm
    ) {
      return new Date(utc).toISOString();
    }
  }
  return null;
}

/** Is this row a regular season game inside the window we ingest? */
function wanted(r, seasons) {
  if (!r.game_id) return false;
  if (r.game_type !== 'REG') return false;
  const week = Number(r.week);
  if (!Number.isInteger(week) || week < 1 || week > LAST_REGULAR_WEEK) return false;
  return seasons.has(Number(r.season));
}

/**
 * One CSV row to one chalk_games row. The derived columns -- total_points,
 * home_margin, home_covered, went_over, total_diff -- are generated in
 * Postgres, so nothing here computes them.
 *
 * spread_line keeps nflverse's sign: POSITIVE means the home team is favored.
 */
function buildRow(r) {
  return {
    game_id: r.game_id,
    season: Number(r.season),
    week: Number(r.week),
    weekday: r.weekday || null,
    kickoff: kickoffIso(r.gameday, r.gametime),
    home_team: r.home_team || null,
    away_team: r.away_team || null,
    home_score: num(r.home_score),
    away_score: num(r.away_score),
    spread_line: num(r.spread_line),
    total_line: num(r.total_line),
    home_rest: num(r.home_rest),
    away_rest: num(r.away_rest),
    div_game: bool(r.div_game),
    roof: r.roof || null,
    surface: r.surface || null,
    overtime: bool(r.overtime),
  };
}

async function streamGames(onRow) {
  const res = await fetch(GAMES_URL);
  if (!res.ok) {
    throw new Error(`Games file fetch failed: ${res.status} ${res.statusText}`);
  }
  const parser = Readable.fromWeb(res.body).pipe(
    parse({ columns: true, skip_empty_lines: true, relax_column_count: true }),
  );
  let seen = 0;
  for await (const row of parser) {
    seen += 1;
    onRow(row);
  }
  return seen;
}

async function main() {
  // With no argument, every season in the window is refreshed. Lines and
  // scores for a season already ingested can still change (a corrected score,
  // a late line), and the whole file arrives in one request either way.
  const asked = Number(process.argv[2]);
  const latest = currentSeason();
  const seasons = new Set();
  if (Number.isInteger(asked) && asked >= FIRST_SEASON) {
    seasons.add(asked);
  } else {
    for (let s = FIRST_SEASON; s <= latest; s += 1) seasons.add(s);
  }

  const SUPABASE_URL = requireEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_KEY = requireEnv('SUPABASE_SERVICE_KEY');

  const list = [...seasons].sort((a, b) => a - b);
  console.log(`Seasons ${list[0]}-${list[list.length - 1]}: downloading games file...`);

  const rows = [];
  const seen = await streamGames((r) => {
    if (wanted(r, seasons)) rows.push(buildRow(r));
  });

  const played = rows.filter((r) => r.home_score != null).length;
  console.log(
    `Read ${seen} rows, kept ${rows.length} regular season games (${played} played).`,
  );

  if (rows.length === 0) {
    console.log('Nothing to upsert.');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from('chalk_games')
      .upsert(chunk, { onConflict: 'game_id' })
      .select('id');
    if (error) {
      console.error(`Upsert failed: ${error.message}`);
      for (let c = error.cause; c; c = c.cause) {
        console.error(`  cause: ${c.code || ''} ${c.message || c}`.trim());
      }
      process.exit(1);
    }
    written += data.length;
  }

  for (const s of list) {
    const inSeason = rows.filter((r) => r.season === s);
    const done = inSeason.filter((r) => r.home_score != null).length;
    console.log(`  ${s}: ${inSeason.length} games, ${done} played`);
  }
  console.log(`Upserted ${written} rows into chalk_games.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  buildRow, kickoffIso, wanted, currentSeason, streamGames,
  FIRST_SEASON, LAST_REGULAR_WEEK, GAMES_URL,
};
