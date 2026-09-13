import Link from "next/link";
import FitText from "./FitText";
import type { BoardGame } from "@/lib/board";
import { city, nickname } from "@/lib/teams";
import { kickoff, plain, spread as fmtSpread } from "@/lib/format";

/** Which side the number favours, always expressed as a negative handicap. */
function favourite(spreadHome: number | null, home: string | null, away: string | null) {
  if (spreadHome == null || home == null || away == null) return null;
  if (spreadHome === 0) return { team: null, line: 0 };
  return spreadHome < 0 ? { team: home, line: spreadHome } : { team: away, line: -spreadHome };
}

const ratingText = (rank: number | null, rating: number | null) =>
  `${rank != null ? `#${rank}` : "–"} · ${rating != null ? `${rating > 0 ? "+" : "−"}${Math.abs(rating).toFixed(1)}` : "–"}`;

/**
 * A team name keeps going to its own page. It sits above the card-wide link
 * below it, which is what makes "anywhere except a team name" work: one
 * stretched link covering the card, and these lifted over it.
 */
function linked(abbr: string | null, className: string, children: React.ReactNode) {
  return abbr ? (
    <Link href={`/team/${abbr}`} className={`pointer-events-auto relative z-10 ${className} hover:opacity-80`}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  );
}

/**
 * One team: name and city on the left, rank and rating on the right. Only the
 * name is the link to the team page. The rank and rating are the card's own
 * figures, so they fall through to the card link like everything else.
 */
function TeamRow({ abbr, name, rating, rank }: BoardGame["home"]) {
  return (
    <div className="flex items-baseline justify-between gap-x-3 py-0.5">
      {linked(
        abbr,
        "flex min-w-0 flex-1 items-baseline gap-2",
        <>
          <FitText boxClassName="flex-1" className="chalk d-team font-bold">{nickname(name)}</FitText>
          <span className="label shrink-0 normal-case tracking-normal text-[0.6875rem]">{city(name)}</span>
        </>,
      )}
      <span className="tabular shrink-0 text-xs text-chalk-soft">{ratingText(rank, rating)}</span>
    </div>
  );
}

/** Small, quiet indicator. The move is context, not the headline. */
function Move({ value, toward }: { value: number | null; toward?: string | null }) {
  if (value == null || value === 0) {
    return <span className="text-chalk-faint">–</span>;
  }
  const up = value > 0;
  return (
    <span className="text-chalk-soft">
      {up ? "▲" : "▼"}
      {Math.abs(value).toFixed(1)}
      {toward ? <span className="text-chalk-faint"> {toward}</span> : null}
    </span>
  );
}

export default function GameCard({ game }: { game: BoardGame }) {
  const market = favourite(game.spreadHome, game.home.abbr, game.away.abbr);
  const chalkLine = favourite(game.impliedSpreadHome, game.home.abbr, game.away.abbr);
  const spreadToward =
    game.spreadMove == null || game.spreadMove === 0
      ? null
      : game.spreadMove < 0
        ? game.home.abbr
        : game.away.abbr;

  const r = game.result;

  return (
    <article className="board-card min-w-0 px-4 py-4 sm:px-5">
      {/* The whole card is a link to the game page. A stretched anchor rather
          than a wrapper, because the team names inside are links of their own
          and an anchor cannot be nested inside another one. */}
      <Link
        href={`/game/${game.gameId}`}
        className="absolute inset-0 z-0 rounded-[2px]"
        aria-label={`${nickname(game.away.name)} at ${nickname(game.home.name)}, game page`}
      />

      <div className="pointer-events-none relative flex items-baseline justify-between gap-3">
        <span className="label">{kickoff(game.commenceTime)}</span>
        {r ? (
          <span className="tabular text-sm text-chalk">
            {r.awayScore}
            <span className="mx-1 text-chalk-faint">–</span>
            {r.homeScore}
            <span className="label ml-2">final</span>
          </span>
        ) : (
          <span className="label">{game.book ?? ""}</span>
        )}
      </div>

      {/* Stacked at every width. Side by side puts each name in half a card,
          which is narrower than "Commanders" or "Buccaneers" at display size
          and breaks them mid-word. */}
      {/* Everything here lets taps through to the card link underneath, except
          the two team names, which take them back. */}
      <div className="pointer-events-none relative mt-2">
        <TeamRow {...game.away} />
        <div className="chalk d-at py-0.5 text-chalk-faint">at</div>
        <TeamRow {...game.home} />
      </div>

      {/* Flat panel. No texture, typewriter numerals, so the figures read. */}
      <div className="pointer-events-none relative slip -mx-4 -mb-4 mt-4 rounded-b-[2px] border-b-0 px-4 pt-3 pb-2 sm:-mx-5 sm:-mb-4 sm:px-5">
        <table className="tabular w-full text-[0.8125rem]">
          <thead>
            <tr className="label">
              <th scope="col" className="pb-1.5 text-left font-medium">
                &nbsp;
              </th>
              <th scope="col" className="pb-1.5 text-right font-medium">
                Market
              </th>
              <th scope="col" className="pb-1.5 text-right font-medium">
                Move
              </th>
              <th scope="col" className="pb-1.5 text-right font-medium">
                Chalk
              </th>
            </tr>
          </thead>
          <tbody className="text-chalk">
            <tr className="border-t border-panel-rule">
              <th scope="row" className="label py-2 text-left font-medium">
                Spread
              </th>
              <td className="py-2 text-right">
                {market ? (market.team ? `${market.team} ${fmtSpread(market.line)}` : "PK") : "–"}
              </td>
              <td className="py-2 text-right">
                <Move value={game.spreadMove} toward={spreadToward} />
              </td>
              <td className="chalk-accent py-2 text-right font-bold">
                {chalkLine
                  ? chalkLine.team
                    ? `${chalkLine.team} ${chalkLine.line < 0 ? "−" : "+"}${Math.abs(chalkLine.line).toFixed(1)}`
                    : "PK"
                  : "–"}
              </td>
            </tr>
            <tr className="border-t border-panel-rule">
              <th scope="row" className="label py-2 text-left font-medium">
                Total
              </th>
              <td className="py-2 text-right">{plain(game.total, 1)}</td>
              <td className="py-2 text-right">
                <Move value={game.totalMove} />
              </td>
              <td className="chalk-accent py-2 text-right font-bold">
                {plain(game.impliedTotal, 1)}
              </td>
            </tr>
            {r ? (
              <tr className="border-t border-panel-rule">
                <th scope="row" className="label py-2 text-left font-medium">
                  Result
                </th>
                <td colSpan={3} className="py-2 text-right">
                  <span className={r.homeCovered == null ? "text-chalk-soft" : r.homeCovered ? "text-win" : "text-loss"}>
                    {r.homeCovered == null
                      ? "ATS push"
                      : `${r.homeCovered ? game.home.abbr : game.away.abbr} covered`}
                  </span>
                  <span className="mx-2 text-chalk-faint">·</span>
                  <span className={r.wentOver == null ? "text-chalk-soft" : "text-chalk"}>
                    {r.wentOver == null ? "total push" : r.wentOver ? "Over" : "Under"}
                  </span>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </article>
  );
}
