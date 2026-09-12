// Bucketed closing-line outcomes. Descriptive only: no model, no fitting, just
// how often the home side covered and how often the total went over inside each
// slice of games.
const { parse } = require('csv-parse/sync');

const GAMES_URL =
  'https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv';

const SEASONS = ['2024', '2025'];

// A team is "off a big loss" if its previous game that season ended in a defeat
// by this much or more.
const BLOWOUT = 17;

function pad(s, n, right = false) {
  s = String(s);
  return right ? s.padEnd(n) : s.padStart(n);
}

// Annotate each game with the two teams' previous-game margins, so bucket rules
// can ask what a team is coming off.
function withPriorResults(games) {
  const byTeam = new Map();
  const sorted = [...games].sort(
    (a, b) => a.gameday.localeCompare(b.gameday) || Number(a.week) - Number(b.week)
  );
  for (const g of sorted) {
    const margin = Number(g.home_score) - Number(g.away_score);
    for (const [team, own] of [[g.home_team, margin], [g.away_team, -margin]]) {
      const key = `${g.season}:${team}`;
      g[team === g.home_team ? 'home_prev_margin' : 'away_prev_margin'] =
        byTeam.has(key) ? byTeam.get(key) : null;
      byTeam.set(key, own);
    }
  }
  return sorted;
}

const month = (g) => Number(g.gameday.slice(5, 7));

const BUCKETS = [
  ['divisional', (g) => g.div_game === '1'],
  ['non-divisional', (g) => g.div_game !== '1'],
  null,
  ['home on a short week (rest <= 4)', (g) => Number(g.home_rest) <= 4],
  ['home on normal rest', (g) => Number(g.home_rest) > 4],
  null,
  ['home off a bye (rest >= 13)', (g) => Number(g.home_rest) >= 13],
  ['home not off a bye', (g) => Number(g.home_rest) < 13],
  null,
  ['either team off a 17+ point loss',
    (g) => (g.home_prev_margin != null && g.home_prev_margin <= -BLOWOUT) ||
           (g.away_prev_margin != null && g.away_prev_margin <= -BLOWOUT)],
  ['neither team off a 17+ point loss',
    (g) => !((g.home_prev_margin != null && g.home_prev_margin <= -BLOWOUT) ||
             (g.away_prev_margin != null && g.away_prev_margin <= -BLOWOUT))],
  null,
  ['home favourite by 7+', (g) => Number(g.spread_line) >= 7],
  ['home underdog (line < 0)', (g) => Number(g.spread_line) < 0],
  null,
  ['total line under 40', (g) => Number(g.total_line) < 40],
  ['total line 40 to 47', (g) => Number(g.total_line) >= 40 && Number(g.total_line) <= 47],
  ['total line over 47', (g) => Number(g.total_line) > 47],
  null,
  ['weeks 1-4', (g) => Number(g.week) <= 4],
  ['weeks 5-18', (g) => Number(g.week) >= 5],
  null,
  ['outdoors in Dec/Jan', (g) => g.roof === 'outdoors' && (month(g) === 12 || month(g) === 1)],
  ['everything else', (g) => !(g.roof === 'outdoors' && (month(g) === 12 || month(g) === 1))],
];

function rates(games) {
  let cov = 0;
  let covPush = 0;
  let covN = 0;
  let ov = 0;
  let ovPush = 0;
  let ovN = 0;
  for (const g of games) {
    const margin = Number(g.home_score) - Number(g.away_score);
    const spread = Number(g.spread_line);
    if (Number.isFinite(spread)) {
      if (margin === spread) covPush++;
      else {
        covN++;
        if (margin > spread) cov++;
      }
    }
    const total = Number(g.home_score) + Number(g.away_score);
    const line = Number(g.total_line);
    if (Number.isFinite(line)) {
      if (total === line) ovPush++;
      else {
        ovN++;
        if (total > line) ov++;
      }
    }
  }
  return {
    n: games.length,
    cover: covN ? (cov / covN) * 100 : null,
    coverN: covN,
    coverPush: covPush,
    over: ovN ? (ov / ovN) * 100 : null,
    overN: ovN,
    overPush: ovPush,
  };
}

async function main() {
  const res = await fetch(GAMES_URL);
  if (!res.ok) {
    console.error(`Schedule download failed: HTTP ${res.status}`);
    process.exit(1);
  }
  const all = parse(await res.text(), { columns: true, skip_empty_lines: true });
  const games = withPriorResults(
    all.filter(
      (g) =>
        SEASONS.includes(g.season) &&
        g.game_type === 'REG' &&
        g.home_score !== '' &&
        g.spread_line !== ''
    )
  );

  const overall = rates(games);
  console.log(`Closing-line outcomes by bucket, ${SEASONS.join(' + ')} regular season`);
  console.log(`  ${games.length} completed games with a closing line ` +
              `(${SEASONS.map((s) => `${s}: ${games.filter((g) => g.season === s).length}`).join(', ')})`);
  console.log(`  Pushes are excluded from each rate: ${overall.coverPush} spread, ${overall.overPush} total.`);
  console.log(`  Baseline: home covers ${overall.cover.toFixed(1)}%, over hits ${overall.over.toFixed(1)}%.`);
  console.log();

  const head =
    `  ${pad('bucket', 36, true)}${pad('games', 7)}${pad('cover%', 9)}${pad('vs 50', 8)}` +
    `${pad('over%', 9)}${pad('vs 50', 8)}`;
  console.log(head);
  console.log('  ' + '-'.repeat(head.length - 2));

  for (const bucket of BUCKETS) {
    if (bucket === null) {
      console.log();
      continue;
    }
    const [name, fn] = bucket;
    const r = rates(games.filter(fn));
    if (r.n === 0) {
      console.log(`  ${pad(name, 36, true)}${pad(0, 7)}${pad('-', 9)}${pad('-', 8)}${pad('-', 9)}${pad('-', 8)}`);
      continue;
    }
    const cd = r.cover == null ? null : r.cover - 50;
    const od = r.over == null ? null : r.over - 50;
    console.log(
      `  ${pad(name, 36, true)}${pad(r.n, 7)}` +
        `${pad(r.cover == null ? '-' : r.cover.toFixed(1) + '%', 9)}` +
        `${pad(cd == null ? '-' : (cd >= 0 ? '+' : '') + cd.toFixed(1), 8)}` +
        `${pad(r.over == null ? '-' : r.over.toFixed(1) + '%', 9)}` +
        `${pad(od == null ? '-' : (od >= 0 ? '+' : '') + od.toFixed(1), 8)}`
    );
  }
  console.log();
  console.log('  Descriptive only. With ~20 buckets over 544 games, differences of a few');
  console.log('  points are what random variation looks like; a 50-game bucket has a');
  console.log(`  standard error near ${(Math.sqrt(0.25 / 50) * 100).toFixed(1)} points.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
