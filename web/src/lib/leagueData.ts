import "server-only";
import { selectAll } from "./supabase";
import { currentSeason } from "./board";
// The arithmetic lives in a plain module with no IO, so it can be tested
// without a database standing behind it.
import { buildLeague, SITUATIONS, LAST_REGULAR_WEEK } from "./league.mjs";

export { LAST_REGULAR_WEEK };

export type GameRow = {
  game_id: string; season: number; week: number;
  weekday: string | null; kickoff: string | null;
  home_team: string | null; away_team: string | null;
  home_score: number | null; away_score: number | null;
  spread_line: string | number | null; total_line: string | number | null;
  home_rest: number | null; away_rest: number | null;
  div_game: boolean | null; roof: string | null; surface: string | null;
  overtime: boolean | null;
  total_points: number | null; home_margin: number | null;
  home_covered: boolean | null; went_over: boolean | null;
  total_diff: string | number | null;
};

export type Cell = {
  /** The number itself, already in display units: points, or percent. */
  value: number | null;
  /** How many games it came off. Rendered under every cell, always. */
  games: number;
  /** Set when the cell is not a single number, e.g. a score line. */
  text?: string;
  /** Small second line under the value, e.g. which teams the extreme was. */
  note?: string;
};

export type Fmt = "num" | "pct" | "signed" | "text";

export type MetricRow = {
  key: string;
  label: string;
  fmt: Fmt;
  digits?: number;
  cells: Record<string, Cell>;
};

export type Column = { key: string; label: string; season: number | null; count: number };

/** One { value, games } pair, which is the only shape league.mjs ever returns. */
type Agg = { value: number | null; games: number };

type Extreme = { points: number; label: string; season: number; week: number } | null;

type ScoringAgg = {
  avgTotal: Agg; avgHome: Agg; avgAway: Agg; avgMargin: Agg;
  under40: Agg; mid: Agg; over48: Agg; overtime: Agg;
  highest: Extreme; lowest: Extreme;
};

type MarketAgg = {
  homeCover: Agg; favCover: Agg; over: Agg;
  spreadPush: Agg; totalPush: Agg;
  avgSpread: Agg; avgTotalLine: Agg;
  within3: Agg; within7: Agg; by3: Agg; by7: Agg;
  pricedHome: Agg; playedHome: Agg;
};

/** The shape league.mjs builds, named here so nothing downstream is untyped. */
type BuiltColumn = {
  key: string; label: string; season: number | null; count: number;
  scoring: ScoringAgg;
  market: MarketAgg;
  situations: Record<string, SituationCell>;
  weeks: { week: number; avgTotal: Agg; over: Agg }[];
};

type Built = {
  available: number[];
  seasons: number[];
  columns: BuiltColumn[];
  span: { first: number | null; last: number | null };
  total: number;
};

export type SituationCell = {
  games: number;
  cover: { value: number | null; games: number };
  over: { value: number | null; games: number };
  off: { value: number | null; from: string | null };
};

export type SituationRow = {
  key: string;
  label: string;
  cells: Record<string, SituationCell>;
};

export type WeekPoint = { week: number; total: number | null; over: number | null; games: number };
export type WeekSeries = { key: string; label: string; season: number | null; points: WeekPoint[] };

export type League = {
  available: number[];
  selected: number[];
  columns: Column[];
  scoring: MetricRow[];
  market: MetricRow[];
  situations: SituationRow[];
  weeks: WeekSeries[];
  span: { first: number | null; last: number | null };
  total: number;
  season: number;
};

/** Turn "col -> metric object" into one row per metric, which is how it renders. */
function rowsFrom<K extends "scoring" | "market">(
  columns: BuiltColumn[],
  slip: K,
  specs: {
    key: string; label: string; fmt: Fmt; digits?: number;
    pick: (s: BuiltColumn[K], c: BuiltColumn) => Cell;
  }[],
): MetricRow[] {
  return specs.map((spec) => ({
    key: spec.key,
    label: spec.label,
    fmt: spec.fmt,
    digits: spec.digits,
    cells: Object.fromEntries(columns.map((c) => [c.key, spec.pick(c[slip], c)])),
  }));
}

/**
 * The one game behind a highest or lowest total. Abbreviations rather than
 * nicknames, because this sits in a column the width of a number, and the
 * season is only worth repeating in the All column where it is not implied.
 */
function extremeNote(e: Extreme, column: BuiltColumn): string | undefined {
  if (!e) return undefined;
  const when = column.season == null ? `${e.season} wk ${e.week}` : `wk ${e.week}`;
  return `${e.label} · ${when}`;
}

const pct = (r: Agg): Cell => ({ value: r.value, games: r.games });

