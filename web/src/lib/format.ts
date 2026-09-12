export const signed = (v: number | null | undefined, digits = 1): string =>
  v == null || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;

export const plain = (v: number | null | undefined, digits = 1): string =>
  v == null || !Number.isFinite(v) ? "–" : v.toFixed(digits);

/** A spread as a bettor reads it: -6, +3.5, PK. */
export const spread = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return "–";
  if (v === 0) return "PK";
  return `${v > 0 ? "+" : "−"}${Math.abs(v)}`;
};

export const price = (v: number | null | undefined): string =>
  v == null || !Number.isFinite(v) ? "–" : v > 0 ? `+${v}` : `${v}`;

export function kickoff(iso: string, timeZone = "America/New_York"): string {
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(d);
}

export function kickoffDay(iso: string, timeZone = "America/New_York"): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(new Date(iso));
}
