import "server-only";
import { selectAll } from "./supabase";
import { currentSeason } from "./board";
import { getTdBoard } from "./tdData";
import { toAbbr } from "./teams";
import weights from "@/data/weights.json";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export type Snapshot = {
  captured_at: string; game_id: string; commence_time: string;
  home_team: string; away_team: string; bookmaker: string;
  spread_home: string | number | null; total: string | number | null;
  home_ml: number | null; away_ml: number | null;
};

export type Rating = {
  team: string; week: number;
  team_rating: string | number | null;
  off_scoring_rating: string | number | null;
  def_scoring_rating: string | number | null;
  league_avg_total: string | number | null;
};

export type InjuryRow = {
  captured_at: string; team: string; player_name: string;
  position: string | null; status: string | null; detail: string | null;
};

export type NewsRow = {
  captured_at: string; game_id: string; headline: string | null;
  preview: string | null; raw: NewsRaw | null;
};

type NewsItem = {
  id?: string | null; type?: string | null; headline?: string | null;
  description?: string | null; published?: string | null; link?: string | null;
  teams?: string[];
};

type NewsRaw = {
  event?: { venue?: string | null; weather?: { temperature?: number; conditionId?: string } | null };
  article?: (NewsItem & { story?: string | null }) | null;
  news?: NewsItem[];
};

export type BetRow = {
  id: number; market: string; side: string; line: string | number | null;
  price: number | null; stake: string | number | null; book: string | null;
  chalk_line: string | number | null; closing_line: string | number | null;
  clv_points: string | number | null; result: string | null;
  profit: string | number | null; placed_at: string;
};

export type Quote = {
  book: string;
  spreadHome: number | null;
  total: number | null;
  homeMl: number | null;
  awayMl: number | null;
};

export type Side = { abbr: string | null; name: string; rating: number | null; rank: number | null };

/** One capture: every book was read at the same instant, so this is a column. */
export type Capture = {
  capturedAt: string;
  /** How many books were quoting this game at that instant. */
  books: number;
  dkSpread: number | null;
  dkTotal: number | null;
  /**
   * Books present in this capture and the one before it that changed their
   * spread or total in between. Null for the first capture, which has nothing
   * to be compared against.
   */
  moved: number | null;
  /**
   * How many books could have moved: those quoting the game in both captures.
   * The denominator is this and not `books`, because a book that has just
   * appeared had no earlier number to change.
   */
  comparable: number | null;
  /** Books quoting the game here that were not in the previous capture. */
  arrived: number | null;
};

/**
 * Every figure on a game page, gathered in one pass. The page is a read of a
 * single game across six tables, so the joining happens here and the components
 * are handed something already shaped.
 */
export type Game = {
  gameId: string;
  commenceTime: string;
  home: Side;
  away: Side;
  ratingWeek: number | null;
  season: number;
  /** Market spread and total from the latest capture at the reference book. */
  market: { book: string | null; spreadHome: number | null; total: number | null };
  chalk: { spreadHome: number | null; total: number | null };
  /** One point per capture per book, for the line history chart. */
  history: { capturedAt: string; book: string; spreadHome: number | null; total: number | null }[];
  /** The same rows folded into one row per capture, for the slip under it. */
  captures: Capture[];
  books: string[];
  /** The latest capture, one row per book. */
  latest: { capturedAt: string | null; quotes: Quote[] };
  best: {
    spreadHome: number | null; spreadAway: number | null;
    over: number | null; under: number | null;
    homeMl: number | null; awayMl: number | null;
  };
  injuries: { capturedAt: string | null; home: InjuryRow[]; away: InjuryRow[] };
  news: { capturedAt: string | null; headline: string | null; preview: string | null; items: NewsItem[]; venue: string | null };
  td: { week: number | null; sides: unknown[] | null; hasProps: boolean };
  result: {
    homeScore: number; awayScore: number;
    homeCovered: boolean | null; wentOver: boolean | null;
    closingSpreadHome: number | null; closingTotal: number | null;
  } | null;
  bets: BetRow[];
};

// The same order snapshot_context.js writes and sorts by: the game-day
// designations in descending severity, then the settled absences.
export const STATUS_ORDER = ["out", "doubtful", "questionable", "probable", "injured reserve", "suspension"];

export const statusRank = (status: string | null): number => {
  const i = STATUS_ORDER.indexOf((status ?? "").toLowerCase());
  return i === -1 ? STATUS_ORDER.length : i;
};

/** Quarterbacks first, then severity, then alphabetical, so a report is stable. */
export function sortInjuries(rows: InjuryRow[]): InjuryRow[] {
  return [...rows].sort((a, b) => {
    const q = (a.position === "QB" ? 0 : 1) - (b.position === "QB" ? 0 : 1);
    if (q !== 0) return q;
    const s = statusRank(a.status) - statusRank(b.status);
    if (s !== 0) return s;
    return a.player_name.localeCompare(b.player_name);
  });
}

