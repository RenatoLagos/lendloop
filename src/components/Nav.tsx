"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

const LINKS = [
  { href: "/tools", label: "Browse tools" },
  { href: "/my/listings", label: "My listings" },
  { href: "/my/requests", label: "My requests" },
  { href: "/my/incoming", label: "Incoming" },
];

export function Nav() {
  const pathname = usePathname();
  const me = useQuery(api.users.me);
  const links = me?.role === "admin" ? [...LINKS, { href: "/admin", label: "Admin" }] : LINKS;
  return (
    <header className="border-b border-stone-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="text-lg font-bold text-emerald-800">LendLoop</Link>
        <nav className="flex flex-1 flex-wrap gap-4 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className={pathname.startsWith(l.href) ? "font-semibold text-emerald-800" : "text-stone-600 hover:text-stone-900"}>
              {l.label}
            </Link>
          ))}
        </nav>
        {me?.role === "admin" && <span className="rounded bg-stone-900 px-2 py-0.5 text-xs text-white">admin</span>}
        <UserButton />
      </div>
    </header>
  );
}
