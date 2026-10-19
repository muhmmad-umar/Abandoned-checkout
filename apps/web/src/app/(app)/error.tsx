"use client";

import { Button } from "@/components/ui/button";

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-card border border-line bg-surface p-8 text-center">
      <h2 className="text-lg font-semibold">We couldn't load this page</h2>
      <p className="mt-1 text-sm text-ink-secondary">{error.message || "Check that the API is running, then try again."}</p>
      <Button className="mt-4" variant="outline" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
