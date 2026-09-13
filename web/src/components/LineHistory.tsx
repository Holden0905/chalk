import type { Game } from "@/lib/gameData";

const W = 600;
const H = 150;
const PAD = { top: 12, right: 10, bottom: 20, left: 38 };

// The book everything else in Chalk is measured against. It is drawn in butter;
// every other book is the faint cloud it sits inside.
const REFERENCE = "draftkings";

type Point = { t: number; v: number };

function chart(
  series: { book: string; points: Point[] }[],
  label: string,
  domain: [number, number],
  format: (v: number) => string,
) {
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return null;

  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  const [min, max] = domain;

  const x = (t: number) =>
    PAD.left + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + ((max - v) / (max - min || 1)) * (H - PAD.top - PAD.bottom);

  const path = (points: Point[]) =>
    points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`).join(" ");

  /**
   * An SVG filter region is a percentage of the object bounding box, and a line
   * that never moves has a bounding box zero pixels tall. Running one of those
   * through the chalk filter scales that zero by 140% and draws nothing at all,
   * so a book that has not moved its number simply renders clean. Most of them
   * have not moved, which is what makes this worth guarding rather than
   * accepting as an oddity.
   */
  const flat = (points: Point[]) => points.every((p) => p.v === points[0].v);
  const chalk = (points: Point[]) => (flat(points) ? undefined : "url(#chalk-stroke)");

  const ticks = [max, (max + min) / 2, min];
  const stamp = (t: number) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", hour: "numeric", timeZone: "America/New_York",
    }).format(new Date(t));

  return (
    <figure className="mt-4 first:mt-0">
      <figcaption className="label">{label}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 h-auto w-full" role="img"
           aria-label={`${label} by capture, every book`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)}
                  stroke="rgba(232,228,216,0.10)" strokeWidth="1" />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" className="tabular"
                  fontSize="10" fill="rgba(125,131,128,0.95)">
              {format(t)}
            </text>
          </g>
        ))}

        {/* Every other book first, so the reference book draws on top of them. */}
        {series.filter((s) => s.book !== REFERENCE).map((s) => (
          <path key={s.book} d={path(s.points)} fill="none" stroke="rgba(232,228,216,0.22)"
                strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
                filter={chalk(s.points)} />
        ))}
        {series.filter((s) => s.book === REFERENCE).map((s) => (
          <g key={s.book}>
            <path d={path(s.points)} fill="none" stroke="#e9c46a" strokeWidth="2.4"
                  strokeLinecap="round" strokeLinejoin="round" filter={chalk(s.points)} />
            {s.points.length === 1 ? (
              <circle cx={x(s.points[0].t)} cy={y(s.points[0].v)} r="3.2" fill="#e9c46a" />
            ) : null}
          </g>
        ))}

        <text x={PAD.left} y={H - 5} fontSize="10" className="tabular" fill="rgba(125,131,128,0.95)">
          {stamp(t0)}
        </text>
        <text x={W - PAD.right} y={H - 5} textAnchor="end" fontSize="10" className="tabular"
              fill="rgba(125,131,128,0.95)">
          {stamp(t1)}
        </text>
      </svg>
    </figure>
  );
}

/** A padded domain that never collapses to a line when nothing has moved. */
function domainOf(values: number[], minSpan: number): [number, number] {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const mid = (lo + hi) / 2;
  const half = Math.max((hi - lo) / 2, minSpan / 2);
  return [Number((mid - half * 1.3).toFixed(2)), Number((mid + half * 1.3).toFixed(2))];
}

export default function LineHistory({ history, home, away }: {
  history: Game["history"];
  home: string | null;
  away: string | null;
}) {
  const byBook = new Map<string, { book: string; spread: Point[]; total: Point[] }>();
  for (const h of history) {
    if (!byBook.has(h.book)) byBook.set(h.book, { book: h.book, spread: [], total: [] });
    const entry = byBook.get(h.book)!;
    const t = Date.parse(h.capturedAt);
    if (!Number.isFinite(t)) continue;
    if (h.spreadHome != null) entry.spread.push({ t, v: h.spreadHome });
    if (h.total != null) entry.total.push({ t, v: h.total });
  }
  const series = [...byBook.values()];
  const spreads = series.flatMap((s) => s.spread.map((p) => p.v));
  const totals = series.flatMap((s) => s.total.map((p) => p.v));

  if (spreads.length === 0 && totals.length === 0) {
    return <p className="mt-3 text-sm text-chalk-faint">No line history captured for this game.</p>;
  }

  return (
    <>
      {spreads.length
        ? chart(
            series.map((s) => ({ book: s.book, points: s.spread })),
            `Spread, from ${home ?? "home"}'s side`,
            domainOf(spreads, 2),
            (v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1)),
          )
        : null}
      {totals.length
        ? chart(
            series.map((s) => ({ book: s.book, points: s.total })),
            "Total",
            domainOf(totals, 2),
            (v) => v.toFixed(1),
          )
        : null}
      <p className="label mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5" style={{ background: "#e9c46a" }} />
          draftkings
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5" style={{ background: "rgba(232,228,216,0.22)" }} />
          {series.length - (byBook.has(REFERENCE) ? 1 : 0)} other book
          {series.length - (byBook.has(REFERENCE) ? 1 : 0) === 1 ? "" : "s"}
        </span>
        <span className="normal-case tracking-normal">
          a spread below zero has {home ?? "the home side"} favoured, above it {away ?? "the away side"}
        </span>
      </p>
    </>
  );
}
