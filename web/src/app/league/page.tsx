import LeagueSlip from "@/components/LeagueSlip";
import SituationSlip from "@/components/SituationSlip";
import SeasonPicker from "@/components/SeasonPicker";
import WeekChart from "@/components/WeekChart";
import { getLeague, parseSeasons } from "@/lib/leagueData";

export const dynamic = "force-dynamic";
export const metadata = { title: "League · Chalk" };

// Season lines in the order seasons are selected, newest first. Butter is the
// accent the rest of the app reserves for the thing being looked at, so the
// newest season gets it.
const LINE_COLORS = ["#e9c46a", "#e8e4d8", "#9bbf8a", "#c98b7e", "#b9b5a9"];

export default async function LeaguePage({
  searchParams,
}: {
  searchParams: Promise<{ seasons?: string }>;
}) {
  const league = await getLeague(parseSeasons((await searchParams).seasons));
  const { columns, span } = league;

  const colors: Record<string, string> = {};
  columns
    .filter((c) => c.season != null)
    .forEach((c, i) => {
      colors[c.key] = LINE_COLORS[i % LINE_COLORS.length];
    });

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="chalk d-title font-bold">League</h1>
        <span className="label text-right">
          {span.first === span.last ? span.first : `${span.first}–${span.last}`}
          <br />
          regular season
        </span>
      </div>

      <SeasonPicker available={league.available} selected={league.selected} />

      <p className="mt-4 max-w-prose text-sm text-chalk-soft">
        What the league actually did, across {league.total.toLocaleString()} regular
        season games. Tap a season to add or drop its column; All is always there
        as the baseline. Every number carries the games it came off, underneath
        it. There is no rating and no pick on this page.
      </p>

      <LeagueSlip
        title="Scoring"
        blurb="How much gets scored, by whom, and how far apart the teams finish."
        columns={columns}
        rows={league.scoring}
        caption="Average margin is the absolute gap, so it is how far apart the teams finished rather than which way. The three point bands are the combined score: under 40, 40 through 47, and 48 or more. Highest and lowest name the game and the week they came from."
      />

      <LeagueSlip
        title="The market"
        blurb="Where the closing number sat against where the game finished."
        columns={columns}
        rows={league.market}
        caption="Cover, favorite and over rates drop pushes from the denominator; the two push rates keep them, so those three denominators differ. The closing spread is written the way a bettor reads it, so a negative number means the home side was favored. The last row turns that around and puts home field as priced next to home field as played, over the same games, both as a home margin."
      />

      <SituationSlip columns={columns} rows={league.situations} />

      <section className="board-card mt-5 px-4 py-4 sm:px-5">
        <h2 className="chalk d-section font-bold">By week</h2>
        <p className="mt-1 max-w-prose text-sm text-chalk-soft">
          Weeks 1 to 18, with All drawn faint behind the seasons you have on.
        </p>

        <WeekChart
          series={league.weeks}
          colors={colors}
          spec={{ field: "total", title: "Average total points" }}
        />
        <WeekChart
          series={league.weeks}
          colors={colors}
          spec={{ field: "over", title: "Over rate, percent", midline: 50, bounds: [0, 100] }}
        />

        <div className="label mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          {columns
            .filter((c) => c.season != null)
            .map((c) => (
              <span key={c.key} className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-5" style={{ background: colors[c.key] }} />
                {c.label}
              </span>
            ))}
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-5"
              style={{ background: "rgba(232,228,216,0.20)" }}
            />
            All
          </span>
        </div>

        <p className="mt-3 text-xs leading-relaxed text-chalk-faint">
          A week is sixteen games in a season and about eighty across all of
          them, so the All line is the only one of these steady enough to read a
          shape off. Weeks with a bye or two carry fewer games than the rest.
        </p>
      </section>
    </>
  );
}
