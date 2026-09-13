import type { WeekSeries } from "@/lib/leagueData";

const W = 600;
const H = 190;
const PAD = { top: 14, right: 10, bottom: 24, left: 34 };
const FIRST = 1;
const LAST = 18;

export type ChartSpec = {
  /** Which figure to plot off each week point. */
  field: "total" | "over";
  title: string;
  /** Drawn as a reference line when the metric has a natural centre. */
  midline?: number;
  /** Hard limits the axis may not pad past, e.g. [0, 100] for a percentage. */
  bounds?: [number, number];
};

/**
 * Weeks across the bottom, one line per selected season, with All behind them
 * as the faint baseline. Drawn through the chalk-stroke filter so the lines
 * wander the way a stick of chalk does rather than reading as vector output.
 */
export default function WeekChart({
  series,
  spec,
  colors,
}: {
  series: WeekSeries[];
  spec: ChartSpec;
  colors: Record<string, string>;
}) {
  const seasons = series.filter((s) => s.key !== "all");
  const all = series.find((s) => s.key === "all");

  const values = series.flatMap((s) =>
    s.points.map((p) => p[spec.field]).filter((v): v is number => v != null),
  );
  if (values.length === 0) {
    return <p className="mt-3 text-sm text-chalk-faint">Nothing played yet.</p>;
  }

  // A little air above and below, and never a band so tight that a one-point
  // wobble looks like a trend.
  const lo = Math.min(...values, spec.midline ?? Infinity);
  const hi = Math.max(...values, spec.midline ?? -Infinity);
  const pad = Math.max((hi - lo) * 0.15, 2);
  const [floorAt, ceilAt] = spec.bounds ?? [-Infinity, Infinity];
  const min = Math.max(floorAt, Math.floor(lo - pad));
  const max = Math.min(ceilAt, Math.ceil(hi + pad));

  const x = (week: number) =>
    PAD.left + ((week - FIRST) / (LAST - FIRST)) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + ((max - v) / (max - min || 1)) * (H - PAD.top - PAD.bottom);

  const points = (s: WeekSeries) =>
    s.points
      .map((p) => ({ week: p.week, v: p[spec.field] }))
      .filter((p): p is { week: number; v: number } => p.v != null);

  // A gap where a week has no games should break the line, not bridge it.
  const path = (pts: { week: number; v: number }[]) => {
    let d = "";
    let prev: number | null = null;
    for (const p of pts) {
      d += `${prev != null && p.week === prev + 1 ? "L" : "M"} ${x(p.week).toFixed(1)} ${y(p.v).toFixed(1)} `;
      prev = p.week;
    }
    return d.trim();
  };

  const ticks = [max, (max + min) / 2, min].map((v) => Math.round(v * 10) / 10);
  const weekLabels = [1, 4, 7, 10, 13, 16, 18];

  return (
    <figure className="mt-4">
      <figcaption className="label">{spec.title}</figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 h-auto w-full"
        role="img"
        aria-label={`${spec.title} by week, weeks 1 to 18`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)}
              stroke="rgba(232,228,216,0.10)" strokeWidth="1"
            />
            <text
              x={PAD.left - 6} y={y(t) + 3} textAnchor="end"
              className="tabular" fontSize="10" fill="rgba(125,131,128,0.95)"
            >
              {t}
            </text>
          </g>
        ))}

        {spec.midline != null ? (
          <line
            x1={PAD.left} x2={W - PAD.right} y1={y(spec.midline)} y2={y(spec.midline)}
            stroke="rgba(232,228,216,0.30)" strokeWidth="1" strokeDasharray="4 5"
          />
        ) : null}

        {/* All seasons, faint and behind: the baseline everything is read against. */}
        {all ? (
          <path
            d={path(points(all))}
            fill="none"
            stroke="rgba(232,228,216,0.20)"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#chalk-stroke)"
          />
        ) : null}

        {seasons.map((s) => {
          const pts = points(s);
          const stroke = colors[s.key] ?? "#e8e4d8";
          return (
            <g key={s.key}>
              <path
                d={path(pts)}
                fill="none"
                stroke={stroke}
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                filter="url(#chalk-stroke)"
              />
              {/* A season with one week played has no line, so it needs the dot. */}
              {pts.map((p) => (
                <circle key={p.week} cx={x(p.week)} cy={y(p.v)} r={pts.length === 1 ? 3.4 : 2} fill={stroke} />
              ))}
            </g>
          );
        })}

        {weekLabels.map((w) => (
          <text
            key={w} x={x(w)} y={H - 7} textAnchor="middle"
            className="tabular" fontSize="10" fill="rgba(125,131,128,0.95)"
          >
            {w}
          </text>
        ))}
      </svg>
    </figure>
  );
}
