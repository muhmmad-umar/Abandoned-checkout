import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="rounded-card border border-line bg-surface p-8 text-center">
      <h2 className="text-lg font-semibold">Not found</h2>
      <p className="mt-1 text-sm text-ink-secondary">This campaign doesn't exist, or it isn't yours.</p>
      <Button asChild className="mt-4" variant="outline">
        <Link href="/campaigns">Back to campaigns</Link>
      </Button>
    </div>
  );
}
