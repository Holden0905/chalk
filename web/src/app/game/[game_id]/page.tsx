import Link from "next/link";
import { notFound } from "next/navigation";
import BestPrices from "@/components/BestPrices";
import CaptureSlip from "@/components/CaptureSlip";
import FitText from "@/components/FitText";
import InjurySlip from "@/components/InjurySlip";
import LineHistory from "@/components/LineHistory";
import NewsSlip from "@/components/NewsSlip";
import TdSlip from "@/components/TdSlip";
import { getGame, type BetRow, type Side } from "@/lib/gameData";
import { city, nickname } from "@/lib/teams";
import { kickoffDay, kickoff as kickoffTime, plain } from "@/lib/format";

export const dynamic = "force-dynamic";

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const signed = (v: number | null, d = 1) =>
  v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(d)}`;

/** A spread as a bettor reads it: the favourite, and by how much. */
function asLine(spreadHome: number | null, home: string | null, away: string | null) {
  if (spreadHome == null) return "–";
  if (spreadHome === 0) return "PK";
  const team = spreadHome < 0 ? home : away;
  return `${team ?? ""} −${Math.abs(spreadHome).toFixed(1)}`.trim();
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ game_id: string }>;
}) {
  const game = await getGame((await params).game_id);
  if (!game) return { title: "Game · Chalk" };
  return { title: `${nickname(game.away.name)} at ${nickname(game.home.name)} · Chalk` };
}

function TeamLine({ side, align }: { side: Side; align: "away" | "home" }) {
  const body = (
    <span className="flex min-w-0 flex-1 items-baseline gap-2">
      <FitText boxClassName="flex-1" className="chalk d-team font-bold">
        {nickname(side.name)}
      </FitText>
      <span className="label shrink-0 normal-case tracking-normal text-[0.6875rem]">
        {city(side.name)}
      </span>
    </span>
  );
  return (
    <div className="flex items-baseline justify-between gap-x-3 py-0.5">
      {side.abbr ? (
        <Link href={`/team/${side.abbr}`} className="flex min-w-0 flex-1 hover:opacity-80">
          {body}
        </Link>
      ) : (
        body
      )}
      <span className="tabular shrink-0 text-xs text-chalk-soft">
        {side.rank != null ? `#${side.rank}` : "–"}
        <span className="mx-1 text-chalk-faint">·</span>
        {signed(side.rating)}
        <span className="sr-only"> rating, {align} team</span>
      </span>
    </div>
  );
}

