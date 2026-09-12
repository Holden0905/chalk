require('dotenv').config();
const { parse } = require('csv-parse/sync');
const { createClient } = require('@supabase/supabase-js');
const { computeRatings, impliedTotal, loadWeights, mean } = require('./rate.js');

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

const FIRST_WEEK = 2;
const LAST_WEEK = 18;
const THRESHOLDS = [1, 2, 3, 4, 5, 6];
const BREAK_EVEN = 52.38;

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
const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};

function slope(xs, ys) {
  const mx = mean(xs);
  const my = mean(ys);
  let n = 0;
  let d = 0;
  for (let i = 0; i < xs.length; i++) {
    n += (xs[i] - mx) * (ys[i] - my);
    d += (xs[i] - mx) ** 2;
  }
  return d ? n / d : null;
}

function pad(s, n, right = false) {
  s = String(s);
  return right ? s.padEnd(n) : s.padStart(n);
}

// Bet the side our number favours whenever it disagrees with the line by at
// least `threshold`. `pick` returns true when our number points at the first
// outcome (home, or over); `result` is actual minus line.
function record(rows, edgeOf, resultOf, threshold) {
  let w = 0;
  let l = 0;
  let p = 0;
  for (const r of rows) {
    const edge = edgeOf(r);
    if (Math.abs(edge) < threshold) continue;
    const res = resultOf(r);
    if (res === 0) p++;
    else if (res > 0 === edge > 0) w++;
    else l++;
  }
  const decided = w + l;
  return { w, l, p, bets: w + l + p, pct: decided ? (w / decided) * 100 : null };
}

function printRecord(title, rows, edgeOf, resultOf) {
  console.log(title);
  console.log(`  ${pad('edge', 6)}${pad('bets', 7)}${pad('W', 6)}${pad('L', 6)}${pad('P', 5)}${pad('win%', 9)}${pad(`vs ${BREAK_EVEN}% BE`, 15)}`);
  for (const threshold of THRESHOLDS) {
    const r = record(rows, edgeOf, resultOf, threshold);
    const delta = r.pct == null ? null : r.pct - BREAK_EVEN;
    console.log(
      `  ${pad('>=' + threshold, 6)}${pad(r.bets, 7)}${pad(r.w, 6)}${pad(r.l, 6)}${pad(r.p, 5)}` +
        `${pad(r.pct == null ? '-' : r.pct.toFixed(1) + '%', 9)}` +
        `${pad(delta == null ? '-' : (delta >= 0 ? '+' : '') + delta.toFixed(1) + ' pts', 15)}`
    );
  }
  console.log();
}

