import assert from 'node:assert/strict';
import {
  prepare, rate, mean, scoring, market, situation, byWeek, buildLeague,
  favoriteCovered, homeLine, SITUATIONS,
} from '../web/src/lib/league.mjs';

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); pass++; };

// A chalk_games row as PostgREST hands it back, with the generated columns
// already filled in. Override what a test needs.
const game = (o = {}) => {
  // `in` rather than a default, so a test can pass an explicit null score.
  const home_score = 'home_score' in o ? o.home_score : 24;
  const away_score = 'away_score' in o ? o.away_score : 20;
  const spread_line = o.spread_line === undefined ? 3 : o.spread_line;
  const total_line = o.total_line === undefined ? 44.5 : o.total_line;
  const margin = home_score == null || away_score == null ? null : home_score - away_score;
  const points = home_score == null || away_score == null ? null : home_score + away_score;
  return {
    game_id: 'g', season: 2025, week: 7, weekday: 'Sunday',
    kickoff: '2025-10-19T20:05:00.000Z',  // 4:05 PM Eastern
    home_team: 'LV', away_team: 'KC',
    home_rest: 7, away_rest: 7, div_game: true,
    roof: 'outdoors', surface: 'grass', overtime: false,
    ...o,
    home_score, away_score, spread_line, total_line,
    total_points: points,
    home_margin: margin,
    home_covered:
      margin == null || spread_line == null ? null
        : margin === spread_line ? null : margin > spread_line,
    went_over:
      points == null || total_line == null ? null
        : points === total_line ? null : points > total_line,
    total_diff: points == null || total_line == null ? null : points - total_line,
  };
};

const one = (o) => prepare([game(o)])[0];

// --- what makes it in -------------------------------------------------------
t('a game that has not been played is dropped', () => {
  assert.equal(prepare([game({ home_score: null, away_score: null })]).length, 0);
  assert.equal(prepare([game()]).length, 1);
});

// --- the Eastern windows ----------------------------------------------------
t('a 4pm kickoff is afternoon and an 8:20pm one is primetime', () => {
  assert.equal(one({ kickoff: '2025-10-19T20:05:00.000Z' }).primetime, false);
  assert.equal(one({ kickoff: '2025-10-20T00:20:00.000Z' }).primetime, true);
});

t('a 9:30am London kickoff is neither primetime nor afternoon', () => {
  // Counting it as an afternoon game would quietly fold a different animal in.
  assert.equal(one({ kickoff: '2025-10-05T13:30:00.000Z' }).primetime, null);
});

t('the month comes off the Eastern clock, not UTC', () => {
  // 8:20 PM ET on 31 December is 01:20 UTC on 1 January. It is a December game.
  assert.equal(one({ kickoff: '2026-01-01T01:20:00.000Z' }).month, 12);
});

t('a closed roof is indoors and an open one is not', () => {
  assert.equal(one({ roof: 'dome' }).indoor, true);
  assert.equal(one({ roof: 'closed' }).indoor, true);
  assert.equal(one({ roof: 'open' }).indoor, false);
  assert.equal(one({ roof: 'outdoors' }).indoor, false);
  assert.equal(one({ roof: '' }).indoor, null);
});

// --- the spread convention --------------------------------------------------
t('a positive spread means the home team is favored, and displays as a minus', () => {
  assert.equal(homeLine(3), -3);
  assert.equal(homeLine(-3), 3);
  assert.equal(homeLine(null), null);
});

t('the favorite covering is read off whichever side was favored', () => {
  // Home favored by 3 and won by 4: the favorite covered.
  assert.equal(favoriteCovered(one({ spread_line: 3, home_score: 24, away_score: 20 })), true);
  // Away favored by 3 and the home side won: the favorite did not cover.
  assert.equal(favoriteCovered(one({ spread_line: -3, home_score: 24, away_score: 20 })), false);
  // A pick'em has no favorite to have an opinion about.
  assert.equal(favoriteCovered(one({ spread_line: 0 })), null);
});

// --- pushes -----------------------------------------------------------------
t('a spread push is neither a cover nor a fail, and leaves the denominator', () => {
  const games = prepare([
    game({ game_id: 'a', spread_line: 4, home_score: 24, away_score: 20 }),  // exact push
    game({ game_id: 'b', spread_line: 3, home_score: 24, away_score: 20 }),  // home covers
  ]);
  const m = market(games);
  assert.equal(m.homeCover.games, 1, 'the push should not be counted as an outcome');
  assert.equal(m.homeCover.value, 100);
  // The push rate, though, is a share of every game that had a number.
  assert.equal(m.spreadPush.games, 2);
  assert.equal(m.spreadPush.value, 50);
});

