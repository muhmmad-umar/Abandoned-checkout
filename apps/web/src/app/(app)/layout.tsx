import { TrendingUp } from "lucide-react";
import Link from "next/link";
import { Nav } from "@/components/shell/nav";
import { UserMenu } from "@/components/shell/user";
import { apiCall } from "@/lib/api";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const n = await apiCall<{ unread: number }>("/notifications?unread=true");
  const unread = n.ok ? n.data.unread : 0;
  const brand = (
    <Link href="/campaigns" className="flex items-center gap-2 font-semibold">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-ink text-page">
        <TrendingUp className="h-4 w-4" aria-hidden />
      </span>
      Ad Scaler
    </Link>
  );
  return (
    <div className="md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-6 border-r border-line bg-surface p-4 md:flex">
        {brand}
        <Nav unread={unread} orientation="vertical" />
        <div className="mt-auto">
          <UserMenu />
        </div>
      </aside>
      <header className="sticky top-0 z-20 flex flex-col gap-2 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-center justify-between">
          {brand}
          <UserMenu />
        </div>
        <Nav unread={unread} orientation="horizontal" />
      </header>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
