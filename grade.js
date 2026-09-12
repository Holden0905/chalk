require('dotenv').config();
const { parse } = require('csv-parse/sync');
const { createClient } = require('@supabase/supabase-js');
const teams = require('./teams.js');
const {
  clvFor, profitFor, gradeSpread, gradeTotal, gradeMoneyline, gradeAnytimeTd, decimalOdds,
} = require('./bets.js');

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

const num = (v) => (v === '' || v == null ? null : Number(v));

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

async function gradeGames(supabase) {
  const ODDS_API_KEY = requireEnv('ODDS_API_KEY');
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

// Games first, then any bets those results now settle. Bet grading must run
// even when no game was graded this pass, since a bet can be placed on a game
// that was already in chalk_results.
async function main() {
  const SUPABASE_URL = requireEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_KEY = requireEnv('SUPABASE_SERVICE_KEY');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  await gradeGames(supabase);
  await gradeBets(supabase);
}

/** Closing quote for a bet, from the same pre-kickoff capture the grader uses. */
function closingForBet(bet, snaps) {
  const kickoff = Date.parse(bet.commence_time);
  const pre = snaps.filter((s) => Date.parse(s.captured_at) < kickoff);
  if (pre.length === 0) return null;
  const latest = pre.reduce((a, b) =>
    Date.parse(b.captured_at) > Date.parse(a.captured_at) ? b : a
  ).captured_at;
  const capture = pre.filter((s) => s.captured_at === latest);

  // The book the bet was placed at is the honest comparison for CLV; fall back
  // to the reference books when it did not post a number in that capture.
  const own = capture.find((s) => s.bookmaker === bet.book);
  const row =
    own ||
    capture.sort(
      (a, b) => bookRank(a.bookmaker) - bookRank(b.bookmaker) || a.bookmaker.localeCompare(b.bookmaker)
    )[0];
  if (!row) return null;

  const home = row.home_team;
  if (bet.market === 'spread') {
    const spread = num(row.spread_home);
    if (spread == null) return null;
    // Stored spreads are from the home side; flip for an away bet.
    return { line: bet.side === home ? spread : -spread, price: null, book: row.bookmaker };
  }
  if (bet.market === 'total') {
    const total = num(row.total);
    return total == null ? null : { line: total, price: null, book: row.bookmaker };
  }
  if (bet.market === 'moneyline') {
    const price = bet.side === home ? num(row.home_ml) : num(row.away_ml);
    return price == null ? null : { line: null, price, book: row.bookmaker };
  }
  return null;
}

/** Closing anytime-TD price: same book if it posted one, otherwise the best. */
function closingForProp(bet, props) {
  const kickoff = Date.parse(bet.commence_time);
  const key = teams.playerNameKey(bet.side);
  const pre = props.filter(
    (p) => Date.parse(p.captured_at) < kickoff && teams.playerNameKey(p.player_name) === key
  );
  if (pre.length === 0) return null;
  const latest = pre.reduce((a, b) =>
    Date.parse(b.captured_at) > Date.parse(a.captured_at) ? b : a
  ).captured_at;
  const capture = pre.filter((p) => p.captured_at === latest);
  const own = capture.find((p) => p.bookmaker === bet.book);
  const row =
    own || capture.reduce((a, b) => (decimalOdds(b.price) > decimalOdds(a.price) ? b : a));
  return row ? { line: null, price: row.price, book: row.bookmaker } : null;
}

async function gradeBets(supabase) {
  const open = await selectAll(supabase, 'chalk_bets', '*', (q) => q.is('graded_at', null));
  if (open.length === 0) {
    console.log('\nNo open bets.');
    await betSummary(supabase);
    return;
  }

  const gameIds = [...new Set(open.map((b) => b.game_id))];
  const results = await selectAll(supabase, 'chalk_results', '*', (q) => q.in('game_id', gameIds));
  const resultByGame = new Map(results.map((r) => [r.game_id, r]));

  const settled = open.filter((b) => resultByGame.has(b.game_id));
  console.log(`\n${open.length} open bets, ${settled.length} on completed games.`);
  if (settled.length === 0) {
    await betSummary(supabase);
    return;
  }

  const snaps = await selectAll(supabase, 'chalk_odds_snapshots', '*', (q) =>
    q.in('game_id', [...new Set(settled.map((b) => b.game_id))])
  );
  const snapsByGame = new Map();
  for (const s of snaps) {
    if (!snapsByGame.has(s.game_id)) snapsByGame.set(s.game_id, []);
    snapsByGame.get(s.game_id).push(s);
  }

  const propBets = settled.filter((b) => b.market === 'anytime_td');
  let propsByGame = new Map();
  let playerWeeks = [];
  let schedule = [];
  if (propBets.length) {
    const props = await selectAll(supabase, 'chalk_prop_snapshots', '*', (q) =>
      q.in('game_id', [...new Set(propBets.map((b) => b.game_id))]).eq('market', 'player_anytime_td')
    );
    for (const p of props) {
      if (!propsByGame.has(p.game_id)) propsByGame.set(p.game_id, []);
      propsByGame.get(p.game_id).push(p);
    }
    // The player tables are keyed by season and week, which only the schedule
    // can supply from a kickoff time and two team names.
    const text = await fetch(GAMES_URL).then((r) => r.text());
    schedule = parse(text, { columns: true, skip_empty_lines: true });
    playerWeeks = await selectAll(supabase, 'chalk_player_weeks', '*');
  }

  const findSeasonWeek = (result) => {
    const home = teams.toAbbr(result.home_team);
    const away = teams.toAbbr(result.away_team);
    const day = String(result.commence_time).slice(0, 10);
    const hit = schedule.find(
      (g) => g.home_team === home && g.away_team === away &&
        Math.abs(Date.parse(g.gameday) - Date.parse(day)) <= 2 * 24 * 3600 * 1000
    );
    return hit ? { season: Number(hit.season), week: Number(hit.week) } : null;
  };

  const skipped = new Map();
  const skip = (why) => skipped.set(why, (skipped.get(why) || 0) + 1);
  let graded = 0;

  for (const bet of settled) {
    const r = resultByGame.get(bet.game_id);
    let result = null;

    if (bet.market === 'spread') {
      result = gradeSpread(bet.side, bet.line, r.home_team, r.home_score, r.away_score);
    } else if (bet.market === 'total') {
      result = gradeTotal(bet.side, bet.line, r.home_score, r.away_score);
    } else if (bet.market === 'moneyline') {
      result = gradeMoneyline(bet.side, r.home_team, r.home_score, r.away_score);
    } else if (bet.market === 'anytime_td') {
      const sw = findSeasonWeek(r);
      if (!sw) {
        skip('anytime TD bet whose game is not in the nflverse schedule');
        continue;
      }
      const key = teams.playerNameKey(bet.side);
      const row = playerWeeks.find(
        (p) => Number(p.season) === sw.season && Number(p.week) === sw.week &&
          teams.playerNameKey(p.player_name) === key
      );
      if (!row) {
        // No row means no carry, target or attempt, which is not a touchdown.
        result = 'loss';
        skip('anytime TD player had no touch that week; graded as a loss');
      } else {
        result = gradeAnytimeTd(row);
      }
    }

    if (!result) {
      skip(`could not grade a ${bet.market} bet`);
      continue;
    }

    const closing =
      bet.market === 'anytime_td'
        ? closingForProp(bet, propsByGame.get(bet.game_id) || [])
        : closingForBet(bet, snapsByGame.get(bet.game_id) || []);

    const update = {
      closing_line: closing?.line ?? null,
      closing_price: closing?.price ?? null,
      clv_points: closing ? clvFor(bet, closing) : null,
      result,
      profit: profitFor(bet.price, bet.stake, result),
      graded_at: new Date().toISOString(),
    };
    if (!closing) skip('no pre-kickoff closing quote; CLV left null');

    const { error } = await supabase.from('chalk_bets').update(update).eq('id', bet.id);
    if (error) {
      console.error(`Bet ${bet.id} update failed: ${error.message}`);
      process.exit(1);
    }
    graded += 1;
  }

  console.log(`Graded ${graded} bets.`);
  for (const [why, n] of [...skipped].sort((a, b) => b[1] - a[1])) console.log(`  ${n}  ${why}`);
  await betSummary(supabase);
}

async function betSummary(supabase) {
  const bets = (await selectAll(supabase, 'chalk_bets', '*')).filter((b) => b.graded_at);
  if (bets.length === 0) {
    console.log('\nNo graded bets yet.');
    return;
  }
  const bySeason = new Map();
  for (const b of bets) {
    // NFL seasons run into the new year, so January belongs to the prior one.
    const d = new Date(b.commence_time);
    const season = d.getUTCMonth() >= 2 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
    if (!bySeason.has(season)) bySeason.set(season, []);
    bySeason.get(season).push(b);
  }

  console.log('\nBet summary');
  for (const [season, rows] of [...bySeason].sort((a, b) => a[0] - b[0])) {
    const w = rows.filter((b) => b.result === 'win').length;
    const l = rows.filter((b) => b.result === 'loss').length;
    const p = rows.filter((b) => b.result === 'push').length;
    const profit = rows.reduce((a, b) => a + Number(b.profit || 0), 0);
    const staked = rows.reduce((a, b) => a + Number(b.stake || 0), 0);
    const clv = rows.filter((b) => b.clv_points != null).map((b) => Number(b.clv_points));
    const avgClv = clv.length ? clv.reduce((a, b) => a + b, 0) / clv.length : null;
    const posClv = clv.filter((c) => c > 0).length;
    console.log(
      `  ${season}: ${rows.length} bets, ${w}-${l}${p ? `-${p}` : ''}, ` +
      `profit ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} on ${staked.toFixed(2)} staked` +
      (staked ? ` (ROI ${((profit / staked) * 100).toFixed(1)}%)` : '')
    );
    console.log(
      `        average CLV ${avgClv == null ? '-' : `${avgClv >= 0 ? '+' : ''}${avgClv.toFixed(2)}`} points, ` +
      `positive on ${clv.length ? `${posClv}/${clv.length} (${((posClv / clv.length) * 100).toFixed(0)}%)` : 'n/a'}`
    );
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { covered, over, closingLine, bookRank, closingForBet, closingForProp };
