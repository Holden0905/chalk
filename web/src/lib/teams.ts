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

const SUFFIXES = new Set<string>(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

/**
 * Collapse either naming style to one key. nflverse writes "A.St. Brown";
 * the props feed writes "Amon-Ra St. Brown". Both become "a|stbrown".
 */
export function playerNameKey(name: string | null | undefined): string | null {
  if (!name) return null;
  let parts: string[] = String(name).trim().split(/\s+/);
  while (parts.length > 1) {
    const last = parts[parts.length - 1].replace(/[.,]/g, '').toLowerCase();
    if (SUFFIXES.has(last)) parts.pop();
    else break;
  }
  if (parts.length === 0) return null;

  const ALL_INITIALS = /^([A-Za-z]\.)+$/;
  let initial: string;
  let rest: string[];

  // nflverse writes "D.Adams" or "A.St. Brown": an initial, a dot, then the
  // surname. It widens the initial to disambiguate two players who would
  // otherwise collide, as in "Ty.Johnson" and "Ja.Williams", so up to three
  // leading letters are allowed. "C.J. Stroud" matches the same shape but is a
  // two-initial given name, so this only counts when what follows the dot is
  // not itself initials.
  const abbreviated = parts[0].match(/^([A-Za-z]{1,3})\.(.*)$/);
  if (abbreviated && abbreviated[2] && !ALL_INITIALS.test(abbreviated[2])) {
    initial = abbreviated[1][0];
    rest = [abbreviated[2], ...parts.slice(1)];
  } else {
    initial = parts[0][0];
    rest = parts.slice(1);
    // Drop middle initials: "Michael J. Smith", "C.J. Stroud".
    while (rest.length > 1 && ALL_INITIALS.test(rest[0])) rest.shift();
  }
  if (rest.length === 0) return null;
  return `${initial}|${rest.join('')}`.toLowerCase().replace(/[^a-z|]/g, '');
}

export function toAbbr(oddsName: string): string | null {
  return ODDS_TO_NFLVERSE[oddsName] ?? null;
}

export function toOddsName(abbr: string): string | null {
  return NFLVERSE_TO_ODDS[abbr.toUpperCase()] ?? null;
}
