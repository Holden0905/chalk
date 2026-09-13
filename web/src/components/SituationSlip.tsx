import type { Column, SituationRow } from "@/lib/leagueData";

/**
 * Situations across seasons. Four numbers per cell rather than four columns per
 * season: the home cover rate and the over rate on top, then the size of the
 * bucket and how far the more extreme of the two rates sits from a coin flip.
 * Stacking keeps the table the same width as the others, which is the only way
 * sixteen situations fit on a phone.
 */
export default function SituationSlip({
  columns,
  rows,
}: {
  columns: Column[];
  rows: SituationRow[];
}) {
  return (
    <section className="board-card mt-5 px-4 py-4 sm:px-5">
      <h2 className="chalk d-section font-bold">Situations</h2>

      <p className="mt-1 max-w-prose text-sm text-chalk-soft">
        A single season splits sixteen ways into buckets of twenty or thirty
        games. At that size a rate swings five points on one result, so read the
        All column first and treat a season column as colour, not evidence.
      </p>

      <div className="slip mt-3 overflow-x-auto">
        <table className="tabular w-full sm:min-w-max text-[0.8125rem]">
          <thead>
            <tr className="label">
              <th className="sticky left-0 z-10 bg-panel py-2 pl-3 pr-2 text-left font-medium">
                Situation
              </th>
              {columns.map((c) => (
                <th key={c.key} className="whitespace-nowrap py-2 pr-3 text-right font-medium">
                  <span className="block text-chalk-soft">{c.label}</span>
                  <span className="block normal-case tracking-normal">ats / o-u</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* The row label is words, not figures, so it reads in the condensed
                face rather than the typewriter one, which is narrow enough that
                every column still fits on a phone. It wraps there and stops
                wrapping from the small breakpoint up, where the table can simply
                be wider than the card and scroll. */}
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-panel-rule">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-panel py-2 pl-3 pr-4 text-left align-top font-sans font-normal text-chalk sm:whitespace-nowrap"
                >
                  {r.label}
                </th>
                {columns.map((c) => {
                  const cell = r.cells[c.key];
                  const ats = pct(cell?.cover.value);
                  const ou = pct(cell?.over.value);
                  const off = cell?.off;
                  return (
                    <td key={c.key} className="py-2 pr-3 text-right align-top">
                      <span className="block whitespace-nowrap text-chalk">
                        {ats} <span className="text-chalk-faint">/</span> {ou}
                      </span>
                      <span className="block text-[0.625rem] leading-tight text-chalk-faint">
                        {cell?.games ?? 0} g
                        {off?.value == null
                          ? ""
                          : ` · ±${off.value.toFixed(1)} ${off.from}`}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-chalk-faint">
        Top line is the home cover rate and the over rate, in percent. Under it,
        the games in the bucket and how far from 50 the more extreme of the two
        rates sits, with the rate it came from. Pushes are dropped from a rate
        but still counted in the bucket, so a rate&rsquo;s own sample is the game
        count less its pushes. Short week is four days of rest or fewer, a bye is
        thirteen or more. Primetime is a 7pm Eastern kickoff or later and
        afternoon is noon to 7pm, which leaves the 9:30am international games out
        of both. Dome counts a closed retractable roof; outdoor counts an open
        one.
      </p>
    </section>
  );
}

const pct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? "–" : v.toFixed(1);
