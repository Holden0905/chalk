"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/supabase";
import { lookupGame, MARKETS, type Market } from "@/lib/betsData";

export type FormState = { error?: string; ok?: string };

/**
 * Mirrors the validation in bet.js: the market decides which fields are
 * required, and the side is normalised to a full team name for spread and
 * moneyline so it matches what the grader compares against.
 */
export async function createBet(_prev: FormState, form: FormData): Promise<FormState> {
  const market = String(form.get("market") ?? "") as Market;
  if (!MARKETS.includes(market)) return { error: "Pick a market." };

  const gameId = String(form.get("game_id") ?? "");
  if (!gameId) return { error: "Pick a game." };
  const game = await lookupGame(gameId);
  if (!game) return { error: "That game is no longer in the odds snapshots." };

  let side = String(form.get("side") ?? "").trim();
  if (!side) return { error: "Pick a side." };
  if (market === "total") {
    const s = side.toLowerCase();
    if (s !== "over" && s !== "under") return { error: "Total side must be Over or Under." };
    side = s === "over" ? "Over" : "Under";
  } else if (market === "spread" || market === "moneyline") {
    if (side !== game.home_team && side !== game.away_team) {
      return { error: `Side must be ${game.away_team} or ${game.home_team}.` };
    }
  }

  const needsLine = market === "spread" || market === "total";
  const rawLine = String(form.get("line") ?? "").trim();
  if (needsLine && rawLine === "") return { error: `A ${market} needs a line.` };
  const line = needsLine ? Number(rawLine) : null;
  if (needsLine && !Number.isFinite(line as number)) return { error: "Line must be a number." };

  const price = Number(String(form.get("price") ?? "").trim());
  if (!Number.isFinite(price)) return { error: "Price must be a number, like -110 or 145." };
  const stake = Number(String(form.get("stake") ?? "").trim());
  if (!Number.isFinite(stake) || stake <= 0) return { error: "Stake must be a positive number." };

  const book = String(form.get("book") ?? "").trim();
  if (!book) return { error: "Pick a book." };
  const note = String(form.get("note") ?? "").trim();

  const { error } = await db().from("chalk_bets").insert({
    game_id: game.game_id,
    commence_time: game.commence_time,
    market,
    side,
    line,
    price: Math.round(price),
    stake,
    book,
    note: note || null,
  });
  if (error) return { error: `Could not save: ${error.message}` };

  revalidatePath("/bets");
  const shown = market === "moneyline" || market === "anytime_td" ? side : `${side} ${line}`;
  return { ok: `Logged ${market} ${shown} at ${price > 0 ? `+${price}` : price} for ${stake}.` };
}

export async function deleteBet(_prev: FormState, form: FormData): Promise<FormState> {
  const id = Number(String(form.get("id") ?? ""));
  if (!Number.isInteger(id)) return { error: "Bad bet id." };
  const { error } = await db().from("chalk_bets").delete().eq("id", id);
  if (error) return { error: `Could not delete: ${error.message}` };
  revalidatePath("/bets");
  return { ok: `Deleted bet #${id}.` };
}
