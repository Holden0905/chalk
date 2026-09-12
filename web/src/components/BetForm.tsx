"use client";

import { useActionState, useState } from "react";
import { createBet, type FormState } from "@/app/bets/actions";
import type { GameChoice } from "@/lib/betsData";

const MARKETS = [
  { key: "spread", label: "Spread" },
  { key: "total", label: "Total" },
  { key: "moneyline", label: "Moneyline" },
  { key: "anytime_td", label: "Anytime TD" },
];

const field = "tabular w-full bg-panel border border-panel-rule rounded-sm px-2.5 py-2 text-chalk outline-none focus:border-butter";

export default function BetForm({
  games, books, playersByGameId,
}: {
  games: GameChoice[]; books: string[]; playersByGameId: Record<string, string[]>;
}) {
  const [state, action, pending] = useActionState<FormState, FormData>(createBet, {});
  const [gameId, setGameId] = useState(games[0]?.gameId ?? "");
  const [market, setMarket] = useState("spread");

  const game = games.find((g) => g.gameId === gameId);
  const needsLine = market === "spread" || market === "total";
  const teamSide = market === "spread" || market === "moneyline";
  const players = playersByGameId[gameId] ?? [];

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
          <select name="game_id" value={gameId} onChange={(e) => setGameId(e.target.value)} className={`${field} mt-1`}>
            {games.map((g) => (
              <option key={g.gameId} value={g.gameId}>{g.label}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label">Market</span>
          <select name="market" value={market} onChange={(e) => setMarket(e.target.value)} className={`${field} mt-1`}>
            {MARKETS.map((m) => (
              <option key={m.key} value={m.key}>{m.label}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="label">Side</span>
          {teamSide && game ? (
            <select name="side" className={`${field} mt-1`} key={`${gameId}-team`}>
              <option value={game.away}>{game.away}</option>
              <option value={game.home}>{game.home}</option>
            </select>
          ) : market === "total" ? (
            <select name="side" className={`${field} mt-1`}>
              <option value="Over">Over</option>
              <option value="Under">Under</option>
            </select>
          ) : (
            <>
              <input
                name="side"
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

        {needsLine ? (
          <label className="block">
            <span className="label">Line</span>
            <input name="line" inputMode="decimal" placeholder={market === "total" ? "44.5" : "-3.5"} className={`${field} mt-1`} />
          </label>
        ) : null}

        <label className="block">
          <span className="label">Price</span>
          <input name="price" inputMode="numeric" placeholder="-110" className={`${field} mt-1`} />
        </label>

        <label className="block">
          <span className="label">Stake</span>
          <input name="stake" inputMode="decimal" placeholder="25" className={`${field} mt-1`} />
        </label>

        <label className="block">
          <span className="label">Book</span>
          <select name="book" defaultValue="draftkings" className={`${field} mt-1`}>
            {books.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>

        <label className="block sm:col-span-2">
          <span className="label">Note</span>
          <input name="note" placeholder="optional" className={`${field} mt-1`} />
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
