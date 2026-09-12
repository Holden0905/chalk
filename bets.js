// Pure betting arithmetic, shared by the CLI, the grader and the tests.
// Nothing here touches the network or the database.

const MARKETS = ['spread', 'total', 'moneyline', 'anytime_td'];

/** Implied probability of an American price, vig included, as a fraction. */
function impliedProb(american) {
  if (american == null || !Number.isFinite(Number(american))) return null;
  const a = Number(american);
  return a > 0 ? 100 / (a + 100) : Math.abs(a) / (Math.abs(a) + 100);
}

/** Decimal payout multiplier, for comparing prices by what they actually pay. */
function decimalOdds(american) {
  if (american == null || !Number.isFinite(Number(american))) return null;
  const a = Number(american);
  return a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a);
}

/** Net profit on a settled bet. Stake is returned separately, so a push is 0. */
function profitFor(price, stake, result) {
  if (result === 'push') return 0;
  if (result === 'loss') return -Number(stake);
  if (result !== 'win') return null;
  const a = Number(price);
  return a > 0 ? Number(stake) * (a / 100) : Number(stake) * (100 / Math.abs(a));
}

/**
 * Spread CLV in points. Both lines are from the bettor's side, so taking -3 on
 * a favourite that closes -4.5 is +1.5, and taking +3 on a dog that closes +4.5
 * is -1.5. Getting the bigger number is always better.
 */
function spreadClv(betLine, closingLine) {
  if (betLine == null || closingLine == null) return null;
  return Number(betLine) - Number(closingLine);
}

/**
 * Total CLV in points. An Over wants the number to rise after the bet, an Under
 * wants it to fall.
 */
function totalClv(side, betLine, closingLine) {
  if (betLine == null || closingLine == null || !side) return null;
  const over = String(side).toLowerCase() === 'over';
  return over ? Number(closingLine) - Number(betLine) : Number(betLine) - Number(closingLine);
}

/**
 * CLV for markets with no line to move. A better price is a lower implied
 * probability, so beating the close means the closing probability is higher
 * than the one bought. Returned in percentage points.
 */
function probClv(betPrice, closingPrice) {
  const bet = impliedProb(betPrice);
  const close = impliedProb(closingPrice);
  if (bet == null || close == null) return null;
  return (close - bet) * 100;
}

/** Dispatch CLV by market. `closing` carries { line, price }. */
function clvFor(bet, closing) {
  if (!closing) return null;
  switch (bet.market) {
    case 'spread':
      return spreadClv(bet.line, closing.line);
    case 'total':
      return totalClv(bet.side, bet.line, closing.line);
    case 'moneyline':
    case 'anytime_td':
      return probClv(bet.price, closing.price);
    default:
      return null;
  }
}

/**
 * Grade a side against a final score. `line` is the handicap on the bet's own
 * side, which is not necessarily the closing number the results table used.
 */
function gradeSpread(side, line, homeTeam, homeScore, awayScore) {
  if (homeScore == null || awayScore == null || line == null) return null;
  const margin = Number(homeScore) - Number(awayScore);
  const sideMargin = side === homeTeam ? margin : -margin;
  const edge = sideMargin + Number(line);
  if (edge === 0) return 'push';
  return edge > 0 ? 'win' : 'loss';
}

function gradeTotal(side, line, homeScore, awayScore) {
  if (homeScore == null || awayScore == null || line == null) return null;
  const total = Number(homeScore) + Number(awayScore);
  const diff = total - Number(line);
  if (diff === 0) return 'push';
  const over = String(side).toLowerCase() === 'over';
  return diff > 0 === over ? 'win' : 'loss';
}

function gradeMoneyline(side, homeTeam, homeScore, awayScore) {
  if (homeScore == null || awayScore == null) return null;
  const margin = Number(homeScore) - Number(awayScore);
  if (margin === 0) return 'push';
  const homeWon = margin > 0;
  return side === homeTeam === homeWon ? 'win' : 'loss';
}

/**
 * Anytime touchdown from a player's week row. Only rushing and receiving
 * touchdowns are stored, so a return or defensive score is not counted.
 */
function gradeAnytimeTd(playerWeek) {
  if (!playerWeek) return null;
  const tds = Number(playerWeek.rush_td || 0) + Number(playerWeek.rec_td || 0);
  return tds > 0 ? 'win' : 'loss';
}

module.exports = {
  MARKETS,
  impliedProb,
  decimalOdds,
  profitFor,
  spreadClv,
  totalClv,
  probClv,
  clvFor,
  gradeSpread,
  gradeTotal,
  gradeMoneyline,
  gradeAnytimeTd,
};
