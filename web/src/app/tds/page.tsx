import Link from "next/link";
import FitText from "@/components/FitText";
import TdSlip from "@/components/TdSlip";
import { getTdBoard } from "@/lib/tdData";
import { NFLVERSE_TO_ODDS, nickname } from "@/lib/teams";

export const dynamic = "force-dynamic";
export const metadata = { title: "TDs · Chalk" };

const full = (abbr: string) => nickname(NFLVERSE_TO_ODDS[abbr] ?? abbr);

export default async function TdsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const asked = Number((await searchParams).week);
  const board = await getTdBoard(Number.isInteger(asked) ? asked : undefined);

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="chalk d-title font-bold">TD Board</h1>
        <span className="label text-right">{board.season} · week {board.week}</span>
      </div>

      <p className="mt-3 max-w-prose text-sm text-chalk-soft">
        Who is getting the ball near the line, and the defense in front of them.
        Sorted by goal line touches per game. There is no score and no pick.
      </p>

      <nav aria-label="Week" className="-mx-1 mt-4 overflow-x-auto">
        <ul className="flex min-w-max items-center gap-0.5 pb-1">
          {board.weeks.map((w: number) => (
            <li key={w}>
              <Link
                href={w === board.week ? "/tds" : `/tds?week=${w}`}
                aria-current={w === board.week ? "page" : undefined}
                className="chalk nav-link block px-2.5 pb-2 pt-1.5 text-[1.4rem] leading-none"
              >
                {w}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {board.games.length === 0 ? (
        <div className="panel mt-6 px-4 py-8 text-center">
          <p className="chalk d-section">No games</p>
          <p className="mt-2 text-sm text-chalk-soft">
            Nothing scheduled for week {board.week}.
          </p>
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {board.games.map((g: any) => (
            <article key={g.key} className="board-card px-4 py-4 sm:px-5">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="min-w-0 flex-1">
                  <FitText boxClassName="flex-1" className="chalk d-team font-bold">
                    {full(g.away)} <span className="d-at text-chalk-faint">at</span> {full(g.home)}
                  </FitText>
                </h2>
                <span className="label shrink-0">
                  {g.gameday?.slice(5)} {g.gametime}
                </span>
              </div>
              {!g.hasProps ? (
                <p className="label mt-1">no prop snapshot for this game</p>
              ) : null}
              <div className="mt-3">
                {g.sides.map((s: any) => (
                  <TdSlip
                    key={s.team}
                    team={s.team}
                    opponent={s.opponent}
                    defence={s.defence}
                    players={s.players}
                  />
                ))}
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="mt-8 text-xs leading-relaxed text-chalk-faint">
        Qualifier is at least 6 touches per game, rushes plus targets, over the
        last four games. Stat basis is the{" "}
        {board.usingPriorSeason
          ? `${board.statsSeason} full season, because ${board.season} has no games before week ${board.week}`
          : `${board.statsSeason} season to date`}
        . Defensive ranks put 1 as the softest, the one allowing the most.
        Prices are the best available across books from the Saturday snapshot,
        not live numbers.{" "}
        {board.hasRoster
          ? `Teams come from the ${board.season} roster file.`
          : "The roster file was unavailable, so teams come from each player's last game."}
      </p>
    </>
  );
}