async function main() {
  const seasons = process.argv.slice(2).map(Number).filter(Number.isInteger);
  if (seasons.length === 0) seasons.push(2025);

  const SUPABASE_URL = requireEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_KEY = requireEnv('SUPABASE_SERVICE_KEY');
  const weights = loadWeights();

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const needed = [...new Set(seasons.flatMap((s) => [s - 1, s]))];
  const teamWeeks = await selectAll(supabase, 'chalk_team_weeks', '*', (q) => q.in('season', needed));

  const res = await fetch(GAMES_URL);
  if (!res.ok) {
    console.error(`Schedule download failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const schedule = parse(await res.text(), { columns: true, skip_empty_lines: true });

  console.log(`Backtest ${seasons.join(' + ')}, weeks ${FIRST_WEEK}-${LAST_WEEK}`);
  console.log(`  weights unchanged: rating_points_per_sd ${weights.rating_points_per_sd}, ` +
              `home_field ${weights.home_field}, scoring_blend ${weights.scoring_blend}`);
  for (const s of seasons) {
    const prior = teamWeeks.filter((r) => Number(r.season) === s - 1).length;
    console.log(`  ${s}: ${prior} prior-season (${s - 1}) team-weeks available for the blend`);
  }
  console.log();

  const rows = [];
  const audit = [];

  for (const season of seasons) {
    const games = schedule.filter(
      (g) =>
        Number(g.season) === season &&
        g.game_type === 'REG' &&
        Number(g.week) >= FIRST_WEEK &&
        Number(g.week) <= LAST_WEEK &&
        g.home_score !== '' &&
        g.spread_line !== ''
    );
    for (let week = FIRST_WEEK; week <= LAST_WEEK; week++) {
      const { ratings, leagueAvgTotal, maxWeekUsed } = computeRatings(teamWeeks, season, week, weights);
      audit.push({ season, week, maxWeekUsed });
      const byTeam = new Map(ratings.map((r) => [r.team, r]));
      for (const g of games.filter((x) => Number(x.week) === week)) {
        const home = byTeam.get(g.home_team);
        const away = byTeam.get(g.away_team);
        if (!home || !away) continue;
        const hf = g.location === 'Home' ? weights.home_field : 0;
        rows.push({
          season,
          week,
          implied: home.team_rating - away.team_rating + hf,
          vegas: Number(g.spread_line),
          actual: Number(g.home_score) - Number(g.away_score),
          impliedTotal: impliedTotal(home, away, leagueAvgTotal),
          vegasTotal: Number(g.total_line),
          actualTotal: Number(g.home_score) + Number(g.away_score),
        });
      }
    }
  }

  const violations = audit.filter((a) => a.maxWeekUsed != null && a.maxWeekUsed >= a.week);
  console.log(`Lookahead audit: ${audit.length} week-ratings checked, ` +
              `${violations.length} violations` + (violations.length ? ' *** LEAK ***' : ' (clean)'));
  console.log();

  // ---- spreads ----
  console.log('Spread accuracy');
  console.log(`  ${pad('season', 8)}${pad('games', 7)}${pad('our MAE', 10)}${pad('vegas MAE', 11)}${pad('diff', 9)}`);
  for (const season of seasons) {
    const w = rows.filter((r) => r.season === season);
    const o = mae(w.map((r) => r.implied - r.actual));
    const v = mae(w.map((r) => r.vegas - r.actual));
    console.log(`  ${pad(season, 8)}${pad(w.length, 7)}${pad(o.toFixed(3), 10)}${pad(v.toFixed(3), 11)}${pad((o - v >= 0 ? '+' : '') + (o - v).toFixed(3), 9)}`);
  }
  if (seasons.length > 1) {
    const o = mae(rows.map((r) => r.implied - r.actual));
    const v = mae(rows.map((r) => r.vegas - r.actual));
    console.log(`  ${pad('ALL', 8)}${pad(rows.length, 7)}${pad(o.toFixed(3), 10)}${pad(v.toFixed(3), 11)}${pad((o - v >= 0 ? '+' : '') + (o - v).toFixed(3), 9)}`);
  }
  const kS = slope(rows.map((r) => r.implied), rows.map((r) => r.actual));
  console.log(`  calibration slope ${kS.toFixed(3)} (vegas ${slope(rows.map((r) => r.vegas), rows.map((r) => r.actual)).toFixed(3)}), ` +
              `our SD ${sd(rows.map((r) => r.implied)).toFixed(2)}, vegas SD ${sd(rows.map((r) => r.vegas)).toFixed(2)}`);
  console.log(`  rating_points_per_sd for slope 1.000 on this sample: ${(weights.rating_points_per_sd * kS).toFixed(4)}`);
  console.log();

  printRecord(
    'ATS record betting the side our number favours, by disagreement with Vegas',
    rows,
    (r) => r.implied - r.vegas,
    (r) => r.actual - r.vegas
  );

  // ---- totals ----
  const tRows = rows.filter((r) => Number.isFinite(r.vegasTotal) && Number.isFinite(r.impliedTotal));
  console.log('Totals accuracy');
  console.log(`  ${pad('season', 8)}${pad('games', 7)}${pad('our MAE', 10)}${pad('vegas MAE', 11)}${pad('diff', 9)}`);
  for (const season of seasons) {
    const w = tRows.filter((r) => r.season === season);
    const o = mae(w.map((r) => r.impliedTotal - r.actualTotal));
    const v = mae(w.map((r) => r.vegasTotal - r.actualTotal));
    console.log(`  ${pad(season, 8)}${pad(w.length, 7)}${pad(o.toFixed(3), 10)}${pad(v.toFixed(3), 11)}${pad((o - v >= 0 ? '+' : '') + (o - v).toFixed(3), 9)}`);
  }
  if (seasons.length > 1) {
    const o = mae(tRows.map((r) => r.impliedTotal - r.actualTotal));
    const v = mae(tRows.map((r) => r.vegasTotal - r.actualTotal));
    console.log(`  ${pad('ALL', 8)}${pad(tRows.length, 7)}${pad(o.toFixed(3), 10)}${pad(v.toFixed(3), 11)}${pad((o - v >= 0 ? '+' : '') + (o - v).toFixed(3), 9)}`);
  }
  const kT = slope(tRows.map((r) => r.impliedTotal), tRows.map((r) => r.actualTotal));
  console.log(`  calibration slope ${kT.toFixed(3)} (vegas ${slope(tRows.map((r) => r.vegasTotal), tRows.map((r) => r.actualTotal)).toFixed(3)}), ` +
              `our SD ${sd(tRows.map((r) => r.impliedTotal)).toFixed(2)}, vegas SD ${sd(tRows.map((r) => r.vegasTotal)).toFixed(2)}`);
  console.log();

  printRecord(
    'O/U record betting the side our number favours, by disagreement with Vegas',
    tRows,
    (r) => r.impliedTotal - r.vegasTotal,
    (r) => r.actualTotal - r.vegasTotal
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
