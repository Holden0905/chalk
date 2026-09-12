import BetForm from "@/components/BetForm";
import DeleteBet from "@/components/DeleteBet";
import { getBetsPage, type Bet } from "@/lib/betsData";
import { toAbbr } from "@/lib/teams";

export const dynamic = "force-dynamic";
export const metadata = { title: "Bets · Chalk" };

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const money = (v: unknown) => {
  const n = num(v);
  return n == null ? "–" : `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;
};
const plain = (v: unknown, d = 1) => {
  const n = num(v);
  return n == null ? "–" : n.toFixed(d);
};
const priceOf = (v: number | null) => (v == null ? "–" : v > 0 ? `+${v}` : `${v}`);
const day = (iso: string | null) =>
  !iso ? "–" : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }).format(new Date(iso));

function Row({ bet, running, label }: { bet: Bet; running?: number; label: string }) {
  const resultColor =
    bet.result === "win" ? "text-win" : bet.result === "loss" ? "text-loss" : "text-chalk-soft";
  const clv = num(bet.clv_points);
  return (
    <tr className="border-t border-panel-rule">
      <td className="py-2 pl-3 pr-2 text-chalk-faint">{day(bet.commence_time)}</td>
      <td className="whitespace-nowrap py-2 pr-3 text-chalk-soft">{label}</td>
      <td className="py-2 pr-3 text-chalk-soft">{bet.market}</td>
      <td className="whitespace-nowrap py-2 pr-3 text-chalk">{bet.side}</td>
      <td className="py-2 pr-3 text-right text-chalk">{bet.line == null ? "–" : plain(bet.line, 1)}</td>
      <td className="py-2 pr-3 text-right text-chalk">{priceOf(bet.price)}</td>
      <td className="py-2 pr-3 text-right text-chalk-soft">{plain(bet.stake, 2)}</td>
      <td className="py-2 pr-3 text-right text-chalk-soft">
        {bet.closing_line != null ? plain(bet.closing_line, 1) : bet.closing_price != null ? priceOf(bet.closing_price) : "–"}
      </td>
      <td className={`py-2 pr-3 text-right ${clv == null ? "text-chalk-faint" : clv > 0 ? "text-win" : clv < 0 ? "text-loss" : "text-chalk-soft"}`}>
        {clv == null ? "–" : money(clv)}
      </td>
      <td className={`py-2 pr-3 ${resultColor}`}>{bet.result ?? "open"}</td>
      <td className={`py-2 pr-2 text-right ${resultColor}`}>{bet.profit == null ? "–" : money(bet.profit)}</td>
      <td className="py-2 pr-1 text-right tabular text-chalk-faint">{running == null ? "" : money(running)}</td>
      <td className="py-0 pr-1 text-right">
        <DeleteBet id={bet.id} label={`${bet.market} ${bet.side}`} />
      </td>
    </tr>
  );
}

const HEADS = ["Date", "Game", "Market", "Side", "Line", "Price", "Stake", "Close", "CLV", "Result", "Profit", "Run", ""];

export default async function BetsPage() {
  const { games, books, open, graded, summary, playersByGameId, season } = await getBetsPage();

  const labelFor = (b: Bet) => {
    const g = games.find((x) => x.gameId === b.game_id);
    if (g) return `${g.awayAbbr ?? g.away} @ ${g.homeAbbr ?? g.home}`;
    return b.game_id ? `${b.game_id.slice(0, 6)}…` : "–";
  };

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="chalk d-title font-bold">Bets</h1>
        <span className="label text-right">{season} season</span>
      </div>

      <p className="mt-3 max-w-prose text-sm text-chalk-soft">
        What was actually taken, at what number.{" "}
        <span className="chalk-accent">CLV</span> is the only column that says
        whether the bet was any good independent of whether it won.
      </p>

      <BetForm games={games} books={books} playersByGameId={playersByGameId} />

      <div className="mt-8 flex items-baseline justify-between gap-4">
        <h2 className="chalk d-section font-bold">The log</h2>
        <span className="label text-right">
          {summary.total} bet{summary.total === 1 ? "" : "s"}
        </span>
      </div>

      <p className="tabular mt-2 text-sm text-chalk-soft">
        {summary.graded === 0 ? (
          "Nothing graded yet."
        ) : (
          <>
            {summary.record}
            <span className="mx-2 text-chalk-faint">·</span>
            profit <span className={summary.profit >= 0 ? "text-win" : "text-loss"}>{money(summary.profit)}</span>
            {summary.roi != null ? <> on {summary.staked.toFixed(2)} staked ({summary.roi.toFixed(1)}% ROI)</> : null}
            <span className="mx-2 text-chalk-faint">·</span>
            avg CLV {summary.avgClv == null ? "–" : money(summary.avgClv)}
            <span className="mx-2 text-chalk-faint">·</span>
            positive CLV {summary.clvCount ? `${summary.positiveClv}/${summary.clvCount}` : "–"}
          </>
        )}
      </p>

      {summary.total === 0 ? (
        <p className="panel mt-4 px-4 py-6 text-sm text-chalk-soft">
          No bets logged yet. The form above writes straight to the log.
        </p>
      ) : (
        <div className="board-card mt-4 overflow-hidden">
          <div className="slip overflow-x-auto border-t-0">
            <table className="tabular w-full min-w-[820px] text-[0.8125rem]">
              <thead>
                <tr className="label">
                  {HEADS.map((h, i) => (
                    <th key={i} className={`py-2 font-medium ${i === 0 ? "pl-3 pr-2 text-left" : i >= 4 && i <= 8 ? "pr-3 text-right" : "pr-3 text-left"}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {open.length ? (
                  <>
                    <tr className="border-t border-panel-rule">
                      <td colSpan={13} className="label bg-white/[0.02] py-1.5 pl-3">Open</td>
                    </tr>
                    {open.map((b) => <Row key={b.id} bet={b} label={labelFor(b)} />)}
                  </>
                ) : null}
                {graded.length ? (
                  <>
                    <tr className="border-t border-panel-rule">
                      <td colSpan={13} className="label bg-white/[0.02] py-1.5 pl-3">Graded</td>
                    </tr>
                    {graded.map((b) => <Row key={b.id} bet={b} running={b.running} label={labelFor(b)} />)}
                  </>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-5 text-xs leading-relaxed text-chalk-faint">
        Close is the closing line for a spread or total and the closing price
        for a moneyline or anytime touchdown. CLV is points of line on the first
        two and percentage points of implied probability on the other two, and
        is positive whenever the bet beat the close. Both are filled in by the
        grade job once the game has a result. The × removes a row for good.
      </p>
    </>
  );
}
