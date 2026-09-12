import StatsTable from "@/components/StatsTable";
import SeasonToggle from "@/components/SeasonToggle";
import { getStats, seasonChoices } from "@/lib/teamData";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stats · Chalk" };

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const choices = seasonChoices();
  const asked = Number((await searchParams).season);
  const wanted = choices.includes(asked) ? asked : choices[0];
  const { season, rows } = await getStats(wanted);
  const played = rows.filter((r) => r.games > 0).length;
  const maxGames = rows.reduce((a, r) => Math.max(a, r.games), 0);

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="chalk d-title font-bold">Stats</h1>
        <span className="label text-right">
          {season === choices[0] ? "season to date" : "full season"}
        </span>
      </div>

      <SeasonToggle path="/stats" seasons={choices} active={season} />

      <p className="mt-4 max-w-prose text-sm text-chalk-soft">
        Season aggregates from the play by play. Tap any heading to sort.
        Teams with no games sort to the bottom whichever way you sort.
      </p>

      <StatsTable rows={rows} />

      <p className="mt-5 text-xs leading-relaxed text-chalk-faint">
        GP is games played, and it is the first thing to read: {played} of 32
        teams have played, at most {maxGames} game{maxGames === 1 ? "" : "s"}
        {" "}each.{" "}
        {maxGames > 0 && maxGames < 5
          ? "Everything here is small sample until week 3 or 4."
          : ""}
        Success rate and EPA per play are weighted by snaps. The pass and rush
        splits are a plain average of the per game rates, because the snap
        counts behind each split are not stored. Start y100 is the average
        distance to the opponent end zone at drive start, so lower is better.
      </p>
    </>
  );
}