/**
 * The best number on offer, or null when no book has one.
 *
 * The reducer is wrapped rather than passed straight through: reduce hands its
 * callback (acc, value, index, array), and Math.max of an array is NaN, so
 * `reduce(Math.max)` silently returns NaN and nothing is ever marked best.
 */
const bestOf = (values: (number | null)[], pick: (a: number, b: number) => number) => {
  const real = values.filter((v): v is number => v != null);
  return real.length ? real.reduce((a, b) => pick(a, b)) : null;
};

export async function getGame(gameId: string): Promise<Game | null> {
  const snapshots = await selectAll<Snapshot>("chalk_odds_snapshots", "*", (q) =>
    q.eq("game_id", gameId),
  );
  if (snapshots.length === 0) return null;

  snapshots.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const meta = snapshots[0];
  const homeAbbr = toAbbr(meta.home_team);
  const awayAbbr = toAbbr(meta.away_team);
  const season = currentSeason(new Date(meta.commence_time));

  const [ratings, injuryRows, newsRows, results, bets] = await Promise.all([
    selectAll<Rating>("chalk_ratings", "*", (q) => q.eq("season", season)),
    selectAll<InjuryRow>("chalk_injuries", "*", (q) =>
      q.in("team", [meta.home_team, meta.away_team]),
    ),
    selectAll<NewsRow>("chalk_game_news", "*", (q) => q.eq("game_id", gameId)),
    selectAll<{
      home_score: number | null; away_score: number | null;
      home_covered: boolean | null; went_over: boolean | null;
      closing_spread_home: string | number | null; closing_total: string | number | null;
    }>("chalk_results", "*", (q) => q.eq("game_id", gameId)),
    selectAll<BetRow>("chalk_bets", "*", (q) => q.eq("game_id", gameId)),
  ]);

  // --- ratings, and the numbers Chalk builds out of them ---------------------
  const ratingWeek = ratings.length ? Math.max(...ratings.map((r) => Number(r.week))) : null;
  const current = ratings.filter((r) => Number(r.week) === ratingWeek);
  const ranked = [...current].sort((a, b) => (num(b.team_rating) ?? 0) - (num(a.team_rating) ?? 0));
  const rankOf = new Map(ranked.map((r, i) => [r.team, i + 1]));
  const ratingOf = new Map(current.map((r) => [r.team, r]));
  const leagueAvgTotal = current.length ? num(current[0].league_avg_total) : null;

  const homeRating = homeAbbr ? ratingOf.get(homeAbbr) : undefined;
  const awayRating = awayAbbr ? ratingOf.get(awayAbbr) : undefined;
  const hr = num(homeRating?.team_rating);
  const ar = num(awayRating?.team_rating);

  // Both are typed numbers in weights.json, so no cast is needed here.
  const homeField = weights.home_field;
  const totalScale = weights.total_scale;
  const chalkSpreadHome = hr != null && ar != null ? -(hr - ar + homeField) : null;

  let chalkTotal: number | null = null;
  if (homeRating && awayRating && leagueAvgTotal != null) {
    const ho = num(homeRating.off_scoring_rating);
    const hd = num(homeRating.def_scoring_rating);
    const ao = num(awayRating.off_scoring_rating);
    const ad = num(awayRating.def_scoring_rating);
    if (ho != null && hd != null && ao != null && ad != null) {
      chalkTotal = leagueAvgTotal + totalScale * (ho + ao - hd - ad);
    }
  }

  // --- line history and the latest capture ----------------------------------
  const history = snapshots.map((s) => ({
    capturedAt: s.captured_at,
    book: s.bookmaker,
    spreadHome: num(s.spread_home),
    total: num(s.total),
  }));
  const books = [...new Set(history.map((h) => h.book))].sort();

  // Every book in one run is inserted by a single statement, so a capture is an
  // exact timestamp rather than a window, and grouping on it is safe.
  const byCapture = new Map<string, Map<string, { spread: number | null; total: number | null }>>();
  for (const h of history) {
    if (!byCapture.has(h.capturedAt)) byCapture.set(h.capturedAt, new Map());
    byCapture.get(h.capturedAt)!.set(h.book, { spread: h.spreadHome, total: h.total });
  }

  const captures: Capture[] = [];
  let previous: Map<string, { spread: number | null; total: number | null }> | null = null;
  for (const at of [...byCapture.keys()].sort()) {
    const quotes = byCapture.get(at)!;
    let moved: number | null = null;
    let comparable: number | null = null;
    let arrived: number | null = null;
    if (previous) {
      moved = 0;
      comparable = 0;
      arrived = 0;
      for (const [book, now] of quotes) {
        const before = previous.get(book);
        if (!before) {
          arrived += 1;
          continue;
        }
        comparable += 1;
        if (before.spread !== now.spread || before.total !== now.total) moved += 1;
      }
    }
    const dk = quotes.get("draftkings");
    captures.push({
      capturedAt: at,
      books: quotes.size,
      dkSpread: dk?.spread ?? null,
      dkTotal: dk?.total ?? null,
      moved,
      comparable,
      arrived,
    });
    previous = quotes;
  }

  // The newest capture is the newest timestamp any book was seen at; a book
  // missing from that instant simply has no row in the best-price table.
  const latestAt = snapshots[snapshots.length - 1]?.captured_at ?? null;
  const latestRows = snapshots.filter((s) => s.captured_at === latestAt);
  const quotes: Quote[] = latestRows
    .map((s) => ({
      book: s.bookmaker,
      spreadHome: num(s.spread_home),
      total: num(s.total),
      homeMl: s.home_ml ?? null,
      awayMl: s.away_ml ?? null,
    }))
    .sort((a, b) => a.book.localeCompare(b.book));

  const best = {
    // The home backer wants the biggest number, the away backer the smallest.
    spreadHome: bestOf(quotes.map((q) => q.spreadHome), Math.max),
    spreadAway: bestOf(quotes.map((q) => q.spreadHome), Math.min),
    // The Over wants the lowest total to clear, the Under the highest.
    over: bestOf(quotes.map((q) => q.total), Math.min),
    under: bestOf(quotes.map((q) => q.total), Math.max),
    // American odds: a higher number always pays more, on either side of zero.
    homeMl: bestOf(quotes.map((q) => q.homeMl), Math.max),
    awayMl: bestOf(quotes.map((q) => q.awayMl), Math.max),
  };

  const preferred = quotes.find((q) => q.book === "draftkings") ?? quotes[0] ?? null;

  // --- injuries, from the newest capture only -------------------------------
  const injCapture = injuryRows.length
    ? injuryRows.map((r) => r.captured_at).sort().at(-1)!
    : null;
  const latestInjuries = injuryRows.filter((r) => r.captured_at === injCapture);

  // --- news, from the newest capture only -----------------------------------
  newsRows.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
  const news = newsRows.at(-1) ?? null;

  // --- the TD board, for this game only -------------------------------------
  let td: Game["td"] = { week: null, sides: null, hasProps: false };
  try {
    const board = await getTdBoard();
    const match = (board.games as { away: string; home: string; sides: unknown[]; hasProps: boolean }[])
      .find((g) => g.home === homeAbbr && g.away === awayAbbr);
    if (match) td = { week: board.week, sides: match.sides, hasProps: match.hasProps };
  } catch {
    // The TD board reaches out to nflverse for a roster file. A game page
    // should still render when that is unavailable.
  }

  const raw = results[0];
  const result =
    raw && raw.home_score != null && raw.away_score != null
      ? {
          homeScore: Number(raw.home_score),
          awayScore: Number(raw.away_score),
          homeCovered: raw.home_covered,
          wentOver: raw.went_over,
          closingSpreadHome: num(raw.closing_spread_home),
          closingTotal: num(raw.closing_total),
        }
      : null;

  return {
    gameId,
    commenceTime: meta.commence_time,
    home: {
      abbr: homeAbbr, name: meta.home_team, rating: hr,
      rank: homeAbbr ? (rankOf.get(homeAbbr) ?? null) : null,
    },
    away: {
      abbr: awayAbbr, name: meta.away_team, rating: ar,
      rank: awayAbbr ? (rankOf.get(awayAbbr) ?? null) : null,
    },
    ratingWeek,
    season,
    market: {
      book: preferred?.book ?? null,
      spreadHome: preferred?.spreadHome ?? null,
      total: preferred?.total ?? null,
    },
    chalk: { spreadHome: chalkSpreadHome, total: chalkTotal },
    history,
    captures,
    books,
    latest: { capturedAt: latestAt, quotes },
    best,
    injuries: {
      capturedAt: injCapture,
      home: sortInjuries(latestInjuries.filter((r) => r.team === meta.home_team)),
      away: sortInjuries(latestInjuries.filter((r) => r.team === meta.away_team)),
    },
    news: {
      capturedAt: news?.captured_at ?? null,
      headline: news?.headline ?? null,
      preview: news?.preview ?? null,
      items: news?.raw?.news ?? [],
      venue: news?.raw?.event?.venue ?? null,
    },
    td,
    result,
    bets: bets.sort((a, b) => a.placed_at.localeCompare(b.placed_at)),
  };
}
