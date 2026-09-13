import Link from "next/link";

/**
 * Multi-select, and a URL parameter rather than client state, so a set of
 * seasons is linkable and the whole page stays a server render. Tapping a
 * season that is already on removes it. All is not in the list because it is
 * not optional: it is the baseline every column is being read against.
 */
export default function SeasonPicker({
  available,
  selected,
}: {
  available: number[];
  selected: number[];
}) {
  const on = new Set(selected);
  const href = (season: number) => {
    const next = on.has(season)
      ? selected.filter((s) => s !== season)
      : [...selected, season];
    // An empty list is a legitimate view -- the All column on its own -- so the
    // parameter is still sent, empty, rather than dropped back to the default.
    return `/league?seasons=${[...next].sort((a, b) => b - a).join(",")}`;
  };

  return (
    <nav aria-label="Seasons" className="-mx-1 mt-4 flex flex-wrap items-center gap-1">
      {available.map((s) => (
        <Link
          key={s}
          href={href(s)}
          data-on={on.has(s) ? "true" : undefined}
          className="chalk nav-link d-nav px-3 pb-2 pt-1.5"
        >
          {s}
        </Link>
      ))}
      <span className="chalk nav-link d-nav px-3 pb-2 pt-1.5" data-on="true" aria-hidden="true">
        All
      </span>
    </nav>
  );
}
