const assert = require('node:assert/strict');
const { computeRatings, impliedTotal, loadWeights, zScores, mean, stdev } = require('../rate.js');

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); pass++; };

const W = loadWeights();

// A synthetic team-week row. Values default to league-average-ish so a test can
// move one stat at a time and read the effect.
const tw = (o = {}) => ({
  season: 2025, week: 1, team: 'AAA', opponent: 'BBB', is_home: true,
  off_plays: 60, off_success_rate: 0.44, off_epa_per_play: 0.0,
  off_points_per_trip_inside_40: 4.0, off_avg_start_yardline: 70, off_turnovers: 1,
  def_plays: 60, def_success_rate: 0.44, def_epa_per_play: 0.0,
  def_points_per_trip_inside_40: 4.0, def_avg_start_yardline: 70, def_turnovers: 1,
  st_epa: 0, ...o,
});

// Four teams, two games, everyone average except where a test says otherwise.
function league(overrides = {}) {
  const pairs = [['AAA', 'BBB'], ['CCC', 'DDD']];
  const rows = [];
  for (const [h, a] of pairs) {
    rows.push(tw({ team: h, opponent: a, ...(overrides[h] || {}) }));
    rows.push(tw({ team: a, opponent: h, ...(overrides[a] || {}) }));
  }
  return rows;
}

// Opponent adjustment off: these tests are about which direction a stat
// points, and in a tiny closed league the adjustment folds an offense gain
// into an equal defense penalty, zeroing every rating.
const W0 = { ...W, opponent_adjust_iterations: 0 };

const rate = (rows, week = 2, weights = W) => {
  const { ratings } = computeRatings(rows, 2025, week, weights);
  return new Map(ratings.map((r) => [r.team, r]));
};

// --- lookahead: the property the whole backtest depends on ------------------
t('future weeks cannot influence an earlier rating', () => {
  const base = league({ AAA: { off_epa_per_play: 0.3 } });
  const before = rate(base, 2);

  // Add a wildly extreme week 5 for every team. A week 2 rating must not move.
  const polluted = base.concat(
    ['AAA', 'BBB', 'CCC', 'DDD'].map((team, i) =>
      tw({ team, week: 5, opponent: 'BBB',
           off_epa_per_play: i % 2 ? 5 : -5, off_success_rate: i % 2 ? 0.9 : 0.05,
           def_epa_per_play: i % 2 ? -5 : 5, st_epa: i % 2 ? 20 : -20 })
    )
  );
  const after = rate(polluted, 2);

  for (const team of ['AAA', 'BBB', 'CCC', 'DDD']) {
    assert.equal(after.get(team).team_rating, before.get(team).team_rating,
      `${team} rating moved when future weeks were added`);
  }
});

t('maxWeekUsed is always below the target week', () => {
  const rows = [1, 2, 3, 4, 5].flatMap((week) =>
    ['AAA', 'BBB', 'CCC', 'DDD'].map((team) => tw({ team, week, opponent: team === 'AAA' ? 'BBB' : 'AAA' }))
  );
  for (const week of [2, 3, 4, 5, 6]) {
    const { maxWeekUsed } = computeRatings(rows, 2025, week, W);
    assert.ok(maxWeekUsed < week, `week ${week} used week ${maxWeekUsed}`);
  }
});

t('the tripwire throws if a future row reaches the scoring path', () => {
  // Simulates a future refactor that widens the filter.
  assert.throws(() => {
    const rows = league();
    const patched = rows.map((r) => ({ ...r, week: 9 }));
    // week 9 rows with a target of 9 must not be treated as "before week 9"
    const { ratings } = computeRatings(patched, 2025, 9, W);
    assert.equal(ratings.filter((r) => r.games_used > 0).length, 0);
    throw new Error('no rows should have counted');
  }, /no rows should have counted/);
});

// --- stat orientation -------------------------------------------------------
t('better field position (lower yardline_100) raises offense', () => {
  const m = rate(league({ AAA: { off_avg_start_yardline: 60 }, BBB: { off_avg_start_yardline: 80 } }), 2, W0);
  assert.ok(m.get('AAA').offense_rating > m.get('BBB').offense_rating);
});

