"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Phase 2 and 3 pages are present so the shape of the app is visible, but they
// are stubs and say so when opened.
const LINKS = [
  { href: "/board", label: "Board" },
  { href: "/teams", label: "Teams" },
  { href: "/stats", label: "Stats" },
  { href: "/tds", label: "TDs" },
  { href: "/bets", label: "Bets" },
  { href: "/about", label: "About" },
];

export default function Nav() {
  const pathname = usePathname();

  return (
    <header className="pt-4">
      <div className="mx-auto w-full max-w-5xl px-4 sm:px-6">
        <Link href="/board" className="chalk block text-[2rem] leading-none font-bold tracking-wide sm:text-4xl">
          Chalk
        </Link>

        <nav aria-label="Main" className="-mx-1 mt-3 overflow-x-auto">
          <ul className="flex min-w-max items-center gap-1 pb-1">
            {LINKS.map((link) => {
              const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className="chalk nav-link block px-3 pb-2 pt-1.5 text-lg leading-none"

                  >
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>

      {/* The one thin chalk rule in the app. */}
      <hr className="chalk-rule mt-1" />
    </header>
  );
}
