// Pure aggregation. No server imports, so client components can share the types.

export type TeamWeek = {
  season: number; week: number; team: string; opponent: string | null; is_home: boolean | null;
  off_points: number | null; def_points: number | null;
  off_plays: number | null; off_success_rate: string | number | null; off_epa_per_play: string | number | null;
  off_pass_success_rate: string | number | null; off_pass_epa_per_play: string | number | null;
  off_rush_success_rate: string | number | null; off_rush_epa_per_play: string | number | null;
  off_points_per_trip_inside_40: string | number | null; off_avg_start_yardline: string | number | null;
  off_turnovers: number | null;
  def_plays: number | null; def_success_rate: string | number | null; def_epa_per_play: string | number | null;
  def_pass_success_rate: string | number | null; def_pass_epa_per_play: string | number | null;
  def_rush_success_rate: string | number | null; def_rush_epa_per_play: string | number | null;
  def_points_per_trip_inside_40: string | number | null; def_avg_start_yardline: string | number | null;
  def_turnovers: number | null;
  st_epa: string | number | null;
};

export type DefenseWeek = {
  season: number; week: number; team: string;
  rush_td_allowed: number | null; pass_td_allowed: number | null;
  rz_trips_allowed: number | null; rz_td_allowed: number | null;
};

export const n = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
};

const mean = (xs: (number | null)[]): number | null => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
};

/** Plays-weighted, for per-play rates where the snap count is known. */
const weighted = (rows: TeamWeek[], rate: keyof TeamWeek, plays: keyof TeamWeek): number | null => {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const v = n(r[rate]);
    const p = n(r[plays]);
    if (v == null || !p) continue;
    num += v * p;
    den += p;
  }
  return den > 0 ? num / den : null;
};

export type SideAgg = {
  games: number;
  plays: number | null;
  successRate: number | null;
  epaPerPlay: number | null;
  passSuccessRate: number | null;
  passEpaPerPlay: number | null;
  rushSuccessRate: number | null;
  rushEpaPerPlay: number | null;
  pointsPerTrip: number | null;
  avgStartYardline: number | null;
  turnoversPerGame: number | null;
  points: number | null;
  pointsPerGame: number | null;
};

/**
 * Season aggregate for one side of the ball.
 *
 * Overall success rate and EPA are weighted by snaps. The pass and rush splits
 * are a plain mean of the per-game rates, because chalk_team_weeks stores the
 * split rates but not the snap counts behind them.
 */
export function aggregateSide(rows: TeamWeek[], side: "off" | "def"): SideAgg {
  const p = (k: string) => `${side}_${k}` as keyof TeamWeek;
  const points = rows.map((r) => n(r[p("points")])).filter((x): x is number => x != null);
  return {
    games: rows.length,
    plays: rows.reduce((a, r) => a + (n(r[p("plays")]) ?? 0), 0) || null,
    successRate: weighted(rows, p("success_rate"), p("plays")),
    epaPerPlay: weighted(rows, p("epa_per_play"), p("plays")),
    passSuccessRate: mean(rows.map((r) => n(r[p("pass_success_rate")]))),
    passEpaPerPlay: mean(rows.map((r) => n(r[p("pass_epa_per_play")]))),
    rushSuccessRate: mean(rows.map((r) => n(r[p("rush_success_rate")]))),
    rushEpaPerPlay: mean(rows.map((r) => n(r[p("rush_epa_per_play")]))),
    pointsPerTrip: mean(rows.map((r) => n(r[p("points_per_trip_inside_40")]))),
    avgStartYardline: mean(rows.map((r) => n(r[p("avg_start_yardline")]))),
    turnoversPerGame: mean(rows.map((r) => n(r[p("turnovers")]))),
    points: points.length ? points.reduce((a, b) => a + b, 0) : null,
    pointsPerGame: points.length ? points.reduce((a, b) => a + b, 0) / points.length : null,
  };
}

export type Ranked = { value: number | null; rank: number | null; of: number };

/**
 * Rank a value against the league. `higherIsBetter` false means the smallest
 * number ranks first. Only teams that have actually played are ranked, and the
 * denominator is returned so a rank out of four reads as a rank out of four.
 */
export function rankAcross(
  values: Map<string, number | null>,
  team: string,
  higherIsBetter: boolean,
): Ranked {
  const present = [...values.entries()].filter(([, v]) => v != null) as [string, number][];
  present.sort((a, b) => (higherIsBetter ? b[1] - a[1] : a[1] - b[1]));
  const i = present.findIndex(([t]) => t === team);
  return {
    value: values.get(team) ?? null,
    rank: i === -1 ? null : i + 1,
    of: present.length,
  };
}

export type Record = { wins: number; losses: number; ties: number };

/** Win-loss from points for and against, which chalk_team_weeks carries. */
export function recordFrom(rows: TeamWeek[]): Record {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  for (const r of rows) {
    const pf = n(r.off_points);
    const pa = n(r.def_points);
    if (pf == null || pa == null) continue;
    if (pf > pa) wins++;
    else if (pf < pa) losses++;
    else ties++;
  }
  return { wins, losses, ties };
}

export const showRecord = (r: Record): string =>
  r.wins + r.losses + r.ties === 0 ? "–" : `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`;
