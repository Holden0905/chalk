import "server-only";
import { selectAll } from "./supabase";
import { currentSeason } from "./board";
import { toAbbr } from "./teams";
import {
  aggregateSide, n, rankAcross, recordFrom,
  type DefenseWeek, type Ranked, type SideAgg, type TeamWeek, type Record as WLRecord,
} from "./aggregate";

/**
 * Regular season only. chalk_team_weeks carries weeks 1 to 22, so an unfiltered
 * count gives a playoff team 20 games and a 14-6 record against 17 games
 * played. Everything counted or averaged on Teams, Stats and a team page stops
 * at week 18.
 */
export const LAST_REGULAR_WEEK = 18;

export type RatingRow = {
  season: number; week: number; team: string;
  team_rating: string | number | null; offense_rating: string | number | null;
  defense_rating: string | number | null; st_rating: string | number | null;
  games_used: number | null;
};

export type ResultRow = {
  game_id: string; commence_time: string; home_team: string; away_team: string;
  home_score: number | null; away_score: number | null;
  closing_spread_home: string | number | null; closing_total: string | number | null;
  home_covered: boolean | null; went_over: boolean | null;
};

export type TeamRow = {
  abbr: string; name: string; rank: number;
  teamRating: number | null; offense: number | null; defense: number | null; st: number | null;
  games: number; record: string; ats: string; ou: string;
};

export type TeamsIndex = {
  season: number; ratingWeek: number | null; teams: TeamRow[];
  gradedGames: number;
};

async function loadRatings(season: number) {
  const rows = await selectAll<RatingRow>("chalk_ratings", "*", (q) => q.eq("season", season));
  const week = rows.length ? Math.max(...rows.map((r) => Number(r.week))) : null;
  return { rows, week, current: rows.filter((r) => Number(r.week) === week) };
}

/** Per-team ATS and over/under tallies, from whatever chalk_results holds. */
function marketRecords(results: ResultRow[]) {
  const ats = new Map<string, WLRecord>();
  const ou = new Map<string, WLRecord>();
  const bump = (m: Map<string, WLRecord>, team: string, key: keyof WLRecord) => {
    const r = m.get(team) ?? { wins: 0, losses: 0, ties: 0 };
    r[key] += 1;
    m.set(team, r);
  };
  for (const r of results) {
    const home = toAbbr(r.home_team);
    const away = toAbbr(r.away_team);
    if (!home || !away) continue;
    if (r.home_covered == null) {
      bump(ats, home, "ties");
      bump(ats, away, "ties");
    } else {
      bump(ats, r.home_covered ? home : away, "wins");
      bump(ats, r.home_covered ? away : home, "losses");
    }
    if (r.went_over == null) {
      bump(ou, home, "ties");
      bump(ou, away, "ties");
    } else {
      for (const t of [home, away]) bump(ou, t, r.went_over ? "wins" : "losses");
    }
  }
  return { ats, ou };
}

const show = (r: WLRecord | undefined): string =>
  !r || r.wins + r.losses + r.ties === 0 ? "–" : `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`;

/** Seasons the toggles offer: the current one and the one before it. */
export function seasonChoices(): number[] {
  const now = currentSeason();
  return [now, now - 1];
}

export async function getTeamsIndex(seasonArg?: number): Promise<TeamsIndex> {
  const season = seasonArg ?? currentSeason();
  const [{ current, week }, teamWeeks, results] = await Promise.all([
    loadRatings(season),
    selectAll<TeamWeek>("chalk_team_weeks", "*", (q) =>
      q.eq("season", season).lte("week", LAST_REGULAR_WEEK),
    ),
    selectAll<ResultRow>("chalk_results", "*", (q) =>
      q.gte("commence_time", `${season}-03-01`).lt("commence_time", `${season + 1}-03-01`),
    ),
  ]);

  const weeksByTeam = new Map<string, TeamWeek[]>();
  for (const r of teamWeeks) {
    if (!weeksByTeam.has(r.team)) weeksByTeam.set(r.team, []);
    weeksByTeam.get(r.team)!.push(r);
  }
  const { ats, ou } = marketRecords(results);

  const teams = current
    .map((r) => {
      const rows = weeksByTeam.get(r.team) ?? [];
      return {
        abbr: r.team,
        name: r.team,
        rank: 0,
        teamRating: n(r.team_rating),
        offense: n(r.offense_rating),
        defense: n(r.defense_rating),
        st: n(r.st_rating),
        games: rows.length,
        record: rows.length ? (() => { const w = recordFrom(rows); return `${w.wins}-${w.losses}${w.ties ? `-${w.ties}` : ""}`; })() : "–",
        ats: show(ats.get(r.team)),
        ou: show(ou.get(r.team)),
      };
    })
    .sort((a, b) => (b.teamRating ?? -Infinity) - (a.teamRating ?? -Infinity))
    .map((t, i) => ({ ...t, rank: i + 1 }));

  return { season, ratingWeek: week, teams, gradedGames: results.length };
}

