import "server-only";
import { selectAll } from "./supabase";
import { toAbbr } from "./teams";
import weights from "@/data/weights.json";

export type Snapshot = {
  id: number;
  captured_at: string;
  game_id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmaker: string;
  spread_home: string | number | null;
  total: string | number | null;
  home_ml: number | null;
  away_ml: number | null;
};

export type Rating = {
  team: string;
  week: number;
  team_rating: string | number | null;
  offense_rating: string | number | null;
  defense_rating: string | number | null;
  st_rating: string | number | null;
  off_scoring_rating: string | number | null;
  def_scoring_rating: string | number | null;
  league_avg_total: string | number | null;
  games_used: number | null;
};

export type Result = {
  game_id: string;
  home_score: number | null;
  away_score: number | null;
  closing_spread_home: string | number | null;
  closing_total: string | number | null;
  closing_book: string | null;
  home_covered: boolean | null;
  went_over: boolean | null;
};

export type TeamLine = {
  abbr: string | null;
  name: string;
  rating: number | null;
  rank: number | null;
};

export type BoardGame = {
  gameId: string;
  commenceTime: string;
  home: TeamLine;
  away: TeamLine;
  book: string | null;
  spreadHome: number | null;
  total: number | null;
  spreadMove: number | null;
  totalMove: number | null;
  impliedSpreadHome: number | null;
  impliedTotal: number | null;
  result: {
    homeScore: number;
    awayScore: number;
    homeCovered: boolean | null;
    wentOver: boolean | null;
    closingSpreadHome: number | null;
    closingTotal: number | null;
  } | null;
};

export type Board = {
  games: BoardGame[];
  ratingWeek: number | null;
  season: number;
  windowStart: string;
  windowEnd: string;
  homeField: number;
  totalScale: number;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** NFL seasons run into the new year; January and February belong to the prior one. */
export function currentSeason(now = new Date()): number {
  return now.getUTCMonth() >= 2 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

/**
 * The board week runs Tuesday noon UTC to Tuesday noon UTC, which puts a
 * Thursday night game and the following Monday night game on the same board
 * and rolls over once the week is genuinely finished.
 */
export function weekWindow(now = new Date()): { start: Date; end: Date } {
  const daysSinceTuesday = (now.getUTCDay() - 2 + 7) % 7;
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - daysSinceTuesday, 12, 0, 0),
  );
  return { start, end: new Date(start.getTime() + 7 * 24 * 3600 * 1000) };
}

const PREFERRED_BOOK = "draftkings";

export async function getBoard(now = new Date()): Promise<Board> {
  const { start, end } = weekWindow(now);
  const season = currentSeason(now);

  const [snapshots, ratings] = await Promise.all([
    selectAll<Snapshot>("chalk_odds_snapshots", "*", (q) =>
      q.gte("commence_time", start.toISOString()).lt("commence_time", end.toISOString()),
    ),
    selectAll<Rating>("chalk_ratings", "*", (q) => q.eq("season", season)),
  ]);

  // Ratings are stored per "as of" week; the newest one is what stands now.
  const ratingWeek = ratings.length ? Math.max(...ratings.map((r) => Number(r.week))) : null;
  const current = ratings.filter((r) => Number(r.week) === ratingWeek);
  const ranked = [...current].sort((a, b) => (num(b.team_rating) ?? 0) - (num(a.team_rating) ?? 0));
  const rankOf = new Map(ranked.map((r, i) => [r.team, i + 1]));
  const ratingOf = new Map(current.map((r) => [r.team, r]));
  const leagueAvgTotal = current.length ? num(current[0].league_avg_total) : null;

  const byGame = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    if (!byGame.has(s.game_id)) byGame.set(s.game_id, []);
    byGame.get(s.game_id)!.push(s);
  }

  const gameIds = [...byGame.keys()];
  const results = gameIds.length
    ? await selectAll<Result>("chalk_results", "*", (q) => q.in("game_id", gameIds))
    : [];
  const resultOf = new Map(results.map((r) => [r.game_id, r]));

  const homeField = Number((weights as any).home_field ?? 0);
  const totalScale = Number((weights as any).total_scale ?? 1);

  const games: BoardGame[] = [];

  for (const [gameId, rows] of byGame) {
    rows.sort((a, b) => a.captured_at.localeCompare(b.captured_at));
    const meta = rows[0];

    // The line is DraftKings where it exists, so the move is like-for-like.
    let book = PREFERRED_BOOK;
    let quotes = rows.filter((r) => r.bookmaker === PREFERRED_BOOK);
    if (quotes.length === 0) {
      book = rows[rows.length - 1]?.bookmaker ?? "";
      quotes = rows.filter((r) => r.bookmaker === book);
    }
    const opening = quotes[0] ?? null;
    const latest = quotes[quotes.length - 1] ?? null;

    const spreadHome = num(latest?.spread_home);
    const total = num(latest?.total);
    const openSpread = num(opening?.spread_home);
    const openTotal = num(opening?.total);

    const homeAbbr = toAbbr(meta.home_team);
    const awayAbbr = toAbbr(meta.away_team);
    const homeRating = homeAbbr ? ratingOf.get(homeAbbr) : undefined;
    const awayRating = awayAbbr ? ratingOf.get(awayAbbr) : undefined;

    const hr = num(homeRating?.team_rating);
    const ar = num(awayRating?.team_rating);
    const impliedSpreadHome = hr != null && ar != null ? -(hr - ar + homeField) : null;

    let impliedTotal: number | null = null;
    if (homeRating && awayRating && leagueAvgTotal != null) {
      const ho = num(homeRating.off_scoring_rating);
      const hd = num(homeRating.def_scoring_rating);
      const ao = num(awayRating.off_scoring_rating);
      const ad = num(awayRating.def_scoring_rating);
      if (ho != null && hd != null && ao != null && ad != null) {
        impliedTotal = leagueAvgTotal + totalScale * (ho + ao - hd - ad);
      }
    }

    const raw = resultOf.get(gameId);
    const graded =
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

    games.push({
      gameId,
      commenceTime: meta.commence_time,
      home: {
        abbr: homeAbbr,
        name: meta.home_team,
        rating: hr,
        rank: homeAbbr ? (rankOf.get(homeAbbr) ?? null) : null,
      },
      away: {
        abbr: awayAbbr,
        name: meta.away_team,
        rating: ar,
        rank: awayAbbr ? (rankOf.get(awayAbbr) ?? null) : null,
      },
      book,
      spreadHome,
      total,
      // A spread that moves toward the home team reads as a negative move.
      spreadMove: spreadHome != null && openSpread != null ? spreadHome - openSpread : null,
      totalMove: total != null && openTotal != null ? total - openTotal : null,
      impliedSpreadHome,
      impliedTotal,
      result: graded,
    });
  }

  games.sort((a, b) => a.commenceTime.localeCompare(b.commenceTime));

  return {
    games,
    ratingWeek,
    season,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    homeField,
    totalScale,
  };
}
