import type { Capture } from "@/lib/gameData";

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  }).format(new Date(iso));

const spread = (v: number | null) =>
  v == null ? "–" : v === 0 ? "PK" : `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}`;

const plain = (v: number | null) => (v == null ? "–" : v.toFixed(1));

/**
 * The chart as a table. Same captures, same order, left to right becomes top to
 * bottom -- and unlike the chart it can be read without a pointer, which is what
 * makes the chart itself safe to leave as a picture.
 */
export default function CaptureSlip({ captures }: { captures: Capture[] }) {
  if (captures.length === 0) return null;

  return (
    <>
      <p className="label mt-4">Captures, oldest first</p>
      <div className="slip mt-2 overflow-x-auto">
        <table className="tabular w-full min-w-max text-[0.8125rem]">
          <thead>
            <tr className="label">
              <th className="sticky left-0 z-10 bg-panel py-2 pl-3 pr-4 text-left font-sans font-medium">
                Captured
              </th>
              <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">DK spread</th>
              <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">DK total</th>
              <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">Books moved</th>
            </tr>
          </thead>
          <tbody>
            {captures.map((c) => (
              <tr key={c.capturedAt} className="border-t border-panel-rule">
                <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-panel py-2 pl-3 pr-4 text-left font-sans font-normal text-chalk">
                  {when(c.capturedAt)}
                </th>
                <td className="py-2 pr-3 text-right text-chalk">{spread(c.dkSpread)}</td>
                <td className="py-2 pr-3 text-right text-chalk">{plain(c.dkTotal)}</td>
                <td className="py-2 pr-3 text-right">
                  {c.moved == null ? (
                    <span className="text-chalk-faint">first</span>
                  ) : (
                    <>
                      <span className={c.moved > 0 ? "chalk-accent font-bold" : "text-chalk-faint"}>
                        {c.moved}
                      </span>
                      <span className="ml-1 text-chalk-faint">of {c.comparable}</span>
                      {c.arrived ? (
                        <span className="ml-1.5 text-chalk-faint">+{c.arrived} new</span>
                      ) : null}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-chalk-faint">
        Times are Eastern, to the minute. Spread and total are DraftKings, the
        book the rest of Chalk is measured against. Books moved counts the books
        quoting this game in both this capture and the one before it that changed
        their spread or their total in between. The denominator is the books
        quoting the game in both captures, not every book in this one: a book
        appearing for the first time had no earlier number to change, so it is
        counted separately as new rather than as a book that held its line.
      </p>
    </>
  );
}
