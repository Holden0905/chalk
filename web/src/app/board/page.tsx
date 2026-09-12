import GameCard from "@/components/GameCard";
import { getBoard, type BoardGame } from "@/lib/board";
import { kickoffDay } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "Board · Chalk" };

export default async function BoardPage() {
  const board = await getBoard();

  const days = new Map<string, BoardGame[]>();
  for (const game of board.games) {
    const key = kickoffDay(game.commenceTime);
    if (!days.has(key)) days.set(key, []);
    days.get(key)!.push(game);
  }

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="chalk d-title font-bold">The Board</h1>
        <span className="label text-right">
          {board.ratingWeek != null ? `ratings as of wk ${board.ratingWeek}` : "no ratings yet"}
        </span>
      </div>

      <p className="mt-3 max-w-prose text-sm text-chalk-soft">
        Market line from the latest DraftKings snapshot, with the move since the
        first one. <span className="chalk-accent">Chalk</span> is our own number
        from the stored ratings. Where they disagree is the only interesting
        part.
      </p>

      {board.games.length === 0 ? (
        <div className="panel mt-8 px-4 py-8 text-center">
          <p className="chalk d-section">Nothing on the board</p>
          <p className="mt-2 text-sm text-chalk-soft">
            No games in this week&rsquo;s window. Run the snapshot job.
          </p>
        </div>
      ) : (
        <div className="mt-7 space-y-8">
          {[...days.entries()].map(([day, games]) => (
            <section key={day}>
              <h2 className="chalk d-day font-bold text-chalk-soft">{day}</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {games.map((game) => (
                  <GameCard key={game.gameId} game={game} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="mt-10 text-xs leading-relaxed text-chalk-faint">
        {board.games.length} game{board.games.length === 1 ? "" : "s"} this week.
        Chalk spread uses a {board.homeField} point home field allowance. Chalk
        total scales the team adjustment by {board.totalScale}. Both come from
        weights.json.
      </p>
    </>
  );
}
