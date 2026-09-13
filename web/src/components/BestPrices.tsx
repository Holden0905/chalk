import type { Game } from "@/lib/gameData";

const price = (v: number | null) => (v == null ? "–" : v > 0 ? `+${v}` : `${v}`);
const line = (v: number | null) =>
  v == null ? "–" : v === 0 ? "PK" : `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;
const plain = (v: number | null) => (v == null ? "–" : v.toFixed(1));

/** Butter marks the number worth taking; everything else stays plain chalk. */
function Cell({ text, best }: { text: string; best: boolean }) {
  return (
    <td className={`py-2 pr-3 text-right ${best ? "chalk-accent font-bold" : "text-chalk"}`}>
      {text}
    </td>
  );
}

/**
 * Every book in the newest capture, with the best number in each column picked
 * out. Which number is "best" depends on the side you are taking, so the home
 * spread and the away spread are separate columns even though they are one
 * number: the home backer wants the biggest, the away backer the smallest.
 */
export default function BestPrices({
  latest, best, home, away,
}: {
  latest: Game["latest"];
  best: Game["best"];
  home: string | null;
  away: string | null;
}) {
  if (latest.quotes.length === 0) {
    return <p className="mt-3 text-sm text-chalk-faint">No prices in the latest capture.</p>;
  }

  /**
   * Butter means "this is the one to take". When every book is on the same
   * number there is nothing to take, so nothing is marked: highlighting all
   * nine rows of a column would say only that the market agrees with itself.
   */
  const varies = (values: (number | null)[]) =>
    new Set(values.filter((v) => v != null)).size > 1;

  const moves = {
    spread: varies(latest.quotes.map((q) => q.spreadHome)),
    total: varies(latest.quotes.map((q) => q.total)),
    homeMl: varies(latest.quotes.map((q) => q.homeMl)),
    awayMl: varies(latest.quotes.map((q) => q.awayMl)),
  };

  const when = latest.capturedAt
    ? new Intl.DateTimeFormat("en-US", {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
      }).format(new Date(latest.capturedAt))
    : "–";

  return (
    <>
      <p className="label mt-4">Best available · captured {when}</p>
      <div className="slip mt-2 overflow-x-auto">
        <table className="tabular w-full min-w-max text-[0.8125rem]">
          <thead>
            <tr className="label">
              <th className="sticky left-0 z-10 bg-panel py-2 pl-3 pr-4 text-left font-sans font-medium">
                Book
              </th>
              <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">{home ?? "Home"}</th>
              <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">{away ?? "Away"}</th>
              <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">Over</th>
              <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">Under</th>
              <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">{home ?? "Home"} ML</th>
              <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">{away ?? "Away"} ML</th>
            </tr>
          </thead>
          <tbody>
            {latest.quotes.map((q) => {
              const awaySpread = q.spreadHome == null ? null : -q.spreadHome;
              const bestAway = best.spreadAway == null ? null : -best.spreadAway;
              return (
                <tr key={q.book} className="border-t border-panel-rule">
                  <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-panel py-2 pl-3 pr-4 text-left font-sans font-normal text-chalk-soft">
                    {q.book}
                  </th>
                  <Cell text={line(q.spreadHome)} best={moves.spread && q.spreadHome != null && q.spreadHome === best.spreadHome} />
                  <Cell text={line(awaySpread)} best={moves.spread && awaySpread != null && awaySpread === bestAway} />
                  <Cell text={plain(q.total)} best={moves.total && q.total != null && q.total === best.over} />
                  <Cell text={plain(q.total)} best={moves.total && q.total != null && q.total === best.under} />
                  <Cell text={price(q.homeMl)} best={moves.homeMl && q.homeMl != null && q.homeMl === best.homeMl} />
                  <Cell text={price(q.awayMl)} best={moves.awayMl && q.awayMl != null && q.awayMl === best.awayMl} />
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-chalk-faint">
        One row per book from the newest capture, with the number worth taking in
        butter. The two spread columns are the same number read from each side.
        Over and under are also one number: the Over wants the lowest total on
        offer and the Under the highest, so they can be picked out at different
        books. Moneyline is American odds, where a higher number always pays
        more. Only the line is stored per book, not the price beside it, so a
        spread here is the number and not the juice.
      </p>
    </>
  );
}
