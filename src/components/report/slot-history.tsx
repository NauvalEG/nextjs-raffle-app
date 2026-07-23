"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import type { ReportHistoryEvent } from "@/lib/report-data";
import { ReportEventStatusPill } from "@/components/report/status-pills";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

// Per-slot supersession history (E3-01 Feature 1, S2 / B-5): collapsed by
// default; expanding reveals every superseded predecessor oldest-first with
// entrant, terminal status, timestamp, and — since the route is admin-gated
// in v1 — the recorded reason. Rendered only for slots that HAVE history;
// slots without supersessions never mount this component (Alt 3).

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function SlotHistory({ history }: { history: ReportHistoryEvent[] }) {
  const [open, setOpen] = React.useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
        aria-label={open ? "Collapse redraw history" : "Expand redraw history"}
      >
        {open ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        History ({history.length} superseded)
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-2 space-y-2 border-l-2 border-dashed pl-4">
          {history.map((event) => (
            <li key={event.drawEventId} className="text-sm text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium line-through decoration-muted-foreground/50">
                  {event.fullName}
                </span>
                <span>#{event.ticketNumber}</span>
                <ReportEventStatusPill status={event.status} className="opacity-80" />
                <span className="text-xs" suppressHydrationWarning>
                  drawn {formatTimestamp(event.createdAt)}
                </span>
              </div>
              {event.reason !== null && (
                <p className="mt-0.5 text-xs">Reason: {event.reason}</p>
              )}
            </li>
          ))}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}
