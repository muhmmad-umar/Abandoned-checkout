import { UserButton } from "@clerk/nextjs";
import { devAuthUser } from "@/lib/session";

export function UserMenu() {
  if (devAuthUser) {
    return (
      <span className="inline-flex items-center gap-2 text-xs text-ink-secondary" title="Local demo mode: Clerk is bypassed">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-accent text-[11px] font-semibold text-white">D</span>
        Demo mode
      </span>
    );
  }
  return <UserButton />;
}
