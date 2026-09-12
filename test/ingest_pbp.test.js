const assert = require('node:assert/strict');
const { addPlay, sideStats, newSide } = require('../ingest_pbp.js');
const teams = require('../teams.js');

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); pass++; };

// Minimal play row with the fields ingest reads; override what a test needs.
const play = (o = {}) => ({
  posteam: 'KC', defteam: 'LAC', play_type: 'pass', epa: '0', success: '0',
  yardline_100: '', down: '1', fixed_drive: '1',
  posteam_score: '', posteam_score_post: '', interception: '0', fumble_lost: '0',
  ...o,
});

const game = () => ({ sides: new Map(), home_team: 'LAC', away_team: 'KC' });
const feed = (rows) => { const g = game(); for (const r of rows) addPlay(g, r); return g; };
const kc = (g) => sideStats(g.sides.get('KC'));

// --- the kickoff trap -------------------------------------------------------
// nflverse attaches the kickoff to the RECEIVING team's drive with
// yardline_100 = 35, which is the kicking spot, not where the offense starts.
t('kickoff does not set drive start field position', () => {
  const g = feed([
    play({ play_type: 'kickoff', yardline_100: '35', down: '' }),
    play({ play_type: 'run', yardline_100: '75' }),
  ]);
  assert.equal(kc(g).avg_start_yardline, 75, 'start must come from the first scrimmage play');
});

t('kickoff does not fake a trip inside the 40', () => {
  const g = feed([
    play({ play_type: 'kickoff', yardline_100: '35', down: '' }),
    play({ play_type: 'run', yardline_100: '75', posteam_score: '0', posteam_score_post: '0' }),
  ]);
  assert.equal(kc(g).points_per_trip_inside_40, null, 'drive never reached the 40');
});

t('a real trip inside the 40 is counted', () => {
  const g = feed([
    play({ play_type: 'run', yardline_100: '75', posteam_score: '0' }),
    play({ play_type: 'run', yardline_100: '30', posteam_score_post: '7' }),
  ]);
  assert.equal(kc(g).points_per_trip_inside_40, 7);
});

// --- drive points -----------------------------------------------------------
t('drive points include the extra point', () => {
  const g = feed([
    play({ play_type: 'run', yardline_100: '20', posteam_score: '0' }),
    play({ play_type: 'run', yardline_100: '2', posteam_score: '0', posteam_score_post: '6' }),
    play({ play_type: 'extra_point', down: '', posteam_score: '6', posteam_score_post: '7' }),
  ]);
  assert.equal(kc(g).points_per_trip_inside_40, 7);
});

t('a failed extra point leaves the drive at six', () => {
  const g = feed([
    play({ play_type: 'run', yardline_100: '20', posteam_score: '0' }),
    play({ play_type: 'run', yardline_100: '2', posteam_score: '0', posteam_score_post: '6' }),
    play({ play_type: 'extra_point', down: '', posteam_score: '6', posteam_score_post: '6' }),
  ]);
  assert.equal(kc(g).points_per_trip_inside_40, 6);
});

// --- which plays count as efficiency ---------------------------------------
t('kneels, spikes, no_plays and special teams are not efficiency plays', () => {
  const g = feed([
    play({ play_type: 'qb_kneel', epa: '-1' }),
    play({ play_type: 'qb_spike', epa: '-1' }),
    play({ play_type: 'no_play', epa: '-1' }),
    play({ play_type: 'punt', epa: '-1', down: '' }),
    play({ play_type: 'field_goal', epa: '-1', down: '' }),
    play({ play_type: 'pass', epa: '1', success: '1' }),
  ]);
  const s = kc(g);
  assert.equal(s.plays, 1, 'only the pass counts');
  assert.equal(s.epa_per_play, 1);
  assert.equal(s.success_rate, 1);
});

t('two-point conversions (no down) are excluded', () => {
  const g = feed([
    play({ play_type: 'pass', epa: '5', success: '1', down: '' }),
    play({ play_type: 'pass', epa: '1', success: '1', down: '2' }),
  ]);
  assert.equal(kc(g).plays, 1);
  assert.equal(kc(g).epa_per_play, 1);
});

t('pass and rush split correctly', () => {
  const g = feed([
    play({ play_type: 'pass', epa: '2', success: '1' }),
    play({ play_type: 'pass', epa: '0', success: '0' }),
    play({ play_type: 'run', epa: '4', success: '1' }),
  ]);
  const s = kc(g);
  assert.equal(s.pass_success_rate, 0.5);
  assert.equal(s.pass_epa_per_play, 1);
  assert.equal(s.rush_success_rate, 1);
  assert.equal(s.rush_epa_per_play, 4);
  assert.equal(s.plays, 3);
});

t('turnovers count interceptions and lost fumbles', () => {
  const g = feed([
    play({ interception: '1' }),
    play({ fumble_lost: '1' }),
    play({}),
  ]);
  assert.equal(kc(g).turnovers, 2);
});

// --- special teams ----------------------------------------------------------
// nflverse's special_teams_play flag omits field goals, so play_type is the
// only reliable key; and ST EPA is netted against the receiving team.
t('special teams EPA is netted between the two teams', () => {
  const g = feed([play({ play_type: 'punt', epa: '1.5', down: '' })]);
  assert.equal(sideStats(g.sides.get('KC')).plays, 0, 'punt is not an offensive play');
  assert.equal(g.sides.get('KC').stEpa, 1.5);
  assert.equal(g.sides.get('LAC').stEpa, -1.5, 'receiving team gets the negative');
});

t('field goals count toward special teams EPA', () => {
  const g = feed([play({ play_type: 'field_goal', epa: '2', down: '' })]);
  assert.equal(g.sides.get('KC').stEpa, 2);
});

t('extra points are not special teams EPA (already in drive points)', () => {
  const g = feed([play({ play_type: 'extra_point', epa: '9', down: '' })]);
  assert.equal(g.sides.get('KC').stEpa, 0);
});

// --- team mapping -----------------------------------------------------------
t('all 32 nflverse abbreviations map to an Odds API name', () => {
  const abbrs = Object.keys(teams.NFLVERSE_TO_ODDS);
  assert.equal(abbrs.length, 32);
  for (const a of abbrs) assert.ok(teams.toOddsName(a), `${a} has no name`);
});

t('mapping round-trips', () => {
  for (const [abbr, name] of Object.entries(teams.NFLVERSE_TO_ODDS)) {
    assert.equal(teams.toAbbr(name), abbr);
  }
});

t('relocation aliases resolve', () => {
  assert.equal(teams.toOddsName('LAR'), 'Los Angeles Rams');
  assert.equal(teams.toOddsName('STL'), 'Los Angeles Rams');
  assert.equal(teams.toOddsName('SD'), 'Los Angeles Chargers');
  assert.equal(teams.toOddsName('OAK'), 'Las Vegas Raiders');
});

console.log(`\n${pass} assertions passed`);
