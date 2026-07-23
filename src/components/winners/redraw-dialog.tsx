"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { redrawSlot, type WinnerRow } from "@/actions/winners";
import { channelName, slotId, type DisplayMessage } from "@/lib/broadcast";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Redraw confirmation (E2-02 Feature 4.3): states which slot will be redrawn
// and that the original record is SUPERSEDED, not deleted. Mandatory reason,
// same pattern as status changes.
//
// Broadcast obligations (touchpoint with E2-01, posting owned here):
//  - `redraw-start` posts IMMEDIATELY on confirmation, BEFORE the Server
//    Action is awaited (the one permitted pre-commit message),
//  - `redraw-result` posts only AFTER the action returns success,
//  - nothing further is posted on failure or cancel (D-E13: no redraw-cancel).
// BroadcastChannel is constructed client-side only (SSR guard).

export function RedrawDialog({
  raffleId,
  row,
  onOpenChange,
}: {
  raffleId: string;
  row: WinnerRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  // Reset the reason whenever a new row opens the dialog (render-time reset,
  // per React's "adjusting state when a prop changes" pattern).
  const rowKey = row?.drawEventId ?? null;
  const [lastRowKey, setLastRowKey] = React.useState(rowKey);
  if (rowKey !== lastRowKey) {
    setLastRowKey(rowKey);
    setReason("");
  }

  const confirm = async () => {
    if (!row || reason.trim().length === 0) return;
    setPending(true);
    const channel =
      typeof window !== "undefined" && "BroadcastChannel" in window
        ? new BroadcastChannel(channelName(raffleId))
        : null;
    try {
      // Pre-commit message so the display isolates this slot as "redrawing…"
      // — posted before the Server Action resolves, carries no entrant data.
      const startMessage: DisplayMessage = {
        type: "redraw-start",
        slotId: slotId(row.roundAllocationId, row.sequenceInAllocation),
      };
      channel?.postMessage(startMessage);

      const result = await redrawSlot({ drawEventId: row.drawEventId, reason });
      if (!result.ok) {
        // Post-commit-only rule: no redraw-result (and no cancel message,
        // D-E13) for a failed action. The display recovers via a retry.
        toast.error(result.error);
        onOpenChange(false);
        router.refresh();
        return;
      }

      const resultMessage: DisplayMessage = {
        type: "redraw-result",
        slotId: result.data.slotId,
        fullName: result.data.replacement.fullName,
      };
      channel?.postMessage(resultMessage);

      toast.success(
        `Slot redrawn: ${result.data.replacement.fullName} (ticket #${result.data.replacement.ticketNumber}) is the new pending winner.`
      );
      onOpenChange(false);
      router.refresh();
    } finally {
      channel?.close();
      setPending(false);
    }
  };

  return (
    <AlertDialog open={row !== null} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Redraw this slot?</AlertDialogTitle>
          <AlertDialogDescription>
            {row
              ? `${row.roundLabel} — ${row.prizeName} (slot #${row.sequenceInAllocation}) will be redrawn. A new winner is selected from the live eligible pool. The original record for ${row.fullName} (ticket #${row.ticketNumber}) will be superseded — preserved in the audit history, not deleted.`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="redraw-reason">Reason</Label>
          <Textarea
            id="redraw-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Why is this slot being redrawn?"
            disabled={pending}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || reason.trim().length === 0}
            onClick={() => void confirm()}
          >
            {pending ? "Redrawing…" : "Redraw slot"}
          </Button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
