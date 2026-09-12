"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { StatsRow } from "@/lib/teamData";
import { NFLVERSE_TO_ODDS, nickname } from "@/lib/teams";

type Col = {
  key: string;
  label: string;
  get: (r: StatsRow) => number | null;
  fmt: (v: number | null) => string;
  /** Which direction is "good", used to pick the first sort direction. */
  best: "high" | "low";
};

const pct = (v: number | null) => (v == null ? "–" : `${(v * 100).toFixed(1)}%`);
const num = (d: number) => (v: number | null) =>
  v == null ? "–" : `${v > 0 && d > 0 ? "+" : ""}${v.toFixed(d)}`;
const whole = (v: number | null) => (v == null ? "–" : String(Math.round(v)));

const OFFENCE: Col[] = [
  { key: "pf", label: "PF", get: (r) => r.off.points, fmt: whole, best: "high" },
  { key: "pfg", label: "PF/g", get: (r) => r.off.pointsPerGame, fmt: num(1), best: "high" },
  { key: "sr", label: "Succ%", get: (r) => r.off.successRate, fmt: pct, best: "high" },
  { key: "epa", label: "EPA/play", get: (r) => r.off.epaPerPlay, fmt: num(3), best: "high" },
  { key: "psr", label: "Pass Succ%", get: (r) => r.off.passSuccessRate, fmt: pct, best: "high" },
  { key: "pepa", label: "Pass EPA", get: (r) => r.off.passEpaPerPlay, fmt: num(3), best: "high" },
  { key: "rsr", label: "Rush Succ%", get: (r) => r.off.rushSuccessRate, fmt: pct, best: "high" },
  { key: "repa", label: "Rush EPA", get: (r) => r.off.rushEpaPerPlay, fmt: num(3), best: "high" },
  { key: "ppt", label: "Pts/trip", get: (r) => r.off.pointsPerTrip, fmt: num(2), best: "high" },
  { key: "to", label: "Giveaways/g", get: (r) => r.off.turnoversPerGame, fmt: num(2), best: "low" },
  { key: "fp", label: "Start y100", get: (r) => r.off.avgStartYardline, fmt: num(1), best: "low" },
];

const DEFENCE: Col[] = [
  { key: "pa", label: "PA", get: (r) => r.def.points, fmt: whole, best: "low" },
  { key: "pag", label: "PA/g", get: (r) => r.def.pointsPerGame, fmt: num(1), best: "low" },
  { key: "sr", label: "Succ%", get: (r) => r.def.successRate, fmt: pct, best: "low" },
  { key: "epa", label: "EPA/play", get: (r) => r.def.epaPerPlay, fmt: num(3), best: "low" },
  { key: "psr", label: "Pass Succ%", get: (r) => r.def.passSuccessRate, fmt: pct, best: "low" },
  { key: "pepa", label: "Pass EPA", get: (r) => r.def.passEpaPerPlay, fmt: num(3), best: "low" },
  { key: "rsr", label: "Rush Succ%", get: (r) => r.def.rushSuccessRate, fmt: pct, best: "low" },
  { key: "repa", label: "Rush EPA", get: (r) => r.def.rushEpaPerPlay, fmt: num(3), best: "low" },
  { key: "ppt", label: "Pts/trip", get: (r) => r.def.pointsPerTrip, fmt: num(2), best: "low" },
  { key: "to", label: "Takeaways/g", get: (r) => r.def.turnoversPerGame, fmt: num(2), best: "high" },
  { key: "rtd", label: "Rush TD/g", get: (r) => r.rushTdAllowedPg, fmt: num(2), best: "low" },
  { key: "ptd", label: "Pass TD/g", get: (r) => r.passTdAllowedPg, fmt: num(2), best: "low" },
];

