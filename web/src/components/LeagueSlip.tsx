import type { Column, MetricRow } from "@/lib/leagueData";

/**
 * A slip of the comparison table: metrics down, seasons across, with the game
 * count under every number. The count is the point of the layout -- a rate with
 * no sample beside it is an assertion, not a measurement.
 */
export default function LeagueSlip({
  title,
  blurb,
  columns,
  rows,
  caption,
}: {
  title: string;
  blurb?: string;
  columns: Column[];
  rows: MetricRow[];
  caption?: string;
}) {
  return (
    <section className="board-card mt-5 px-4 py-4 sm:px-5">
      <h2 className="chalk d-section font-bold">{title}</h2>
      {blurb ? <p className="mt-1 max-w-prose text-sm text-chalk-soft">{blurb}</p> : null}

      <div className="slip mt-3 overflow-x-auto">
        <table className="tabular w-full sm:min-w-max text-[0.8125rem]">
          <thead>
            <tr className="label">
              <th className="sticky left-0 z-10 bg-panel py-2 pl-3 pr-2 text-left font-medium">
                <span className="sr-only">Metric</span>
              </th>
              {columns.map((c) => (
                <th key={c.key} className="whitespace-nowrap py-2 pr-3 text-right font-medium">
                  <span className="block text-chalk-soft">{c.label}</span>
                  <span className="block normal-case tracking-normal">{c.count} games</span>
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
                  return (
                    <td key={c.key} className="py-2 pr-3 text-right align-top">
                      {/* Figures stay on one line; the two prose rows -- the
                          extremes and the priced-vs-played pair -- may wrap. */}
                      <span className={`block text-chalk ${r.fmt === "text" ? "" : "whitespace-nowrap"}`}>
                        {display(cell, r)}
                      </span>
                      {/* The note under an extreme names a game, so it is allowed
                          to wrap. Keeping it on one line would set the width of
                          every column in the slip. */}
                      <span className="block text-[0.625rem] leading-tight text-chalk-faint">
                        {cell?.note ?? (cell && cell.games ? cell.games : "–")}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {caption ? (
        <p className="mt-3 text-xs leading-relaxed text-chalk-faint">{caption}</p>
      ) : null}
    </section>
  );
}

function display(cell: { value: number | null; text?: string } | undefined, row: MetricRow) {
  if (!cell) return "–";
  if (row.fmt === "text") return cell.text ?? "–";
  if (cell.value == null || !Number.isFinite(cell.value)) return "–";
  const d = row.digits ?? 1;
  if (row.fmt === "pct") return `${cell.value.toFixed(d)}%`;
  if (row.fmt === "signed") {
    const sign = cell.value > 0 ? "+" : cell.value < 0 ? "−" : "";
    return `${sign}${Math.abs(cell.value).toFixed(d)}`;
  }
  return cell.value.toFixed(d);
}