t('fewer giveaways raises offense', () => {
  const m = rate(league({ AAA: { off_turnovers: 0 }, BBB: { off_turnovers: 3 } }), 2, W0);
  assert.ok(m.get('AAA').offense_rating > m.get('BBB').offense_rating);
});

t('defense is inverted: allowing less EPA raises defense rating', () => {
  const m = rate(league({ AAA: { def_epa_per_play: -0.3 }, BBB: { def_epa_per_play: 0.3 } }), 2, W0);
  assert.ok(m.get('AAA').defense_rating > m.get('BBB').defense_rating);
});

t('more takeaways raises defense rating', () => {
  const m = rate(league({ AAA: { def_turnovers: 4 }, BBB: { def_turnovers: 0 } }), 2, W0);
  assert.ok(m.get('AAA').defense_rating > m.get('BBB').defense_rating);
});

t('pushing the opponent back (higher def_avg_start_yardline) raises defense', () => {
  const m = rate(league({ AAA: { def_avg_start_yardline: 80 }, BBB: { def_avg_start_yardline: 60 } }), 2, W0);
  assert.ok(m.get('AAA').defense_rating > m.get('BBB').defense_rating);
});

t('better special teams raises st_rating', () => {
  const m = rate(league({ AAA: { st_epa: 5 }, BBB: { st_epa: -5 } }), 2, W0);
  assert.ok(m.get('AAA').st_rating > m.get('BBB').st_rating);
});

// --- composition and scale --------------------------------------------------
t('offense + defense + st equals team_rating (to rounding)', () => {
  const m = rate(league({ AAA: { off_epa_per_play: 0.4, def_turnovers: 3, st_epa: 2 } }), 2, W0);
  for (const r of m.values()) {
    const sum = r.offense_rating + r.defense_rating + r.st_rating;
    // Each field is rounded to 4dp independently, so the parts can miss the
    // whole by a few units in the last place. Anything larger is a real bug.
    assert.ok(Math.abs(sum - r.team_rating) < 5e-4, `${r.team}: ${sum} vs ${r.team_rating}`);
  }
});

t('ratings are centred on zero and scaled to rating_points_per_sd', () => {
  const m = rate(league({ AAA: { off_epa_per_play: 0.4 }, CCC: { off_epa_per_play: -0.4 } }), 2, W0);
  const vals = [...m.values()].map((r) => r.team_rating);
  assert.ok(Math.abs(mean(vals)) < 1e-6, 'not centred');
  assert.ok(Math.abs(stdev(vals) - W.rating_points_per_sd) < 1e-3, `SD ${stdev(vals)}`);
});

t('rating_points_per_sd actually rescales', () => {
  const rows = league({ AAA: { off_epa_per_play: 0.4 } });
  const a = rate(rows, 2, { ...W0, rating_points_per_sd: 5 });
  const b = rate(rows, 2, { ...W0, rating_points_per_sd: 10 });
  assert.ok(Math.abs(b.get('AAA').team_rating - 2 * a.get('AAA').team_rating) < 1e-3);
});

// --- prior season blend -----------------------------------------------------
t('week 1 leans on the prior season', () => {
  const prior = league({ AAA: { off_epa_per_play: 0.5 } }).map((r) => ({ ...r, season: 2024 }));
  const { ratings, blend } = computeRatings(prior, 2025, 1, W);
  assert.equal(blend, W.prior_season_blend[0]);
  const aaa = ratings.find((r) => r.team === 'AAA');
  assert.equal(aaa.games_used, 0, 'no current-season games in week 1');
  assert.ok(aaa.offense_rating > 0, 'prior-season strength should still show');
});

t('blend reaches zero by week 9', () => {
  assert.equal(W.prior_season_blend[8], 0);
  const prior = league({ AAA: { off_epa_per_play: 0.5 } }).map((r) => ({ ...r, season: 2024 }));
  const current = league();
  const { blend } = computeRatings(prior.concat(current), 2025, 9, W);
  assert.equal(blend, 0);
});

