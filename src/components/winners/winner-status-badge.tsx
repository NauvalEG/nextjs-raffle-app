import type { DrawEventStatus } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Status badge for DrawEvent outcomes (E2-02 Feature 4.1 Rule 2): always a
// read of the PERSISTED status — never an optimistic client-side value.

const STATUS_STYLES: Record<DrawEventStatus, { label: string; className: string }> = {
  PENDING: {
    label: "Pending",
    className:
      "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  },
  CLAIMED: {
    label: "Claimed",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  },
  DISQUALIFIED: {
    label: "Disqualified",
    className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
  },
  RELEASED_TO_POOL: {
    label: "Released to pool",
    className: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
  },
};

export function WinnerStatusBadge({
  status,
  className,
}: {
  status: DrawEventStatus;
  className?: string;
}) {
  const style = STATUS_STYLES[status];
  return (
    <Badge variant="secondary" className={cn(style.className, className)}>
      {style.label}
    </Badge>
  );
}
