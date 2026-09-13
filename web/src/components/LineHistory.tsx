"use client";

import { useState } from "react";
import type { Game } from "@/lib/gameData";

const W = 600;
const H = 168;
const PAD = { top: 12, right: 10, bottom: 34, left: 38 };

// The book everything else in Chalk is measured against. It is drawn in butter;
// every other book is the faint cloud it sits inside.
const REFERENCE = "draftkings";

type Point = { t: number; v: number };

/**
 * One dot on the chart. Books agreeing on a number land on the same pixel, so
 * they are folded into a single marker rather than stacked invisibly on top of
 * each other -- otherwise hovering the pile would name whichever book happened
 * to render last and hide the other eight.
 */
type Marker = { t: number; v: number; books: string[] };

const stamp = (t: number) =>
  new Intl.DateTimeFormat("en-US", {
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
  }).format(new Date(t));

const axisStamp = (t: number) =>
  new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", hour: "numeric", timeZone: "America/New_York",
  }).format(new Date(t));

/** Which books sit on a marker, named without running off the line. */
function describeBooks(books: string[]) {
  const ordered = [...books].sort((a, b) =>
    a === REFERENCE ? -1 : b === REFERENCE ? 1 : a.localeCompare(b));
  if (ordered.length === 1) return ordered[0];
  if (ordered.length === 2) return `${ordered[0]} and ${ordered[1]}`;
  return `${ordered[0]} +${ordered.length - 1} more`;
}

