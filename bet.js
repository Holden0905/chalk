require('dotenv').config();
const readline = require('node:readline/promises');
const { createClient } = require('@supabase/supabase-js');
const teams = require('./teams.js');
const { MARKETS, impliedProb } = require('./bets.js');

function requireEnv(name) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return raw.trim();
}

const USAGE = `
Chalk bet log

  node bet.js add --game "ATL @ PIT" --market total --side Over --line 41.5 \\
                  --price -110 --stake 25 --book draftkings --note "text"

  --game     "AWAY @ HOME". Abbreviations or full names; fuzzy is fine.
             --game-id <id> skips resolution entirely.
  --market   ${MARKETS.join(' | ')}
  --side     team name (spread, moneyline), Over or Under (total),
             or the player's name (anytime_td)
  --line     required for spread and total; omit for moneyline and anytime_td
  --price    American odds you took, e.g. -110 or +145
  --stake    risk amount
  --book     sportsbook key, e.g. draftkings
  --note     optional free text

  node bet.js list [--all]     open and graded bets with running profit
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Resolve one token to a full Odds API team name, or null. */
function resolveTeam(token, candidates) {
  if (!token) return null;
  const t = token.trim();
  const viaAbbr = teams.toOddsName(t);
  if (viaAbbr && candidates.includes(viaAbbr)) return viaAbbr;
  const n = norm(t);
  const exact = candidates.filter((c) => norm(c) === n);
  if (exact.length === 1) return exact[0];
  const partial = candidates.filter((c) => norm(c).includes(n) || n.includes(norm(c)));
  return partial.length === 1 ? partial[0] : null;
}

async function confirm(question) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

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

/** Distinct upcoming games known to the odds snapshots. */
async function upcomingGames(supabase) {
  const rows = await selectAll(supabase, 'chalk_odds_snapshots',
    'game_id,commence_time,home_team,away_team',
    (q) => q.gt('commence_time', new Date().toISOString()));
  const byId = new Map();
  for (const r of rows) if (!byId.has(r.game_id)) byId.set(r.game_id, r);
  return [...byId.values()].sort((a, b) => a.commence_time.localeCompare(b.commence_time));
}

const describe = (g) =>
  `${g.away_team} @ ${g.home_team}  ${new Date(g.commence_time).toISOString().replace('T', ' ').slice(0, 16)}Z`;

async function resolveGame(supabase, spec) {
  const games = await upcomingGames(supabase);
  if (games.length === 0) {
    console.error('No upcoming games in chalk_odds_snapshots. Run `npm run snapshot` first.');
    process.exit(1);
  }
  const names = [...new Set(games.flatMap((g) => [g.home_team, g.away_team]))];

  const parts = String(spec).split(/\s+(?:@|at|vs\.?|v)\s+/i);
  if (parts.length !== 2) {
    console.error(`Could not read "${spec}". Use the form "AWAY @ HOME".`);
    process.exit(1);
  }
  const away = resolveTeam(parts[0], names);
  const home = resolveTeam(parts[1], names);

  let matches;
  if (away && home) {
    matches = games.filter((g) => g.away_team === away && g.home_team === home);
    // Tolerate the two teams being given the wrong way round.
    if (matches.length === 0) matches = games.filter((g) => g.away_team === home && g.home_team === away);
  } else {
    const known = [away, home].filter(Boolean);
    if (known.length === 0) {
      console.error(`Neither team in "${spec}" matched an upcoming game.`);
      process.exit(1);
    }
    matches = games.filter((g) => known.every((t) => g.home_team === t || g.away_team === t));
  }

  if (matches.length === 1) return matches[0];
  if (matches.length === 0) {
    console.error(`No upcoming game matched "${spec}".`);
    process.exit(1);
  }
  console.error(`"${spec}" matched ${matches.length} games:`);
  matches.forEach((g, i) => console.error(`  [${i + 1}] ${describe(g)}   game_id ${g.game_id}`));
  if (!(await confirm(`Use [1] ${describe(matches[0])}?`))) {
    console.error('Ambiguous. Re-run with --game-id <id>.');
    process.exit(1);
  }
  return matches[0];
}

async function add(supabase, args) {
  const market = String(args.market || '').toLowerCase();
  if (!MARKETS.includes(market)) {
    console.error(`--market must be one of ${MARKETS.join(', ')}`);
    process.exit(1);
  }
  for (const required of ['side', 'price', 'stake', 'book']) {
    if (args[required] === undefined || args[required] === true) {
      console.error(`--${required} is required`);
      process.exit(1);
    }
  }

  let game;
  if (args['game-id']) {
    const rows = await selectAll(supabase, 'chalk_odds_snapshots',
      'game_id,commence_time,home_team,away_team', (q) => q.eq('game_id', args['game-id']).limit(1));
    if (rows.length === 0) {
      console.error(`No game with id ${args['game-id']}`);
      process.exit(1);
    }
    game = rows[0];
  } else if (args.game) {
    game = await resolveGame(supabase, args.game);
  } else {
    console.error('--game or --game-id is required');
    process.exit(1);
  }

  let side = String(args.side);
  if (market === 'total') {
    const s = side.toLowerCase();
    if (s !== 'over' && s !== 'under') {
      console.error('--side must be Over or Under for a total');
      process.exit(1);
    }
    side = s === 'over' ? 'Over' : 'Under';
  } else if (market === 'spread' || market === 'moneyline') {
    const resolved = resolveTeam(side, [game.home_team, game.away_team]);
    if (!resolved) {
      console.error(`--side "${side}" is neither ${game.away_team} nor ${game.home_team}`);
      process.exit(1);
    }
    side = resolved;
  }

  const needsLine = market === 'spread' || market === 'total';
  if (needsLine && (args.line === undefined || args.line === true)) {
    console.error(`--line is required for a ${market}`);
    process.exit(1);
  }

  const row = {
    game_id: game.game_id,
    commence_time: game.commence_time,
    market,
    side,
    line: needsLine ? Number(args.line) : null,
    price: Math.round(Number(args.price)),
    stake: Number(args.stake),
    book: String(args.book),
    note: args.note && args.note !== true ? String(args.note) : null,
  };
  if (!Number.isFinite(row.price) || !Number.isFinite(row.stake)) {
    console.error('--price and --stake must be numbers');
    process.exit(1);
  }

  const { data, error } = await supabase.from('chalk_bets').insert(row).select('*').single();
  if (error) {
    console.error(`Insert failed: ${error.message}`);
    process.exit(1);
  }

  const priceStr = row.price > 0 ? `+${row.price}` : `${row.price}`;
  const lineStr = row.line == null ? '' : ` ${row.line > 0 ? '+' : ''}${row.line}`;
  console.log(`Bet #${data.id} recorded.`);
  console.log(`  ${describe(game)}`);
  console.log(`  ${market} ${row.side}${lineStr} at ${priceStr} for ${row.stake} (${row.book})`);
  console.log(`  implied ${(impliedProb(row.price) * 100).toFixed(1)}%` +
              (row.note ? `   note: ${row.note}` : ''));
}

