// Mirrors teams.js at the repo root, which is the source of truth for the
// nflverse abbreviation to Odds API name mapping. Kept as TypeScript here so
// the web app has it without reaching outside its own deploy root.
//
// LA, SEA and SF were never confirmed against a real chalk_odds_snapshots row;
// see the root file for why.

export const NFLVERSE_TO_ODDS: Record<string, string> = {
  ARI: "Arizona Cardinals",
  ATL: "Atlanta Falcons",
  BAL: "Baltimore Ravens",
  BUF: "Buffalo Bills",
  CAR: "Carolina Panthers",
  CHI: "Chicago Bears",
  CIN: "Cincinnati Bengals",
  CLE: "Cleveland Browns",
  DAL: "Dallas Cowboys",
  DEN: "Denver Broncos",
  DET: "Detroit Lions",
  GB: "Green Bay Packers",
  HOU: "Houston Texans",
  IND: "Indianapolis Colts",
  JAX: "Jacksonville Jaguars",
  KC: "Kansas City Chiefs",
  LA: "Los Angeles Rams",
  LAC: "Los Angeles Chargers",
  LV: "Las Vegas Raiders",
  MIA: "Miami Dolphins",
  MIN: "Minnesota Vikings",
  NE: "New England Patriots",
  NO: "New Orleans Saints",
  NYG: "New York Giants",
  NYJ: "New York Jets",
  PHI: "Philadelphia Eagles",
  PIT: "Pittsburgh Steelers",
  SEA: "Seattle Seahawks",
  SF: "San Francisco 49ers",
  TB: "Tampa Bay Buccaneers",
  TEN: "Tennessee Titans",
  WAS: "Washington Commanders",
};

export const ODDS_TO_NFLVERSE: Record<string, string> = Object.fromEntries(
  Object.entries(NFLVERSE_TO_ODDS).map(([abbr, name]) => [name, abbr]),
);

/** Short display name, e.g. "Pittsburgh Steelers" becomes "Steelers". */
export function nickname(oddsName: string): string {
  const parts = oddsName.split(" ");
  return parts[parts.length - 1];
}

/** City part, e.g. "Pittsburgh". Handles the two-word cities. */
export function city(oddsName: string): string {
  const parts = oddsName.split(" ");
  return parts.slice(0, -1).join(" ");
}

export function toAbbr(oddsName: string): string | null {
  return ODDS_TO_NFLVERSE[oddsName] ?? null;
}

export function toOddsName(abbr: string): string | null {
  return NFLVERSE_TO_ODDS[abbr.toUpperCase()] ?? null;
}
