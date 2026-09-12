require('dotenv').config();
const zlib = require('node:zlib');
const { Readable } = require('node:stream');
const { parse } = require('csv-parse');
const { createClient } = require('@supabase/supabase-js');
const { currentSeason, streamPlays } = require('./ingest_pbp.js');

function requireEnv(name) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) {
    console.error(`Missing ${name}`);
    process.exit(1);
  }
  return raw.trim();
}

const rosterUrl = (season) =>
  `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv.gz`;

const num = (v) => (v === '' || v == null ? null : Number(v));
const int = (v) => Math.round(num(v) ?? 0);

const RED_ZONE = 20;
const GOAL_LINE = 5;

// Scrimmage snaps, for locating where a drive actually reached. Special teams
// rows carry a yardline_100 that does not describe the offense's field
// position: an extra point sits at 15, which would mark nearly every touchdown
// drive as a red zone trip.
const SCRIMMAGE = new Set(['pass', 'run', 'qb_kneel', 'qb_spike', 'no_play']);

function newPlayer(id) {
  return {
    player_id: id, player_name: null, team: null, opponent: null,
    rush_att: 0, rush_yds: 0, rush_td: 0,
    targets: 0, receptions: 0, rec_yds: 0, rec_td: 0,
    rz_rush_att: 0, rz_targets: 0, gl_touches: 0,
    pass_att: 0, pass_yds: 0, pass_td: 0, int_thrown: 0,
  };
}

function newDefense(team) {
  return {
    team, opponent: null,
    rush_td_allowed: 0, pass_td_allowed: 0,
    rz_trips_allowed: 0, rz_td_allowed: 0,
    rush_yds_allowed: 0, pass_yds_allowed: 0,
    targets_rb: 0, targets_wr: 0, targets_te: 0,
  };
}

/**
 * Fold one play into a game's player and defense accumulators.
 * `positions` maps a GSIS id to a position, or is null when unavailable.
 */
function addPlay(game, r, positions) {
  const posteam = r.posteam;
  const defteam = r.defteam;
  const playType = r.play_type;
  if (!posteam || !defteam) return;

  const defence = (team, other) => {
    if (!game.defense.has(team)) game.defense.set(team, newDefense(team));
    const d = game.defense.get(team);
    d.opponent = other;
    return d;
  };
  defence(defteam, posteam);
  defence(posteam, defteam);

  // Drive tracking, for red zone trips allowed. Uses scrimmage plays only.
  if (r.fixed_drive) {
    const key = `${posteam}|${r.fixed_drive}`;
    if (!game.drives.has(key)) {
      game.drives.set(key, { offense: posteam, defense: defteam, minY100: null, td: false });
    }
    const drive = game.drives.get(key);
    if (SCRIMMAGE.has(playType)) {
      const y = num(r.yardline_100);
      if (y != null && (drive.minY100 == null || y < drive.minY100)) drive.minY100 = y;
    }
    // Only offensive touchdowns count; a pick-six leaves both flags at 0.
    if (r.rush_touchdown === '1' || r.pass_touchdown === '1') drive.td = true;
  }

  // Everything below is player production. Two-point conversions carry
  // rush_attempt and pass_attempt but are not scrimmage downs, and kneels and
  // spikes are excluded by requiring play_type run or pass.
  if (r.two_point_attempt === '1') return;
  if (playType !== 'run' && playType !== 'pass') return;

  const y100 = num(r.yardline_100);
  const inRedZone = y100 != null && y100 <= RED_ZONE;
  const atGoalLine = y100 != null && y100 <= GOAL_LINE;

  const player = (id, name) => {
    if (!game.players.has(id)) game.players.set(id, newPlayer(id));
    const p = game.players.get(id);
    p.player_name = p.player_name || name || null;
    p.team = posteam;
    p.opponent = defteam;
    p.position = positions ? positions.get(id) ?? null : null;
    return p;
  };

  const def = game.defense.get(defteam);

  if (playType === 'run' && r.rush_attempt === '1') {
    const yds = int(r.rushing_yards);
    def.rush_yds_allowed += yds;
    if (r.rush_touchdown === '1') def.rush_td_allowed += 1;

    if (r.rusher_player_id) {
      const p = player(r.rusher_player_id, r.rusher_player_name);
      p.rush_att += 1;
      p.rush_yds += yds;
      if (r.rush_touchdown === '1') p.rush_td += 1;
      if (inRedZone) p.rz_rush_att += 1;
      if (atGoalLine) p.gl_touches += 1;
    }
    return;
  }

  if (playType === 'pass') {
    const passYds = int(r.passing_yards); // null on sacks and incompletions
    def.pass_yds_allowed += passYds;
    if (r.pass_touchdown === '1') def.pass_td_allowed += 1;

    if (r.passer_player_id) {
      const p = player(r.passer_player_id, r.passer_player_name);
      // Official pass attempts exclude sacks, though nflverse flags them.
      if (r.sack !== '1') p.pass_att += 1;
      p.pass_yds += passYds;
      if (r.pass_touchdown === '1') p.pass_td += 1;
      if (r.interception === '1') p.int_thrown += 1;
    }

    if (r.receiver_player_id) {
      const p = player(r.receiver_player_id, r.receiver_player_name);
      p.targets += 1;
      if (r.complete_pass === '1') {
        p.receptions += 1;
        p.rec_yds += int(r.receiving_yards);
      }
      if (r.pass_touchdown === '1') p.rec_td += 1;
      if (inRedZone) p.rz_targets += 1;
      if (atGoalLine) p.gl_touches += 1;

      const pos = positions ? positions.get(r.receiver_player_id) : null;
      if (pos === 'RB') def.targets_rb += 1;
      else if (pos === 'WR') def.targets_wr += 1;
      else if (pos === 'TE') def.targets_te += 1;
    }
  }
}

