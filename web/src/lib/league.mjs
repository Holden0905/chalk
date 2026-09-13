/**
 * League-wide base rates, built from chalk_games rows. Pure: rows in, slips
 * out, no IO and no database, so the numbers can be tested without a network.
 *
 * Every figure here is a { value, games } pair. Nothing on /league is a rate
 * without the sample it came from sitting next to it, because a 62% cover rate
 * off 13 games and off 1,300 games are not the same claim.
 *
 * SPREAD SIGN. chalk_games.spread_line keeps nflverse's convention: POSITIVE
 * means the home team is favored, which points the same way as home_margin.
 * That is what every calculation below uses. `homeLine()` flips it for display,
 * where a bettor expects a home favorite to read as a minus number.
 */

export const FIRST_SEASON = 2022;
export const LAST_REGULAR_WEEK = 18;

/** A home favorite priced at +3 here is the −3 a bettor sees on the screen. */
export const homeLine = (spread) => (spread == null ? null : -spread);

const n = (v) => {
  if (v == null || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

const bool = (v) => (v == null ? null : v === true || v === "true" || v === "t");

const etParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  month: "2-digit",
  hour: "2-digit",
  hour12: false,
});

/** Kickoff month and hour in Eastern, which is how the NFL labels its windows. */
function easternSlot(iso) {
  if (!iso) return { month: null, hour: null };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { month: null, hour: null };
  const p = Object.fromEntries(etParts.formatToParts(d).map((x) => [x.type, x.value]));
  const hour = Number(p.hour);
  return { month: Number(p.month), hour: hour === 24 ? 0 : hour };
}

/**
 * Row shape from the database into the shape everything below reads, with the
 * pieces that need a lookup across games -- each team's previous game -- filled
 * in. Unplayed games are dropped: a scheduled game has no rate to contribute,
 * and counting it would inflate every denominator on the page.
 */
export function prepare(rows) {
  const games = rows
    .map((r) => {
      const { month, hour } = easternSlot(r.kickoff);
      const roof = r.roof || null;
      return {
        gameId: r.game_id,
        season: Number(r.season),
        week: Number(r.week),
        weekday: r.weekday || null,
        kickoff: r.kickoff || null,
        month,
        hour,
        home: r.home_team,
        away: r.away_team,
        homeScore: n(r.home_score),
        awayScore: n(r.away_score),
        spread: n(r.spread_line),
        totalLine: n(r.total_line),
        homeRest: n(r.home_rest),
        awayRest: n(r.away_rest),
        div: bool(r.div_game),
        roof,
        surface: r.surface || null,
        ot: bool(r.overtime),
        points: n(r.total_points),
        margin: n(r.home_margin),
        homeCovered: bool(r.home_covered),
        wentOver: bool(r.went_over),
        totalDiff: n(r.total_diff),
        // A closed retractable roof is an indoor game; an open one is not.
        indoor: roof == null ? null : roof === "dome" || roof === "closed",
        // Primetime is the 7pm ET or later window: TNF, SNF, MNF. Afternoon is
        // the 12pm to 7pm block. The 9:30am ET international games are in
        // neither, on purpose -- they are their own animal.
        primetime: hour == null ? null : hour >= 19 ? true : hour >= 12 ? false : null,
        homePrev: null,
        awayPrev: null,
      };
    })
    .filter((g) => g.homeScore != null && g.awayScore != null);

  // Each team's previous game this season, in kickoff order. Used by the "off a
  // Thursday game" and "off a 17+ loss" situations, neither of which any single
  // row can answer on its own.
  games.sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)) || a.week - b.week);
  const last = new Map();
  for (const g of games) {
    const hk = `${g.season}|${g.home}`;
    const ak = `${g.season}|${g.away}`;
    g.homePrev = last.get(hk) ?? null;
    g.awayPrev = last.get(ak) ?? null;
    last.set(hk, { weekday: g.weekday, margin: g.margin });
    last.set(ak, { weekday: g.weekday, margin: g.margin == null ? null : -g.margin });
  }
  return games;
}

// --- the two primitives every number on the page is made of -----------------

