import type { TrendPoint } from "@/lib/teamData";

type Props = {
  current: TrendPoint[];
  prior: TrendPoint[];
  priorSeason: number;
  season: number;
};

const W = 640;
const H = 220;
const PAD = { top: 16, right: 14, bottom: 26, left: 34 };

export default function RatingTrend({ current, prior, priorSeason, season }: Props) {
  const all = [...current, ...prior];
  if (all.length === 0) {
    return (
      <p className="text-sm text-chalk-faint">No ratings stored for either season yet.</p>
    );
  }

  const weeks = all.map((p) => p.week);
  const ratings = all.map((p) => p.rating);
  const minW = Math.min(...weeks);
  const maxW = Math.max(...weeks, minW + 1);
  // A little headroom, and always straddle zero so the midline means something.
  const bound = Math.max(6, Math.ceil(Math.max(...ratings.map(Math.abs)) + 1));

  const x = (w: number) =>
    PAD.left + ((w - minW) / (maxW - minW)) * (W - PAD.left - PAD.right);
  const y = (r: number) =>
    PAD.top + ((bound - r) / (2 * bound)) * (H - PAD.top - PAD.bottom);

  const path = (pts: TrendPoint[]) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.week).toFixed(1)} ${y(p.rating).toFixed(1)}`).join(" ");

  const zero = y(0);
  const ticks = [bound, bound / 2, 0, -bound / 2, -bound].map((v) => Math.round(v * 10) / 10);

  return (
    <figure className="mt-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Team rating by week for ${season}, with ${priorSeason} behind it`}
        preserveAspectRatio="none"
      >
        {/* midline at zero, the league average */}
        <line
          x1={PAD.left} x2={W - PAD.right} y1={zero} y2={zero}
          stroke="rgba(232,228,216,0.28)" strokeWidth="1" strokeDasharray="4 5"
        />
        {ticks.map((t) => (
          <text
            key={t}
            x={PAD.left - 6}
            y={y(t) + 3}
            textAnchor="end"
            className="tabular"
            fontSize="9"
            fill="rgba(125,131,128,0.95)"
          >
            {t > 0 ? `+${t}` : t}
          </text>
        ))}

        {/* prior season, faint, behind */}
        {prior.length > 1 ? (
          <path
            d={path(prior)}
            fill="none"
            stroke="rgba(232,228,216,0.22)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#chalk-stroke)"
          />
        ) : null}

        {/* current season */}
        {current.length > 1 ? (
          <path
            d={path(current)}
            fill="none"
            stroke="#e9c46a"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#chalk-stroke)"
          />
        ) : null}
        {current.map((p) => (
          <circle key={p.week} cx={x(p.week)} cy={y(p.rating)} r="3.4" fill="#e9c46a" />
        ))}

        {/* week labels at the ends */}
        <text x={PAD.left} y={H - 8} fontSize="9" className="tabular" fill="rgba(125,131,128,0.95)">
          wk {minW}
        </text>
        <text x={W - PAD.right} y={H - 8} fontSize="9" textAnchor="end" className="tabular" fill="rgba(125,131,128,0.95)">
          wk {maxW}
        </text>
      </svg>
      <figcaption className="label mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5" style={{ background: "#e9c46a" }} />
          {season}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5" style={{ background: "rgba(232,228,216,0.22)" }} />
          {priorSeason}
        </span>
        {current.length === 1 ? <span>one week stored, so no line yet</span> : null}
      </figcaption>
    </figure>
  );
}
