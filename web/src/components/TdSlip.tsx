import FitText from "@/components/FitText";
import { NFLVERSE_TO_ODDS, nickname } from "@/lib/teams";

type Player = {
  playerId: string; name: string; pos: string; vs: string;
  seasonRushTd: number; seasonRecTd: number; l4RushTd: number; l4RecTd: number;
  glPg: number; rzPg: number; touchesPg: number;
  price: number | null; book: string | null;
};

type Defence = {
  rushTdPg: number | null; passTdPg: number | null; rzRate: number | null;
  rzTd: number; rzTrips: number; rushRank: number | null; passRank: number | null;
} | null;

const f = (v: number | null | undefined, d = 2) =>
  v == null || !Number.isFinite(v) ? "–" : v.toFixed(d);
const price = (v: number | null) => (v == null ? "–" : v > 0 ? `+${v}` : `${v}`);
const full = (abbr: string) => nickname(NFLVERSE_TO_ODDS[abbr] ?? abbr);

export default function TdSlip({
  team, opponent, defence, players,
}: {
  team: string; opponent: string; defence: Defence; players: Player[];
}) {
  return (
    <section className="mt-4 first:mt-0">
      <h3>
        <FitText className="chalk d-team-row">
          {full(team)} <span className="text-chalk-faint">vs</span> {full(opponent)}{" "}
          <span className="text-chalk-faint">defense</span>
        </FitText>
      </h3>
      <p className="label mt-1 normal-case tracking-normal text-[0.6875rem]">
        <span className="tabular">{f(defence?.rushTdPg)}</span> rush TD/g
        <span className="text-chalk-faint"> (rank {defence?.rushRank ?? "–"})</span>
        <span className="mx-1.5 text-chalk-faint">·</span>
        <span className="tabular">{f(defence?.passTdPg)}</span> pass TD/g
        <span className="text-chalk-faint"> (rank {defence?.passRank ?? "–"})</span>
        <span className="mx-1.5 text-chalk-faint">·</span>
        RZ TD rate <span className="tabular">{f(defence?.rzRate)}</span>
        <span className="text-chalk-faint"> ({defence?.rzTd ?? 0}/{defence?.rzTrips ?? 0})</span>
      </p>

      {players.length === 0 ? (
        <p className="slip mt-2 px-3 py-3 text-sm text-chalk-faint">
          No player clears the touch threshold.
        </p>
      ) : (
        // The leftmost columns are the ones worth seeing on a phone: who, what
        // they are, and the goal line and red zone work the sort is built on.
        // Season and last-four touchdowns sit to the right of the fold.
        <div className="slip mt-2 overflow-x-auto">
          <table className="tabular w-full text-[0.8125rem]">
            <thead>
              <tr className="label">
                <th className="sticky left-0 z-10 bg-panel py-2 pl-3 pr-2 text-left font-medium">Player</th>
                <th className="py-2 pr-2 text-left font-medium">Pos</th>
                <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">L4 gl/g</th>
                <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">L4 rz/g</th>
                <th className="py-2 pr-2 text-right font-medium">Price</th>
                <th className="py-2 pr-3 text-left font-medium">Book</th>
                <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">Ru TD</th>
                <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">Re TD</th>
                <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">L4 Ru</th>
                <th className="whitespace-nowrap py-2 pr-3 text-right font-medium">L4 Re</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.playerId} className="border-t border-panel-rule">
                  <th scope="row" className="sticky left-0 z-10 bg-panel py-2 pl-3 pr-2 text-left font-normal text-chalk">
                    {p.name}
                  </th>
                  <td className="py-2 pr-2 text-chalk-soft">{p.pos}</td>
                  <td className="py-2 pr-3 text-right text-chalk">{f(p.glPg)}</td>
                  <td className="py-2 pr-3 text-right text-chalk">{f(p.rzPg)}</td>
                  <td className={`py-2 pr-2 text-right ${p.price == null ? "text-chalk-faint" : "text-chalk"}`}>
                    {price(p.price)}
                  </td>
                  <td className="whitespace-nowrap py-2 pr-3 text-chalk-faint">{p.book ?? "–"}</td>
                  <td className="py-2 pr-3 text-right text-chalk-soft">{p.seasonRushTd}</td>
                  <td className="py-2 pr-3 text-right text-chalk-soft">{p.seasonRecTd}</td>
                  <td className="py-2 pr-3 text-right text-chalk-soft">{p.l4RushTd}</td>
                  <td className="py-2 pr-3 text-right text-chalk-soft">{p.l4RecTd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
