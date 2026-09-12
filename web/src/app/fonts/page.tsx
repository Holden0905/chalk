import GameCard from "@/components/GameCard";
import type { BoardGame } from "@/lib/board";
import { CANDIDATES } from "@/lib/fonts";

export const metadata = { title: "Fonts · Chalk" };

const NAV = ["Board", "Teams", "Stats", "TDs", "Bets", "About"];

// A real-shaped card so each face is judged on the numbers it will actually
// have to carry, not on a pangram.
const SAMPLE: BoardGame = {
  gameId: "sample",
  commenceTime: "2026-09-13T17:00:00Z",
  home: { abbr: "PIT", name: "Pittsburgh Steelers", rating: -0.1, rank: 14 },
  away: { abbr: "ATL", name: "Atlanta Falcons", rating: -1.3, rank: 19 },
  book: "draftkings",
  spreadHome: -6,
  total: 41.5,
  spreadMove: -0.5,
  totalMove: 1,
  impliedSpreadHome: -3.1,
  impliedTotal: 45.1,
  result: null,
};

function Specimen({ label, cssVar, note }: { label: string; cssVar: string; note: string }) {
  return (
    <section
      className="mt-10 first:mt-4"
      style={{ ["--font-display" as string]: `var(${cssVar})` }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="label text-butter">
          {label}
          {note ? <span className="ml-2 text-chalk-faint">{note}</span> : null}
        </h2>
        <code className="tabular text-[0.6875rem] text-chalk-faint">{cssVar}</code>
      </div>

      <div className="board-card mt-3 px-4 py-4">
        {/* header */}
        <div className="chalk text-[2rem] leading-none font-bold tracking-wide">Chalk</div>

        {/* nav */}
        <nav className="-mx-1 mt-3 overflow-x-auto">
          <ul className="flex min-w-max items-center gap-1 pb-1">
            {NAV.map((item, i) => (
              <li key={item}>
                <span
                  className="chalk nav-link block px-3 pb-2 pt-1.5 text-lg leading-none"
                  aria-current={i === 0 ? "page" : undefined}
                >
                  {item}
                </span>
              </li>
            ))}
          </ul>
        </nav>
        <hr className="chalk-rule mt-1" />

        {/* page title */}
        <h3 className="chalk mt-4 text-4xl leading-none font-bold">The Board</h3>

        {/* mixed case and caps */}
        <p className="chalk mt-4 text-2xl leading-tight">
          Steelers 27, Falcons 21 &mdash; Pittsburgh covered
        </p>
        <p className="chalk mt-1 text-2xl leading-tight uppercase">
          Steelers 27, Falcons 21 &mdash; Pittsburgh covered
        </p>
        <p className="chalk mt-2 text-3xl leading-none">0123456789 &minus;6.5 +190 PK</p>

        {/* a real card */}
        <div className="mt-5">
          <GameCard game={SAMPLE} />
        </div>
      </div>
    </section>
  );
}

export default function FontsPage() {
  return (
    <div className={CANDIDATES.map((c) => c.font.variable).join(" ")}>
      <h1 className="chalk text-4xl leading-none font-bold sm:text-5xl">Display faces</h1>
      <p className="mt-3 max-w-prose text-sm text-chalk-soft">
        The same header, nav, page title and Board card in each candidate, with
        the face in use first to compare against. Courier Prime stays on the
        slips throughout, so only the chalk changes. Pick one and change the
        single line at the top of{" "}
        <code className="tabular text-chalk">src/lib/fonts.ts</code>.
      </p>

      {CANDIDATES.map((c) => (
        <Specimen key={c.key} label={c.label} cssVar={c.cssVar} note={c.note} />
      ))}

      <p className="mt-12 text-xs text-chalk-faint">
        This route is not in the nav. It is behind the same password as
        everything else.
      </p>
    </div>
  );
}
