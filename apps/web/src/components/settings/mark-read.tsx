"use client";

import { useTransition } from "react";
import { markNotificationRead } from "@/app/actions";

export function MarkRead({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} className="text-ink-secondary hover:text-ink disabled:opacity-50" onClick={() => start(() => markNotificationRead(id))}>
      Mark as read
    </button>
  );
}
