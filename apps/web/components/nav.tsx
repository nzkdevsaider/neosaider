"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Chat" },
  { href: "/store", label: "Tienda" },
  { href: "/modules", label: "Módulos" },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-rule bg-card">
      <nav
        aria-label="Principal"
        className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6"
      >
        <Link href="/" className="font-serif text-2xl text-ink">
          Neosaider
        </Link>
        <ul className="flex gap-1">
          {LINKS.map(({ href, label }) => {
            const active =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded px-3 py-1.5 text-sm ${
                    active
                      ? "bg-accent-tint font-medium text-accent"
                      : "text-muted hover:text-ink"
                  }`}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
