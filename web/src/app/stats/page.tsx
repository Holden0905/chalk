import StatsTable from "@/components/StatsTable";
import { getStats } from "@/lib/teamData";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stats · Chalk" };

export default async function StatsPage() {
  const { season, rows } = await getStats();
  const played = rows.filter((r) => r.games > 0).length;
  const maxGames = rows.reduce((a, r) => Math.max(a, r.games), 0);

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="chalk text-4xl leading-none font-bold sm:text-5xl">Stats</h1>
        <span className="label text-right">{season} season to date</span>
      </div>

      <p className="mt-3 max-w-prose text-sm text-chalk-soft">
        Season aggregates from the play by play. Tap any heading to sort.
        Teams with no games sort to the bottom whichever way you sort.
      </p>

      <StatsTable rows={rows} />

      <p className="mt-5 text-xs leading-relaxed text-chalk-faint">
        GP is games played, and it is the first thing to read: {played} of 32
        teams have played, at most {maxGames} game{maxGames === 1 ? "" : "s"}
        {" "}each. Everything here is small sample until week 3 or 4.
        Success rate and EPA per play are weighted by snaps. The pass and rush
        splits are a plain average of the per game rates, because the snap
        counts behind each split are not stored. Start y100 is the average
        distance to the opponent end zone at drive start, so lower is better.
      </p>
    </>
  );
}
