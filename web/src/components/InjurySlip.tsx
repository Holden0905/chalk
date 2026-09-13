import type { InjuryRow } from "@/lib/gameData";

// Out is the loudest thing on the page after a score, so it takes the loss
// colour. Questionable is genuinely a question and stays plain chalk.
const STATUS_STYLE: Record<string, string> = {
  out: "text-loss",
  doubtful: "text-loss",
  questionable: "text-chalk",
  probable: "text-chalk-soft",
  "injured reserve": "text-chalk-faint",
  suspension: "text-chalk-faint",
};

function Report({ team, rows }: { team: string; rows: InjuryRow[] }) {
  return (
    <div className="mt-4 first:mt-0">
      <h3 className="chalk d-team-row">{team}</h3>
      {rows.length === 0 ? (
        <p className="slip mt-2 px-3 py-3 text-sm text-chalk-faint">
          Nobody on the report.
        </p>
      ) : (
        // A list rather than a table: the note is a sentence, and giving a
        // sentence its own column leaves it four words wide on a phone. Name
        // and status on one line, the note underneath, works at every width.
        <ul className="slip mt-2">
          {rows.map((r) => (
            <li key={r.player_name} className="border-t border-panel-rule px-3 py-2 first:border-t-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-sm text-chalk">
                  {r.player_name}
                  {r.position ? (
                    <span className="label ml-1.5 normal-case tracking-normal">{r.position}</span>
                  ) : null}
                </span>
                <span className={`tabular shrink-0 text-[0.75rem] ${STATUS_STYLE[r.status ?? ""] ?? "text-chalk-soft"}`}>
                  {r.status ?? "–"}
                </span>
              </div>
              {r.detail ? (
                <p className="mt-0.5 text-[0.75rem] leading-snug text-chalk-faint">{r.detail}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function InjurySlip({
  capturedAt, home, away, homeRows, awayRows,
}: {
  capturedAt: string | null;
  home: string;
  away: string;
  homeRows: InjuryRow[];
  awayRows: InjuryRow[];
}) {
  const when = capturedAt
    ? new Intl.DateTimeFormat("en-US", {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", timeZone: "America/New_York",
      }).format(new Date(capturedAt))
    : null;

  return (
    <section className="board-card mt-5 px-4 py-4 sm:px-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="chalk d-section font-bold">Injuries</h2>
        <span className="label text-right">{when ? `captured ${when}` : "never captured"}</span>
      </div>

      {capturedAt == null ? (
        <p className="mt-2 text-sm text-chalk-faint">
          No injury report has been captured yet. Run npm run snapshot:context.
        </p>
      ) : (
        <>
          <Report team={away} rows={awayRows} />
          <Report team={home} rows={homeRows} />
          <p className="mt-3 text-xs leading-relaxed text-chalk-faint">
            Quarterbacks first, then most severe. Injured reserve and suspension
            sort below the game-day designations because they are settled
            absences rather than this week&rsquo;s question. Players ESPN lists as
            active are not on the report at all.
          </p>
        </>
      )}
    </section>
  );
}