/** Share of decided outcomes, in percent. Pushes and unknowns are excluded. */
export function rate(games, pick) {
  let yes = 0;
  let no = 0;
  for (const g of games) {
    const v = pick(g);
    if (v === true) yes += 1;
    else if (v === false) no += 1;
  }
  const total = yes + no;
  return { value: total ? (100 * yes) / total : null, games: total };
}

/** Plain average over the games that have the quantity at all. */
export function mean(games, pick) {
  let sum = 0;
  let count = 0;
  for (const g of games) {
    const v = pick(g);
    if (v != null && Number.isFinite(v)) {
      sum += v;
      count += 1;
    }
  }
  return { value: count ? sum / count : null, games: count };
}

const empty = { value: null, games: 0 };

/** Which side was favored covered. Pick'ems have no favorite, so they sit out. */
export const favoriteCovered = (g) => {
  if (g.spread == null || g.spread === 0 || g.homeCovered == null) return null;
  return g.spread > 0 ? g.homeCovered : !g.homeCovered;
};

// --- slip 1: scoring --------------------------------------------------------

function extreme(games, direction) {
  let best = null;
  for (const g of games) {
    if (g.points == null) continue;
    if (!best || (direction > 0 ? g.points > best.points : g.points < best.points)) best = g;
  }
  if (!best) return null;
  return {
    points: best.points,
    label: `${best.away} ${best.awayScore} at ${best.home} ${best.homeScore}`,
    season: best.season,
    week: best.week,
  };
}

export function scoring(games) {
  return {
    avgTotal: mean(games, (g) => g.points),
    avgHome: mean(games, (g) => g.homeScore),
    avgAway: mean(games, (g) => g.awayScore),
    avgMargin: mean(games, (g) => (g.margin == null ? null : Math.abs(g.margin))),
    under40: rate(games, (g) => (g.points == null ? null : g.points < 40)),
    mid: rate(games, (g) => (g.points == null ? null : g.points >= 40 && g.points <= 47)),
    over48: rate(games, (g) => (g.points == null ? null : g.points >= 48)),
    overtime: rate(games, (g) => g.ot),
    highest: extreme(games, 1),
    lowest: extreme(games, -1),
  };
}

// --- slip 2: the market -----------------------------------------------------

export function market(games) {
  const priced = games.filter((g) => g.spread != null);
  return {
    homeCover: rate(games, (g) => g.homeCovered),
    favCover: rate(games, favoriteCovered),
    over: rate(games, (g) => g.wentOver),
    // A push is a real outcome, so its denominator is every game that had a
    // number, pushes included -- unlike the cover and over rates above.
    spreadPush: rate(games, (g) =>
      g.spread == null || g.margin == null ? null : g.margin === g.spread),
    totalPush: rate(games, (g) =>
      g.totalLine == null || g.points == null ? null : g.points === g.totalLine),
    avgSpread: mean(games, (g) => (g.spread == null ? null : homeLine(g.spread))),
    avgTotalLine: mean(games, (g) => g.totalLine),
    within3: rate(games, (g) => (g.totalDiff == null ? null : Math.abs(g.totalDiff) <= 3)),
    within7: rate(games, (g) => (g.totalDiff == null ? null : Math.abs(g.totalDiff) <= 7)),
    by3: rate(games, (g) => (g.margin == null ? null : Math.abs(g.margin) === 3)),
    by7: rate(games, (g) => (g.margin == null ? null : Math.abs(g.margin) === 7)),
    // Home field as the market priced it against how it actually played, over
    // the same set of games so the two are comparable.
    pricedHome: mean(priced, (g) => g.spread),
    playedHome: mean(priced, (g) => g.margin),
  };
}

// --- slip 3: situations -----------------------------------------------------

const prevLossBy17 = (prev) => prev != null && prev.margin != null && prev.margin <= -17;

