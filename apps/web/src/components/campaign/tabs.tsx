import Link from "next/link";
import { cn } from "@/lib/utils";

export const TABS = [
  { id: "overview", label: "Overview" },
  { id: "creatives", label: "Creatives" },
  { id: "creative-brief", label: "Creative brief" },
  { id: "scaling", label: "Scaling timeline" },
  { id: "history", label: "Override history" },
] as const;
export type TabId = (typeof TABS)[number]["id"];

export function CampaignTabs({ id, active }: { id: string; active: TabId }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <nav className="flex min-w-max gap-1 border-b border-line" aria-label="Campaign sections">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.id === "overview" ? `/campaigns/${id}` : `/campaigns/${id}?tab=${t.id}`}
            aria-current={active === t.id ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2.5 text-sm transition-colors",
              active === t.id ? "border-ink font-medium text-ink" : "border-transparent text-ink-secondary hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