t('a total push behaves the same way', () => {
  const games = prepare([
    game({ game_id: 'a', total_line: 44, home_score: 24, away_score: 20 }),
    game({ game_id: 'b', total_line: 40, home_score: 24, away_score: 20 }),
  ]);
  const m = market(games);
  assert.equal(m.over.games, 1);
  assert.equal(m.over.value, 100);
  assert.equal(m.totalPush.value, 50);
});

// --- the primitives ---------------------------------------------------------
t('a rate off nothing is null rather than zero', () => {
  assert.deepEqual(rate([], () => true), { value: null, games: 0 });
  assert.deepEqual(mean([], () => 1), { value: null, games: 0 });
});

t('a mean skips the games that do not have the quantity', () => {
  const games = prepare([
    game({ game_id: 'a', total_line: 40 }),
    game({ game_id: 'b', total_line: null }),
  ]);
  const m = mean(games, (g) => g.totalLine);
  assert.equal(m.value, 40);
  assert.equal(m.games, 1, 'the game with no total should not dilute the average');
});

// --- scoring ----------------------------------------------------------------
t('the point bands split at 40 and 48 without a gap or an overlap', () => {
  const games = prepare([
    game({ game_id: 'a', home_score: 20, away_score: 19 }),  // 39, under
    game({ game_id: 'b', home_score: 20, away_score: 20 }),  // 40, middle
    game({ game_id: 'c', home_score: 24, away_score: 23 }),  // 47, middle
    game({ game_id: 'd', home_score: 24, away_score: 24 }),  // 48, over
  ]);
  const s = scoring(games);
  assert.equal(s.under40.value, 25);
  assert.equal(s.mid.value, 50);
  assert.equal(s.over48.value, 25);
  assert.equal(s.under40.value + s.mid.value + s.over48.value, 100);
});

t('average margin is the gap, not the direction', () => {
  const games = prepare([
    game({ game_id: 'a', home_score: 30, away_score: 10 }),  // +20
    game({ game_id: 'b', home_score: 10, away_score: 30 }),  // -20
  ]);
  assert.equal(scoring(games).avgMargin.value, 20);
});

t('the highest and lowest totals name their game', () => {
  const games = prepare([
    game({ game_id: 'a', home_score: 40, away_score: 38, home_team: 'LV', away_team: 'KC' }),
    game({ game_id: 'b', home_score: 3, away_score: 0 }),
  ]);
  const s = scoring(games);
  assert.equal(s.highest.points, 78);
  assert.equal(s.highest.label, 'KC 38 at LV 40');
  assert.equal(s.lowest.points, 3);
});

// --- home field -------------------------------------------------------------
t('priced and played home field are measured over the same games', () => {
  const games = prepare([
    game({ game_id: 'a', spread_line: 3, home_score: 24, away_score: 20 }),
    game({ game_id: 'b', spread_line: null, home_score: 30, away_score: 0 }),
  ]);
  const m = market(games);
  assert.equal(m.pricedHome.value, 3);
  assert.equal(m.playedHome.value, 4, 'the game with no line must not reach the played side either');
  assert.equal(m.pricedHome.games, m.playedHome.games);
});

// --- situations that need to look across games ------------------------------
t('off a Thursday game reads the previous game, not this one', () => {
  const rows = [
    game({ game_id: 'a', week: 5, weekday: 'Thursday', kickoff: '2025-10-03T00:20:00.000Z', home_team: 'LV', away_team: 'KC' }),
    game({ game_id: 'b', week: 6, weekday: 'Sunday', kickoff: '2025-10-12T17:00:00.000Z', home_team: 'LV', away_team: 'DEN' }),
    game({ game_id: 'c', week: 6, weekday: 'Sunday', kickoff: '2025-10-12T17:00:00.000Z', home_team: 'NE', away_team: 'NYJ' }),
  ];
  const games = prepare(rows);
  const test = SITUATIONS.find((s) => s.key === 'home-post-thu').test;
  assert.deepEqual(games.filter(test).map((g) => g.gameId), ['b']);
});

