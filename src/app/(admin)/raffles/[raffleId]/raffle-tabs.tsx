"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { label: "Setup", segment: "" },
  { label: "Participants", segment: "participants" },
  { label: "Rounds", segment: "rounds" },
  { label: "Draw", segment: "draw" },
  { label: "Winners", segment: "winners" },
  { label: "Report", segment: "report" },
] as const;

export function RaffleTabs({ raffleId }: { raffleId: string }) {
  const pathname = usePathname();
  const base = `/raffles/${raffleId}`;

  return (
    <nav className="overflow-x-auto border-b" aria-label="Raffle sections">
      <div className="flex gap-1">
        {TABS.map((tab) => {
          const href = tab.segment ? `${base}/${tab.segment}` : base;
          const active = tab.segment
            ? pathname === href || pathname.startsWith(`${href}/`)
            : pathname === base;
          return (
            <Link
              key={tab.label}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground",
                active && "border-foreground font-medium text-foreground"
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
