const assert = require('node:assert/strict');
const {
  impliedProb, profitFor, spreadClv, totalClv, probClv, clvFor,
  gradeSpread, gradeTotal, gradeMoneyline, gradeAnytimeTd,
} = require('../bets.js');

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); pass++; };
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

// --- spread CLV -------------------------------------------------------------
t('favourite CLV is positive when the line gets longer after the bet', () => {
  // Took home -3, closed -4.5: bought a cheaper number.
  close(spreadClv(-3, -4.5), 1.5);
});

t('favourite CLV is negative when the line shortens', () => {
  // Took home -4.5, closed -3: the market came to you and you paid up.
  close(spreadClv(-4.5, -3), -1.5);
});

t('dog CLV is positive when the number grows', () => {
  // Took +6, closed +4.5: you hold the bigger cushion.
  close(spreadClv(6, 4.5), 1.5);
});

t('dog CLV is negative when the number shrinks', () => {
  close(spreadClv(3, 4.5), -1.5);
});

t('spread CLV is zero at an unchanged line', () => {
  close(spreadClv(-3, -3), 0);
});

// --- total CLV --------------------------------------------------------------
t('Over CLV is positive when the total rises', () => {
  close(totalClv('Over', 41.5, 44.5), 3);
});

t('Over CLV is negative when the total falls', () => {
  close(totalClv('Over', 44.5, 41.5), -3);
});

t('Under CLV is positive when the total falls', () => {
  close(totalClv('Under', 41.5, 38.5), 3);
});

t('Under CLV is negative when the total rises', () => {
  close(totalClv('Under', 41.5, 44.5), -3);
});

// --- moneyline CLV via implied probability ---------------------------------
t('implied probability matches the standard conversion', () => {
  close(impliedProb(100), 0.5);
  close(impliedProb(-110), 110 / 210);
  close(impliedProb(150), 0.4);
});

t('moneyline CLV is positive when the price shortens after the bet', () => {
  // Took +150 (40.0%), closed +120 (45.45%): bought at a longer price.
  const clv = probClv(150, 120);
  close(clv, (100 / 220 - 0.4) * 100);
  assert.ok(clv > 0);
  close(clv, 5.4545454545, 1e-6);
});

t('moneyline CLV is negative when the price drifts out', () => {
  assert.ok(probClv(120, 150) < 0);
});

t('moneyline CLV is zero at an unchanged price', () => {
  close(probClv(-110, -110), 0);
});

t('clvFor dispatches by market', () => {
  close(clvFor({ market: 'spread', line: -3 }, { line: -4.5 }), 1.5);
  close(clvFor({ market: 'total', side: 'Under', line: 41.5 }, { line: 38.5 }), 3);
  close(clvFor({ market: 'moneyline', price: 150 }, { price: 120 }), 5.4545454545, 1e-6);
  close(clvFor({ market: 'anytime_td', price: 500 }, { price: 300 }), (0.25 - 1 / 6) * 100, 1e-9);
  assert.equal(clvFor({ market: 'spread', line: -3 }, null), null);
});

// --- grading ----------------------------------------------------------------
t('spread grades against the bet own line, not the closing one', () => {
  // Home won by 4. -3 covers, -4.5 does not, even in the same game.
  assert.equal(gradeSpread('PIT', -3, 'PIT', 24, 20), 'win');
  assert.equal(gradeSpread('PIT', -4.5, 'PIT', 24, 20), 'loss');
  // The away side of the same game.
  assert.equal(gradeSpread('ATL', 4.5, 'PIT', 24, 20), 'win');
  assert.equal(gradeSpread('ATL', 3, 'PIT', 24, 20), 'loss');
});

t('spread push when the margin lands exactly on the number', () => {
  assert.equal(gradeSpread('PIT', -3, 'PIT', 24, 21), 'push');
  assert.equal(gradeSpread('ATL', 3, 'PIT', 24, 21), 'push');
});

t('total grades Over and Under', () => {
  assert.equal(gradeTotal('Over', 41.5, 24, 20), 'win');   // 44
  assert.equal(gradeTotal('Under', 41.5, 24, 20), 'loss');
  assert.equal(gradeTotal('Under', 45.5, 24, 20), 'win');
});

t('total push on an exact number', () => {
  assert.equal(gradeTotal('Over', 44, 24, 20), 'push');
  assert.equal(gradeTotal('Under', 44, 24, 20), 'push');
});

t('moneyline grades both sides and a tie', () => {
  assert.equal(gradeMoneyline('PIT', 'PIT', 24, 20), 'win');
  assert.equal(gradeMoneyline('ATL', 'PIT', 24, 20), 'loss');
  assert.equal(gradeMoneyline('ATL', 'PIT', 20, 24), 'win');
  assert.equal(gradeMoneyline('PIT', 'PIT', 20, 20), 'push');
});

t('anytime TD grades from a player week row', () => {
  assert.equal(gradeAnytimeTd({ rush_td: 1, rec_td: 0 }), 'win');
  assert.equal(gradeAnytimeTd({ rush_td: 0, rec_td: 2 }), 'win');
  assert.equal(gradeAnytimeTd({ rush_td: 0, rec_td: 0 }), 'loss');
  assert.equal(gradeAnytimeTd({ rush_att: 12, targets: 3 }), 'loss', 'touches without a score is a loss');
  assert.equal(gradeAnytimeTd(null), null, 'no row is not gradable here');
});

// --- profit -----------------------------------------------------------------
t('profit follows the price', () => {
  close(profitFor(150, 25, 'win'), 37.5);
  close(profitFor(-110, 22, 'win'), 20);
  close(profitFor(-110, 22, 'loss'), -22);
});

t('a push returns nothing and costs nothing', () => {
  assert.equal(profitFor(-110, 22, 'push'), 0);
  assert.equal(profitFor(500, 10, 'push'), 0);
});

console.log(`\n${pass} assertions passed`);
