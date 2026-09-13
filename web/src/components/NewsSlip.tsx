import type { Game } from "@/lib/gameData";

type Item = Game["news"]["items"][number];

const SHOWN = 3;

const when = (iso: string | null | undefined) =>
  !iso
    ? null
    : new Intl.DateTimeFormat("en-US", {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        timeZone: "America/New_York",
      }).format(new Date(iso));

function Headline({ item }: { item: Item }) {
  const body = (
    <>
      <span className="block text-sm leading-snug text-chalk">{item.headline}</span>
      {item.description ? (
        <span className="mt-0.5 block text-xs leading-snug text-chalk-soft">{item.description}</span>
      ) : null}
      <span className="label mt-1 block normal-case tracking-normal">
        {[item.type, when(item.published)].filter(Boolean).join(" · ")}
      </span>
    </>
  );
  return (
    <li className="border-t border-panel-rule px-3 py-3 first:border-t-0">
      {item.link ? (
        <a href={item.link} target="_blank" rel="noreferrer" className="block hover:opacity-80">
          {body}
        </a>
      ) : (
        body
      )}
    </li>
  );
}

export default function NewsSlip({ news }: { news: Game["news"] }) {
  const items = news.items ?? [];
  const captured = when(news.capturedAt);

  return (
    <section className="board-card mt-5 px-4 py-4 sm:px-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="chalk d-section font-bold">News</h2>
        <span className="label text-right">
          {captured ? `captured ${captured}` : "never captured"}
        </span>
      </div>

      {news.capturedAt == null ? (
        <p className="mt-2 text-sm text-chalk-faint">
          No news has been captured for this game yet.
        </p>
      ) : (
        <>
          {news.headline ? (
            <div className="slip mt-3 px-3 py-3">
              <p className="label">ESPN preview{news.venue ? ` · ${news.venue}` : ""}</p>
              <h3 className="mt-1 text-[0.9375rem] font-semibold leading-snug text-chalk">
                {news.headline}
              </h3>
              {news.preview ? (
                <p className="mt-1.5 text-sm leading-snug text-chalk-soft">{news.preview}</p>
              ) : null}
            </div>
          ) : null}

          {items.length === 0 ? (
            <p className="mt-3 text-sm text-chalk-faint">No headlines mentioning either team.</p>
          ) : (
            <>
              <ul className="slip mt-3">
                {items.slice(0, SHOWN).map((item, i) => (
                  <Headline key={item.id ?? item.link ?? i} item={item} />
                ))}
              </ul>

              {/* Native details, so the rest of the list costs no client JS. */}
              {items.length > SHOWN ? (
                <details className="mt-2 group">
                  <summary className="label cursor-pointer select-none py-1 text-chalk-soft marker:content-['']">
                    <span className="group-open:hidden">
                      show {items.length - SHOWN} more
                    </span>
                    <span className="hidden group-open:inline">show fewer</span>
                  </summary>
                  <ul className="slip mt-2">
                    {items.slice(SHOWN).map((item, i) => (
                      <Headline key={item.id ?? item.link ?? i} item={item} />
                    ))}
                  </ul>
                </details>
              ) : null}
            </>
          )}
        </>
      )}
    </section>
  );
}