function StepChart({
  label, series, domain, format, captureTimes,
}: {
  label: string;
  series: { book: string; points: Point[] }[];
  domain: [number, number];
  format: (v: number) => string;
  captureTimes: number[];
}) {
  const [picked, setPicked] = useState<Marker | null>(null);

  const all = series.flatMap((s) => s.points);
  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  const [min, max] = domain;

  const x = (t: number) =>
    PAD.left + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - PAD.left - PAD.right);
  const y = (v: number) =>
    PAD.top + ((max - v) / (max - min || 1)) * (H - PAD.top - PAD.bottom);

  /**
   * A step, not a curve. A book's number is what it is from the capture that set
   * it until the capture that changes it, so the line holds flat and then jumps.
   * Sloping between two captures would draw a move that never happened, at times
   * nobody could have bet.
   */
  const stepPath = (points: Point[]) => {
    if (points.length === 0) return "";
    let d = `M ${x(points[0].t).toFixed(1)} ${y(points[0].v).toFixed(1)}`;
    for (let i = 1; i < points.length; i += 1) {
      d += ` H ${x(points[i].t).toFixed(1)} V ${y(points[i].v).toFixed(1)}`;
    }
    return d;
  };

  // An SVG filter region is a percentage of the object bounding box, and a line
  // that never moves has a box zero pixels tall, which the chalk filter scales
  // to nothing. A book that has not moved is drawn clean instead.
  const flat = (points: Point[]) => points.every((p) => p.v === points[0].v);
  const chalk = (points: Point[]) => (flat(points) ? undefined : "url(#chalk-stroke)");

  // Fold every book's points onto shared positions.
  const markers = new Map<string, Marker>();
  for (const s of series) {
    for (const p of s.points) {
      const key = `${p.t}|${p.v}`;
      if (!markers.has(key)) markers.set(key, { t: p.t, v: p.v, books: [] });
      markers.get(key)!.books.push(s.book);
    }
  }
  const dots = [...markers.values()];
  const isRef = (m: Marker) => m.books.includes(REFERENCE);
  const same = (a: Marker | null, b: Marker) => !!a && a.t === b.t && a.v === b.v;

  const ticks = [max, (max + min) / 2, min];
  const axisY = H - PAD.bottom;

  return (
    <figure className="mt-5 first:mt-0">
      <figcaption className="label">{label}</figcaption>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 h-auto w-full touch-manipulation"
        role="img"
        aria-label={
          `${label}: ${series.length} book${series.length === 1 ? "" : "s"} over ` +
          `${captureTimes.length} capture${captureTimes.length === 1 ? "" : "s"}, drawn as step lines. ` +
          `The capture table below the chart carries the same figures as text.`
        }
        onMouseLeave={() => setPicked(null)}
      >
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

        {/* One tick per capture, so the gaps in the schedule are visible: the
            overnight stretch with no capture is as much a fact as a move is. */}
        <line x1={PAD.left} x2={W - PAD.right} y1={axisY} y2={axisY}
              stroke="rgba(232,228,216,0.18)" strokeWidth="1" />
        {captureTimes.map((t) => (
          // Lit by the capture that is picked, whatever number was picked at it.
          <line key={t} x1={x(t)} x2={x(t)} y1={axisY} y2={axisY + 4}
                stroke={picked?.t === t ? "#e9c46a" : "rgba(232,228,216,0.45)"}
                strokeWidth={picked?.t === t ? 1.6 : 1} />
        ))}

        {/* Every other book first, so the reference book draws on top of them. */}
        {series.filter((s) => s.book !== REFERENCE).map((s) => (
          <path key={s.book} d={stepPath(s.points)} fill="none" stroke="rgba(232,228,216,0.22)"
                strokeWidth="1.6" strokeLinecap="butt" strokeLinejoin="miter"
                filter={chalk(s.points)} />
        ))}
        {series.filter((s) => s.book === REFERENCE).map((s) => (
          <path key={s.book} d={stepPath(s.points)} fill="none" stroke="#e9c46a"
                strokeWidth="2.4" strokeLinecap="butt" strokeLinejoin="miter"
                filter={chalk(s.points)} />
        ))}

        {dots.map((m) => (
          <circle key={`${m.t}|${m.v}`} cx={x(m.t)} cy={y(m.v)}
                  r={same(picked, m) ? 4 : isRef(m) ? 2.6 : 1.6}
                  fill={isRef(m) ? "#e9c46a" : "rgba(232,228,216,0.5)"} />
        ))}

        {/* Invisible and generous: a 1.6px dot is not a tap target on a phone. */}
        {dots.map((m) => (
          <circle
            key={`hit-${m.t}|${m.v}`}
            cx={x(m.t)} cy={y(m.v)} r="9"
            fill="transparent"
            style={{ cursor: "pointer" }}
            onPointerEnter={() => setPicked(m)}
            onPointerDown={() => setPicked(m)}
          >
            <title>{`${stamp(m.t)} · ${describeBooks(m.books)} · ${format(m.v)}`}</title>
          </circle>
        ))}

        <text x={PAD.left} y={H - 6} fontSize="10" className="tabular" fill="rgba(125,131,128,0.95)">
          {axisStamp(t0)}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" fontSize="10" className="tabular"
              fill="rgba(125,131,128,0.95)">
          {axisStamp(t1)}
        </text>
      </svg>

      {/*
        Below the chart, with its height reserved, and both parts matter. Above
        it, a readout that wraps to a second line on a narrow screen moves the
        chart down while the pointer is still over it, which lands the pointer on
        a different point, which rewrites the readout: it oscillates and never
        settles. Below, a change in height pushes the rest of the page down and
        leaves the thing being pointed at exactly where it was.
      */}
      <p className="tabular mt-1 min-h-[2rem] text-[0.6875rem] leading-4 text-chalk">
        {picked ? (
          <>
            {stamp(picked.t)}
            <span className="mx-1.5 text-chalk-faint">·</span>
            {describeBooks(picked.books)}
            <span className="mx-1.5 text-chalk-faint">·</span>
            <span className="chalk-accent font-bold">{format(picked.v)}</span>
          </>
        ) : (
          <span className="text-chalk-faint">tap or hover a point for its book and time</span>
        )}
      </p>
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
  const captureTimes = new Set<number>();
  for (const h of history) {
    const t = Date.parse(h.capturedAt);
    if (!Number.isFinite(t)) continue;
    captureTimes.add(t);
    if (!byBook.has(h.book)) byBook.set(h.book, { book: h.book, spread: [], total: [] });
    const entry = byBook.get(h.book)!;
    if (h.spreadHome != null) entry.spread.push({ t, v: h.spreadHome });
    if (h.total != null) entry.total.push({ t, v: h.total });
  }
  // A step line only means anything in order.
  for (const e of byBook.values()) {
    e.spread.sort((a, b) => a.t - b.t);
    e.total.sort((a, b) => a.t - b.t);
  }

  const series = [...byBook.values()];
  const times = [...captureTimes].sort((a, b) => a - b);
  const spreads = series.flatMap((s) => s.spread.map((p) => p.v));
  const totals = series.flatMap((s) => s.total.map((p) => p.v));
  const others = series.length - (byBook.has(REFERENCE) ? 1 : 0);

  if (spreads.length === 0 && totals.length === 0) {
    return <p className="mt-3 text-sm text-chalk-faint">No line history captured for this game.</p>;
  }

  return (
    <>
      {spreads.length ? (
        <StepChart
          label={`Spread, from ${home ?? "home"}'s side`}
          series={series.map((s) => ({ book: s.book, points: s.spread }))}
          domain={domainOf(spreads, 2)}
          format={(v) => (v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1))}
          captureTimes={times}
        />
      ) : null}
      {totals.length ? (
        <StepChart
          label="Total"
          series={series.map((s) => ({ book: s.book, points: s.total }))}
          domain={domainOf(totals, 2)}
          format={(v) => v.toFixed(1)}
          captureTimes={times}
        />
      ) : null}

      <p className="label mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5" style={{ background: "#e9c46a" }} />
          draftkings
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5" style={{ background: "rgba(232,228,216,0.22)" }} />
          {others} other book{others === 1 ? "" : "s"}
        </span>
        <span className="normal-case tracking-normal">
          {times.length} capture{times.length === 1 ? "" : "s"}, ticked along the axis
        </span>
        <span className="normal-case tracking-normal">
          a spread below zero has {home ?? "the home side"} favoured, above it {away ?? "the away side"}
        </span>
      </p>
    </>
  );
}
