import Link from "next/link";
import SeasonToggle from "@/components/SeasonToggle";
import { getTeamsIndex, seasonChoices } from "@/lib/teamData";
import { NFLVERSE_TO_ODDS, nickname } from "@/lib/teams";
import { signed } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Teams · Chalk" };

export default async function TeamsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const choices = seasonChoices();
  const asked = Number((await searchParams).season);
  const wanted = choices.includes(asked) ? asked : choices[0];
  const { teams, ratingWeek, season, gradedGames } = await getTeamsIndex(wanted);

  return (
    <>
      <div className="flex items-baseline justify-between gap-4">
        <h1 className="chalk text-4xl leading-none font-bold sm:text-5xl">Teams</h1>
        <span className="label text-right">
          {ratingWeek != null ? `${season} · ratings as of wk ${ratingWeek}` : "no ratings yet"}
        </span>
      </div>

      <SeasonToggle path="/teams" seasons={choices} active={season} />

      <p className="mt-4 max-w-prose text-sm text-chalk-soft">
        All 32 by team rating, in points of expected margin against an average
        team. <span className="chalk-accent">Offence</span>, defence and special
        teams sum to the total.
      </p>

      <div className="board-card mt-5 overflow-hidden">
        <div className="slip overflow-x-auto border-t-0">
          <table className="tabular w-full min-w-[640px] text-[0.8125rem]">
            <thead>
              <tr className="label">
                <th className="py-2 pl-3 text-left font-medium">#</th>
                <th className="py-2 pl-2 text-left font-medium">Team</th>
                <th className="py-2 pr-3 text-right font-medium">Rating</th>
                <th className="py-2 pr-3 text-right font-medium">Off</th>
                <th className="py-2 pr-3 text-right font-medium">Def</th>
                <th className="py-2 pr-3 text-right font-medium">ST</th>
                <th className="py-2 pr-3 text-right font-medium">GP</th>
                <th className="py-2 pr-3 text-right font-medium">Rec</th>
                <th className="py-2 pr-3 text-right font-medium">ATS</th>
                <th className="py-2 pr-3 text-right font-medium">O/U</th>
              </tr>
            </thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.abbr} className="border-t border-panel-rule hover:bg-white/[0.03]">
                  <td className="py-0 pl-3 text-chalk-faint">
                    <Link href={`/team/${t.abbr}`} className="block py-2.5">{t.rank}</Link>
                  </td>
                  <td className="py-0 pl-2">
                    <Link href={`/team/${t.abbr}`} className="block py-2.5">
                      <span className="chalk text-[1.0625rem] leading-none">
                        {nickname(NFLVERSE_TO_ODDS[t.abbr] ?? t.abbr)}
                      </span>
                      <span className="ml-2 text-[0.6875rem] text-chalk-faint">{t.abbr}</span>
                    </Link>
                  </td>
                  <td className="py-0 pr-3 text-right">
                    <Link href={`/team/${t.abbr}`} className="chalk-accent block py-2.5 font-bold">
                      {signed(t.teamRating, 1)}
                    </Link>
                  </td>
                  {[t.offense, t.defense, t.st].map((v, i) => (
                    <td key={i} className="py-0 pr-3 text-right text-chalk">
                      <Link href={`/team/${t.abbr}`} className="block py-2.5">{signed(v, 1)}</Link>
                    </td>
                  ))}
                  <td className="py-0 pr-3 text-right text-chalk-soft">
                    <Link href={`/team/${t.abbr}`} className="block py-2.5">{t.games}</Link>
                  </td>
                  {[t.record, t.ats, t.ou].map((v, i) => (
                    <td key={i} className="py-0 pr-3 text-right text-chalk-soft">
                      <Link href={`/team/${t.abbr}`} className="block py-2.5">{v}</Link>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-5 text-xs leading-relaxed text-chalk-faint">
        GP is games played this season. Record comes from points scored and
        allowed in chalk_team_weeks.{" "}
        {gradedGames === 0
          ? "ATS and O/U are empty because no game has been graded yet; they fill in once results land."
          : `ATS and O/U come from ${gradedGames} graded game${gradedGames === 1 ? "" : "s"}.`}
      </p>
    </>
  );
}
