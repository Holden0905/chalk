require('dotenv').config();
const zlib = require('node:zlib');
const { Readable } = require('node:stream');
const { parse } = require('csv-parse');
const { createClient } = require('@supabase/supabase-js');

function requireEnv(name) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return raw.trim();
}

const pbpUrl = (season) =>
  'https://github.com/nflverse/nflverse-data/releases/download/pbp/' +
  `play_by_play_${season}.csv.gz`;

// Scrimmage snaps. Everything else is either a special teams play or clock
// administration, and has a yardline_100 that does not describe where the
// offense actually had the ball.
const SCRIMMAGE = new Set(['pass', 'run', 'qb_kneel', 'qb_spike', 'no_play']);

// Plays that count toward efficiency: real snaps, run or thrown. no_play
// (a penalty that wiped out the snap), kneels and spikes are excluded.
const EFFICIENCY = new Set(['pass', 'run']);

// Special teams. Note that nflverse's special_teams_play flag does NOT include
// field goals, so keying off play_type is the only way to catch all four.
// Returns live on the punt and kickoff rows themselves. Extra points are left
// out; they are scoring plays already counted in drive points.
const SPECIAL = new Set(['field_goal', 'punt', 'kickoff']);

const num = (v) => (v === '' || v == null ? null : Number(v));
const ratio = (n, d) => (d > 0 ? n / d : null);
const round = (v, places) =>
  v == null || !Number.isFinite(v) ? null : Number(v.toFixed(places));

