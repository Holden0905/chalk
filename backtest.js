require('dotenv').config();
const { parse } = require('csv-parse/sync');
const { createClient } = require('@supabase/supabase-js');
const { computeRatings, loadWeights, mean } = require('./rate.js');

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

const mae = (xs) => (xs.length ? xs.reduce((a, b) => a + Math.abs(b), 0) / xs.length : null);

// Least-squares slope of actual margin on our implied spread. A slope near 1
// means the points scale is calibrated; below 1 means the numbers are too
// spread out, above 1 too compressed.
function slope(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den ? num / den : null;
}

function pad(s, n, right = false) {
  s = String(s);
  return right ? s.padEnd(n) : s.padStart(n);
}

async function main() {
  const season = Number(process.argv[2] || 2025);
  const firstWeek = 2;
  const lastWeek = 18;

  const SUPABASE_URL = requireEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_KEY = requireEnv('SUPABASE_SERVICE_KEY');
  const weights = loadWeights();

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const teamWeeks = await selectAll(supabase, 'chalk_team_weeks', '*', (q) =>
    q.in('season', [season - 1, season])
  );

  const res = await fetch(GAMES_URL);
  if (!res.ok) {
    console.error(`Schedule download failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const games = parse(await res.text(), { columns: true, skip_empty_lines: true }).filter(
    (g) =>
      Number(g.season) === season &&
      g.game_type === 'REG' &&
      Number(g.week) >= firstWeek &&
      Number(g.week) <= lastWeek &&
      g.home_score !== '' &&
      g.spread_line !== ''
  );

  const priorCount = teamWeeks.filter((r) => Number(r.season) === season - 1).length;
  console.log(`Backtest ${season}, weeks ${firstWeek}-${lastWeek}`);
  console.log(`  team-week rows: ${teamWeeks.length} (${priorCount} from ${season - 1} for the prior-season blend)`);
  console.log(`  games with a closing line: ${games.length}`);
  console.log(`  home_field ${weights.home_field}, rating_points_per_sd ${weights.rating_points_per_sd}, ` +
              `opponent_adjust_iterations ${weights.opponent_adjust_iterations}`);
  console.log();

  const rows = [];
  const lookahead = [];

  for (let week = firstWeek; week <= lastWeek; week++) {
    const { ratings, maxWeekUsed, blend } = computeRatings(teamWeeks, season, week, weights);
    lookahead.push({ week, maxWeekUsed, blend, teams: ratings.length });

    const byTeam = new Map(ratings.map((r) => [r.team, r]));
    for (const g of games.filter((x) => Number(x.week) === week)) {
      const home = byTeam.get(g.home_team);
      const away = byTeam.get(g.away_team);
      if (!home || !away) continue;
      // The schedule marks international and other neutral sites; no home edge there.
      const hf = g.location === 'Home' ? weights.home_field : 0;
      const implied = home.team_rating - away.team_rating + hf;
      const vegas = Number(g.spread_line);
      const actual = Number(g.home_score) - Number(g.away_score);
      rows.push({ week, home: g.home_team, away: g.away_team, implied, vegas, actual });
    }
  }

  // ---- lookahead audit ----
  const violations = lookahead.filter((l) => l.maxWeekUsed != null && l.maxWeekUsed >= l.week);
  console.log('Lookahead audit (week N ratings may only use weeks < N)');
  console.log(`  ${pad('week', 5)}${pad('latest week used', 20)}${pad('prior blend', 14)}${pad('teams', 7)}`);
  for (const l of lookahead) {
    console.log(`  ${pad(l.week, 5)}${pad(l.maxWeekUsed ?? '-', 20)}${pad((l.blend * 100).toFixed(1) + '%', 14)}${pad(l.teams, 7)}`);
  }
  console.log(`  violations: ${violations.length}` + (violations.length ? '  *** LOOKAHEAD LEAK ***' : '  (clean)'));
  console.log();

  // ---- accuracy ----
  const ourErr = rows.map((r) => r.implied - r.actual);
  const vegasErr = rows.map((r) => r.vegas - r.actual);

  console.log('Spread accuracy by week');
  console.log(`  ${pad('week', 5)}${pad('games', 7)}${pad('our MAE', 10)}${pad('vegas MAE', 11)}${pad('diff', 9)}`);
  for (let week = firstWeek; week <= lastWeek; week++) {
    const w = rows.filter((r) => r.week === week);
    if (!w.length) continue;
    const o = mae(w.map((r) => r.implied - r.actual));
    const v = mae(w.map((r) => r.vegas - r.actual));
    console.log(`  ${pad(week, 5)}${pad(w.length, 7)}${pad(o.toFixed(3), 10)}${pad(v.toFixed(3), 11)}${pad((o - v >= 0 ? '+' : '') + (o - v).toFixed(3), 9)}`);
  }
  const oAll = mae(ourErr);
  const vAll = mae(vegasErr);
  console.log(`  ${pad('ALL', 5)}${pad(rows.length, 7)}${pad(oAll.toFixed(3), 10)}${pad(vAll.toFixed(3), 11)}${pad((oAll - vAll >= 0 ? '+' : '') + (oAll - vAll).toFixed(3), 9)}`);
  console.log();

  const k = slope(rows.map((r) => r.implied), rows.map((r) => r.actual));
  const kv = slope(rows.map((r) => r.vegas), rows.map((r) => r.actual));
  console.log('Calibration (slope of actual margin on the number; 1.00 is perfectly scaled)');
  console.log(`  ours  ${k.toFixed(3)}   vegas ${kv.toFixed(3)}`);
  console.log(`  implied spread SD ${Math.sqrt(mean(rows.map((r) => (r.implied - mean(rows.map((x) => x.implied))) ** 2))).toFixed(2)}, ` +
              `vegas SD ${Math.sqrt(mean(rows.map((r) => (r.vegas - mean(rows.map((x) => x.vegas))) ** 2))).toFixed(2)}`);
  console.log();

  // ---- ATS ----
  console.log('ATS record betting the side our number favours, by disagreement with Vegas');
  console.log(`  ${pad('edge', 6)}${pad('bets', 7)}${pad('W', 6)}${pad('L', 6)}${pad('P', 5)}${pad('win%', 9)}${pad('vs 52.38% BE', 15)}`);
  for (const threshold of [1, 2, 3, 4]) {
    let w = 0;
    let l = 0;
    let p = 0;
    for (const r of rows) {
      const edge = r.implied - r.vegas;
      if (Math.abs(edge) < threshold) continue;
      const onHome = edge > 0;
      const cover = r.actual - r.vegas; // >0 home covers, <0 away covers
      if (cover === 0) p++;
      else if (cover > 0 === onHome) w++;
      else l++;
    }
    const decided = w + l;
    const pct = decided ? (w / decided) * 100 : null;
    const delta = pct == null ? null : pct - 52.38;
    console.log(
      `  ${pad('>=' + threshold, 6)}${pad(w + l + p, 7)}${pad(w, 6)}${pad(l, 6)}${pad(p, 5)}` +
        `${pad(pct == null ? '-' : pct.toFixed(1) + '%', 9)}${pad(delta == null ? '-' : (delta >= 0 ? '+' : '') + delta.toFixed(1) + ' pts', 15)}`
    );
  }
  console.log();

  // ---- totals ----
  console.log('Totals');
  console.log('  Not produced. This rating is margin-only by construction: every input is a');
  console.log('  z-scored efficiency rate, and chalk_team_weeks stores no points scored or');
  console.log('  allowed, so there is nothing to anchor an expected points total to. A totals');
  console.log('  model needs points for/against added to the team-week table first.');
  console.log(`  For reference, Vegas total_line MAE over these ${games.length} games would be the bar to beat.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
