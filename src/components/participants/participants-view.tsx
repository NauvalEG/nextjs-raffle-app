"use client";

import * as React from "react";
import type { RaffleStatus } from "@prisma/client";
import { PlusIcon, Trash2Icon, UploadIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AddEntrantDialog } from "@/components/participants/add-entrant-dialog";
import { ImportEntrantsDialog } from "@/components/participants/import-entrants-dialog";
import { RemoveEntrantDialog } from "@/components/participants/remove-entrant-dialog";

// Participant table (E1-02, Feature: Participant Table & Individual Add/Remove).
// Columns: ticket/ID, full name, contact, added date; sorted ticket asc (server
// supplies the order). Mutation controls are DISABLED — not hidden — with a
// tooltip when the raffle is past OPEN (FSD Alt 1 / PRD epic AC 4).

export type EntryRow = {
  id: string;
  ticketNumber: string;
  fullName: string;
  contact: string | null;
  createdAt: string; // ISO
};

const PAGE_SIZE = 100;

const TOOLTIP_ADD = "Entrants cannot be added after the raffle is locked.";
const TOOLTIP_IMPORT = "Entrants cannot be imported after the raffle is locked.";
const TOOLTIP_REMOVE = "Entrants cannot be removed after the raffle is locked.";

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
});

function DisabledWithTooltip({
  reason,
  children,
}: {
  reason: string;
  children: React.ReactNode;
}) {
  // Disabled buttons don't emit pointer events; the wrapping span carries the
  // tooltip trigger so the reason stays visible to the operator.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent>{reason}</TooltipContent>
    </Tooltip>
  );
}

export function ParticipantsView({
  raffleId,
  raffleTitle,
  raffleStatus,
  mutable,
  entries,
}: {
  raffleId: string;
  raffleTitle: string;
  raffleStatus: RaffleStatus;
  mutable: boolean;
  entries: EntryRow[];
}) {
  const [page, setPage] = React.useState(1);
  const [addOpen, setAddOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [removeTarget, setRemoveTarget] = React.useState<EntryRow | null>(null);

  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageEntries =
    entries.length > PAGE_SIZE
      ? entries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
      : entries;

  const existingTickets = React.useMemo(
    () => entries.map((e) => e.ticketNumber),
    [entries]
  );

  const addButton = (
    <Button size="sm" disabled={!mutable} onClick={() => setAddOpen(true)}>
      <PlusIcon className="size-4" />
      Add entrant
    </Button>
  );
  const importButton = (
    <Button size="sm" variant="outline" disabled={!mutable} onClick={() => setImportOpen(true)}>
      <UploadIcon className="size-4" />
      Import entrants
    </Button>
  );

  return (
    <TooltipProvider>
      <div className="mx-auto w-full max-w-5xl space-y-4 p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">{raffleTitle} — Participants</h1>
            <p className="text-sm text-muted-foreground">
              {/* Entrant count above the table — feeds E1-03's allocation indicator. */}
              {entries.length} entrant{entries.length === 1 ? "" : "s"}
              <Badge variant="outline" className="ml-2 align-middle">
                {raffleStatus}
              </Badge>
            </p>
          </div>
          <div className="flex gap-2">
            {mutable ? (
              importButton
            ) : (
              <DisabledWithTooltip reason={TOOLTIP_IMPORT}>{importButton}</DisabledWithTooltip>
            )}
            {mutable ? (
              addButton
            ) : (
              <DisabledWithTooltip reason={TOOLTIP_ADD}>{addButton}</DisabledWithTooltip>
            )}
          </div>
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Ticket/ID</TableHead>
                <TableHead>Full name</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead className="w-36">Added</TableHead>
                <TableHead className="w-16">
                  <span className="sr-only">Remove</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    No entrants yet. Import a CSV or add entrants individually.
                  </TableCell>
                </TableRow>
              ) : (
                pageEntries.map((entry) => {
                  const removeButton = (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove entrant ${entry.fullName} (ticket ${entry.ticketNumber})`}
                      disabled={!mutable}
                      onClick={() => setRemoveTarget(entry)}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  );
                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono">{entry.ticketNumber}</TableCell>
                      <TableCell>{entry.fullName}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {entry.contact ?? ""}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {dateFormat.format(new Date(entry.createdAt))}
                      </TableCell>
                      <TableCell className="text-right">
                        {mutable ? (
                          removeButton
                        ) : (
                          <DisabledWithTooltip reason={TOOLTIP_REMOVE}>
                            {removeButton}
                          </DisabledWithTooltip>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {(currentPage - 1) * PAGE_SIZE + 1}–
              {Math.min(currentPage * PAGE_SIZE, entries.length)} of {entries.length}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={currentPage <= 1}
                onClick={() => setPage(currentPage - 1)}
              >
                Previous
              </Button>
              <span>
                Page {currentPage} of {totalPages}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={currentPage >= totalPages}
                onClick={() => setPage(currentPage + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}

        <AddEntrantDialog raffleId={raffleId} open={addOpen} onOpenChange={setAddOpen} />
        <ImportEntrantsDialog
          raffleId={raffleId}
          open={importOpen}
          onOpenChange={setImportOpen}
          existingTickets={existingTickets}
        />
        <RemoveEntrantDialog
          entry={removeTarget}
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null);
          }}
        />
      </div>
    </TooltipProvider>
  );
}