const money = (v) => (v == null ? '-' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}`);
const pad = (s, n, right = true) => {
  s = String(s);
  if (s.length > n) s = s.slice(0, n);
  return right ? s.padEnd(n) : s.padStart(n);
};

async function list(supabase) {
  const bets = await selectAll(supabase, 'chalk_bets', '*');
  if (bets.length === 0) {
    console.log('No bets logged yet.');
    return;
  }
  const open = bets.filter((b) => !b.graded_at);
  const graded = bets
    .filter((b) => b.graded_at)
    .sort((a, b) => String(a.commence_time).localeCompare(String(b.commence_time)));

  const header =
    '  ' + pad('#', 5) + pad('when', 18) + pad('market', 11) + pad('side', 20) +
    pad('line', 8, false) + pad('price', 8, false) + pad('stake', 8, false) +
    pad('book', 12) + pad('CLV', 8, false) + pad('result', 8) + pad('profit', 10, false) +
    pad('running', 10, false);

  if (open.length) {
    console.log(`Open (${open.length})`);
    console.log(header);
    for (const b of open) {
      console.log('  ' + pad(b.id, 5) + pad(String(b.commence_time).replace('T', ' ').slice(0, 16), 18) +
        pad(b.market, 11) + pad(b.side, 20) +
        pad(b.line ?? '-', 8, false) + pad(b.price > 0 ? `+${b.price}` : b.price, 8, false) +
        pad(Number(b.stake).toFixed(2), 8, false) + pad(b.book, 12) +
        pad('-', 8, false) + pad('-', 8) + pad('-', 10, false) + pad('-', 10, false));
    }
    console.log();
  }

  if (graded.length) {
    let running = 0;
    let w = 0;
    let l = 0;
    let p = 0;
    let clvSum = 0;
    let clvN = 0;
    let clvPos = 0;
    console.log(`Graded (${graded.length})`);
    console.log(header);
    for (const b of graded) {
      running += Number(b.profit || 0);
      if (b.result === 'win') w++;
      else if (b.result === 'loss') l++;
      else if (b.result === 'push') p++;
      if (b.clv_points != null) {
        clvSum += Number(b.clv_points);
        clvN++;
        if (Number(b.clv_points) > 0) clvPos++;
      }
      console.log('  ' + pad(b.id, 5) + pad(String(b.commence_time).replace('T', ' ').slice(0, 16), 18) +
        pad(b.market, 11) + pad(b.side, 20) +
        pad(b.line ?? '-', 8, false) + pad(b.price > 0 ? `+${b.price}` : b.price, 8, false) +
        pad(Number(b.stake).toFixed(2), 8, false) + pad(b.book, 12) +
        pad(b.clv_points == null ? '-' : money(b.clv_points), 8, false) +
        pad(b.result ?? '-', 8) + pad(money(b.profit), 10, false) + pad(money(running), 10, false));
    }
    const staked = graded.reduce((a, b) => a + Number(b.stake || 0), 0);
    console.log();
    console.log(`  record ${w}-${l}${p ? `-${p}` : ''}   staked ${staked.toFixed(2)}   profit ${money(running)}` +
      (staked ? `   ROI ${((running / staked) * 100).toFixed(1)}%` : ''));
    if (clvN) {
      console.log(`  average CLV ${money(clvSum / clvN)} points   positive CLV on ${clvPos}/${clvN} ` +
        `(${((clvPos / clvN) * 100).toFixed(0)}%)`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  if (!command || args.help) {
    console.log(USAGE);
    return;
  }
  const SUPABASE_URL = requireEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_KEY = requireEnv('SUPABASE_SERVICE_KEY');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

  if (command === 'add') return add(supabase, args);
  if (command === 'list') return list(supabase);
  console.log(USAGE);
  console.error(`Unknown command "${command}"`);
  process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { parseArgs, resolveTeam };
