const assert = require('node:assert/strict');
const {
  espnTeamToOdds, normalizeStatus, statusRank, sortInjuries, injuryRows,
  matchEvent, stripHtml, mentionsEither, describeInjury, dedupe, STATUS_ORDER,
  noteFor, isWrittenNote,
} = require('../snapshot_context.js');
const teams = require('../teams.js');

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); pass++; };

// Every displayName ESPN's /injuries endpoint returned, verbatim, on
// 2026-09-13. This is a fixture rather than a live call on purpose: the whole
// point is to notice the day ESPN renames a club and our join key stops
// matching, which a test that asks ESPN what it calls them cannot do.
const ESPN_DISPLAY_NAMES = [
  'Arizona Cardinals', 'Atlanta Falcons', 'Baltimore Ravens', 'Buffalo Bills',
  'Carolina Panthers', 'Chicago Bears', 'Cincinnati Bengals', 'Cleveland Browns',
  'Dallas Cowboys', 'Denver Broncos', 'Detroit Lions', 'Green Bay Packers',
  'Houston Texans', 'Indianapolis Colts', 'Jacksonville Jaguars', 'Kansas City Chiefs',
  'Las Vegas Raiders', 'Los Angeles Chargers', 'Los Angeles Rams', 'Miami Dolphins',
  'Minnesota Vikings', 'New England Patriots', 'New Orleans Saints', 'New York Giants',
  'New York Jets', 'Philadelphia Eagles', 'Pittsburgh Steelers', 'San Francisco 49ers',
  'Seattle Seahawks', 'Tampa Bay Buccaneers', 'Tennessee Titans', 'Washington Commanders',
];

// --- the ESPN to teams.js mapping -------------------------------------------
t('all 32 ESPN team names resolve to an Odds API name', () => {
  const unresolved = ESPN_DISPLAY_NAMES.filter((n) => espnTeamToOdds(n) === null);
  assert.deepEqual(unresolved, [], 'ESPN names teams.js cannot map');
});

t('every club is covered exactly once, with no two mapping to the same team', () => {
  assert.equal(ESPN_DISPLAY_NAMES.length, 32);
  const mapped = ESPN_DISPLAY_NAMES.map(espnTeamToOdds);
  assert.equal(new Set(mapped).size, 32);
  // And between them they account for the whole league as teams.js knows it.
  assert.deepEqual(
    [...mapped].sort(),
    Object.values(teams.NFLVERSE_TO_ODDS).sort(),
  );
});

t('the mapping goes through teams.js rather than passing the string along', () => {
  // A plausible-looking name that is not a club must come back null, not
  // echoed, or an unknown team would be written as if it were real.
  assert.equal(espnTeamToOdds('Los Angeles Raiders'), null);
  assert.equal(espnTeamToOdds('San Diego Chargers'), null);
  assert.equal(espnTeamToOdds(''), null);
  assert.equal(espnTeamToOdds(null), null);
  assert.equal(espnTeamToOdds(undefined), null);
});

t('surrounding whitespace does not break the mapping', () => {
  assert.equal(espnTeamToOdds('  Kansas City Chiefs '), 'Kansas City Chiefs');
});

t('the relocated clubs resolve to their current name', () => {
  assert.equal(espnTeamToOdds('Los Angeles Rams'), 'Los Angeles Rams');
  assert.equal(espnTeamToOdds('Las Vegas Raiders'), 'Las Vegas Raiders');
  assert.equal(espnTeamToOdds('Washington Commanders'), 'Washington Commanders');
});

// --- status ordering ---------------------------------------------------------
t('status is normalised to lower case', () => {
  assert.equal(normalizeStatus('Questionable'), 'questionable');
  assert.equal(normalizeStatus('  OUT  '), 'out');
  assert.equal(normalizeStatus(''), null);
  assert.equal(normalizeStatus(null), null);
});

t('the game-day designations rank in descending severity', () => {
  const ranked = ['out', 'doubtful', 'questionable', 'probable'].map(statusRank);
  assert.deepEqual(ranked, [0, 1, 2, 3]);
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(ranked[i] > ranked[i - 1], 'severity must be strictly decreasing');
  }
});

t('the settled absences rank after every game-day designation', () => {
  // Injured reserve and suspension are certainties known for weeks. They are
  // not what moves a number on Sunday, so they sort below a question.
  assert.ok(statusRank('injured reserve') > statusRank('probable'));
  assert.ok(statusRank('suspension') > statusRank('probable'));
});

t('an unknown status sorts last rather than first', () => {
  assert.equal(statusRank('who knows'), STATUS_ORDER.length);
  assert.ok(statusRank('who knows') > statusRank('suspension'));
  assert.ok(statusRank(null) > statusRank('out'));
});