// The NFL season spans two calendar years; January and February belong to the
// season that started the previous autumn.
function currentSeason(now = new Date()) {
  return now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

function newSide() {
  return {
    plays: 0,
    success: 0,
    epa: 0,
    pass: { plays: 0, success: 0, epa: 0 },
    rush: { plays: 0, success: 0, epa: 0 },
    turnovers: 0,
    stEpa: 0,
    drives: new Map(),
  };
}

function sideStats(side) {
  // Drives that got inside the opponent's 40, and what they produced.
  let trips = 0;
  let tripPoints = 0;
  let startSum = 0;
  let startCount = 0;
  for (const d of side.drives.values()) {
    if (d.firstScrimmageY100 != null) {
      startSum += d.firstScrimmageY100;
      startCount += 1;
    }
    if (d.minY100 != null && d.minY100 <= 40) {
      trips += 1;
      tripPoints += d.points || 0;
    }
  }

  return {
    plays: side.plays,
    success_rate: round(ratio(side.success, side.plays), 4),
    epa_per_play: round(ratio(side.epa, side.plays), 4),
    pass_success_rate: round(ratio(side.pass.success, side.pass.plays), 4),
    pass_epa_per_play: round(ratio(side.pass.epa, side.pass.plays), 4),
    rush_success_rate: round(ratio(side.rush.success, side.rush.plays), 4),
    rush_epa_per_play: round(ratio(side.rush.epa, side.rush.plays), 4),
    points_per_trip_inside_40: round(ratio(tripPoints, trips), 4),
    avg_start_yardline: round(ratio(startSum, startCount), 2),
    turnovers: side.turnovers,
  };
}

function prefixed(prefix, stats) {
  return Object.fromEntries(Object.entries(stats).map(([k, v]) => [`${prefix}_${k}`, v]));
}

// Fold one play into the accumulators for the game it belongs to.
function addPlay(game, r) {
  const posteam = r.posteam;
  const playType = r.play_type;
  if (!posteam) return;

  if (!game.sides.has(posteam)) game.sides.set(posteam, newSide());
  const side = game.sides.get(posteam);

  // Special teams EPA is netted: earned as the possessing team, conceded as
  // the team on the other side of the kick.
  if (SPECIAL.has(playType)) {
    const epa = num(r.epa);
    if (epa != null) {
      side.stEpa += epa;
      const opp = r.defteam;
      if (opp) {
        if (!game.sides.has(opp)) game.sides.set(opp, newSide());
        game.sides.get(opp).stEpa -= epa;
      }
    }
  }

  // Drive bookkeeping. Every play in the drive counts toward points, because
  // the extra point or two-point try is where the 7th point shows up, but only
  // scrimmage plays describe field position.
  if (r.fixed_drive) {
    if (!side.drives.has(r.fixed_drive)) {
      side.drives.set(r.fixed_drive, {
        scoreStart: null,
        scoreEnd: null,
        firstScrimmageY100: null,
        minY100: null,
        points: 0,
      });
    }
    const drive = side.drives.get(r.fixed_drive);

    const before = num(r.posteam_score);
    const after = num(r.posteam_score_post);
    if (before != null && drive.scoreStart == null) drive.scoreStart = before;
    if (after != null) drive.scoreEnd = after;
    if (drive.scoreStart != null && drive.scoreEnd != null) {
      drive.points = drive.scoreEnd - drive.scoreStart;
    }

    if (SCRIMMAGE.has(playType)) {
      const y = num(r.yardline_100);
      if (y != null) {
        if (drive.firstScrimmageY100 == null) drive.firstScrimmageY100 = y;
        if (drive.minY100 == null || y < drive.minY100) drive.minY100 = y;
      }
    }
  }

  // Efficiency. Two-point conversions have no down and are not scrimmage
  // downs, so they are left out.
  if (!EFFICIENCY.has(playType) || r.down === '' || r.down == null) return;

  const epa = num(r.epa);
  const success = num(r.success);
  if (epa == null) return;

  side.plays += 1;
  side.epa += epa;
  if (success) side.success += 1;

  const split = playType === 'pass' ? side.pass : side.rush;
  split.plays += 1;
  split.epa += epa;
  if (success) split.success += 1;

  if (r.interception === '1' || r.fumble_lost === '1') side.turnovers += 1;
}

function buildRows(games) {
  const rows = [];
  for (const game of games.values()) {
    for (const [team, side] of game.sides) {
      const oppName = team === game.home_team ? game.away_team : game.home_team;
      const oppSide = game.sides.get(oppName);
      if (!oppSide) continue; // one-sided game data; skip rather than emit half a row

      rows.push({
        season: game.season,
        week: game.week,
        team,
        opponent: oppName,
        is_home: team === game.home_team,
        ...prefixed('off', sideStats(side)),
        ...prefixed('def', sideStats(oppSide)),
        st_epa: round(side.stEpa, 4),
      });
    }
  }
  return rows;
}

async function streamPlays(season, onPlay) {
  const res = await fetch(pbpUrl(season));
  if (!res.ok) {
    console.error(`nflverse download failed for ${season}: HTTP ${res.status}`);
    process.exit(1);
  }
  const parser = Readable.fromWeb(res.body)
    .pipe(zlib.createGunzip())
    .pipe(parse({ columns: true, relax_column_count: true }));

  let count = 0;
  for await (const record of parser) {
    count += 1;
    onPlay(record);
  }
  return count;
}

async function main() {
  const season = Number(process.argv[2] || currentSeason());
  if (!Number.isInteger(season) || season < 1999 || season > 2100) {
    console.error(`Bad season argument: ${process.argv[2]}`);
    process.exit(1);
  }

  const SUPABASE_URL = requireEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_KEY = requireEnv('SUPABASE_SERVICE_KEY');

  console.log(`Season ${season}: downloading play-by-play...`);

  const games = new Map();
  const plays = await streamPlays(season, (r) => {
    if (!r.game_id) return;
    if (!games.has(r.game_id)) {
      games.set(r.game_id, {
        season: Number(r.season),
        week: Number(r.week),
        home_team: r.home_team,
        away_team: r.away_team,
        sides: new Map(),
      });
    }
    addPlay(games.get(r.game_id), r);
  });

  const rows = buildRows(games);
  console.log(`Parsed ${plays} plays across ${games.size} games -> ${rows.length} team-weeks.`);

  if (rows.length === 0) {
    console.log('Nothing to upsert.');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { data, error } = await supabase
      .from('chalk_team_weeks')
      .upsert(chunk, { onConflict: 'season,week,team' })
      .select('id');
    if (error) {
      console.error(`Upsert failed: ${error.message}`);
      for (let c = error.cause; c; c = c.cause) {
        console.error(`  cause: ${c.code || ''} ${c.message || c}`.trim());
      }
      process.exit(1);
    }
    written += data.length;
  }

  const weeks = [...new Set(rows.map((r) => r.week))].sort((a, b) => a - b);
  console.log(`Upserted ${written} rows for season ${season}, weeks ${weeks[0]}-${weeks[weeks.length - 1]}.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { addPlay, sideStats, buildRows, currentSeason, newSide, SCRIMMAGE, EFFICIENCY, SPECIAL };
