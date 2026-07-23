import type { RaffleStatus } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Distinct, consistent visual treatment per lifecycle state (E1-01 Feature B
// Rule 3). The badge is a read of the persisted raffle.status, never
// client-derived.
const STATUS_STYLES: Record<RaffleStatus, { label: string; className: string }> = {
  DRAFT: {
    label: "Draft",
    className: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  },
  OPEN: {
    label: "Open",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  LOCKED: {
    label: "Locked",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  DRAWN: {
    label: "Drawn",
    className: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  },
  COMPLETED: {
    label: "Completed",
    className:
      "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  },
};

export function RaffleStatusBadge({
  status,
  className,
}: {
  status: RaffleStatus;
  className?: string;
}) {
  const style = STATUS_STYLES[status];
  return (
    <Badge variant="secondary" className={cn(style.className, className)}>
      {style.label}
    </Badge>
  );
}
