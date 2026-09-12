require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_SERVICE_KEY, ODDS_API_KEY } = process.env;

for (const [name, value] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_KEY, ODDS_API_KEY })) {
  if (!value) {
    console.error(`Missing ${name} in .env`);
    process.exit(1);
  }
}

const ODDS_URL =
  'https://api.the-odds-api.com/v4/sports/americanfootball_nfl/odds' +
  `?apiKey=${ODDS_API_KEY}&regions=us&markets=h2h,spreads,totals&oddsFormat=american`;

// Pull the point/price for a named outcome out of one of a bookmaker's markets.
function outcome(markets, marketKey, name) {
  const market = markets.find((m) => m.key === marketKey);
  return market && market.outcomes.find((o) => o.name === name);
}

function toRows(games) {
  const rows = [];
  for (const game of games) {
    for (const book of game.bookmakers || []) {
      const markets = book.markets || [];
      const spreadHome = outcome(markets, 'spreads', game.home_team);
      const over = outcome(markets, 'totals', 'Over');
      const homeMl = outcome(markets, 'h2h', game.home_team);
      const awayMl = outcome(markets, 'h2h', game.away_team);

      rows.push({
        game_id: game.id,
        commence_time: game.commence_time,
        home_team: game.home_team,
        away_team: game.away_team,
        bookmaker: book.key,
        spread_home: spreadHome ? spreadHome.point : null,
        total: over ? over.point : null,
        home_ml: homeMl ? homeMl.price : null,
        away_ml: awayMl ? awayMl.price : null,
      });
    }
  }
  return rows;
}

async function main() {
  const res = await fetch(ODDS_URL);
  if (!res.ok) {
    console.error(`Odds API ${res.status}: ${await res.text()}`);
    process.exit(1);
  }

  console.log(`x-requests-remaining: ${res.headers.get('x-requests-remaining')}`);

  const games = await res.json();
  const rows = toRows(games);
  if (rows.length === 0) {
    console.log('No odds returned; nothing inserted.');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const { data, error } = await supabase
    .from('chalk_odds_snapshots')
    .insert(rows)
    .select('id');

  if (error) {
    console.error(`Insert failed: ${error.message}`);
    process.exit(1);
  }

  console.log(`Inserted ${data.length} rows from ${games.length} games.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
