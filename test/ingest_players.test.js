const assert = require('node:assert/strict');
const { addPlay, buildRows, RED_ZONE, GOAL_LINE } = require('../ingest_players.js');

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); pass++; };

const POSITIONS = new Map([
  ['RB1', 'RB'], ['WR1', 'WR'], ['TE1', 'TE'], ['QB1', 'QB'],
]);

const play = (o = {}) => ({
  posteam: 'KC', defteam: 'LAC', play_type: 'run', fixed_drive: '1',
  yardline_100: '50', two_point_attempt: '0', sack: '0',
  rush_attempt: '0', pass_attempt: '0', complete_pass: '0',
  rush_touchdown: '0', pass_touchdown: '0', interception: '0',
  rushing_yards: '', receiving_yards: '', passing_yards: '',
  rusher_player_id: '', rusher_player_name: '',
  receiver_player_id: '', receiver_player_name: '',
  passer_player_id: '', passer_player_name: '',
  ...o,
});

const rush = (o = {}) => play({ play_type: 'run', rush_attempt: '1', rusher_player_id: 'RB1', rusher_player_name: 'A.Back', rushing_yards: '4', ...o });
const target = (o = {}) => play({ play_type: 'pass', pass_attempt: '1', passer_player_id: 'QB1', passer_player_name: 'A.Arm', receiver_player_id: 'WR1', receiver_player_name: 'A.Hands', ...o });

function run(plays) {
  const game = { season: 2025, week: 1, players: new Map(), defense: new Map(), drives: new Map() };
  for (const p of plays) addPlay(game, p, POSITIONS);
  const { players, defenses } = buildRows(new Map([['g', game]]), true);
  return {
    player: (id) => players.find((p) => p.player_id === id),
    defense: (team) => defenses.find((d) => d.team === team),
    players, defenses,
  };
}

// --- touchdowns credit both sides -------------------------------------------
t('a rushing TD credits the rusher and the defense rush_td_allowed', () => {
  const r = run([rush({ yardline_100: '3', rush_touchdown: '1', rushing_yards: '3' })]);
  assert.equal(r.player('RB1').rush_td, 1);
  assert.equal(r.player('RB1').rush_att, 1);
  assert.equal(r.defense('LAC').rush_td_allowed, 1, 'defense must be charged');
  assert.equal(r.defense('LAC').pass_td_allowed, 0);
  assert.equal(r.defense('KC').rush_td_allowed, 0, 'the scoring team is not charged');
});

t('a receiving TD credits the receiver and the defense pass_td_allowed', () => {
  const r = run([target({ yardline_100: '8', complete_pass: '1', pass_touchdown: '1', receiving_yards: '8', passing_yards: '8' })]);
  assert.equal(r.player('WR1').rec_td, 1);
  assert.equal(r.player('WR1').receptions, 1);
  assert.equal(r.player('WR1').rec_yds, 8);
  assert.equal(r.player('QB1').pass_td, 1);
  assert.equal(r.defense('LAC').pass_td_allowed, 1, 'defense must be charged');
  assert.equal(r.defense('LAC').rush_td_allowed, 0);
});

// --- red zone ---------------------------------------------------------------
t('a red zone drive that stalls is a trip but not a TD', () => {
  const r = run([
    rush({ yardline_100: '30', rushing_yards: '12' }),
    rush({ yardline_100: '18', rushing_yards: '2' }),
    target({ yardline_100: '16' }),        // incomplete
    play({ play_type: 'field_goal', yardline_100: '16', rush_attempt: '0' }),
  ]);
  const d = r.defense('LAC');
  assert.equal(d.rz_trips_allowed, 1, 'reaching the 18 is a trip');
  assert.equal(d.rz_td_allowed, 0, 'no touchdown on the drive');
});

t('a red zone drive that scores counts as both', () => {
  const r = run([
    rush({ yardline_100: '18', rushing_yards: '15' }),
    rush({ yardline_100: '3', rush_touchdown: '1', rushing_yards: '3' }),
  ]);
  assert.equal(r.defense('LAC').rz_trips_allowed, 1);
  assert.equal(r.defense('LAC').rz_td_allowed, 1);
});

