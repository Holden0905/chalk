import Link from "next/link";

/**
 * Seasons are a URL parameter rather than client state, so a view is
 * linkable and the data is fetched on the server for whichever season is
 * being looked at.
 */
export default function SeasonToggle({
  path,
  seasons,
  active,
}: {
  path: string;
  seasons: number[];
  active: number;
}) {
  return (
    <nav aria-label="Season" className="-mx-1 mt-4 flex items-center gap-1">
      {seasons.map((s) => (
        <Link
          key={s}
          href={s === seasons[0] ? path : `${path}?season=${s}`}
          aria-current={s === active ? "page" : undefined}
          className="chalk nav-link d-nav px-3 pb-2 pt-1.5"
        >
          {s}
        </Link>
      ))}
    </nav>
  );
}