t('ranking is case insensitive, the way ESPN spells it', () => {
  assert.equal(statusRank('Out'), statusRank('out'));
  assert.equal(statusRank('Injured Reserve'), statusRank('injured reserve'));
});

// --- sorting a report --------------------------------------------------------
const p = (player_name, position, status) => ({ player_name, position, status });

t('a quarterback leads the report whatever his status', () => {
  const sorted = sortInjuries([
    p('Sauce Gardner', 'CB', 'out'),
    p('Aaron Rodgers', 'QB', 'questionable'),
    p('Garrett Wilson', 'WR', 'doubtful'),
  ]);
  assert.equal(sorted[0].player_name, 'Aaron Rodgers');
});

t('below the quarterbacks the report runs most severe first', () => {
  const sorted = sortInjuries([
    p('C', 'WR', 'questionable'),
    p('A', 'WR', 'out'),
    p('D', 'WR', 'injured reserve'),
    p('B', 'WR', 'doubtful'),
  ]);
  assert.deepEqual(sorted.map((r) => r.player_name), ['A', 'B', 'C', 'D']);
});

t('two quarterbacks order between themselves by severity', () => {
  const sorted = sortInjuries([p('Backup', 'QB', 'questionable'), p('Starter', 'QB', 'out')]);
  assert.deepEqual(sorted.map((r) => r.player_name), ['Starter', 'Backup']);
});

t('ties break alphabetically, so the order is stable between captures', () => {
  const one = sortInjuries([p('Zeta', 'WR', 'out'), p('Alpha', 'WR', 'out')]);
  const two = sortInjuries([p('Alpha', 'WR', 'out'), p('Zeta', 'WR', 'out')]);
  assert.deepEqual(one.map((r) => r.player_name), ['Alpha', 'Zeta']);
  assert.deepEqual(one, two);
});

t('sorting does not mutate what it was given', () => {
  const input = [p('B', 'WR', 'out'), p('A', 'QB', 'out')];
  sortInjuries(input);
  assert.equal(input[0].player_name, 'B');
});

// --- building injury rows ----------------------------------------------------
const payload = (status, extra = {}) => ({
  injuries: [{
    displayName: 'Kansas City Chiefs',
    injuries: [{
      status,
      shortComment: 'A note.',
      athlete: { displayName: 'Patrick Mahomes', position: { abbreviation: 'QB' } },
      ...extra,
    }],
  }],
});
const built = (status, extra) =>
  injuryRows(payload(status, extra), { capturedAt: 'T', season: 2026, week: 1 });

t('a player with no designation is not stored at all', () => {
  // Two thirds of ESPN's feed is "Active", which is the absence of an injury.
  assert.equal(built('Active').rows.length, 0);
  assert.equal(built('Out').rows.length, 1);
});

t('a stored row carries the team as an Odds API name', () => {
  const r = built('Out').rows[0];
  assert.equal(r.team, 'Kansas City Chiefs');
  assert.equal(r.player_name, 'Patrick Mahomes');
  assert.equal(r.position, 'QB');
  assert.equal(r.status, 'out');
  assert.equal(r.season, 2026);
  assert.equal(r.week, 1);
});

t('an unmappable team is reported rather than written', () => {
  const out = injuryRows(
    { injuries: [{ displayName: 'Toronto Argonauts', injuries: [{ status: 'Out', athlete: { displayName: 'X' } }] }] },
    { capturedAt: 'T', season: 2026, week: 1 },
  );
  assert.equal(out.rows.length, 0);
  assert.deepEqual(out.unknownTeams, ['Toronto Argonauts']);
});

t('the body part fills in when ESPN writes no note', () => {
  const r = built('Out', { shortComment: null, details: { type: 'Ankle', side: 'Left' } }).rows[0];
  assert.equal(r.detail, 'Ankle, Left');
  assert.equal(describeInjury(null), null);
  assert.equal(describeInjury({}), null);
});

t('a written note is one with a sentence in it', () => {
  assert.equal(isWrittenNote('Gordon (calf) is away from the team.'), true);
  // A quarter of ESPN's shortComments are the status again, lower cased.
  assert.equal(isWrittenNote('ir'), false);
  assert.equal(isWrittenNote('questionable'), false);
  assert.equal(isWrittenNote('reserve-sus'), false);
  assert.equal(isWrittenNote(''), false);
  assert.equal(isWrittenNote(null), false);
});

t('a status masquerading as a note is replaced by the body part', () => {
  // Otherwise the report reads "Turner | DT | out | out".
  const r = built('Out', {
    shortComment: 'out',
    details: { type: 'Knee - ACL', location: 'Leg', detail: 'Surgery', side: 'Not Specified' },
  }).rows[0];
  assert.equal(r.detail, 'Knee - ACL, Surgery');
});

