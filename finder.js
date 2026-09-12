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

const MARKET = 'player_anytime_td';
const MIN_TOUCHES = 6;      // per game, averaged over the last four
const LAST_N = 4;
const SKILL = new Set(['QB', 'RB', 'WR', 'TE']);

// Which defensive touchdown rate is the relevant one for a player.
const MATCHUP = { RB: 'BOTH', QB: 'RUSH', WR: 'PASS', TE: 'PASS' };

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

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

/**
 * Collapse either naming style to one key. nflverse writes "A.St. Brown";
 * the props feed writes "Amon-Ra St. Brown". Both become "a|stbrown".
 */
function nameKey(name) {
  if (!name) return null;
  let parts = String(name).trim().split(/\s+/);
  while (parts.length > 1) {
    const last = parts[parts.length - 1].replace(/[.,]/g, '').toLowerCase();
    if (SUFFIXES.has(last)) parts.pop();
    else break;
  }
  if (parts.length === 0) return null;

  const ALL_INITIALS = /^([A-Za-z]\.)+$/;
  let initial;
  let rest;

  // nflverse writes "D.Adams" or "A.St. Brown": an initial, a dot, then the
  // surname. It widens the initial to disambiguate two players who would
  // otherwise collide, as in "Ty.Johnson" and "Ja.Williams", so up to three
  // leading letters are allowed. "C.J. Stroud" matches the same shape but is a
  // two-initial given name, so this only counts when what follows the dot is
  // not itself initials.
  const abbreviated = parts[0].match(/^([A-Za-z]{1,3})\.(.*)$/);
  if (abbreviated && abbreviated[2] && !ALL_INITIALS.test(abbreviated[2])) {
    initial = abbreviated[1][0];
    rest = [abbreviated[2], ...parts.slice(1)];
  } else {
    initial = parts[0][0];
    rest = parts.slice(1);
    // Drop middle initials: "Michael J. Smith", "C.J. Stroud".
    while (rest.length > 1 && ALL_INITIALS.test(rest[0])) rest.shift();
  }
  if (rest.length === 0) return null;
  return `${initial}|${rest.join('')}`.toLowerCase().replace(/[^a-z|]/g, '');
}

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

  // Season-to-date within the target season, falling back to the prior season
  // when the target week is early enough that nothing has been played.
  const seasonToDate = (rows) => rows.filter((r) => Number(r.season) === season && Number(r.week) < week);
  const usingPriorSeason = seasonToDate(playerRows).length === 0;
  const statsSeason = usingPriorSeason ? season - 1 : season;
  const seasonSlice = (rows) =>
    usingPriorSeason
      ? rows.filter((r) => Number(r.season) === season - 1)
      : seasonToDate(rows);

  // Everything playable before the target week, oldest first, for last-N windows.
  const chronological = (rows) =>
    rows
      .filter((r) => Number(r.season) === season - 1 || (Number(r.season) === season && Number(r.week) < week))
      .sort((a, b) => Number(a.season) - Number(b.season) || Number(a.week) - Number(b.week));

  // ---- defense aggregates and league ranks ----
  const defBySeason = seasonSlice(defenseRows);
  const defByTeam = new Map();
  for (const r of defBySeason) {
    if (!defByTeam.has(r.team)) {
      defByTeam.set(r.team, { games: 0, rushTd: 0, passTd: 0, rzTrips: 0, rzTd: 0 });
    }
    const d = defByTeam.get(r.team);
    d.games += 1;
    d.rushTd += n(r.rush_td_allowed);
    d.passTd += n(r.pass_td_allowed);
    d.rzTrips += n(r.rz_trips_allowed);
    d.rzTd += n(r.rz_td_allowed);
  }
  for (const d of defByTeam.values()) {
    d.rushTdPg = div(d.rushTd, d.games);
    d.passTdPg = div(d.passTd, d.games);
    d.rzRate = div(d.rzTd, d.rzTrips);
  }
  // Rank 1 = softest, i.e. allows the most.
  const rankBy = (key) => {
    const sorted = [...defByTeam.entries()].sort((a, b) => (b[1][key] ?? -1) - (a[1][key] ?? -1));
    return new Map(sorted.map(([team], i) => [team, i + 1]));
  };
  const rushRank = rankBy('rushTdPg');
  const passRank = rankBy('passTdPg');

  // ---- player aggregates ----
  const byPlayer = new Map();
  for (const r of chronological(playerRows)) {
    if (!byPlayer.has(r.player_id)) byPlayer.set(r.player_id, []);
    byPlayer.get(r.player_id).push(r);
  }
  const seasonByPlayer = new Map();
  for (const r of seasonSlice(playerRows)) {
    if (!seasonByPlayer.has(r.player_id)) seasonByPlayer.set(r.player_id, { rushTd: 0, recTd: 0 });
    const s = seasonByPlayer.get(r.player_id);
    s.rushTd += n(r.rush_td);
    s.recTd += n(r.rec_td);
  }

  // Where each player is NOW, not where they last played.
  const currentTeam = (playerId, fallback) => roster?.get(playerId)?.team ?? fallback;
  const currentPos = (playerId, fallback) => roster?.get(playerId)?.position ?? fallback;
  let moved = 0;
  for (const [playerId, rows] of byPlayer) {
    const last = rows[rows.length - 1];
    if (roster?.has(playerId) && roster.get(playerId).team !== last.team) moved += 1;
  }

  // ---- props: newest capture per player per book, keyed by matchup ----
  const propsByGame = new Map();
  const latestCapture = new Map();
  for (const p of propRows) {
    const k = `${p.game_id}|${p.player_name}|${p.bookmaker}`;
    const prev = latestCapture.get(k);
    if (!prev || Date.parse(p.captured_at) > Date.parse(prev.captured_at)) latestCapture.set(k, p);
  }
  for (const p of latestCapture.values()) {
    const home = teams.toAbbr(p.home_team);
    const away = teams.toAbbr(p.away_team);
    if (!home || !away) continue;
    const key = `${away}@${home}`;
    if (!propsByGame.has(key)) propsByGame.set(key, []);
    propsByGame.get(key).push(p);
  }

  console.log(`TD board — ${season} week ${week}`);
  console.log(`  stat basis: ${statsSeason}${usingPriorSeason ? ` full season (no ${season} games before week ${week})` : ' season to date'}`);
  console.log(`  qualifier: at least ${MIN_TOUCHES} touches per game (rushes + targets) over the last ${LAST_N} games`);
  console.log(`  defensive ranks: 1 = allows the most`);
  console.log(roster
    ? `  rosters: ${season} roster file (${moved} players changed team since their last game)`
    : `  rosters: UNAVAILABLE, using each player's last-game team`);
  console.log();

  const unmatchedProps = [];
  const noPrice = [];
  // Every nflverse player name we know about, for match reporting.
  const leagueKeys = new Set(playerRows.map((r) => nameKey(r.player_name)).filter(Boolean));

  for (const g of games) {
    const key = `${g.away_team}@${g.home_team}`;
    const gameProps = propsByGame.get(key) || [];

    // Best available price per player across books.
    const best = new Map();
    for (const p of gameProps) {
      if (p.outcome !== 'Yes') continue;
      const k = nameKey(p.player_name);
      if (!k) continue;
      const d = decimal(p.price);
      const cur = best.get(k);
      if (!cur || (d != null && d > cur.decimal)) {
        best.set(k, { decimal: d, price: p.price, book: p.bookmaker, name: p.player_name });
      }
    }

    console.log(`${'='.repeat(112)}`);
    console.log(`${g.away_team} @ ${g.home_team}   ${g.gameday} ${g.gametime}   ` +
                `line ${g.spread_line >= 0 ? '+' : ''}${g.spread_line} / total ${g.total_line}` +
                (gameProps.length ? '' : '   [no prop snapshot]'));

    for (const side of ['away', 'home']) {
      const team = side === 'away' ? g.away_team : g.home_team;
      const opp = side === 'away' ? g.home_team : g.away_team;
      const d = defByTeam.get(opp);

      console.log(`\n  ${team} vs ${opp} defence — ` +
                  `${f(d?.rushTdPg)} rush TD/g (rank ${d ? rushRank.get(opp) : '-'}), ` +
                  `${f(d?.passTdPg)} pass TD/g (rank ${d ? passRank.get(opp) : '-'}), ` +
                  `RZ TD rate ${f(d?.rzRate)} (${d?.rzTd ?? 0}/${d?.rzTrips ?? 0})`);

      const board = [];
      for (const [playerId, rows] of byPlayer) {
        const last = rows.slice(-LAST_N);
        if (last.length === 0) continue;
        const recent = last[last.length - 1];
        if (currentTeam(playerId, recent.team) !== team) continue;
        const pos = currentPos(playerId, recent.position);
        if (!SKILL.has(pos)) continue;

        const touches = last.reduce((a, r) => a + n(r.rush_att) + n(r.targets), 0);
        const perGame = touches / last.length;
        if (perGame < MIN_TOUCHES) continue;

        const s = seasonByPlayer.get(playerId) || { rushTd: 0, recTd: 0 };
        const k = nameKey(recent.player_name);
        const price = k ? best.get(k) : null;
        if (gameProps.length && !price) noPrice.push(`${recent.player_name} (${team})`);

        board.push({
          name: recent.player_name,
          pos,
          vs: MATCHUP[pos] || '-',
          seasonRushTd: s.rushTd,
          seasonRecTd: s.recTd,
          l4RushTd: last.reduce((a, r) => a + n(r.rush_td), 0),
          l4RecTd: last.reduce((a, r) => a + n(r.rec_td), 0),
          glPg: last.reduce((a, r) => a + n(r.gl_touches), 0) / last.length,
          rzPg: last.reduce((a, r) => a + n(r.rz_rush_att) + n(r.rz_targets), 0) / last.length,
          touchesPg: perGame,
          price,
        });
      }

      board.sort((a, b) => b.glPg - a.glPg || b.rzPg - a.rzPg);

      if (board.length === 0) {
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
      for (const b of board) {
        const showRush = b.vs === 'RUSH' || b.vs === 'BOTH';
        const showPass = b.vs === 'PASS' || b.vs === 'BOTH';
        console.log(
          '    ' + pad(b.name, 20) + pad(b.pos, 5) + pad(b.vs, 6) +
          pad(b.seasonRushTd, 7, false) + pad(b.seasonRecTd, 7, false) +
          pad(b.l4RushTd, 8, false) + pad(b.l4RecTd, 8, false) +
          pad(f(b.glPg), 8, false) + pad(f(b.rzPg), 8, false) + pad(f(b.touchesPg, 1), 7, false) +
          pad(showRush ? `${f(d?.rushTdPg)}(${rushRank.get(opp) ?? '-'})` : '-', 9, false) +
          pad(showPass ? `${f(d?.passTdPg)}(${passRank.get(opp) ?? '-'})` : '-', 9, false) +
          pad(f(d?.rzRate), 7, false) +
          pad(fmtPrice(b.price?.price), 8, false) + '  ' + (b.price?.book ?? '-')
        );
      }
    }

    // Props names that match no nflverse player anywhere. Scoping this to the
    // game's two rosters would flag every player who changed teams.
    for (const [k, v] of best) {
      if (TEAM_DEFENCE.test(v.name)) continue;
      if (!leagueKeys.has(k)) unmatchedProps.push(`${v.name} (${key})`);
    }
    console.log();
  }

  console.log('='.repeat(112));
  if (unmatchedProps.length) {
    console.log(`Props names with no match in ${season - 1}/${season} nflverse player data ` +
                `(${unmatchedProps.length}); team defences excluded:`);
    for (const u of [...new Set(unmatchedProps)].sort()) console.log(`  ${u}`);
  } else {
    console.log('Every props name matched an nflverse player.');
  }
  if (noPrice.length) {
    console.log(`\nBoard players with no anytime-TD price (${new Set(noPrice).size}):`);
    for (const u of [...new Set(noPrice)].sort()) console.log(`  ${u}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { nameKey, decimal };
