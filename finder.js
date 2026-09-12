require('dotenv').config();
const zlib = require('node:zlib');
const { Readable } = require('node:stream');
const { parse } = require('csv-parse/sync');
const { parse: parseStream } = require('csv-parse');
const { createClient } = require('@supabase/supabase-js');
const teams = require('./teams.js');

function requireEnv(name) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return raw.trim();
}

const GAMES_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';
const rosterUrl = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv.gz`;

// Team defence entries in the props feed are not players and should not be
// reported as failed name matches.
const TEAM_DEFENCE = /\b(D\/ST|Defense|Defence)\b/i;

/**
 * Current team and position per player for a season. Last season's game log
 * says where a player used to be, which is the wrong answer in week 1 after
 * free agency; the roster file says where they are now.
 */
async function loadRoster(season) {
  let res;
  try {
    res = await fetch(rosterUrl(season));
  } catch (err) {
    console.warn(`  roster fetch failed (${err.message}); falling back to last-game teams.`);
    return null;
  }
  if (!res.ok) {
    console.warn(`  roster_${season}.csv.gz returned HTTP ${res.status}; falling back to last-game teams.`);
    return null;
  }
  const parser = Readable.fromWeb(res.body)
    .pipe(zlib.createGunzip())
    .pipe(parseStream({ columns: true, relax_column_count: true }));
  const map = new Map();
  try {
    for await (const row of parser) {
      if (row.gsis_id && row.team) map.set(row.gsis_id, { team: row.team, position: row.position || null });
    }
  } catch (err) {
    console.warn(`  roster parse failed (${err.message}); falling back to last-game teams.`);
    return null;
  }
  return map.size ? map : null;
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

const n = (v) => (v == null || v === '' ? 0 : Number(v));
const div = (a, b) => (b > 0 ? a / b : null);
const f = (v, d = 2) => (v == null || !Number.isFinite(v) ? '-' : v.toFixed(d));

// American odds to decimal, so "best price" means best payout rather than
// biggest number.
function decimal(american) {
  if (american == null) return null;
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}
const fmtPrice = (p) => (p == null ? '-' : p > 0 ? `+${p}` : `${p}`);

const nameKey = teams.playerNameKey;

function pad(s, w, right = true) {
  s = String(s);
  if (s.length > w) s = s.slice(0, w);
  return right ? s.padEnd(w) : s.padStart(w);
}

async function main() {
  const season = Number(process.argv[2]);
  const week = Number(process.argv[3]);
  if (!Number.isInteger(season) || !Number.isInteger(week)) {
    console.error('Usage: node finder.js <season> <week>');
    process.exit(1);
  }

  // The board itself is built by the module the /tds page uses, so the CLI and
  // the site cannot disagree about who qualifies or what a price is.
  const { buildTdBoard, MARKET, MIN_TOUCHES, LAST_N } = await import(
    './web/src/lib/tdBoard.mjs'
  );

  const SUPABASE_URL = requireEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_KEY = requireEnv('SUPABASE_SERVICE_KEY');
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const [playerRows, defenseRows, propRows, scheduleText, roster] = await Promise.all([
    selectAll(supabase, 'chalk_player_weeks', '*', (q) => q.in('season', [season - 1, season])),
    selectAll(supabase, 'chalk_defense_weeks', '*', (q) => q.in('season', [season - 1, season])),
    selectAll(supabase, 'chalk_prop_snapshots', '*', (q) => q.eq('market', MARKET)),
    fetch(GAMES_URL).then((r) => r.text()),
    loadRoster(season),
  ]);

  const games = parse(scheduleText, { columns: true, skip_empty_lines: true }).filter(
    (g) => Number(g.season) === season && Number(g.week) === week && g.game_type === 'REG'
  );
  if (games.length === 0) {
    console.log(`No ${season} week ${week} games in the schedule.`);
    return;
  }

  const board = buildTdBoard({
    games, playerRows, defenseRows, propRows, roster, season, week,
    toAbbr: teams.toAbbr, nameKey,
  });

  console.log(`TD board — ${season} week ${week}`);
  console.log(`  stat basis: ${board.statsSeason}${board.usingPriorSeason ? ` full season (no ${season} games before week ${week})` : ' season to date'}`);
  console.log(`  qualifier: at least ${MIN_TOUCHES} touches per game (rushes + targets) over the last ${LAST_N} games`);
  console.log(`  defensive ranks: 1 = allows the most`);
  console.log(board.hasRoster
    ? `  rosters: ${season} roster file (${board.moved} players changed team since their last game)`
    : `  rosters: UNAVAILABLE, using each player's last-game team`);
  console.log();

  for (const g of board.games) {
    console.log(`${'='.repeat(112)}`);
    console.log(`${g.away} @ ${g.home}   ${g.gameday} ${g.gametime}   ` +
                `line ${g.spreadLine >= 0 ? '+' : ''}${g.spreadLine} / total ${g.totalLine}` +
                (g.hasProps ? '' : '   [no prop snapshot]'));

    for (const side of g.sides) {
      const d = side.defence;
      console.log(`\n  ${side.team} vs ${side.opponent} defence — ` +
                  `${f(d?.rushTdPg)} rush TD/g (rank ${d?.rushRank ?? '-'}), ` +
                  `${f(d?.passTdPg)} pass TD/g (rank ${d?.passRank ?? '-'}), ` +
                  `RZ TD rate ${f(d?.rzRate)} (${d?.rzTd ?? 0}/${d?.rzTrips ?? 0})`);

      if (side.players.length === 0) {
        console.log('    (no player clears the touch threshold)');
        continue;
      }

      console.log(
        '    ' + pad('player', 20) + pad('pos', 5) + pad('vs', 6) +
        pad('sRuTD', 7, false) + pad('sReTD', 7, false) +
        pad('L4RuTD', 8, false) + pad('L4ReTD', 8, false) +
        pad('L4gl/g', 8, false) + pad('L4rz/g', 8, false) + pad('tch/g', 7, false) +
        pad('DruTD/g', 9, false) + pad('DpaTD/g', 9, false) + pad('Drz%', 7, false) +
        pad('price', 8, false) + '  book'
      );
      for (const b of side.players) {
        const showRush = b.vs === 'RUSH' || b.vs === 'BOTH';
        const showPass = b.vs === 'PASS' || b.vs === 'BOTH';
        console.log(
          '    ' + pad(b.name, 20) + pad(b.pos, 5) + pad(b.vs, 6) +
          pad(b.seasonRushTd, 7, false) + pad(b.seasonRecTd, 7, false) +
          pad(b.l4RushTd, 8, false) + pad(b.l4RecTd, 8, false) +
          pad(f(b.glPg), 8, false) + pad(f(b.rzPg), 8, false) + pad(f(b.touchesPg, 1), 7, false) +
          pad(showRush ? `${f(d?.rushTdPg)}(${d?.rushRank ?? '-'})` : '-', 9, false) +
          pad(showPass ? `${f(d?.passTdPg)}(${d?.passRank ?? '-'})` : '-', 9, false) +
          pad(f(d?.rzRate), 7, false) +
          pad(fmtPrice(b.price), 8, false) + '  ' + (b.book ?? '-')
        );
      }
    }
    console.log();
  }

  console.log('='.repeat(112));
  if (board.unmatchedProps.length) {
    console.log(`Props names with no match in ${season - 1}/${season} nflverse player data ` +
                `(${board.unmatchedProps.length}); team defences excluded:`);
    for (const u of board.unmatchedProps) console.log(`  ${u}`);
  } else {
    console.log('Every props name matched an nflverse player.');
  }
  if (board.noPrice.length) {
    console.log(`\nBoard players with no anytime-TD price (${board.noPrice.length}):`);
    for (const u of board.noPrice) console.log(`  ${u}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { nameKey, decimal };