function buildRows(games, havePositions) {
  const players = [];
  const defenses = [];

  for (const game of games.values()) {
    for (const p of game.players.values()) {
      // Only players who actually touched the ball in a countable way.
      if (p.rush_att === 0 && p.targets === 0 && p.pass_att === 0) continue;
      players.push({
        season: game.season,
        week: game.week,
        player_id: p.player_id,
        player_name: p.player_name,
        team: p.team,
        position: p.position ?? null,
        opponent: p.opponent,
        rush_att: p.rush_att, rush_yds: p.rush_yds, rush_td: p.rush_td,
        targets: p.targets, receptions: p.receptions, rec_yds: p.rec_yds, rec_td: p.rec_td,
        rz_rush_att: p.rz_rush_att, rz_targets: p.rz_targets, gl_touches: p.gl_touches,
        pass_att: p.pass_att, pass_yds: p.pass_yds, pass_td: p.pass_td, int_thrown: p.int_thrown,
      });
    }

    // Red zone trips are counted per defense from the opponent's drives.
    const trips = new Map();
    for (const d of game.drives.values()) {
      if (d.minY100 == null || d.minY100 > RED_ZONE) continue;
      if (!trips.has(d.defense)) trips.set(d.defense, { n: 0, td: 0 });
      const t = trips.get(d.defense);
      t.n += 1;
      if (d.td) t.td += 1;
    }

    for (const d of game.defense.values()) {
      const t = trips.get(d.team) || { n: 0, td: 0 };
      defenses.push({
        season: game.season,
        week: game.week,
        team: d.team,
        opponent: d.opponent,
        rush_td_allowed: d.rush_td_allowed,
        pass_td_allowed: d.pass_td_allowed,
        rz_trips_allowed: t.n,
        rz_td_allowed: t.td,
        rush_yds_allowed: d.rush_yds_allowed,
        pass_yds_allowed: d.pass_yds_allowed,
        targets_allowed_rb: havePositions ? d.targets_rb : null,
        targets_allowed_wr: havePositions ? d.targets_wr : null,
        targets_allowed_te: havePositions ? d.targets_te : null,
      });
    }
  }
  return { players, defenses };
}

/** Position lookup for a season, or null if the roster file cannot be used. */
async function loadPositions(season) {
  let res;
  try {
    res = await fetch(rosterUrl(season));
  } catch (err) {
    console.warn(`Roster fetch failed for ${season} (${err.message}); positions will be null.`);
    return null;
  }
  if (!res.ok) {
    console.warn(`Roster file roster_${season}.csv.gz returned HTTP ${res.status}; positions will be null.`);
    return null;
  }
  const parser = Readable.fromWeb(res.body)
    .pipe(zlib.createGunzip())
    .pipe(parse({ columns: true, relax_column_count: true }));

  const map = new Map();
  let checked = false;
  try {
    for await (const row of parser) {
      if (!checked) {
        checked = true;
        for (const col of ['gsis_id', 'position']) {
          if (!(col in row)) {
            console.warn(`Roster file has no "${col}" column (found: ${Object.keys(row).slice(0, 12).join(', ')}...); ` +
                         'positions will be null.');
            return null;
          }
        }
      }
      if (row.gsis_id && row.position) map.set(row.gsis_id, row.position);
    }
  } catch (err) {
    console.warn(`Roster parse failed for ${season} (${err.message}); positions will be null.`);
    return null;
  }
  if (map.size === 0) {
    console.warn(`Roster file for ${season} yielded no positions; positions will be null.`);
    return null;
  }
  return map;
}

async function upsertAll(supabase, table, rows, onConflict) {
  const BATCH = 500;
  let written = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { data, error } = await supabase
      .from(table)
      .upsert(rows.slice(i, i + BATCH), { onConflict })
      .select('id');
    if (error) {
      console.error(`Upsert into ${table} failed: ${error.message}`);
      process.exit(1);
    }
    written += data.length;
  }
  return written;
}

async function main() {
  const season = Number(process.argv[2] || currentSeason());
  if (!Number.isInteger(season) || season < 1999 || season > 2100) {
    console.error(`Bad season argument: ${process.argv[2]}`);
    process.exit(1);
  }

  const SUPABASE_URL = requireEnv('SUPABASE_URL');
  const SUPABASE_SERVICE_KEY = requireEnv('SUPABASE_SERVICE_KEY');

  const positions = await loadPositions(season);
  console.log(
    positions
      ? `Season ${season}: ${positions.size} roster positions loaded.`
      : `Season ${season}: no roster positions; position and targets_allowed_* will be null.`
  );

  const games = new Map();
  const plays = await streamPlays(season, (r) => {
    if (!r.game_id) return;
    if (!games.has(r.game_id)) {
      games.set(r.game_id, {
        season: Number(r.season),
        week: Number(r.week),
        players: new Map(),
        defense: new Map(),
        drives: new Map(),
      });
    }
    addPlay(games.get(r.game_id), r, positions);
  });

  const { players, defenses } = buildRows(games, positions != null);
  console.log(`Parsed ${plays} plays across ${games.size} games -> ` +
              `${players.length} player-weeks, ${defenses.length} defense-weeks.`);

  if (players.length === 0 && defenses.length === 0) {
    console.log('Nothing to upsert.');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const p = await upsertAll(supabase, 'chalk_player_weeks', players, 'season,week,player_id');
  const d = await upsertAll(supabase, 'chalk_defense_weeks', defenses, 'season,week,team');
  console.log(`Upserted ${p} player-weeks and ${d} defense-weeks for season ${season}.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { addPlay, buildRows, newPlayer, newDefense, loadPositions, RED_ZONE, GOAL_LINE };