function BetsSlip({ bets }: { bets: BetRow[] }) {
  return (
    <div className="slip mt-4 overflow-x-auto">
      <table className="tabular w-full min-w-max text-[0.8125rem]">
        <thead>
          <tr className="label">
            <th className="py-2 pl-3 pr-3 text-left font-sans font-medium">Bet</th>
            <th className="py-2 pr-3 text-right font-medium">Line</th>
            <th className="py-2 pr-3 text-right font-medium">Price</th>
            <th className="py-2 pr-3 text-right font-medium">Close</th>
            <th className="py-2 pr-3 text-right font-medium">CLV</th>
            <th className="py-2 pr-3 text-right font-medium">Result</th>
            <th className="py-2 pr-3 text-right font-medium">P/L</th>
          </tr>
        </thead>
        <tbody>
          {bets.map((b) => {
            const clv = num(b.clv_points);
            const profit = num(b.profit);
            return (
              <tr key={b.id} className="border-t border-panel-rule">
                <th scope="row" className="whitespace-nowrap py-2 pl-3 pr-3 text-left font-sans font-normal text-chalk">
                  {b.side}
                  <span className="ml-1.5 text-chalk-faint">{b.market}</span>
                </th>
                <td className="py-2 pr-3 text-right text-chalk">{b.line == null ? "–" : plain(num(b.line), 1)}</td>
                <td className="py-2 pr-3 text-right text-chalk-soft">
                  {b.price == null ? "–" : b.price > 0 ? `+${b.price}` : b.price}
                </td>
                <td className="py-2 pr-3 text-right text-chalk-soft">
                  {b.closing_line == null ? "–" : plain(num(b.closing_line), 1)}
                </td>
                <td className={`py-2 pr-3 text-right ${clv == null ? "text-chalk-faint" : clv > 0 ? "text-win" : clv < 0 ? "text-loss" : "text-chalk-soft"}`}>
                  {signed(clv)}
                </td>
                <td className={`py-2 pr-3 text-right ${b.result === "win" ? "text-win" : b.result === "loss" ? "text-loss" : "text-chalk-soft"}`}>
                  {b.result ?? "open"}
                </td>
                <td className={`py-2 pr-3 text-right ${profit == null ? "text-chalk-faint" : profit > 0 ? "text-win" : profit < 0 ? "text-loss" : "text-chalk-soft"}`}>
                  {profit == null ? "–" : signed(profit, 2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function GamePage({
  params,
}: {
  params: Promise<{ game_id: string }>;
}) {
  const game = await getGame((await params).game_id);
  if (!game) notFound();

  const { home, away, result } = game;
  const marketLine = asLine(game.market.spreadHome, home.abbr, away.abbr);
  const chalkLine = asLine(game.chalk.spreadHome, home.abbr, away.abbr);

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="chalk d-title font-bold">Game</h1>
        <span className="label text-right">
          {kickoffDay(game.commenceTime)}
          <br />
          {kickoffTime(game.commenceTime)}
        </span>
      </div>

      <p className="mt-3 text-sm text-chalk-soft">
        <Link href="/board" className="underline underline-offset-4 hover:opacity-80">
          Back to the board
        </Link>
      </p>

      {/* --- matchup --------------------------------------------------------- */}
      <section className="board-card mt-5 px-4 py-4 sm:px-5">
        <h2 className="sr-only">Matchup</h2>
        <TeamLine side={away} align="away" />
        <div className="chalk d-at py-0.5 text-chalk-faint">at</div>
        <TeamLine side={home} align="home" />

        <div className="slip -mx-4 -mb-4 mt-4 rounded-b-[2px] border-b-0 px-4 pb-2 pt-3 sm:-mx-5 sm:-mb-4 sm:px-5">
          <table className="tabular w-full text-[0.8125rem]">
            <thead>
              <tr className="label">
                <th className="pb-1.5 text-left font-medium">&nbsp;</th>
                <th className="pb-1.5 text-right font-medium">
                  Market{game.market.book ? <span className="ml-1 normal-case tracking-normal">({game.market.book})</span> : null}
                </th>
                <th className="pb-1.5 text-right font-medium">Chalk</th>
              </tr>
            </thead>
            <tbody className="text-chalk">
              <tr className="border-t border-panel-rule">
                <th scope="row" className="label py-2 text-left font-medium">Spread</th>
                <td className="py-2 text-right">{marketLine}</td>
                <td className="chalk-accent py-2 text-right font-bold">{chalkLine}</td>
              </tr>
              <tr className="border-t border-panel-rule">
                <th scope="row" className="label py-2 text-left font-medium">Total</th>
                <td className="py-2 text-right">{plain(game.market.total, 1)}</td>
                <td className="chalk-accent py-2 text-right font-bold">{plain(game.chalk.total, 1)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <p className="mt-5 text-xs leading-relaxed text-chalk-faint">
          Rank and rating are Chalk&rsquo;s own, in points of expected margin
          against an average team, as of
          {game.ratingWeek != null ? ` week ${game.ratingWeek}` : " the latest rating"}.
          Tap either team for its page.
        </p>
      </section>

      {/* --- after grading --------------------------------------------------- */}
      {result ? (
        <section className="board-card mt-5 px-4 py-4 sm:px-5">
          <h2 className="chalk d-section font-bold">Result</h2>
          <p className="chalk mt-1 text-[2rem] leading-none">
            {away.abbr ?? nickname(away.name)} {result.awayScore}
            <span className="mx-2 text-chalk-faint">–</span>
            {home.abbr ?? nickname(home.name)} {result.homeScore}
          </p>
          <div className="slip mt-3 px-3 py-3 text-sm">
            <p>
              <span className="label mr-2">ATS</span>
              <span className={result.homeCovered == null ? "text-chalk-soft" : result.homeCovered ? "text-win" : "text-loss"}>
                {result.homeCovered == null
                  ? "push"
                  : `${result.homeCovered ? home.abbr : away.abbr} covered`}
              </span>
              <span className="ml-2 text-chalk-faint">
                closed {signed(result.closingSpreadHome)} on {home.abbr ?? "home"}
              </span>
            </p>
            <p className="mt-1.5">
              <span className="label mr-2">O/U</span>
              <span className={result.wentOver == null ? "text-chalk-soft" : "text-chalk"}>
                {result.wentOver == null ? "push" : result.wentOver ? "Over" : "Under"}
              </span>
              <span className="ml-2 text-chalk-faint">
                {result.homeScore + result.awayScore} against a close of {plain(result.closingTotal, 1)}
              </span>
            </p>
          </div>

          {game.bets.length > 0 ? (
            <>
              <p className="label mt-4">Bets on this game</p>
              <BetsSlip bets={game.bets} />
            </>
          ) : (
            <p className="mt-3 text-xs text-chalk-faint">No bets were logged on this game.</p>
          )}
        </section>
      ) : game.bets.length > 0 ? (
        <section className="board-card mt-5 px-4 py-4 sm:px-5">
          <h2 className="chalk d-section font-bold">Bets</h2>
          <p className="mt-1 text-sm text-chalk-soft">Open until the game is graded.</p>
          <BetsSlip bets={game.bets} />
        </section>
      ) : null}

      {/* --- line history ---------------------------------------------------- */}
      <section className="board-card mt-5 px-4 py-4 sm:px-5">
        <h2 className="chalk d-section font-bold">Line history</h2>
        <p className="mt-1 max-w-prose text-sm text-chalk-soft">
          Every capture, every book. {game.history.length.toLocaleString()} quotes
          across {game.books.length} book{game.books.length === 1 ? "" : "s"}.
        </p>
        <LineHistory history={game.history} home={home.abbr} away={away.abbr} />
        <CaptureSlip captures={game.captures} />
        <BestPrices latest={game.latest} best={game.best} home={home.abbr} away={away.abbr} />
      </section>

      {/* --- injuries -------------------------------------------------------- */}
      <InjurySlip
        capturedAt={game.injuries.capturedAt}
        home={home.name}
        away={away.name}
        homeRows={game.injuries.home}
        awayRows={game.injuries.away}
      />

      {/* --- news ------------------------------------------------------------ */}
      <NewsSlip news={game.news} />

      {/* --- td board -------------------------------------------------------- */}
      <section className="board-card mt-5 px-4 py-4 sm:px-5">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="chalk d-section font-bold">TD board</h2>
          {game.td.week != null ? <span className="label text-right">week {game.td.week}</span> : null}
        </div>
        {game.td.sides == null ? (
          <p className="mt-2 text-sm text-chalk-faint">
            No TD board for this game. The board is built for the current
            season&rsquo;s upcoming week only.
          </p>
        ) : (
          <>
            {!game.td.hasProps ? <p className="label mt-1">no prop snapshot for this game</p> : null}
            <div className="mt-3">
              {(game.td.sides as { team: string }[]).map((s) => (
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                <TdSlip key={s.team} {...(s as any)} />
              ))}
            </div>
          </>
        )}
      </section>
    </>
  );
}
