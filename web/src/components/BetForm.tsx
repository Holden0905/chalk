"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createBet, type FormState } from "@/app/bets/actions";
import type { GameChoice } from "@/lib/betsData";

const MARKETS = [
  { key: "spread", label: "Spread" },
  { key: "total", label: "Total" },
  { key: "moneyline", label: "Moneyline" },
  { key: "anytime_td", label: "Anytime TD" },
];

const DEFAULT_MARKET = "spread";
const DEFAULT_BOOK = "draftkings";

const field = "tabular w-full bg-panel border border-panel-rule rounded-sm px-2.5 py-2 text-chalk outline-none focus:border-butter";

const teamMarket = (market: string) => market === "spread" || market === "moneyline";
const lineMarket = (market: string) => market === "spread" || market === "total";

/**
 * What the side should read when it has just been reset. A team market starts on
 * the away side because that is the first option a fresh select would show; a
 * total starts on Over; anytime TD is a free-text player name and starts empty.
 */
function defaultSide(market: string, game: GameChoice | undefined): string {
  if (teamMarket(market)) return game?.away ?? "";
  if (market === "total") return "Over";
  return "";
}

export default function BetForm({
  games, books, playersByGameId,
}: {
  games: GameChoice[]; books: string[]; playersByGameId: Record<string, string[]>;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createBet, {});

  const firstGame = games[0];
  const [gameId, setGameId] = useState(firstGame?.gameId ?? "");
  const [market, setMarket] = useState(DEFAULT_MARKET);

  /**
   * Every input is controlled. They used to be uncontrolled, which left whether
   * a field survived a market change up to React reconciliation: the side
   * happened to reset because its two selects carry different keys, while the
   * line kept its value because both markets render the same bare input, so a
   * spread of -3.5 became a total of -3.5. Holding the values here makes what
   * clears, and when, a decision rather than an accident.
   */
  const [side, setSide] = useState(() => defaultSide(DEFAULT_MARKET, firstGame));
  const [line, setLine] = useState("");
  const [price, setPrice] = useState("");
  const [stake, setStake] = useState("");
  const [book, setBook] = useState(books.includes(DEFAULT_BOOK) ? DEFAULT_BOOK : (books[0] ?? ""));
  const [note, setNote] = useState("");

  const game = games.find((g) => g.gameId === gameId);
  const players = playersByGameId[gameId] ?? [];

  /** The market decides what a side even means, so changing it invalidates both. */
  const changeMarket = (next: string) => {
    setMarket(next);
    setSide(defaultSide(next, game));
    setLine("");
  };

  /** A different game means different teams, so a team side no longer applies. */
  const changeGame = (nextId: string) => {
    setGameId(nextId);
    setSide(defaultSide(market, games.find((g) => g.gameId === nextId)));
  };

  // Clear after a bet is logged, keeping the game and the book: those are the
  // two things that stay true across a run of bets on the same slate, and
  // re-picking them every time is the annoyance this avoids.
  const clearedAt = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!state.ok || state.at == null || state.at === clearedAt.current) return;
    clearedAt.current = state.at;
    setMarket(DEFAULT_MARKET);
    setSide(defaultSide(DEFAULT_MARKET, games.find((g) => g.gameId === gameId)));
    setLine("");
    setPrice("");
    setStake("");
    setNote("");
  }, [state, games, gameId]);

  if (games.length === 0) {
    return (
      <p className="panel mt-5 px-4 py-6 text-sm text-chalk-soft">
        No upcoming games in the odds snapshots, so there is nothing to bet on
        yet. Run the snapshot job.
      </p>
    );
  }

  return (
    <form action={action} className="board-card mt-5 px-4 py-4 sm:px-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="label">Game</span>
          <select name="game_id" value={gameId} onChange={(e) => changeGame(e.target.value)} className={`${field} mt-1`}>
            {games.map((g) => (
              <option key={g.gameId} value={g.gameId}>{g.label}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label">Market</span>
          <select name="market" value={market} onChange={(e) => changeMarket(e.target.value)} className={`${field} mt-1`}>
            {MARKETS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label">Side</span>
          {teamMarket(market) && game ? (
            <select name="side" value={side} onChange={(e) => setSide(e.target.value)} className={`${field} mt-1`}>
              <option value={game.away}>{game.away}</option>
              <option value={game.home}>{game.home}</option>
            </select>
          ) : market === "total" ? (
            <select name="side" value={side} onChange={(e) => setSide(e.target.value)} className={`${field} mt-1`}>
              <option value="Over">Over</option>
              <option value="Under">Under</option>
            </select>
          ) : (
            <>
              <input
                name="side"
                value={side}
                onChange={(e) => setSide(e.target.value)}
                list="td-players"
                autoComplete="off"
                placeholder={players.length ? "Start typing a name" : "Player name"}
                className={`${field} mt-1`}
              />
              <datalist id="td-players">
                {players.map((p) => <option key={p} value={p} />)}
              </datalist>
            </>
          )}
        </label>

        {lineMarket(market) ? (
          <label className="block">
            <span className="label">Line</span>
            <input
              name="line"
              value={line}
              onChange={(e) => setLine(e.target.value)}
              inputMode="decimal"
              placeholder={market === "total" ? "44.5" : "-3.5"}
              className={`${field} mt-1`}
            />
          </label>
        ) : null}

        <label className="block">
          <span className="label">Price</span>
          <input name="price" value={price} onChange={(e) => setPrice(e.target.value)}
                 inputMode="numeric" placeholder="-110" className={`${field} mt-1`} />
        </label>

        <label className="block">
          <span className="label">Stake</span>
          <input name="stake" value={stake} onChange={(e) => setStake(e.target.value)}
                 inputMode="decimal" placeholder="25" className={`${field} mt-1`} />
        </label>

        <label className="block">
          <span className="label">Book</span>
          <select name="book" value={book} onChange={(e) => setBook(e.target.value)} className={`${field} mt-1`}>
            {books.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>

        <label className="block sm:col-span-2">
          <span className="label">Note</span>
          <input name="note" value={note} onChange={(e) => setNote(e.target.value)}
                 placeholder="optional" className={`${field} mt-1`} />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="chalk d-nav rounded-sm border border-chalk/25 px-4 py-2 font-bold hover:border-butter hover:text-butter disabled:opacity-50"
        >
          {pending ? "Saving" : "Log it"}
        </button>
        {state.error ? <span className="text-sm text-loss">{state.error}</span> : null}
        {state.ok ? <span className="text-sm text-win">{state.ok}</span> : null}
      </div>
    </form>
  );
}
