"use client";

import { Bell, LayoutGrid, Link2, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/campaigns", label: "Campaigns", icon: LayoutGrid },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/settings/accounts", label: "Ad accounts", icon: Link2 },
  { href: "/settings", label: "Settings", icon: Settings, exact: true },
];

export function Nav({ unread, orientation }: { unread: number; orientation: "vertical" | "horizontal" }) {
  const path = usePathname();
  return (
    <nav className={cn("flex gap-1", orientation === "vertical" ? "flex-col" : "overflow-x-auto")} aria-label="Main">
      {LINKS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? path === href : path === href || path.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active ? "bg-ink/[0.06] font-medium text-ink" : "text-ink-secondary hover:bg-ink/[0.04] hover:text-ink",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            <span className={orientation === "horizontal" ? "sr-only sm:not-sr-only" : undefined}>{label}</span>
            {href === "/notifications" && unread > 0 && (
              <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] font-semibold leading-5 text-white tabular" aria-label={`${unread} unread`}>
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
