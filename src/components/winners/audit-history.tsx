"use client";

import type { WinnerRow } from "@/actions/winners";
import { Badge } from "@/components/ui/badge";
import { WinnerStatusBadge } from "@/components/winners/winner-status-badge";

// Expandable audit history (E2-02 Feature 4.4): the slot's COMPLETE chain —
// every AuditLog entry of the current event and of every superseded
// predecessor, chronological oldest-first, each entry visibly attributed to
// the event it belongs to. Strictly read-only by construction: no edit,
// delete, or annotate affordance exists on any entry. Rendered from the
// preloaded winners-screen state (no lazy fetch, so no fetch-error state).

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join(", ");
  }
  return String(value);
}

function formatTimestamp(iso: string): string {
  // Browser-local timezone (FSD 4.1 Rule 3 / A6); stored values are UTC.
  return new Date(iso).toLocaleString();
}

export function AuditHistory({ row }: { row: WinnerRow }) {
  const eventById = new Map(row.chain.map((e) => [e.drawEventId, e]));

  return (
    <div className="space-y-4 py-2">
      {row.chain.length > 1 && (
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Supersession chain
          </p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {row.chain.map((event, i) => (
              <span key={event.drawEventId} className="flex items-center gap-2">
                {i > 0 && <span className="text-muted-foreground">→</span>}
                <span className="flex items-center gap-1.5">
                  <span>
                    {event.fullName}{" "}
                    <span className="text-muted-foreground">
                      (ticket #{event.ticketNumber})
                    </span>
                  </span>
                  <WinnerStatusBadge status={event.status} />
                  {!event.isCurrent && (
                    <Badge variant="outline" className="text-muted-foreground">
                      superseded
                    </Badge>
                  )}
                </span>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Audit history
        </p>
        {row.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No audit entries yet for this slot.
          </p>
        ) : (
          <ol className="space-y-2">
            {row.history.map((entry) => {
              const owner = eventById.get(entry.drawEventId);
              return (
                <li
                  key={entry.id}
                  className="rounded-md border bg-background p-3 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{entry.action}</span>
                    {entry.belongsToCurrent ? (
                      <Badge variant="outline">current event</Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-400"
                      >
                        superseded — original draw
                        {owner ? ` (${owner.fullName})` : ""}
                      </Badge>
                    )}
                    <span
                      className="ml-auto text-xs text-muted-foreground"
                      suppressHydrationWarning
                    >
                      {formatTimestamp(entry.createdAt)}
                    </span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {formatValue(entry.oldValue)}{" "}
                    <span aria-hidden="true">→</span> {formatValue(entry.newValue)}
                  </div>
                  {entry.reason && (
                    <div className="mt-1">
                      <span className="text-muted-foreground">Reason:</span>{" "}
                      {entry.reason}
                    </div>
                  )}
                  <div className="mt-1 text-xs text-muted-foreground">
                    Actor: {entry.actor}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}