t('a drive that never reaches the 20 is not a trip', () => {
  const r = run([rush({ yardline_100: '40', rushing_yards: '5' })]);
  assert.equal(r.defense('LAC').rz_trips_allowed, 0);
});

t('an extra point does not fake a red zone trip', () => {
  // Extra points sit at yardline_100 = 15. A 60-yard TD drive never entered
  // the red zone by scrimmage, and the PAT must not say otherwise.
  const r = run([
    rush({ yardline_100: '60', rush_touchdown: '1', rushing_yards: '60' }),
    play({ play_type: 'extra_point', yardline_100: '15', fixed_drive: '1' }),
  ]);
  assert.equal(r.defense('LAC').rz_trips_allowed, 0, 'the PAT spot is not a red zone trip');
});

// --- goal line --------------------------------------------------------------
t('a goal line target counts as a gl_touch', () => {
  const r = run([target({ yardline_100: '4' })]);
  const p = r.player('WR1');
  assert.equal(p.gl_touches, 1);
  assert.equal(p.rz_targets, 1, 'inside the 5 is also inside the 20');
  assert.equal(p.targets, 1);
});

t('a goal line rush counts as a gl_touch', () => {
  const r = run([rush({ yardline_100: `${GOAL_LINE}` })]);
  assert.equal(r.player('RB1').gl_touches, 1);
  assert.equal(r.player('RB1').rz_rush_att, 1);
});

t('a target outside the 5 is not a gl_touch', () => {
  const r = run([target({ yardline_100: '12' })]);
  assert.equal(r.player('WR1').gl_touches, 0);
  assert.equal(r.player('WR1').rz_targets, 1);
});

// --- counting rules ---------------------------------------------------------
t('sacks do not count as pass attempts', () => {
  const r = run([
    target({ sack: '1', receiver_player_id: '', receiver_player_name: '' }),
    target({ complete_pass: '1', passing_yards: '10', receiving_yards: '10' }),
  ]);
  assert.equal(r.player('QB1').pass_att, 1, 'only the real attempt counts');
});

t('two-point conversions are excluded', () => {
  const r = run([
    rush({ two_point_attempt: '1', yardline_100: '2' }),
    target({ two_point_attempt: '1', yardline_100: '2' }),
  ]);
  assert.equal(r.players.length, 0, 'no player rows from conversions alone');
});

t('kneels and spikes are excluded', () => {
  const r = run([
    rush({ play_type: 'qb_kneel', rusher_player_id: 'QB1', rushing_yards: '-1' }),
    play({ play_type: 'qb_spike', pass_attempt: '1', passer_player_id: 'QB1' }),
  ]);
  assert.equal(r.players.length, 0);
});

t('interceptions are charged to the passer', () => {
  const r = run([target({ interception: '1' })]);
  assert.equal(r.player('QB1').int_thrown, 1);
});

t('only players who touched the ball get a row', () => {
  const r = run([rush()]);
  assert.equal(r.players.length, 1);
  assert.equal(r.players[0].player_id, 'RB1');
});

t('targets allowed split by receiver position', () => {
  const r = run([
    target({ receiver_player_id: 'WR1' }),
    target({ receiver_player_id: 'TE1' }),
    target({ receiver_player_id: 'RB1' }),
    target({ receiver_player_id: 'WR1' }),
  ]);
  const d = r.defense('LAC');
  assert.equal(d.targets_allowed_wr, 2);
  assert.equal(d.targets_allowed_te, 1);
  assert.equal(d.targets_allowed_rb, 1);
});

t('positions are null when no roster is available', () => {
  const game = { season: 2025, week: 1, players: new Map(), defense: new Map(), drives: new Map() };
  addPlay(game, rush(), null);
  const { players, defenses } = buildRows(new Map([['g', game]]), false);
  assert.equal(players[0].position, null);
  assert.equal(defenses[0].targets_allowed_wr, null);
});

console.log(`\n${pass} assertions passed`);
