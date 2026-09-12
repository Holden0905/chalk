"use client";

import { useActionState } from "react";
import { deleteBet, type FormState } from "@/app/bets/actions";

/** Typos happen, so a row can be removed. Confirmed first, since it is final. */
export default function DeleteBet({ id, label }: { id: number; label: string }) {
  const [state, action] = useActionState<FormState, FormData>(deleteBet, {});
  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!confirm(`Delete ${label}? This cannot be undone.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        aria-label={`Delete ${label}`}
        title={state.error ?? "Delete"}
        className="px-2 py-1 text-chalk-faint hover:text-loss"
      >
        ×
      </button>
    </form>
  );
}
