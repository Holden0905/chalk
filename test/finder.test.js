const assert = require('node:assert/strict');
const { nameKey, decimal } = require('../finder.js');

let pass = 0;
const t = (name, fn) => { fn(); console.log(`  ok  ${name}`); pass++; };

const same = (a, b) => assert.equal(nameKey(a), nameKey(b), `${a} should key like ${b}`);

t('plain names match their nflverse abbreviation', () => {
  same('D.Adams', 'Davante Adams');
  same('B.Robinson', 'Bijan Robinson');
  same('T.McBride', 'Trey McBride');
});

t('multi-word surnames survive', () => {
  same('A.St. Brown', 'Amon-Ra St. Brown');
  same('M.Valdes-Scantling', 'Marquez Valdes-Scantling');
});

t('generational suffixes are ignored', () => {
  same('M.Pittman', 'Michael Pittman Jr.');
  same('K.Walker', 'Kenneth Walker III');
  same('O.Beckham', 'Odell Beckham Jr');
});

t('initial-style given names are not mistaken for a surname', () => {
  // "C.J. Stroud" has the same shape as nflverse's "C.Stroud" but the part
  // after the first dot is another initial, not the surname.
  same('C.Stroud', 'C.J. Stroud');
  same('A.Brown', 'A.J. Brown');
  same('D.Moore', 'D.J. Moore');
  assert.equal(nameKey('C.J. Stroud'), 'c|stroud');
});

t('nflverse widened initials still key on the first letter', () => {
  // nflverse writes Ty.Johnson to separate him from another T.Johnson.
  same('Ty.Johnson', 'Tyler Johnson');
  same('Ja.Williams', 'Jameson Williams');
  assert.equal(nameKey('Ty.Johnson'), 't|johnson');
});

t('middle initials are dropped', () => {
  same('M.Smith', 'Michael J. Smith');
});

t('unusable names return null rather than a bad key', () => {
  assert.equal(nameKey(''), null);
  assert.equal(nameKey(null), null);
  assert.equal(nameKey('Cher'), null);
});

t('different players do not collide', () => {
  assert.notEqual(nameKey('D.Adams'), nameKey('J.Adams'));
  assert.notEqual(nameKey('D.Adams'), nameKey('D.Anderson'));
});

t('decimal odds order prices by payout, not by number', () => {
  assert.ok(decimal(190) > decimal(120), 'bigger plus price pays more');
  assert.ok(decimal(120) > decimal(-140), 'a plus price beats a minus price');
  assert.ok(decimal(-140) > decimal(-200), 'a shorter minus price pays more');
  assert.equal(decimal(null), null);
});

t('best-price selection picks the top payout', () => {
  const quotes = [
    { price: -140, book: 'a' },
    { price: 120, book: 'b' },
    { price: -110, book: 'c' },
  ];
  const best = quotes.reduce((x, y) => (decimal(y.price) > decimal(x.price) ? y : x));
  assert.equal(best.book, 'b');
});

console.log(`\n${pass} assertions passed`);