// ── one team ────────────────────────────────────────────────────────────────

export type TrendPoint = { week: number; rating: number };
export type GameLogRow = {
  week: number; opponent: string | null; isHome: boolean | null;
  pointsFor: number | null; pointsAgainst: number | null;
  closingSpread: number | null; ats: string | null;
  closingTotal: number | null; ou: string | null;
};

export type TeamDetail = {
  abbr: string; season: number; ratingWeek: number | null;
  rank: number | null; of: number;
  teamRating: number | null; offense: number | null; defense: number | null; st: number | null;
  gamesUsed: number | null;
  trend: TrendPoint[]; priorTrend: TrendPoint[]; priorSeason: number;
  log: GameLogRow[];
  offAgg: SideAgg; defAgg: SideAgg;
  ranks: Record<string, Ranked>;
  leagueGames: number;
};

const STAT_DIRECTION: [keyof SideAgg, "off" | "def", boolean][] = [
  ["successRate", "off", true], ["epaPerPlay", "off", true],
  ["passSuccessRate", "off", true], ["passEpaPerPlay", "off", true],
  ["rushSuccessRate", "off", true], ["rushEpaPerPlay", "off", true],
  ["pointsPerTrip", "off", true], ["turnoversPerGame", "off", false],
  ["successRate", "def", false], ["epaPerPlay", "def", false],
  ["passSuccessRate", "def", false], ["passEpaPerPlay", "def", false],
  ["rushSuccessRate", "def", false], ["rushEpaPerPlay", "def", false],
  ["pointsPerTrip", "def", false], ["turnoversPerGame", "def", true],
];

export async function getTeam(abbr: string): Promise<TeamDetail | null> {
  const season = currentSeason();
  const prior = season - 1;

  const [ratings, teamWeeks, results] = await Promise.all([
    selectAll<RatingRow>("chalk_ratings", "*", (q) => q.in("season", [prior, season])),
    selectAll<TeamWeek>("chalk_team_weeks", "*", (q) =>
      q.eq("season", season).lte("week", LAST_REGULAR_WEEK),
    ),
    selectAll<ResultRow>("chalk_results", "*", (q) =>
      q.gte("commence_time", `${season}-03-01`).lt("commence_time", `${season + 1}-03-01`),
    ),
  ]);

  const seasonRatings = ratings.filter((r) => Number(r.season) === season);
  const week = seasonRatings.length ? Math.max(...seasonRatings.map((r) => Number(r.week))) : null;
  const current = seasonRatings.filter((r) => Number(r.week) === week);
  if (!current.some((r) => r.team === abbr)) return null;

  const ranked = [...current].sort((a, b) => (n(b.team_rating) ?? 0) - (n(a.team_rating) ?? 0));
  const rank = ranked.findIndex((r) => r.team === abbr) + 1;
  const mine = current.find((r) => r.team === abbr)!;

  const trendOf = (yr: number): TrendPoint[] =>
    ratings
      .filter((r) => Number(r.season) === yr && r.team === abbr && n(r.team_rating) != null)
      .map((r) => ({ week: Number(r.week), rating: n(r.team_rating)! }))
      .sort((a, b) => a.week - b.week);

  // Aggregates and league ranks, across teams that have actually played.
  const byTeam = new Map<string, TeamWeek[]>();
  for (const r of teamWeeks) {
    if (!byTeam.has(r.team)) byTeam.set(r.team, []);
    byTeam.get(r.team)!.push(r);
  }
  const mineWeeks = (byTeam.get(abbr) ?? []).sort((a, b) => a.week - b.week);
  const offAgg = aggregateSide(mineWeeks, "off");
  const defAgg = aggregateSide(mineWeeks, "def");

  const aggCache = new Map<string, { off: SideAgg; def: SideAgg }>();
  for (const [team, rows] of byTeam) {
    aggCache.set(team, { off: aggregateSide(rows, "off"), def: aggregateSide(rows, "def") });
  }
  const ranks: Record<string, Ranked> = {};
  for (const [key, side, higher] of STAT_DIRECTION) {
    const values = new Map<string, number | null>();
    for (const [team, agg] of aggCache) values.set(team, agg[side][key] as number | null);
    ranks[`${side}.${key}`] = rankAcross(values, abbr, higher);
  }

  // Game log: scores come from the team weeks, which exist as soon as the play
  // by play lands. Closing numbers and the ATS or over/under call come from
  // chalk_results, which only fills in once a game has been graded.
  const resultByTeams = new Map<string, ResultRow>();
  for (const r of results) {
    const h = toAbbr(r.home_team);
    const a = toAbbr(r.away_team);
    if (h && a) resultByTeams.set([h, a].sort().join("|"), r);
  }

  const log: GameLogRow[] = mineWeeks.map((w) => {
    const key = w.opponent ? [abbr, w.opponent].sort().join("|") : "";
    const res = resultByTeams.get(key);
    const isHome = w.is_home === true;
    const spreadHome = res ? n(res.closing_spread_home) : null;
    return {
      week: Number(w.week),
      opponent: w.opponent,
      isHome: w.is_home,
      pointsFor: n(w.off_points),
      pointsAgainst: n(w.def_points),
      closingSpread: spreadHome == null ? null : isHome ? spreadHome : -spreadHome,
      ats: !res || res.home_covered == null ? null
        : (res.home_covered === isHome ? "W" : "L"),
      closingTotal: res ? n(res.closing_total) : null,
      ou: !res || res.went_over == null ? null : res.went_over ? "O" : "U",
    };
  });

  return {
    abbr, season, ratingWeek: week, rank: rank || null, of: current.length,
    teamRating: n(mine.team_rating), offense: n(mine.offense_rating),
    defense: n(mine.defense_rating), st: n(mine.st_rating), gamesUsed: mine.games_used,
    trend: trendOf(season), priorTrend: trendOf(prior), priorSeason: prior,
    log, offAgg, defAgg, ranks, leagueGames: teamWeeks.length,
  };
}