export default function StatsTable({ rows }: { rows: StatsRow[] }) {
  const [side, setSide] = useState<"off" | "def">("off");
  const [sortKey, setSortKey] = useState<string>("team");
  const [desc, setDesc] = useState(false);

  const cols = side === "off" ? OFFENCE : DEFENCE;

  const sorted = useMemo(() => {
    const out = [...rows];
    if (sortKey === "team") {
      out.sort((a, b) => (desc ? b.abbr.localeCompare(a.abbr) : a.abbr.localeCompare(b.abbr)));
      return out;
    }
    if (sortKey === "gp") {
      out.sort((a, b) => (desc ? b.games - a.games : a.games - b.games));
      return out;
    }
    const col = cols.find((c) => c.key === sortKey);
    if (!col) return out;
    out.sort((a, b) => {
      const x = col.get(a);
      const y = col.get(b);
      // Teams with no data always sit at the bottom, whichever way it is sorted.
      if (x == null && y == null) return a.abbr.localeCompare(b.abbr);
      if (x == null) return 1;
      if (y == null) return -1;
      return desc ? y - x : x - y;
    });
    return out;
  }, [rows, cols, sortKey, desc]);

  const clickSort = (key: string, best: "high" | "low" | null) => {
    if (sortKey === key) {
      setDesc((d) => !d);
      return;
    }
    setSortKey(key);
    setDesc(best === "high");
  };

  const arrow = (key: string) => (sortKey !== key ? "" : desc ? " ▾" : " ▴");

  const headCell = (key: string, label: string, best: "high" | "low" | null, extra = "") => (
    <th
      key={key}
      scope="col"
      aria-sort={sortKey === key ? (desc ? "descending" : "ascending") : "none"}
      className={`whitespace-nowrap p-0 text-right font-medium ${extra}`}
    >
      <button
        type="button"
        onClick={() => clickSort(key, best)}
        className={`label w-full px-2.5 py-2.5 text-right ${sortKey === key ? "text-butter" : ""}`}
      >
        {label}
        {arrow(key)}
      </button>
    </th>
  );

  return (
    <>
      <div className="mt-5 flex items-center gap-1">
        {(["off", "def"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => { setSide(s); setSortKey("team"); setDesc(false); }}
            aria-current={side === s ? "page" : undefined}
            className="chalk nav-link px-3 pb-2 pt-1.5 text-xl leading-none"
          >
            {s === "off" ? "Offence" : "Defence"}
          </button>
        ))}
      </div>

      <div className="board-card mt-3 overflow-hidden">
        <div className="slip overflow-x-auto border-t-0">
          <table className="tabular w-full text-[0.8125rem]">
            <thead>
              <tr>
                <th
                  scope="col"
                  aria-sort={sortKey === "team" ? (desc ? "descending" : "ascending") : "none"}
                  className="sticky left-0 z-10 bg-panel p-0 text-left font-medium"
                >
                  <button type="button" onClick={() => clickSort("team", null)}
                    className={`label w-full px-3 py-2.5 text-left ${sortKey === "team" ? "text-butter" : ""}`}>
                    Team{arrow("team")}
                  </button>
                </th>
                {headCell("gp", "GP", null)}
                {cols.map((c) => headCell(c.key, c.label, c.best))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr key={row.abbr} className="border-t border-panel-rule hover:bg-white/[0.03]">
                  <th scope="row" className="sticky left-0 z-10 bg-panel p-0 text-left font-normal">
                    <Link href={`/team/${row.abbr}`} className="block px-3 py-2.5">
                      <span className="chalk text-[1rem] leading-none">
                        {nickname(NFLVERSE_TO_ODDS[row.abbr] ?? row.abbr)}
                      </span>
                      <span className="ml-1.5 text-[0.625rem] text-chalk-faint">{row.abbr}</span>
                    </Link>
                  </th>
                  <td className={`px-2.5 py-2.5 text-right ${row.games ? "text-chalk-soft" : "text-chalk-faint"}`}>
                    {row.games}
                  </td>
                  {cols.map((c) => {
                    const v = c.get(row);
                    return (
                      <td key={c.key} className={`whitespace-nowrap px-2.5 py-2.5 text-right ${v == null ? "text-chalk-faint" : "text-chalk"}`}>
                        {c.fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
