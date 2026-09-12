require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const { createClient } = require('@supabase/supabase-js');
const { currentSeason } = require('./ingest_pbp.js');

function requireEnv(name) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return raw.trim();
}

function loadWeights(file = path.join(__dirname, 'weights.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// How each stat points. +1 means a higher value is better for that side of the
// ball, -1 means lower is better.
//
// field_position is avg_start_yardline, which is yardline_100 at drive start:
// for an offense a LOWER number is a better starting spot, while for a defense
// a HIGHER number means the opponent started further away. turnovers are
// giveaways on offense and takeaways on defense, so the sign flips there too.
const ORIENT = {
  offense: { success_rate: 1, epa_per_play: 1, finishing: 1, field_position: -1, turnovers: -1 },
  defense: { success_rate: -1, epa_per_play: -1, finishing: -1, field_position: 1, turnovers: 1 },
};

const COLUMN = {
  success_rate: 'success_rate',
  epa_per_play: 'epa_per_play',
  finishing: 'points_per_trip_inside_40',
  field_position: 'avg_start_yardline',
  turnovers: 'turnovers',
};

const STATS = Object.keys(COLUMN);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

function mean(xs) {
  const v = xs.filter((x) => x != null && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function stdev(xs) {
  const v = xs.filter((x) => x != null && Number.isFinite(x));
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
}

// success_rate and epa_per_play are per-play rates, so they aggregate weighted
// by snap count. The rest are per-game quantities and take a plain mean.
function aggregate(rows, side) {
  const out = {};
  const playsCol = `${side}_plays`;
  for (const stat of STATS) {
    const col = `${side}_${COLUMN[stat]}`;
    if (stat === 'success_rate' || stat === 'epa_per_play') {
      let wsum = 0;
      let psum = 0;
      for (const r of rows) {
        const v = num(r[col]);
        const p = num(r[playsCol]);
        if (v == null || !p) continue;
        wsum += v * p;
        psum += p;
      }
      out[stat] = psum > 0 ? wsum / psum : null;
    } else {
      out[stat] = mean(rows.map((r) => num(r[col])));
    }
  }
  return out;
}

function blendValue(current, prior, blend) {
  if (current == null && prior == null) return null;
  if (current == null) return prior;
  if (prior == null) return current;
  return (1 - blend) * current + blend * prior;
}

function zScores(values) {
  const m = mean(values);
  const s = stdev(values);
  return values.map((v) => (v == null || m == null || !s ? 0 : (v - m) / s));
}

/**
 * Ratings for `season` as of `week`, using only games played BEFORE `week`.
 * Pure: give it rows and it returns ratings, no I/O.
 */
function computeRatings(allRows, season, week, weights) {
  const current = allRows.filter((r) => Number(r.season) === season && Number(r.week) < week);

  // The filter above is what prevents lookahead. This assertion cannot fire
  // today; it is a tripwire so that a future edit widening that filter fails
  // loudly instead of silently leaking future results into a rating. The
  // property that actually matters is tested by feeding in future weeks and
  // checking the ratings do not move.
  const leak = current.find((r) => Number(r.week) >= week);
  if (leak) {
    throw new Error(`Lookahead: week ${leak.week} row used for a week ${week} rating`);
  }

  const prior = allRows.filter((r) => Number(r.season) === season - 1);
  const blend = weights.prior_season_blend[week - 1] ?? 0;

  const teams = [...new Set([...current, ...prior].map((r) => r.team))].sort();
  if (teams.length === 0) return { ratings: [], maxWeekUsed: null, blend };

  const byTeam = new Map(
    teams.map((t) => [
      t,
      {
        current: current.filter((r) => r.team === t),
        prior: prior.filter((r) => r.team === t),
      },
    ])
  );

  // Blended per-team inputs.
  const inputs = new Map();
  for (const t of teams) {
    const { current: cur, prior: pri } = byTeam.get(t);
    const row = { offense: {}, defense: {} };
    for (const side of ['offense', 'defense']) {
      const key = side === 'offense' ? 'off' : 'def';
      const c = aggregate(cur, key);
      const p = aggregate(pri, key);
      for (const stat of STATS) row[side][stat] = blendValue(c[stat], p[stat], blend);
    }
    row.st = blendValue(
      mean(cur.map((r) => num(r.st_epa))),
      mean(pri.map((r) => num(r.st_epa))),
      blend
    );
    row.games = cur.length;
    inputs.set(t, row);
  }

  // z-score each stat across the league, then weight into a composite.
  const composite = { offense: new Map(), defense: new Map() };
  for (const side of ['offense', 'defense']) {
    const z = {};
    for (const stat of STATS) {
      z[stat] = zScores(teams.map((t) => inputs.get(t)[side][stat]));
    }
    teams.forEach((t, i) => {
      let score = 0;
      for (const stat of STATS) {
        score += weights[side][stat] * ORIENT[side][stat] * z[stat][i];
      }
      composite[side].set(t, score);
    });
  }

  const stZ = zScores(teams.map((t) => inputs.get(t).st));
  const stMap = new Map(teams.map((t, i) => [t, stZ[i]]));

  // Opponent adjustment. Only current-season games have a known opponent, so
  // in week 1 there is nothing to adjust against and the raw composites stand.
  const opponents = new Map(teams.map((t) => [t, []]));
  for (const r of current) {
    if (r.opponent && opponents.has(r.team)) opponents.get(r.team).push(r.opponent);
  }

  let off = new Map(composite.offense);
  let def = new Map(composite.defense);
  const iterations = weights.opponent_adjust_iterations ?? 0;

  for (let i = 0; i < iterations; i++) {
    const offMean = mean([...off.values()]) ?? 0;
    const defMean = mean([...def.values()]) ?? 0;
    const nextOff = new Map();
    const nextDef = new Map();
    for (const t of teams) {
      const opps = opponents.get(t).filter((o) => off.has(o));
      if (opps.length === 0) {
        nextOff.set(t, composite.offense.get(t));
        nextDef.set(t, composite.defense.get(t));
        continue;
      }
      // Faced better defenses than average -> the raw offense number understates
      // this team, so push it up by the average quality of those defenses.
      const defFaced = mean(opps.map((o) => def.get(o) - defMean));
      const offFaced = mean(opps.map((o) => off.get(o) - offMean));
      nextOff.set(t, composite.offense.get(t) + defFaced);
      nextDef.set(t, composite.defense.get(t) + offFaced);
    }
    off = nextOff;
    def = nextDef;
  }

  // Centre each component, then scale all three by one factor so the parts
  // still sum to the whole and league SD equals rating_points_per_sd.
  const stW = weights.special_teams;
  const rawTotal = new Map(teams.map((t) => [t, off.get(t) + def.get(t) + stW * stMap.get(t)]));

  const offMean = mean([...off.values()]) ?? 0;
  const defMean = mean([...def.values()]) ?? 0;
  const stMean = mean([...stMap.values()]) ?? 0;
  const totalMean = mean([...rawTotal.values()]) ?? 0;
  const totalSd = stdev([...rawTotal.values()]);
  const scale = totalSd ? weights.rating_points_per_sd / totalSd : 0;

  const ratings = teams.map((t) => ({
    season,
    week,
    team: t,
    offense_rating: round4((off.get(t) - offMean) * scale),
    defense_rating: round4((def.get(t) - defMean) * scale),
    st_rating: round4(stW * (stMap.get(t) - stMean) * scale),
    team_rating: round4((rawTotal.get(t) - totalMean) * scale),
    games_used: inputs.get(t).games,
  }));

  const weeksUsed = current.map((r) => Number(r.week));
  return {
    ratings,
    maxWeekUsed: weeksUsed.length ? Math.max(...weeksUsed) : null,
    blend,
    scale,
  };
}

const round4 = (v) => (Number.isFinite(v) ? Number(v.toFixed(4)) : null);

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

async function main() {
  // Both arguments are optional so the scheduled workflow can call this bare:
  // season falls back to the current one, week to the next unplayed week.
  const season = process.argv[2] ? Number(process.argv[2]) : currentSeason();
  if (!Number.isInteger(season)) {
    console.error('Usage: node rate.js [season] [week]');
    process.exit(1);
  }

  const SUPABASE_URL = requireEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_KEY = requireEnv('SUPABASE_SERVICE_KEY');
  const weights = loadWeights();

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const rows = await selectAll(supabase, 'chalk_team_weeks', '*', (q) =>
    q.in('season', [season - 1, season])
  );

  let week = Number(process.argv[3]);
  if (!Number.isInteger(week)) {
    const played = rows.filter((r) => Number(r.season) === season).map((r) => Number(r.week));
    week = played.length ? Math.max(...played) + 1 : 1;
    console.log(`No week given; rating as of week ${week}.`);
  }

  const { ratings, maxWeekUsed, blend } = computeRatings(rows, season, week, weights);
  if (ratings.length === 0) {
    console.log(`No data for season ${season} as of week ${week}.`);
    return;
  }

  console.log(
    `Season ${season} week ${week}: ${ratings.length} teams, ` +
      `prior-season blend ${(blend * 100).toFixed(1)}%, ` +
      `latest week used ${maxWeekUsed ?? 'none (prior season only)'}.`
  );

  const { data, error } = await supabase
    .from('chalk_ratings')
    .upsert(ratings, { onConflict: 'season,week,team' })
    .select('id');
  if (error) {
    console.error(`Upsert failed: ${error.message}`);
    process.exit(1);
  }

  const top = [...ratings].sort((a, b) => b.team_rating - a.team_rating).slice(0, 5);
  console.log(`Upserted ${data.length} ratings. Top 5:`);
  for (const r of top) {
    console.log(`  ${r.team.padEnd(4)} ${r.team_rating.toFixed(2).padStart(6)}  (off ${r.offense_rating.toFixed(2)}, def ${r.defense_rating.toFixed(2)}, st ${r.st_rating.toFixed(2)})`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { computeRatings, loadWeights, aggregate, zScores, mean, stdev, ORIENT, COLUMN, STATS };
