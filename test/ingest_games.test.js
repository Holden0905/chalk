const assert = require('node:assert/strict');
const { buildRow, kickoffIso, wanted, currentSeason, FIRST_SEASON } = require('../ingest_games.js');

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); pass++; };

// A row with the fields the ingest reads; override what a test needs.
const row = (o = {}) => ({
  game_id: '2025_07_KC_LV', season: '2025', game_type: 'REG', week: '7',
  gameday: '2025-10-19', weekday: 'Sunday', gametime: '16:05',
  away_team: 'KC', away_score: '20', home_team: 'LV', home_score: '24',
  spread_line: '-3', total_line: '44.5', away_rest: '7', home_rest: '7',
  div_game: '1', roof: 'dome', surface: 'grass', overtime: '0',
  ...o,
});

const seasons = new Set([2022, 2023, 2024, 2025, 2026]);

// --- kickoff, which is the only thing here that is not a straight copy -------
t('a September kickoff resolves against Eastern daylight time', () => {
  // 8:20 PM ET on 8 September 2022 is 00:20 UTC the next day.
  assert.equal(kickoffIso('2022-09-08', '20:20'), '2022-09-09T00:20:00.000Z');
});

t('a December kickoff resolves against Eastern standard time', () => {
  // The same wall clock an hour later in UTC, because the clocks have gone back.
  assert.equal(kickoffIso('2025-12-21', '13:00'), '2025-12-21T18:00:00.000Z');
});

t('a London morning kickoff keeps its Eastern wall clock', () => {
  assert.equal(kickoffIso('2025-10-05', '09:30'), '2025-10-05T13:30:00.000Z');
});

t('a game with no time is not given one', () => {
  assert.equal(kickoffIso('2025-10-05', ''), null);
  assert.equal(kickoffIso('', '13:00'), null);
});

// --- what gets ingested -----------------------------------------------------
t('regular season weeks 1 to 18 are kept', () => {
  assert.equal(wanted(row({ week: '1' }), seasons), true);
  assert.equal(wanted(row({ week: '18' }), seasons), true);
});

t('playoffs are dropped, by week and by game type', () => {
  assert.equal(wanted(row({ week: '19', game_type: 'WC' }), seasons), false);
  assert.equal(wanted(row({ week: '22', game_type: 'SB' }), seasons), false);
  // A playoff row mislabelled as week 18 is still caught by game_type.
  assert.equal(wanted(row({ week: '18', game_type: 'DIV' }), seasons), false);
});

t('seasons outside the window are dropped', () => {
  assert.equal(wanted(row({ season: '2021' }), seasons), false);
  assert.equal(wanted(row({ season: String(FIRST_SEASON) }), new Set([FIRST_SEASON])), true);
});

t('a row with no game id is dropped', () => {
  assert.equal(wanted(row({ game_id: '' }), seasons), false);
});

// --- the row itself ---------------------------------------------------------
t('the spread keeps nflverse sign, where positive means the home team is favored', () => {
  // Chalk's own chalk_results table uses the opposite sign; these must not be
  // confused, so the convention is pinned by a test.
  assert.equal(buildRow(row({ spread_line: '-3' })).spread_line, -3);
  assert.equal(buildRow(row({ spread_line: '6.5' })).spread_line, 6.5);
});

t('derived columns are left to the database', () => {
  const built = buildRow(row());
  for (const key of ['total_points', 'home_margin', 'home_covered', 'went_over', 'total_diff']) {
    assert.ok(!(key in built), `${key} should be generated in Postgres, not written by the ingest`);
  }
});

t('flags become booleans and blanks become null', () => {
  assert.equal(buildRow(row({ div_game: '1' })).div_game, true);
  assert.equal(buildRow(row({ div_game: '0' })).div_game, false);
  assert.equal(buildRow(row({ overtime: '' })).overtime, null);
});

t('an unplayed game carries no score but keeps its line', () => {
  const built = buildRow(row({ home_score: '', away_score: '' }));
  assert.equal(built.home_score, null);
  assert.equal(built.away_score, null);
  assert.equal(built.total_line, 44.5);
});

t('missing lines are null rather than zero', () => {
  const built = buildRow(row({ spread_line: '', total_line: '' }));
  assert.equal(built.spread_line, null);
  assert.equal(built.total_line, null);
});

// --- the season boundary ----------------------------------------------------
t('January and February belong to the season that started the previous autumn', () => {
  assert.equal(currentSeason(new Date('2026-01-15T00:00:00Z')), 2025);
  assert.equal(currentSeason(new Date('2026-02-08T00:00:00Z')), 2025);
  assert.equal(currentSeason(new Date('2026-09-13T00:00:00Z')), 2026);
});

console.log(`\n${pass} assertions passed`);
