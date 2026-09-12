import Link from "next/link";
import { notFound } from "next/navigation";
import RatingTrend from "@/components/RatingTrend";
import { getTeam } from "@/lib/teamData";
import type { Ranked, SideAgg } from "@/lib/aggregate";
import { NFLVERSE_TO_ODDS, city, nickname } from "@/lib/teams";
import { plain, signed, spread as fmtSpread } from "@/lib/format";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ abbr: string }> }) {
  const { abbr } = await params;
  return { title: `${NFLVERSE_TO_ODDS[abbr.toUpperCase()] ?? abbr} · Chalk` };
}

const pct = (v: number | null) => (v == null ? "–" : `${(v * 100).toFixed(1)}%`);
const rankLabel = (r: Ranked | undefined) =>
  !r || r.rank == null ? "–" : `${r.rank}/${r.of}`;

function StatRow({
  label, offValue, offRank, defValue, defRank,
}: {
  label: string; offValue: string; offRank: string; defValue: string; defRank: string;
}) {
  return (
    <tr className="border-t border-panel-rule">
      <th scope="row" className="label py-2 pl-3 text-left font-medium">{label}</th>
      <td className="py-2 pr-2 text-right text-chalk">{offValue}</td>
      <td className="py-2 pr-3 text-right text-[0.6875rem] text-chalk-faint">{offRank}</td>
      <td className="py-2 pr-2 text-right text-chalk">{defValue}</td>
      <td className="py-2 pr-3 text-right text-[0.6875rem] text-chalk-faint">{defRank}</td>
    </tr>
  );
}