t('off a 17+ loss looks at either team, and from that team\'s own side', () => {
  const rows = [
    // KC lose by 21 at LV in week 5.
    game({ game_id: 'a', week: 5, kickoff: '2025-10-05T17:00:00.000Z', home_team: 'LV', away_team: 'KC', home_score: 31, away_score: 10 }),
    // Week 6: KC are home, off that loss.
    game({ game_id: 'b', week: 6, kickoff: '2025-10-12T17:00:00.000Z', home_team: 'KC', away_team: 'DEN' }),
    // LV won that game by 21, so their next one does not qualify.
    game({ game_id: 'c', week: 6, kickoff: '2025-10-12T17:00:00.000Z', home_team: 'SEA', away_team: 'LV' }),
  ];
  const games = prepare(rows);
  const test = SITUATIONS.find((s) => s.key === 'off-blowout').test;
  assert.deepEqual(games.filter(test).map((g) => g.gameId), ['b']);
});

t('a week 1 game has no previous game to be off anything', () => {
  const games = prepare([game({ week: 1, kickoff: '2025-09-07T17:00:00.000Z' })]);
  assert.equal(games[0].homePrev, null);
  assert.equal(games[0].awayPrev, null);
  for (const key of ['home-post-thu', 'off-blowout']) {
    assert.equal(SITUATIONS.find((s) => s.key === key).test(games[0]), false);
  }
});

t('rest thresholds are inclusive at 4 and at 13', () => {
  const by = (key) => SITUATIONS.find((s) => s.key === key).test;
  assert.equal(by('home-short')(one({ home_rest: 4 })), true);
  assert.equal(by('home-short')(one({ home_rest: 5 })), false);
  assert.equal(by('road-short')(one({ away_rest: 4 })), true);
  assert.equal(by('home-bye')(one({ home_rest: 13 })), true);
  assert.equal(by('home-bye')(one({ home_rest: 12 })), false);
});

t('the week split and the divisional split each cover every game once', () => {
  const games = prepare([
    game({ game_id: 'a', week: 4, div_game: true }),
    game({ game_id: 'b', week: 5, div_game: false }),
  ]);
  const by = (key) => games.filter(SITUATIONS.find((s) => s.key === key).test).length;
  assert.equal(by('weeks-1-4') + by('weeks-5-18'), games.length);
  assert.equal(by('div') + by('nondiv'), games.length);
});

t('distance from 50 reports the more extreme of the two rates', () => {
  const games = prepare([
    // Home covers both, goes over one and under one: 100% ats, 50% o/u.
    game({ game_id: 'a', spread_line: 0, home_score: 24, away_score: 20, total_line: 40 }),
    game({ game_id: 'b', spread_line: 0, home_score: 24, away_score: 20, total_line: 50 }),
  ]);
  const s = situation(games, () => true);
  assert.equal(s.games, 2);
  assert.equal(s.cover.value, 100);
  assert.equal(s.over.value, 50);
  assert.equal(s.off.value, 50);
  assert.equal(s.off.from, 'ats');
});

// --- by week ----------------------------------------------------------------
t('by week always returns all eighteen weeks, empty ones included', () => {
  const weeks = byWeek(prepare([game({ week: 7 })]));
  assert.equal(weeks.length, 18);
  assert.equal(weeks[6].week, 7);
  assert.equal(weeks[6].avgTotal.games, 1);
  assert.equal(weeks[0].avgTotal.value, null, 'a week with no games has no average');
  assert.equal(weeks[0].avgTotal.games, 0);
});

// --- assembly ---------------------------------------------------------------
t('the All column is always present and holds every game', () => {
  const rows = [game({ game_id: 'a', season: 2024 }), game({ game_id: 'b', season: 2025 })];
  const built = buildLeague(rows, [2025]);
  assert.deepEqual(built.columns.map((c) => c.key), ['2025', 'all']);
  assert.equal(built.columns.at(-1).count, 2);
  assert.equal(built.columns[0].count, 1);
});

t('asking for no seasons leaves the All column on its own', () => {
  const built = buildLeague([game()], []);
  assert.deepEqual(built.columns.map((c) => c.key), ['all']);
});

t('a season with no played games is not offered as a column', () => {
  const built = buildLeague([game({ season: 2025 })], [2026, 2025]);
  assert.deepEqual(built.available, [2025]);
  assert.deepEqual(built.columns.map((c) => c.key), ['2025', 'all']);
});

console.log(`\n${pass} assertions passed`);