export const SITUATIONS = [
  { key: "home-short", label: "Home off a short week", test: (g) => g.homeRest != null && g.homeRest <= 4 },
  { key: "road-short", label: "Road off a short week", test: (g) => g.awayRest != null && g.awayRest <= 4 },
  { key: "home-bye", label: "Home off a bye", test: (g) => g.homeRest != null && g.homeRest >= 13 },
  { key: "home-post-thu", label: "Home off a Thursday game", test: (g) => g.homePrev?.weekday === "Thursday" },
  { key: "div", label: "Divisional", test: (g) => g.div === true },
  { key: "nondiv", label: "Non-divisional", test: (g) => g.div === false },
  { key: "primetime", label: "Primetime", test: (g) => g.primetime === true },
  { key: "afternoon", label: "Afternoon", test: (g) => g.primetime === false },
  { key: "home-fav-7", label: "Home favorite by 7+", test: (g) => g.spread != null && g.spread >= 7 },
  { key: "home-dog", label: "Home underdog", test: (g) => g.spread != null && g.spread < 0 },
  { key: "dome", label: "Dome", test: (g) => g.indoor === true },
  { key: "outdoor", label: "Outdoor", test: (g) => g.indoor === false },
  { key: "outdoor-late", label: "Outdoor, Dec and Jan", test: (g) => g.indoor === false && (g.month === 12 || g.month === 1) },
  { key: "weeks-1-4", label: "Weeks 1 to 4", test: (g) => g.week >= 1 && g.week <= 4 },
  { key: "weeks-5-18", label: "Weeks 5 to 18", test: (g) => g.week >= 5 && g.week <= LAST_REGULAR_WEEK },
  { key: "off-blowout", label: "Either team off a 17+ loss", test: (g) => prevLossBy17(g.homePrev) || prevLossBy17(g.awayPrev) },
];

/**
 * How far the more extreme of the two rates sits from a coin flip, and which
 * one it was. One number for "is anything happening in this bucket at all",
 * which is the only question a situation split is really being asked.
 */
function offFifty(cover, over) {
  const candidates = [
    { from: "ats", d: cover.value == null ? null : Math.abs(cover.value - 50) },
    { from: "o/u", d: over.value == null ? null : Math.abs(over.value - 50) },
  ].filter((c) => c.d != null);
  if (candidates.length === 0) return { value: null, from: null };
  const best = candidates.reduce((a, b) => (b.d > a.d ? b : a));
  return { value: best.d, from: best.from };
}

export function situation(games, test) {
  const hit = games.filter(test);
  const cover = rate(hit, (g) => g.homeCovered);
  const over = rate(hit, (g) => g.wentOver);
  return { games: hit.length, cover, over, off: offFifty(cover, over) };
}

// --- slip 4: by week --------------------------------------------------------

export function byWeek(games) {
  const weeks = [];
  for (let w = 1; w <= LAST_REGULAR_WEEK; w += 1) {
    const hit = games.filter((g) => g.week === w);
    weeks.push({
      week: w,
      avgTotal: mean(hit, (g) => g.points),
      over: rate(hit, (g) => g.wentOver),
    });
  }
  return weeks;
}

// --- assembly ---------------------------------------------------------------

/**
 * One column per selected season plus All, each carrying every slip. The page
 * renders rows across columns; this builds columns of rows, because the split
 * by season is the expensive part and the metrics are cheap.
 */
export function buildLeague(rows, selected) {
  const games = prepare(rows);
  const available = [...new Set(games.map((g) => g.season))].sort((a, b) => b - a);
  const seasons = selected.filter((s) => available.includes(s)).sort((a, b) => b - a);

  const columns = [
    ...seasons.map((s) => ({ key: String(s), label: String(s), season: s, games: games.filter((g) => g.season === s) })),
    { key: "all", label: "All", season: null, games },
  ].map((c) => ({
    key: c.key,
    label: c.label,
    season: c.season,
    count: c.games.length,
    scoring: scoring(c.games),
    market: market(c.games),
    situations: Object.fromEntries(SITUATIONS.map((s) => [s.key, situation(c.games, s.test)])),
    weeks: byWeek(c.games),
  }));

  return {
    available,
    seasons,
    columns,
    span: available.length
      ? { first: available[available.length - 1], last: available[0] }
      : { first: null, last: null },
    total: games.length,
  };
}

export const EMPTY_CELL = empty;
