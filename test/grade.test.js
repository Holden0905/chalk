const assert = require('node:assert/strict');
const { covered, over, closingLine, bookRank } = require('../grade.js');

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); pass++; };

// --- spread ---
// Home -3 wins by 7 -> covers.  (24 + -3) = 21 > 14
t('home favorite covers', () => assert.equal(covered(24, 14, '-3'), true));
// Home -7 wins by 3 -> fails.   (24 + -7) = 17 < 21
t('home favorite fails to cover', () => assert.equal(covered(24, 21, '-7'), false));
// Home +3 loses by 1 -> covers. (20 + 3) = 23 > 21
t('home dog covers', () => assert.equal(covered(20, 21, '3'), true));
// Exact push: home -7 wins by exactly 7.
t('spread push is null', () => assert.equal(covered(24, 17, '-7'), null));
t('pickem push is null', () => assert.equal(covered(20, 20, '0'), null));
t('null spread -> null', () => assert.equal(covered(24, 17, null), null));

// --- total ---
t('over', () => assert.equal(over(24, 21, '38.5'), true));
t('under', () => assert.equal(over(10, 13, '38.5'), false));
t('total push is null', () => assert.equal(over(24, 17, '41'), null));
t('null total -> null', () => assert.equal(over(24, 17, null), null));

// numerics arrive from PostgREST as strings; make sure no string concat sneaks in
t('string spread is not concatenated', () => assert.equal(covered(3, 10, '-3'), false));
t('string total is not concatenated', () => assert.equal(over(3, 4, '7'), null));

// --- book preference ---
t('draftkings outranks fanduel', () => assert.ok(bookRank('draftkings') < bookRank('fanduel')));
t('known books outrank unknown', () => assert.ok(bookRank('fanduel') < bookRank('betus')));

const KICK = '2026-09-13T17:00:00Z';
const game = (snaps) => ({ commence_time: KICK, snaps });

t('prefers draftkings within the latest pre-kickoff capture', () => {
  const c = closingLine(game([
    { captured_at: '2026-09-13T16:00:00Z', bookmaker: 'draftkings', spread_home: '-3', total: '44' },
    { captured_at: '2026-09-13T16:00:00Z', bookmaker: 'fanduel', spread_home: '-3.5', total: '44.5' },
    { captured_at: '2026-09-13T16:00:00Z', bookmaker: 'betus', spread_home: '-2.5', total: '43' },
  ]));
  assert.equal(c.bookmaker, 'draftkings');
});

t('falls back to fanduel, then any book', () => {
  assert.equal(closingLine(game([
    { captured_at: '2026-09-13T16:00:00Z', bookmaker: 'betus', spread_home: '-2.5', total: '43' },
    { captured_at: '2026-09-13T16:00:00Z', bookmaker: 'fanduel', spread_home: '-3.5', total: '44.5' },
  ])).bookmaker, 'fanduel');
  assert.equal(closingLine(game([
    { captured_at: '2026-09-13T16:00:00Z', bookmaker: 'betus', spread_home: '-2.5', total: '43' },
  ])).bookmaker, 'betus');
});

t('takes the latest capture, not an earlier one', () => {
  const c = closingLine(game([
    { captured_at: '2026-09-10T14:00:00Z', bookmaker: 'draftkings', spread_home: '-1', total: '40' },
    { captured_at: '2026-09-13T16:30:00Z', bookmaker: 'draftkings', spread_home: '-3', total: '44' },
  ]));
  assert.equal(c.spread_home, '-3');
});

t('ignores captures at or after kickoff', () => {
  const c = closingLine(game([
    { captured_at: '2026-09-13T16:30:00Z', bookmaker: 'draftkings', spread_home: '-3', total: '44' },
    { captured_at: '2026-09-13T18:00:00Z', bookmaker: 'draftkings', spread_home: '-6', total: '48' },
  ]));
  assert.equal(c.spread_home, '-3', 'in-game line must not be used as closing');
});

t('no pre-kickoff capture -> null', () => {
  assert.equal(closingLine(game([
    { captured_at: '2026-09-13T18:00:00Z', bookmaker: 'draftkings', spread_home: '-6', total: '48' },
  ])), null);
});

console.log(`\n${pass} assertions passed`);