// ── stats table ─────────────────────────────────────────────────────────────

export type StatsRow = {
  abbr: string; games: number;
  off: SideAgg; def: SideAgg;
  rushTdAllowedPg: number | null; passTdAllowedPg: number | null;
};

export async function getStats(seasonArg?: number): Promise<{ season: number; rows: StatsRow[] }> {
  const season = seasonArg ?? currentSeason();
  const [teamWeeks, defenseWeeks] = await Promise.all([
    selectAll<TeamWeek>("chalk_team_weeks", "*", (q) =>
      q.eq("season", season).lte("week", LAST_REGULAR_WEEK),
    ),
    selectAll<DefenseWeek>("chalk_defense_weeks", "*", (q) =>
      q.eq("season", season).lte("week", LAST_REGULAR_WEEK),
    ),
  ]);

  const byTeam = new Map<string, TeamWeek[]>();
  for (const r of teamWeeks) {
    if (!byTeam.has(r.team)) byTeam.set(r.team, []);
    byTeam.get(r.team)!.push(r);
  }
  const defByTeam = new Map<string, DefenseWeek[]>();
  for (const r of defenseWeeks) {
    if (!defByTeam.has(r.team)) defByTeam.set(r.team, []);
    defByTeam.get(r.team)!.push(r);
  }

  // Every team appears, even at zero games, so the table is always 32 rows and
  // the empty ones are visibly empty rather than missing.
  const { NFLVERSE_TO_ODDS } = await import("./teams");
  const rows: StatsRow[] = Object.keys(NFLVERSE_TO_ODDS).map((abbr) => {
    const weeks = byTeam.get(abbr) ?? [];
    const dw = defByTeam.get(abbr) ?? [];
    const g = dw.length;
    return {
      abbr,
      games: weeks.length,
      off: aggregateSide(weeks, "off"),
      def: aggregateSide(weeks, "def"),
      rushTdAllowedPg: g ? dw.reduce((a, r) => a + (n(r.rush_td_allowed) ?? 0), 0) / g : null,
      passTdAllowedPg: g ? dw.reduce((a, r) => a + (n(r.pass_td_allowed) ?? 0), 0) / g : null,
    };
  });

  return { season, rows };
}
