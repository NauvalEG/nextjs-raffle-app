"use client";

import * as React from "react";
import { Download, FileText } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

// Export triggers (E3-01 Features 2 & 3). When the raffle is not COMPLETED a
// confirmation dialog interposes (D-E27 / FSD Feature 2 Alt 1) — the routes
// themselves never block on status; this soft guard is purely client-side.
// Confirmed (or completed-raffle) clicks navigate to the export route; the
// Content-Disposition: attachment response downloads without leaving the page.

type ExportKind = "results" | "log";

export function ExportButtons({
  raffleId,
  completed,
}: {
  raffleId: string;
  completed: boolean;
}) {
  const [pendingKind, setPendingKind] = React.useState<ExportKind | null>(null);

  const download = (kind: ExportKind) => {
    window.location.assign(`/api/raffles/${raffleId}/export/${kind}`);
  };

  const handleClick = (kind: ExportKind) => {
    if (completed) download(kind);
    else setPendingKind(kind); // soft guard: confirm first (Alt 1)
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => handleClick("results")}>
          <Download className="size-3.5" />
          Export results CSV
        </Button>
        <Button variant="outline" size="sm" onClick={() => handleClick("log")}>
          <FileText className="size-3.5" />
          Export complete log
        </Button>
      </div>

      <AlertDialog
        open={pendingKind !== null}
        onOpenChange={(open) => !open && setPendingKind(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Raffle not completed</AlertDialogTitle>
            <AlertDialogDescription>
              This raffle is not completed. The export will reflect the current
              state, not final results. Export anyway?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingKind) download(pendingKind);
              }}
            >
              Export anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
