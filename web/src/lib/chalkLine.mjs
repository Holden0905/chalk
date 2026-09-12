/**
 * Chalk's own number for a game, shared by the bets form and bet.js so the CLI
 * and the site cannot record different numbers for the same bet.
 *
 * Pure: it takes rating rows and weights and returns a number.
 */

const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The handicap on the home team. Negative means the home team is favoured. */
export function impliedSpreadHome(homeRating, awayRating, homeField) {
  if (homeRating == null || awayRating == null) return null;
  return -(homeRating - awayRating + homeField);
}

export function impliedTotal(home, away, leagueAvgTotal, totalScale) {
  if (!home || !away || leagueAvgTotal == null) return null;
  const parts = [home.off, away.off, home.def, away.def];
  if (parts.some((p) => p == null)) return null;
  return leagueAvgTotal + totalScale * (home.off + away.off - home.def - away.def);
}

/**
 * @param {object} input
 * @param {string} input.market       spread | total | moneyline | anytime_td
 * @param {string} input.side         team name for a spread, Over/Under for a total
 * @param {string} input.homeTeam     Odds API home team name
 * @param {string|null} input.homeAbbr
 * @param {string|null} input.awayAbbr
 * @param {Array}  input.ratings      chalk_ratings rows for the latest week
 * @param {object} input.weights      weights.json
 * @returns {number|null} the number from the bettor's side, or null
 */
export function chalkLineFor({ market, side, homeTeam, homeAbbr, awayAbbr, ratings, weights }) {
  if (market !== "spread" && market !== "total") return null;
  if (!homeAbbr || !awayAbbr) return null;

  const byTeam = new Map(ratings.map((r) => [r.team, r]));
  const home = byTeam.get(homeAbbr);
  const away = byTeam.get(awayAbbr);
  if (!home || !away) return null;

  if (market === "spread") {
    const spreadHome = impliedSpreadHome(
      num(home.team_rating), num(away.team_rating), Number(weights.home_field ?? 0),
    );
    if (spreadHome == null) return null;
    // Flip for an away bet, matching how `line` is stored.
    return side === homeTeam ? spreadHome : -spreadHome;
  }

  return impliedTotal(
    { off: num(home.off_scoring_rating), def: num(home.def_scoring_rating) },
    { off: num(away.off_scoring_rating), def: num(away.def_scoring_rating) },
    num(home.league_avg_total),
    Number(weights.total_scale ?? 1),
  );
}

/**
 * Did the bet agree with Chalk's lean? Positive means the number taken was
 * better than Chalk's own, which is the same comparison CLV makes against the
 * close. Null when Chalk has no opinion.
 */
export function chalkEdge({ market, side, line, chalkLine }) {
  if (chalkLine == null || line == null) return null;
  if (market === "spread") return Number(line) - Number(chalkLine);
  if (market === "total") {
    return String(side).toLowerCase() === "over"
      ? Number(chalkLine) - Number(line)
      : Number(line) - Number(chalkLine);
  }
  return null;
}
