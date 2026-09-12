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

module.exports = {
  NFLVERSE_TO_ODDS,
  ODDS_TO_NFLVERSE,
  ALIASES,
  UNVERIFIED,
  canonical,
  toOddsName,
  toAbbr,
};
