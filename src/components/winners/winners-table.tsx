"use client";

import * as React from "react";
import type { DrawEventStatus } from "@prisma/client";
import { ChevronDown, ChevronRight, MoreHorizontal, RotateCcw } from "lucide-react";

import type { WinnerRow, WinnersScreenState } from "@/actions/winners";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AuditHistory } from "@/components/winners/audit-history";
import { RedrawDialog } from "@/components/winners/redraw-dialog";
import {
  StatusChangeDialog,
  type StatusChangeTarget,
} from "@/components/winners/status-change-dialog";
import { WinnerStatusBadge } from "@/components/winners/winner-status-badge";

// Winners table (E2-02 Feature 4.1): one row per CURRENT DrawEvent; status
// and round Select filters (both default "All", combined as AND); row-action
// DropdownMenu offering ONLY the legal actions (PENDING rows only — D-E10 /
// D-E11 make every other status terminal for direct change); Redraw button
// ONLY on disqualified / released rows (absent, not disabled, elsewhere);
// expandable per-row audit history. COMPLETED raffles render read-only.

const STATUS_FILTER_OPTIONS: { value: DrawEventStatus; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "CLAIMED", label: "Claimed" },
  { value: "DISQUALIFIED", label: "Disqualified" },
  { value: "RELEASED_TO_POOL", label: "Released to pool" },
];

function formatTimestamp(iso: string): string {
  // Browser-local timezone (FSD 4.1 Rule 3 / A6).
  return new Date(iso).toLocaleString();
}

export function WinnersTable({ state }: { state: WinnersScreenState }) {
  const [statusFilter, setStatusFilter] = React.useState<"ALL" | DrawEventStatus>("ALL");
  const [roundFilter, setRoundFilter] = React.useState<string>("ALL");
  const [expanded, setExpanded] = React.useState<Set<string>>(new Set());
  const [statusTarget, setStatusTarget] = React.useState<StatusChangeTarget | null>(null);
  const [redrawTarget, setRedrawTarget] = React.useState<WinnerRow | null>(null);

  const completed = state.raffleStatus === "COMPLETED";
  const actionsEnabled = state.raffleStatus === "DRAWN";

  // Empty state — no draws yet (FSD 4.1 Alt 1): no filters active.
  if (state.rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
        No winners drawn yet.
      </div>
    );
  }

  const filtered = state.rows.filter(
    (row) =>
      (statusFilter === "ALL" || row.status === statusFilter) &&
      (roundFilter === "ALL" || row.roundId === roundFilter)
  );

  const toggleExpanded = (drawEventId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(drawEventId)) next.delete(drawEventId);
      else next.add(drawEventId);
      return next;
    });
  };

  const activeFilterNames = [
    statusFilter !== "ALL"
      ? `status "${STATUS_FILTER_OPTIONS.find((o) => o.value === statusFilter)?.label}"`
      : null,
    roundFilter !== "ALL"
      ? `round "${state.rounds.find((r) => r.id === roundFilter)?.label}"`
      : null,
  ].filter((s): s is string => s !== null);

  return (
    <div className="space-y-4">
      {completed && (
        <Alert>
          <AlertTitle>This raffle is completed</AlertTitle>
          <AlertDescription>
            Winner records are frozen. Statuses can no longer be changed and slots can no
            longer be redrawn. The audit history remains available below.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as "ALL" | DrawEventStatus)}
        >
          <SelectTrigger className="w-[190px]" aria-label="Filter by status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUS_FILTER_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={roundFilter} onValueChange={setRoundFilter}>
          <SelectTrigger className="w-[190px]" aria-label="Filter by round">
            <SelectValue placeholder="Round" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All rounds</SelectItem>
            {state.rounds.map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead>Round</TableHead>
              <TableHead>Prize</TableHead>
              <TableHead>Entrant</TableHead>
              <TableHead>Ticket #</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Drawn at</TableHead>
              <TableHead className="w-[180px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  <div className="space-y-2">
                    <p>No winners match {activeFilterNames.join(" and ")}.</p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setStatusFilter("ALL");
                        setRoundFilter("ALL");
                      }}
                    >
                      Clear filters
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => {
                const isExpanded = expanded.has(row.drawEventId);
                const canChangeStatus = actionsEnabled && row.status === "PENDING";
                const canRedraw =
                  actionsEnabled &&
                  (row.status === "DISQUALIFIED" || row.status === "RELEASED_TO_POOL");
                return (
                  <React.Fragment key={row.drawEventId}>
                    <TableRow>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => toggleExpanded(row.drawEventId)}
                          aria-expanded={isExpanded}
                          aria-label={
                            isExpanded ? "Collapse audit history" : "Expand audit history"
                          }
                        >
                          {isExpanded ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell>{row.roundLabel}</TableCell>
                      <TableCell>
                        {row.prizeName}
                        <span className="ml-1 text-xs text-muted-foreground">
                          #{row.sequenceInAllocation}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">{row.fullName}</TableCell>
                      <TableCell>{row.ticketNumber}</TableCell>
                      <TableCell>
                        <WinnerStatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="text-muted-foreground" suppressHydrationWarning>
                        {formatTimestamp(row.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canRedraw && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setRedrawTarget(row)}
                            >
                              <RotateCcw className="size-3.5" />
                              Redraw
                            </Button>
                          )}
                          {canChangeStatus && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-7"
                                  aria-label={`Actions for ${row.fullName}`}
                                >
                                  <MoreHorizontal className="size-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem
                                  onSelect={() =>
                                    setStatusTarget({ row, newStatus: "CLAIMED" })
                                  }
                                >
                                  Mark claimed
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() =>
                                    setStatusTarget({ row, newStatus: "DISQUALIFIED" })
                                  }
                                >
                                  Disqualify
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onSelect={() =>
                                    setStatusTarget({ row, newStatus: "RELEASED_TO_POOL" })
                                  }
                                >
                                  Release to pool
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpanded && (
                      <TableRow className="bg-muted/30 hover:bg-muted/30">
                        <TableCell colSpan={8} className="px-6">
                          <AuditHistory row={row} />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      <StatusChangeDialog
        target={statusTarget}
        onOpenChange={(open) => !open && setStatusTarget(null)}
      />
      <RedrawDialog
        raffleId={state.raffleId}
        row={redrawTarget}
        onOpenChange={(open) => !open && setRedrawTarget(null)}
      />
    </div>
  );
}