// --- opponent adjustment ---------------------------------------------------
t('facing tougher defenses lifts an offense relative to an identical team', () => {
  // Six teams. AAA and CCC post the same offensive numbers, but AAA's two
  // opponents have strong defenses and CCC's have weak ones.
  const strongDef = { def_epa_per_play: -0.35, def_success_rate: 0.36 };
  const weakDef = { def_epa_per_play: 0.35, def_success_rate: 0.52 };
  const rows = [
    tw({ team: 'AAA', week: 1, opponent: 'BBB', off_epa_per_play: 0.1 }),
    tw({ team: 'AAA', week: 2, opponent: 'DDD', off_epa_per_play: 0.1 }),
    tw({ team: 'CCC', week: 1, opponent: 'EEE', off_epa_per_play: 0.1 }),
    tw({ team: 'CCC', week: 2, opponent: 'FFF', off_epa_per_play: 0.1 }),
    tw({ team: 'BBB', week: 1, opponent: 'AAA', ...strongDef }),
    tw({ team: 'DDD', week: 2, opponent: 'AAA', ...strongDef }),
    tw({ team: 'EEE', week: 1, opponent: 'CCC', ...weakDef }),
    tw({ team: 'FFF', week: 2, opponent: 'CCC', ...weakDef }),
  ];
  const adjusted = rate(rows, 3, { ...W, opponent_adjust_iterations: 5 });
  const unadjusted = rate(rows, 3, W0);

  assert.equal(unadjusted.get('AAA').offense_rating, unadjusted.get('CCC').offense_rating,
    'identical raw offenses should start equal');
  assert.ok(adjusted.get('AAA').offense_rating > adjusted.get('CCC').offense_rating,
    'the team that faced better defenses should end up rated higher');
});

// --- implied total ----------------------------------------------------------
t('two average teams imply the league average total', () => {
  const rows = league();
  for (const r of rows) { r.off_points = 23; r.def_points = 23; }
  const { ratings, leagueAvgTotal } = computeRatings(rows, 2025, 2, W0);
  assert.equal(leagueAvgTotal, 46);
  const m = new Map(ratings.map((r) => [r.team, r]));
  const total = impliedTotal(m.get('AAA'), m.get('BBB'), leagueAvgTotal);
  assert.ok(Math.abs(total - 46) < 1e-6, `expected 46, got ${total}`);
});

t('two high-scoring offenses imply a higher total than two low-scoring ones', () => {
  const rows = league();
  for (const r of rows) {
    const hot = r.team === 'AAA' || r.team === 'BBB';
    r.off_points = hot ? 34 : 13;
    r.def_points = hot ? 34 : 13;
    r.off_epa_per_play = hot ? 0.3 : -0.3;
    r.def_epa_per_play = hot ? 0.3 : -0.3;
  }
  const { ratings, leagueAvgTotal } = computeRatings(rows, 2025, 2, W0);
  const m = new Map(ratings.map((r) => [r.team, r]));
  const hotGame = impliedTotal(m.get('AAA'), m.get('BBB'), leagueAvgTotal);
  const coldGame = impliedTotal(m.get('CCC'), m.get('DDD'), leagueAvgTotal);
  assert.ok(hotGame > coldGame, `${hotGame} should exceed ${coldGame}`);
});

t('a stronger defense pulls the implied total down', () => {
  const rows = league();
  for (const r of rows) { r.off_points = 23; r.def_points = r.team === 'AAA' ? 10 : 23; }
  const { ratings, leagueAvgTotal } = computeRatings(rows, 2025, 2, W0);
  const m = new Map(ratings.map((r) => [r.team, r]));
  assert.ok(m.get('AAA').def_points_rating > 0, 'AAA allows fewer points, so rates above average');
  assert.ok(impliedTotal(m.get('AAA'), m.get('BBB'), leagueAvgTotal) < leagueAvgTotal);
});

// --- helpers ----------------------------------------------------------------
t('zScores centre and normalise', () => {
  const z = zScores([1, 2, 3, 4, 5]);
  assert.ok(Math.abs(mean(z)) < 1e-12);
  assert.ok(z[0] < 0 && z[4] > 0);
});

t('zScores treat nulls as league average', () => {
  assert.equal(zScores([null, null])[0], 0);
});

console.log(`\n${pass} assertions passed`);
