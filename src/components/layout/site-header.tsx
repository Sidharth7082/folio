"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/browse", label: "Browse" },
  { href: "/catalogue", label: "Catalogue" },
  { href: "/library", label: "Library" },
  { href: "/add", label: "Add" },
  { href: "/search", label: "Search" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-6 px-5">
        <Link href="/" className="group flex shrink-0 items-center gap-2.5">
          <span
            aria-hidden
            className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-accent-ink shadow-sm"
          >
            <svg viewBox="0 0 24 24" className="h-4.5 w-4.5" fill="none" strokeWidth="2">
              <path
                d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z"
                stroke="currentColor"
                strokeLinejoin="round"
              />
              <path d="M4 5.5V20.5" stroke="currentColor" strokeLinecap="round" />
            </svg>
          </span>
          <span className="text-[17px] font-semibold tracking-tight">Folio</span>
        </Link>

        <nav
          aria-label="Main"
          className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={[
                  "shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-surface-2 text-ink"
                    : "text-muted hover:bg-surface hover:text-ink",
                ].join(" ")}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
