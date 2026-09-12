// Maps nflverse team abbreviations (chalk_team_weeks.team) to the full team
// names The Odds API uses (chalk_odds_snapshots.home_team / away_team), so the
// two tables can be joined.
//
// 29 of the 32 names below were confirmed against the strings actually present
// in chalk_odds_snapshots. The three in UNVERIFIED were not: no game involving
// them had been captured when this was written, so their names are the Odds
// API's documented spelling rather than something observed in our own data.
// Confirm them once those teams appear in a snapshot.

const NFLVERSE_TO_ODDS = {
  ARI: 'Arizona Cardinals',
  ATL: 'Atlanta Falcons',
  BAL: 'Baltimore Ravens',
  BUF: 'Buffalo Bills',
  CAR: 'Carolina Panthers',
  CHI: 'Chicago Bears',
  CIN: 'Cincinnati Bengals',
  CLE: 'Cleveland Browns',
  DAL: 'Dallas Cowboys',
  DEN: 'Denver Broncos',
  DET: 'Detroit Lions',
  GB: 'Green Bay Packers',
  HOU: 'Houston Texans',
  IND: 'Indianapolis Colts',
  JAX: 'Jacksonville Jaguars',
  KC: 'Kansas City Chiefs',
  LA: 'Los Angeles Rams',
  LAC: 'Los Angeles Chargers',
  LV: 'Las Vegas Raiders',
  MIA: 'Miami Dolphins',
  MIN: 'Minnesota Vikings',
  NE: 'New England Patriots',
  NO: 'New Orleans Saints',
  NYG: 'New York Giants',
  NYJ: 'New York Jets',
  PHI: 'Philadelphia Eagles',
  PIT: 'Pittsburgh Steelers',
  SEA: 'Seattle Seahawks',
  SF: 'San Francisco 49ers',
  TB: 'Tampa Bay Buccaneers',
  TEN: 'Tennessee Titans',
  WAS: 'Washington Commanders',
};

// Not yet confirmed against a real row in chalk_odds_snapshots.
const UNVERIFIED = new Set(['LA', 'SEA', 'SF']);

// nflverse reuses abbreviations across relocations and has changed some over
// time. These only matter when backfilling seasons before 2020; the 2025 and
// 2026 files use the canonical keys above.
//   LAR -> LA   some nflverse vintages spell the Rams LAR
//   STL -> LA   Rams before the 2016 move
//   SD  -> LAC  Chargers before the 2017 move
//   OAK -> LV   Raiders before the 2020 move
const ALIASES = { LAR: 'LA', STL: 'LA', SD: 'LAC', OAK: 'LV' };

function canonical(abbr) {
  if (!abbr) return null;
  const up = String(abbr).toUpperCase();
  return ALIASES[up] || up;
}

function toOddsName(abbr) {
  return NFLVERSE_TO_ODDS[canonical(abbr)] || null;
}

const ODDS_TO_NFLVERSE = Object.fromEntries(
  Object.entries(NFLVERSE_TO_ODDS).map(([abbr, name]) => [name, abbr])
);

function toAbbr(oddsName) {
  return ODDS_TO_NFLVERSE[oddsName] || null;
}

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

/**
 * Collapse either naming style to one key. nflverse writes "A.St. Brown";
 * the props feed writes "Amon-Ra St. Brown". Both become "a|stbrown".
 */
function playerNameKey(name) {
  if (!name) return null;
  let parts = String(name).trim().split(/\s+/);
  while (parts.length > 1) {
    const last = parts[parts.length - 1].replace(/[.,]/g, '').toLowerCase();
    if (SUFFIXES.has(last)) parts.pop();
    else break;
  }
  if (parts.length === 0) return null;

  const ALL_INITIALS = /^([A-Za-z]\.)+$/;
  let initial;
  let rest;

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

module.exports = {
  playerNameKey,
  NFLVERSE_TO_ODDS,
  ODDS_TO_NFLVERSE,
  ALIASES,
  UNVERIFIED,
  canonical,
  toOddsName,
  toAbbr,
};
