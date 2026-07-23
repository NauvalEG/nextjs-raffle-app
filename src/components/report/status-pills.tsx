import type { DrawEventStatus, RaffleStatus } from "@prisma/client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Self-contained status pills for the report (PRD AC5 / FSD Feature 1 route
// note): the report UI must not depend on admin chrome, so it does NOT import
// the admin status badges under src/app/(admin)/** — these are deliberate,
// visually equivalent local copies built only on generic ui primitives.

const RAFFLE_STYLES: Record<RaffleStatus, { label: string; className: string }> = {
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

export function ReportRaffleStatusPill({ status }: { status: RaffleStatus }) {
  const style = RAFFLE_STYLES[status];
  return (
    <Badge variant="secondary" className={style.className}>
      {style.label}
    </Badge>
  );
}

const EVENT_STYLES: Record<DrawEventStatus, { label: string; className: string }> = {
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

export function ReportEventStatusPill({
  status,
  className,
}: {
  status: DrawEventStatus;
  className?: string;
}) {
  const style = EVENT_STYLES[status];
  return (
    <Badge variant="secondary" className={cn(style.className, className)}>
      {style.label}
    </Badge>
  );
}
