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

// Credentials are read inside main() rather than at import, so the pure
// helpers below can be required by the tests without a .env present.
function scoresUrl(apiKey) {
  return (
    'https://api.the-odds-api.com/v4/sports/americanfootball_nfl/scores' +
    `?daysFrom=3&apiKey=${apiKey}`
  );
}

// Which book's number counts as the closing line, best first.
const BOOK_PRIORITY = ['draftkings', 'fanduel'];

// PostgREST caps a response at 1000 rows, so every read has to page.
const PAGE = 1000;
async function selectAll(supabase, table, columns, tweak = (q) => q) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await tweak(
      supabase.from(table).select(columns).order('id', { ascending: true }).range(from, from + PAGE - 1)
    );
    if (error) throw new Error(`Read from ${table} failed: ${error.message}`);
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

function bookRank(book) {
  const i = BOOK_PRIORITY.indexOf(book);
  return i === -1 ? BOOK_PRIORITY.length : i;
}

// Every row written by one snapshot run shares a captured_at, so "the latest
// snapshot before kickoff" is the latest capture; the book preference breaks
// the tie among that capture's rows rather than reaching back to older ones.
function closingLine(game) {
  const kickoff = Date.parse(game.commence_time);
  const pre = game.snaps.filter((s) => Date.parse(s.captured_at) < kickoff);
  if (pre.length === 0) return null;

  const latest = pre.reduce((a, b) =>
    Date.parse(b.captured_at) > Date.parse(a.captured_at) ? b : a
  ).captured_at;

  return pre
    .filter((s) => s.captured_at === latest)
    .sort(
      (a, b) =>
        bookRank(a.bookmaker) - bookRank(b.bookmaker) ||
        a.bookmaker.localeCompare(b.bookmaker)
    )[0];
}

// An exact push is not a win or a loss, so it stays null.
function covered(homeScore, awayScore, spreadHome) {
  if (spreadHome === null || spreadHome === undefined) return null;
  const adjusted = homeScore + Number(spreadHome);
  return adjusted === awayScore ? null : adjusted > awayScore;
}

function over(homeScore, awayScore, total) {
  if (total === null || total === undefined) return null;
  const combined = homeScore + awayScore;
  return combined === Number(total) ? null : combined > Number(total);
}

function teamScore(final, team) {
  const entry = (final.scores || []).find((s) => s.name === team);
  if (!entry) return null;
  const n = Number(entry.score);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const SUPABASE_URL = requireEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_KEY = requireEnv('SUPABASE_SERVICE_KEY');
  const ODDS_API_KEY = requireEnv('ODDS_API_KEY');

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const alreadyGraded = new Set(
    (await selectAll(supabase, 'chalk_results', 'id,game_id')).map((r) => r.game_id)
  );

  const snaps = await selectAll(
    supabase,
    'chalk_odds_snapshots',
    'id,game_id,commence_time,home_team,away_team,bookmaker,spread_home,total,captured_at',
    (q) => q.lt('commence_time', new Date().toISOString())
  );

  const games = new Map();
  for (const s of snaps) {
    if (alreadyGraded.has(s.game_id)) continue;
    let g = games.get(s.game_id);
    if (!g) {
      g = {
        game_id: s.game_id,
        commence_time: s.commence_time,
        home_team: s.home_team,
        away_team: s.away_team,
        snaps: [],
      };
      games.set(s.game_id, g);
    }
    g.snaps.push(s);
  }

  const skipped = new Map();
  const skip = (reason) => skipped.set(reason, (skipped.get(reason) || 0) + 1);

  const report = (gradedCount) => {
    const skippedTotal = [...skipped.values()].reduce((a, b) => a + b, 0);
    console.log(`Graded ${gradedCount} games.`);
    console.log(`Skipped ${skippedTotal} games.`);
    for (const [reason, count] of [...skipped].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count}  ${reason}`);
    }
  };

  if (games.size === 0) {
    // Nothing to look up, so don't spend an API request finding that out.
    report(0);
    return;
  }

  const res = await fetch(scoresUrl(ODDS_API_KEY));
  if (!res.ok) {
    console.error(`Scores API ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  console.log(`x-requests-remaining: ${res.headers.get('x-requests-remaining')}`);

  const finals = new Map((await res.json()).map((f) => [f.id, f]));

  const rows = [];
  for (const game of games.values()) {
    const final = finals.get(game.game_id);
    if (!final) {
      skip('no entry in scores feed (kickoff outside the daysFrom=3 window)');
      continue;
    }
    if (!final.completed) {
      skip('game not marked completed');
      continue;
    }

    const homeScore = teamScore(final, game.home_team);
    const awayScore = teamScore(final, game.away_team);
    if (homeScore === null || awayScore === null) {
      skip('completed but scores feed had no usable score for both teams');
      continue;
    }

    const closing = closingLine(game);
    if (!closing) {
      skip('no snapshot captured before kickoff');
      continue;
    }

    rows.push({
      game_id: game.game_id,
      commence_time: game.commence_time,
      home_team: game.home_team,
      away_team: game.away_team,
      home_score: homeScore,
      away_score: awayScore,
      closing_spread_home: closing.spread_home,
      closing_total: closing.total,
      closing_book: closing.bookmaker,
      home_covered: covered(homeScore, awayScore, closing.spread_home),
      went_over: over(homeScore, awayScore, closing.total),
    });
  }

  if (rows.length === 0) {
    report(0);
    return;
  }

  const { data, error } = await supabase
    .from('chalk_results')
    .insert(rows)
    .select('game_id');

  if (error) {
    console.error(`Insert failed: ${error.message}`);
    for (let c = error.cause; c; c = c.cause) {
      console.error(`  cause: ${c.code || ''} ${c.message || c}`.trim());
    }
    process.exit(1);
  }

  report(data.length);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { covered, over, closingLine, bookRank };