export default async function TeamPage({ params }: { params: Promise<{ abbr: string }> }) {
  const { abbr: raw } = await params;
  const abbr = raw.toUpperCase();
  const team = await getTeam(abbr);
  if (!team) notFound();

  const name = NFLVERSE_TO_ODDS[abbr] ?? abbr;
  const { offAgg, defAgg, ranks } = team;
  const r = (k: string) => rankLabel(ranks[k]);
  const stat = (a: SideAgg, k: keyof SideAgg) => a[k] as number | null;

  return (
    <>
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="label">{city(name)}</p>
          <h1 className="chalk text-4xl leading-none font-bold sm:text-5xl">{nickname(name)}</h1>
        </div>
        <div className="text-right">
          <p className="chalk-accent chalk text-3xl leading-none font-bold sm:text-4xl">
            {signed(team.teamRating, 1)}
          </p>
          <p className="label mt-1">
            {team.rank != null ? `rank ${team.rank} of ${team.of}` : "unrated"}
          </p>
        </div>
      </div>

      {/* trend */}
      <section className="board-card mt-6 px-4 pt-4 pb-3 sm:px-5">
        <h2 className="label">Team rating by week</h2>
        <RatingTrend
          current={team.trend}
          prior={team.priorTrend}
          priorSeason={team.priorSeason}
          season={team.season}
        />
      </section>

      {/* components */}
      <section className="board-card mt-4 overflow-hidden">
        <h2 className="label px-4 pt-4 sm:px-5">Where the rating comes from</h2>
        <div className="slip mt-3 overflow-x-auto">
          <table className="tabular w-full text-[0.8125rem]">
            <tbody>
              {[
                ["Offence", team.offense],
                ["Defence", team.defense],
                ["Special teams", team.st],
                ["Team rating", team.teamRating],
              ].map(([label, value], i, arr) => (
                <tr key={label as string} className={i === arr.length - 1 ? "border-t-2 border-card-edge" : "border-t border-panel-rule first:border-t-0"}>
                  <th scope="row" className="label py-2.5 pl-3 text-left font-medium">{label as string}</th>
                  <td className={`py-2.5 pr-3 text-right ${i === arr.length - 1 ? "chalk-accent font-bold" : "text-chalk"}`}>
                    {signed(value as number | null, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="px-4 pb-3 pt-2 text-xs text-chalk-faint sm:px-5">
          Points of expected margin. Built from {team.gamesUsed ?? 0} game
          {team.gamesUsed === 1 ? "" : "s"} of this season, blended with last
          season early on.
        </p>
      </section>

      {/* game log */}
      <section className="board-card mt-4 overflow-hidden">
        <h2 className="label px-4 pt-4 sm:px-5">Game log</h2>
        {team.log.length === 0 ? (
          <p className="px-4 pb-4 pt-2 text-sm text-chalk-faint sm:px-5">
            No games played yet this season.
          </p>
        ) : (
          <div className="slip mt-3 overflow-x-auto">
            <table className="tabular w-full min-w-[520px] text-[0.8125rem]">
              <thead>
                <tr className="label">
                  <th className="py-2 pl-3 text-left font-medium">Wk</th>
                  <th className="py-2 text-left font-medium">Opp</th>
                  <th className="py-2 pr-3 text-right font-medium">Score</th>
                  <th className="py-2 pr-3 text-right font-medium">Spread</th>
                  <th className="py-2 pr-3 text-right font-medium">ATS</th>
                  <th className="py-2 pr-3 text-right font-medium">Total</th>
                  <th className="py-2 pr-3 text-right font-medium">O/U</th>
                </tr>
              </thead>
              <tbody>
                {team.log.map((g) => {
                  const won = g.pointsFor != null && g.pointsAgainst != null && g.pointsFor > g.pointsAgainst;
                  const tied = g.pointsFor != null && g.pointsFor === g.pointsAgainst;
                  return (
                    <tr key={g.week} className="border-t border-panel-rule">
                      <td className="py-2 pl-3 text-chalk-soft">{g.week}</td>
                      <td className="py-2">
                        <span className="text-chalk-faint">{g.isHome ? "vs" : "@"}</span>{" "}
                        {g.opponent ? (
                          <Link href={`/team/${g.opponent}`} className="text-chalk underline decoration-chalk-faint underline-offset-2">
                            {g.opponent}
                          </Link>
                        ) : "–"}
                      </td>
                      <td className={`py-2 pr-3 text-right ${tied ? "text-chalk-soft" : won ? "text-win" : "text-loss"}`}>
                        {g.pointsFor ?? "–"}&ndash;{g.pointsAgainst ?? "–"}
                      </td>
                      <td className="py-2 pr-3 text-right text-chalk">{g.closingSpread == null ? "–" : fmtSpread(g.closingSpread)}</td>
                      <td className={`py-2 pr-3 text-right ${g.ats === "W" ? "text-win" : g.ats === "L" ? "text-loss" : "text-chalk-faint"}`}>{g.ats ?? "–"}</td>
                      <td className="py-2 pr-3 text-right text-chalk">{plain(g.closingTotal, 1)}</td>
                      <td className="py-2 pr-3 text-right text-chalk-soft">{g.ou ?? "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="px-4 pb-3 pt-2 text-xs leading-relaxed text-chalk-faint sm:px-5">
          Scores come from the play by play. Closing spread, total and the ATS
          and O/U calls come from graded results, so they stay blank until a
          game has been graded.
        </p>
      </section>

      {/* season stats */}
      <section className="board-card mt-4 overflow-hidden">
        <h2 className="label px-4 pt-4 sm:px-5">
          Season stats{offAgg.games ? ` · ${offAgg.games} game${offAgg.games === 1 ? "" : "s"}` : ""}
        </h2>
        {offAgg.games === 0 ? (
          <p className="px-4 pb-4 pt-2 text-sm text-chalk-faint sm:px-5">
            Nothing yet. These fill in once a game is in the play by play.
          </p>
        ) : (
          <>
            <div className="slip mt-3 overflow-x-auto">
              <table className="tabular w-full min-w-[460px] text-[0.8125rem]">
                <thead>
                  <tr className="label">
                    <th className="py-2 pl-3 text-left font-medium">&nbsp;</th>
                    <th colSpan={2} className="py-2 pr-3 text-right font-medium">Offence</th>
                    <th colSpan={2} className="py-2 pr-3 text-right font-medium">Defence</th>
                  </tr>
                </thead>
                <tbody>
                  <StatRow label="Success rate" offValue={pct(stat(offAgg, "successRate"))} offRank={r("off.successRate")} defValue={pct(stat(defAgg, "successRate"))} defRank={r("def.successRate")} />
                  <StatRow label="EPA / play" offValue={signed(stat(offAgg, "epaPerPlay"), 3)} offRank={r("off.epaPerPlay")} defValue={signed(stat(defAgg, "epaPerPlay"), 3)} defRank={r("def.epaPerPlay")} />
                  <StatRow label="Pass success" offValue={pct(stat(offAgg, "passSuccessRate"))} offRank={r("off.passSuccessRate")} defValue={pct(stat(defAgg, "passSuccessRate"))} defRank={r("def.passSuccessRate")} />
                  <StatRow label="Pass EPA / play" offValue={signed(stat(offAgg, "passEpaPerPlay"), 3)} offRank={r("off.passEpaPerPlay")} defValue={signed(stat(defAgg, "passEpaPerPlay"), 3)} defRank={r("def.passEpaPerPlay")} />
                  <StatRow label="Rush success" offValue={pct(stat(offAgg, "rushSuccessRate"))} offRank={r("off.rushSuccessRate")} defValue={pct(stat(defAgg, "rushSuccessRate"))} defRank={r("def.rushSuccessRate")} />
                  <StatRow label="Rush EPA / play" offValue={signed(stat(offAgg, "rushEpaPerPlay"), 3)} offRank={r("off.rushEpaPerPlay")} defValue={signed(stat(defAgg, "rushEpaPerPlay"), 3)} defRank={r("def.rushEpaPerPlay")} />
                  <StatRow label="Pts / trip in 40" offValue={plain(stat(offAgg, "pointsPerTrip"), 2)} offRank={r("off.pointsPerTrip")} defValue={plain(stat(defAgg, "pointsPerTrip"), 2)} defRank={r("def.pointsPerTrip")} />
                  <StatRow label="Turnovers / game" offValue={plain(stat(offAgg, "turnoversPerGame"), 2)} offRank={r("off.turnoversPerGame")} defValue={plain(stat(defAgg, "turnoversPerGame"), 2)} defRank={r("def.turnoversPerGame")} />
                </tbody>
              </table>
            </div>
            <p className="px-4 pb-3 pt-2 text-xs leading-relaxed text-chalk-faint sm:px-5">
              Small numbers beside each value are the league rank out of the
              teams that have played. Offence turnovers are giveaways, defence
              turnovers are takeaways, so first is best in both columns.
            </p>
          </>
        )}
      </section>

      <p className="mt-6 text-sm">
        <Link href="/teams" className="text-chalk-soft underline decoration-chalk-faint underline-offset-4">
          All teams
        </Link>
      </p>
    </>
  );
}
