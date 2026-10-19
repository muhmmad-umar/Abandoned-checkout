import Link from "next/link";
import { Card } from "@/components/ui/card";
import { MarkRead } from "@/components/settings/mark-read";
import { apiGet } from "@/lib/api";
import type { NotificationItem } from "@/lib/types";
import { cn, relativeTime } from "@/lib/utils";

export const metadata = { title: "Notifications" };

/** Turns the absolute link in a notification into an in-app path. */
const appPath = (link: string | null) => {
  if (!link) return null;
  try {
    const u = new URL(link);
    return `${u.pathname}${u.search}`;
  } catch {
    return link.startsWith("/") ? link : null;
  }
};

export default async function NotificationsPage() {
  const { items } = await apiGet<{ items: NotificationItem[]; unread: number }>("/notifications");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
      <Card>
        {items.length === 0 ? (
          <p className="p-6 text-sm text-ink-secondary">Nothing yet. You'll hear from us when a brief, recommendation or alert is ready.</p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((n) => {
              const href = appPath(n.link);
              const body = n.body.replace(/\s*→\s*https?:\/\/\S+$/, "").replace(/\s*Review it here$/, "");
              return (
                <li key={n.id} className={cn("flex gap-3 px-5 py-4", !n.readAt && "bg-accent-soft/20")}>
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-transparent" : "bg-accent")} aria-label={n.readAt ? undefined : "Unread"} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="font-medium">{n.title}</p>
                      <span className="text-xs text-ink-muted">{relativeTime(n.createdAt)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-line text-sm text-ink-secondary">{body}</p>
                    <div className="mt-2 flex gap-4 text-sm">
                      {href && <Link href={href} className="font-medium text-accent-ink hover:underline">Open</Link>}
                      {!n.readAt && <MarkRead id={n.id} />}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
