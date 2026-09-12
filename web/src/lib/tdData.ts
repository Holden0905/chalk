import "server-only";
import zlib from "node:zlib";
import { Readable } from "node:stream";
import { parse } from "csv-parse/sync";
import { parse as parseStream } from "csv-parse";
import { selectAll } from "./supabase";
import { currentSeason } from "./board";
import { playerNameKey, toAbbr } from "./teams";
// The board itself is built by the same module the finder CLI uses.
import { buildTdBoard, MARKET } from "./tdBoard.mjs";

const GAMES_URL =
  "https://github.com/nflverse/nflverse-data/releases/download/schedules/games.csv";
const rosterUrl = (season: number) =>
  `https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv.gz`;

export const LAST_REGULAR_WEEK = 18;

/** Player id to current team and position, or null if the file is unusable. */
async function loadRoster(season: number): Promise<Map<string, { team: string; position: string }> | null> {
  try {
    const res = await fetch(rosterUrl(season), { next: { revalidate: 3600 } });
    if (!res.ok || !res.body) return null;
    const parser = Readable.fromWeb(res.body as never)
      .pipe(zlib.createGunzip())
      .pipe(parseStream({ columns: true, relax_column_count: true }));
    const map = new Map<string, { team: string; position: string }>();
    for await (const row of parser as AsyncIterable<Record<string, string>>) {
      if (row.gsis_id && row.team) map.set(row.gsis_id, { team: row.team, position: row.position });
    }
    return map.size ? map : null;
  } catch {
    return null;
  }
}

type ScheduleRow = Record<string, string>;

async function schedule(): Promise<ScheduleRow[]> {
  const text = await fetch(GAMES_URL, { next: { revalidate: 3600 } }).then((r) => r.text());
  return parse(text, { columns: true, skip_empty_lines: true }) as ScheduleRow[];
}

/**
 * The week to show by default: the one holding the next kickoff, or the last
 * week of the season once it is over.
 */
export function defaultWeek(rows: ScheduleRow[], season: number, now = new Date()): number {
  const reg = rows.filter((g) => Number(g.season) === season && g.game_type === "REG");
  if (reg.length === 0) return 1;
  const upcoming = reg
    .filter((g) => g.gameday && Date.parse(`${g.gameday}T23:59:59Z`) >= now.getTime())
    .sort((a, b) => a.gameday.localeCompare(b.gameday));
  if (upcoming.length) return Number(upcoming[0].week);
  return Math.max(...reg.map((g) => Number(g.week)));
}

export async function getTdBoard(weekArg?: number) {
  const season = currentSeason();
  const rows = await schedule();
  const week = weekArg && weekArg >= 1 && weekArg <= LAST_REGULAR_WEEK ? weekArg : defaultWeek(rows, season);

  const games = rows.filter(
    (g) => Number(g.season) === season && Number(g.week) === week && g.game_type === "REG",
  );

  const [playerRows, defenseRows, propRows, roster] = await Promise.all([
    selectAll<Record<string, unknown>>("chalk_player_weeks", "*", (q) =>
      q.in("season", [season - 1, season]),
    ),
    selectAll<Record<string, unknown>>("chalk_defense_weeks", "*", (q) =>
      q.in("season", [season - 1, season]),
    ),
    selectAll<Record<string, unknown>>("chalk_prop_snapshots", "*", (q) => q.eq("market", MARKET)),
    loadRoster(season),
  ]);

  const board = buildTdBoard({
    games, playerRows, defenseRows, propRows, roster, season, week,
    toAbbr, nameKey: playerNameKey,
  });
  return { ...board, weeks: Array.from({ length: LAST_REGULAR_WEEK }, (_, i) => i + 1) };
}

/** Player names per game, for the anytime-TD autocomplete on the bets form. */
export async function tdPlayersByGame(): Promise<Record<string, string[]>> {
  const board = await getTdBoard();
  const out: Record<string, string[]> = {};
  for (const g of board.games) {
    out[`${g.away}@${g.home}`] = g.sides.flatMap((s: { players: { name: string }[] }) =>
      s.players.map((p) => p.name),
    );
  }
  return out;
}
