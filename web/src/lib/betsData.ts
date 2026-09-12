import "server-only";
import { db, selectAll } from "./supabase";
import { getBoard } from "./board";
import { tdPlayersByGame } from "./tdData";
import { toAbbr } from "./teams";

export const MARKETS = ["spread", "total", "moneyline", "anytime_td"] as const;
export type Market = (typeof MARKETS)[number];

export type Bet = {
  id: number; placed_at: string; game_id: string | null; commence_time: string | null;
  market: string; side: string; line: string | number | null; price: number | null;
  stake: string | number | null; book: string | null; note: string | null;
  closing_line: string | number | null; closing_price: number | null;
  clv_points: string | number | null; result: string | null;
  profit: string | number | null; graded_at: string | null;
};

export type GameChoice = {
  gameId: string; label: string; home: string; away: string;
  homeAbbr: string | null; awayAbbr: string | null; commenceTime: string;
};

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export async function getBooks(): Promise<string[]> {
  const rows = await selectAll<{ bookmaker: string }>("chalk_odds_snapshots", "id,bookmaker");
  const books = [...new Set(rows.map((r) => r.bookmaker).filter(Boolean))].sort();
  // DraftKings leads because it is the reference book everywhere else in Chalk.
  return books.sort((a, b) => (a === "draftkings" ? -1 : b === "draftkings" ? 1 : a.localeCompare(b)));
}

export async function getBetsPage() {
  const [board, books, bets, tdPlayers] = await Promise.all([
    getBoard(),
    getBooks(),
    selectAll<Bet>("chalk_bets", "*"),
    tdPlayersByGame().catch(() => ({}) as Record<string, string[]>),
  ]);

  const games: GameChoice[] = board.games.map((g) => ({
    gameId: g.gameId,
    home: g.home.name,
    away: g.away.name,
    homeAbbr: g.home.abbr,
    awayAbbr: g.away.abbr,
    commenceTime: g.commenceTime,
    label: `${g.away.abbr ?? g.away.name} @ ${g.home.abbr ?? g.home.name}, ${new Intl.DateTimeFormat(
      "en-US",
      { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" },
    ).format(new Date(g.commenceTime))}`,
  }));

  // Autocomplete for anytime TD, keyed by the game the form is holding.
  const playersByGameId: Record<string, string[]> = {};
  for (const g of games) {
    if (!g.awayAbbr || !g.homeAbbr) continue;
    const key = `${g.awayAbbr}@${g.homeAbbr}`;
    if (tdPlayers[key]) playersByGameId[g.gameId] = tdPlayers[key];
  }

  const open = bets.filter((b) => !b.graded_at)
    .sort((a, b) => String(a.commence_time).localeCompare(String(b.commence_time)));
  const graded = bets.filter((b) => b.graded_at)
    .sort((a, b) => String(a.commence_time).localeCompare(String(b.commence_time)));

  let running = 0;
  const gradedWithRunning = graded.map((b) => {
    running += num(b.profit) ?? 0;
    return { ...b, running };
  });

  const wins = graded.filter((b) => b.result === "win").length;
  const losses = graded.filter((b) => b.result === "loss").length;
  const pushes = graded.filter((b) => b.result === "push").length;
  const staked = graded.reduce((a, b) => a + (num(b.stake) ?? 0), 0);
  const clv = graded.map((b) => num(b.clv_points)).filter((v): v is number => v != null);
  const summary = {
    total: bets.length,
    open: open.length,
    graded: graded.length,
    record: graded.length ? `${wins}-${losses}${pushes ? `-${pushes}` : ""}` : "–",
    profit: running,
    staked,
    roi: staked ? (running / staked) * 100 : null,
    avgClv: clv.length ? clv.reduce((a, b) => a + b, 0) / clv.length : null,
    positiveClv: clv.filter((c) => c > 0).length,
    clvCount: clv.length,
  };

  return { games, books, open, graded: gradedWithRunning, summary, playersByGameId, season: board.season };
}

/** Shared by the form action: the game a bet is being placed on. */
export async function lookupGame(gameId: string) {
  const rows = await selectAll<{
    game_id: string; commence_time: string; home_team: string; away_team: string;
  }>("chalk_odds_snapshots", "id,game_id,commence_time,home_team,away_team", (q) =>
    q.eq("game_id", gameId).limit(1),
  );
  return rows[0] ?? null;
}

export { db, toAbbr };