t('a real note is kept in preference to the body part', () => {
  const r = built('Out', {
    shortComment: 'Gordon (calf) is working with his own trainer.',
    details: { type: 'Calf' },
  }).rows[0];
  assert.equal(r.detail, 'Gordon (calf) is working with his own trainer.');
});

t('ESPN\'s filler words are not written out as if they meant something', () => {
  assert.equal(describeInjury({ type: 'Not Specified', detail: 'Not Specified', side: 'Not Specified' }), null);
  assert.equal(describeInjury({ type: 'Leg', detail: 'Not Specified', side: 'Right' }), 'Leg, Right');
  // location merely repeats type at a coarser grain, so it is never used.
  assert.equal(describeInjury({ type: 'Knee', location: 'Leg' }), 'Knee');
  assert.equal(noteFor({}), null);
});

t('a player listed twice for one club is stored once', () => {
  // The unique constraint would otherwise reject the entire batch.
  const twice = {
    injuries: [{
      displayName: 'Kansas City Chiefs',
      injuries: [
        { status: 'Out', athlete: { displayName: 'Patrick Mahomes' } },
        { status: 'Questionable', athlete: { displayName: 'Patrick Mahomes' } },
      ],
    }],
  };
  const out = injuryRows(twice, { capturedAt: 'T', season: 2026, week: 1 });
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].status, 'out', 'the first entry should win');
  assert.equal(dedupe([]).length, 0);
});

// --- matching an ESPN event to one of our games ------------------------------
const ourGame = (o = {}) => ({
  game_id: 'g1',
  home_team: 'Cincinnati Bengals',
  away_team: 'Tampa Bay Buccaneers',
  commence_time: '2026-09-13T17:00:00Z',
  ...o,
});
const espnEvent = (o = {}) => ({
  id: '401872925',
  date: '2026-09-13T17:00Z',
  home: 'Cincinnati Bengals',
  away: 'Tampa Bay Buccaneers',
  ...o,
});

t('an event matches our game on both names and kickoff', () => {
  assert.equal(matchEvent(espnEvent(), [ourGame()])?.game_id, 'g1');
});

t('the same fixture at a different kickoff is a different game', () => {
  // These two meet twice a season; only the names would not tell them apart.
  const later = ourGame({ game_id: 'g2', commence_time: '2026-12-20T18:00:00Z' });
  assert.equal(matchEvent(espnEvent(), [later]), null);
  assert.equal(matchEvent(espnEvent({ date: '2026-12-20T18:00Z' }), [ourGame(), later])?.game_id, 'g2');
});

t('home and away are not interchangeable', () => {
  const flipped = ourGame({ home_team: 'Tampa Bay Buccaneers', away_team: 'Cincinnati Bengals' });
  assert.equal(matchEvent(espnEvent(), [flipped]), null);
});

t('a kickoff that has been nudged by an hour still matches', () => {
  const nudged = ourGame({ commence_time: '2026-09-13T18:00:00Z' });
  assert.equal(matchEvent(espnEvent(), [nudged])?.game_id, 'g1');
});

t('the closest kickoff wins when more than one is in range', () => {
  const near = ourGame({ game_id: 'near', commence_time: '2026-09-13T17:05:00Z' });
  const far = ourGame({ game_id: 'far', commence_time: '2026-09-13T20:00:00Z' });
  assert.equal(matchEvent(espnEvent(), [far, near])?.game_id, 'near');
});

t('an unmappable or undated event matches nothing', () => {
  assert.equal(matchEvent(espnEvent({ home: 'Toronto Argonauts' }), [ourGame()]), null);
  assert.equal(matchEvent(espnEvent({ date: null }), [ourGame()]), null);
  assert.equal(matchEvent(espnEvent(), []), null);
});

// --- news text ---------------------------------------------------------------
t('a preview story keeps its sentences and loses its markup', () => {
  const html = '<p>Burrow is <b>back</b>.</p><p>Mayfield &amp; company answer.</p>';
  assert.equal(stripHtml(html), 'Burrow is back.\n\nMayfield & company answer.');
  assert.equal(stripHtml(''), null);
  assert.equal(stripHtml(null), null);
});

t('an article counts for a game only if it names one of the two teams', () => {
  const article = { teams: ['Cincinnati Bengals'] };
  assert.equal(mentionsEither(article, 'Cincinnati Bengals', 'Tampa Bay Buccaneers'), true);
  assert.equal(mentionsEither(article, 'Kansas City Chiefs', 'Denver Broncos'), false);
  assert.equal(mentionsEither({ teams: [] }, 'Cincinnati Bengals', 'Tampa Bay Buccaneers'), false);
});

console.log(`\n${pass} assertions passed`);