/** Both halves of the priced-vs-played row are home margins, so both take a sign. */
const signed = (v: number) =>
  `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;

/** Named rather than "*": the whole table is read on every request. */
const GAME_COLUMNS = [
  "game_id", "season", "week", "weekday", "kickoff",
  "home_team", "away_team", "home_score", "away_score",
  "spread_line", "total_line", "home_rest", "away_rest",
  "div_game", "roof", "surface", "overtime",
  "total_points", "home_margin", "home_covered", "went_over", "total_diff",
].join(",");

export async function getLeague(selected?: number[]): Promise<League> {
  // `undefined` means nobody asked, so use the default view. An empty array is
  // a real choice -- every season switched off -- and leaves only the All column.
  const rows = await selectAll<GameRow>("chalk_games", GAME_COLUMNS);
  const season = currentSeason();

  // Default view: this season, last season, and the whole span behind them.
  const fallback = [season, season - 1];
  const built = buildLeague(rows, selected ?? fallback) as Built;

  const columns: Column[] = built.columns.map((c) => ({
    key: c.key, label: c.label, season: c.season, count: c.count,
  }));

  const scoring = rowsFrom(built.columns, "scoring", [
    { key: "avg-total", label: "Average total", fmt: "num", digits: 1, pick: (s) => pct(s.avgTotal) },
    { key: "avg-home", label: "Average home points", fmt: "num", digits: 1, pick: (s) => pct(s.avgHome) },
    { key: "avg-away", label: "Average away points", fmt: "num", digits: 1, pick: (s) => pct(s.avgAway) },
    { key: "avg-margin", label: "Average margin", fmt: "num", digits: 1, pick: (s) => pct(s.avgMargin) },
    { key: "under-40", label: "Under 40 points", fmt: "pct", digits: 1, pick: (s) => pct(s.under40) },
    { key: "mid", label: "40 to 47 points", fmt: "pct", digits: 1, pick: (s) => pct(s.mid) },
    { key: "over-48", label: "48 or more points", fmt: "pct", digits: 1, pick: (s) => pct(s.over48) },
    { key: "ot", label: "Went to overtime", fmt: "pct", digits: 1, pick: (s) => pct(s.overtime) },
    {
      key: "highest", label: "Highest total", fmt: "text",
      pick: (s, c) => ({
        value: s.highest?.points ?? null,
        games: s.highest ? 1 : 0,
        text: s.highest ? String(s.highest.points) : undefined,
        note: extremeNote(s.highest, c),
      }),
    },
    {
      key: "lowest", label: "Lowest total", fmt: "text",
      pick: (s, c) => ({
        value: s.lowest?.points ?? null,
        games: s.lowest ? 1 : 0,
        text: s.lowest ? String(s.lowest.points) : undefined,
        note: extremeNote(s.lowest, c),
      }),
    },
  ]);

  const market = rowsFrom(built.columns, "market", [
    { key: "home-cover", label: "Home cover rate", fmt: "pct", digits: 1, pick: (m) => pct(m.homeCover) },
    { key: "fav-cover", label: "Favorite cover rate", fmt: "pct", digits: 1, pick: (m) => pct(m.favCover) },
    { key: "over", label: "Over rate", fmt: "pct", digits: 1, pick: (m) => pct(m.over) },
    { key: "spread-push", label: "Spread push rate", fmt: "pct", digits: 1, pick: (m) => pct(m.spreadPush) },
    { key: "total-push", label: "Total push rate", fmt: "pct", digits: 1, pick: (m) => pct(m.totalPush) },
    { key: "avg-spread", label: "Average closing spread", fmt: "signed", digits: 2, pick: (m) => pct(m.avgSpread) },
    { key: "avg-total-line", label: "Average closing total", fmt: "num", digits: 2, pick: (m) => pct(m.avgTotalLine) },
    { key: "within-3", label: "Total within 3 of close", fmt: "pct", digits: 1, pick: (m) => pct(m.within3) },
    { key: "within-7", label: "Total within 7 of close", fmt: "pct", digits: 1, pick: (m) => pct(m.within7) },
    { key: "by-3", label: "Decided by exactly 3", fmt: "pct", digits: 1, pick: (m) => pct(m.by3) },
    { key: "by-7", label: "Decided by exactly 7", fmt: "pct", digits: 1, pick: (m) => pct(m.by7) },
    {
      key: "home-field", label: "Home field, priced vs played", fmt: "text",
      pick: (m) => ({
        value: m.playedHome.value,
        games: m.playedHome.games,
        text:
          m.pricedHome.value == null || m.playedHome.value == null
            ? undefined
            : `${signed(m.pricedHome.value)} → ${signed(m.playedHome.value)}`,
      }),
    },
  ]);

  const list = SITUATIONS as { key: string; label: string }[];
  const situations: SituationRow[] = list.map((s) => ({
    key: s.key,
    label: s.label,
    cells: Object.fromEntries(built.columns.map((c) => [c.key, c.situations[s.key]])),
  }));

  const weeks: WeekSeries[] = built.columns.map((c) => ({
    key: c.key,
    label: c.label,
    season: c.season,
    points: c.weeks.map((w) => ({
      week: w.week,
      total: w.avgTotal.value,
      over: w.over.value,
      games: w.avgTotal.games,
    })),
  }));

  return {
    available: built.available,
    selected: built.seasons,
    columns, scoring, market, situations, weeks,
    span: built.span,
    total: built.total,
    season,
  };
}

/** `?seasons=2026,2024` to a clean list, or undefined for the default view. */
export function parseSeasons(raw: string | undefined): number[] | undefined {
  if (raw == null) return undefined;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map(Number)
    .filter((s) => Number.isInteger(s));
  // An explicit empty value is a real choice -- it means "All only" -- so it is
  // kept as an empty list rather than falling back to the default.
  return [...new Set(list)].sort((a, b) => b - a);
}
