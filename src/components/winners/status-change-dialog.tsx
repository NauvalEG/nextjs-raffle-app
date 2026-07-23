"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { changeDrawEventStatus, type WinnerRow } from "@/actions/winners";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

// Status-change dialog (E2-02 Feature 4.2): names the action, the entrant,
// and the slot (round + prize); mandatory reason Textarea; submit disabled
// until at least one non-whitespace character (the server re-validates
// independently via the shared Zod schema).

export type StatusChangeTarget = {
  row: WinnerRow;
  newStatus: "CLAIMED" | "DISQUALIFIED" | "RELEASED_TO_POOL";
};

const ACTION_LABELS: Record<StatusChangeTarget["newStatus"], { title: string; verb: string }> = {
  CLAIMED: { title: "Mark claimed", verb: "mark as claimed" },
  DISQUALIFIED: { title: "Disqualify", verb: "disqualify" },
  RELEASED_TO_POOL: { title: "Release to pool", verb: "release back to the pool" },
};

export function StatusChangeDialog({
  target,
  onOpenChange,
}: {
  target: StatusChangeTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  // Reset the reason whenever a new dialog target opens (render-time reset,
  // per React's "adjusting state when a prop changes" pattern).
  const targetKey = target ? `${target.row.drawEventId}:${target.newStatus}` : null;
  const [lastTargetKey, setLastTargetKey] = React.useState(targetKey);
  if (targetKey !== lastTargetKey) {
    setLastTargetKey(targetKey);
    setReason("");
  }

  const submit = async () => {
    if (!target || reason.trim().length === 0) return;
    setPending(true);
    try {
      const result = await changeDrawEventStatus({
        drawEventId: target.row.drawEventId,
        newStatus: target.newStatus,
        reason,
      });
      if (!result.ok) {
        // Stale row / superseded / frozen: surface the exact server message
        // and refresh the row to the persisted state (FSD 4.2 Alt 2).
        toast.error(result.error);
      } else {
        toast.success(
          `${ACTION_LABELS[target.newStatus].title}: ${target.row.fullName} (ticket #${target.row.ticketNumber}).`
        );
      }
      onOpenChange(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  const labels = target ? ACTION_LABELS[target.newStatus] : null;

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !pending && onOpenChange(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{labels?.title}</DialogTitle>
          <DialogDescription>
            {target && labels
              ? `You are about to ${labels.verb} ${target.row.fullName} (ticket #${target.row.ticketNumber}) for ${target.row.roundLabel} — ${target.row.prizeName} (slot #${target.row.sequenceInAllocation}). A reason is required and will be recorded in the audit log.`
              : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="status-change-reason">Reason</Label>
          <Textarea
            id="status-change-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="Why is this status changing?"
            disabled={pending}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || reason.trim().length === 0}
            onClick={() => void submit()}
          >
            {pending ? "Saving…" : labels?.title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
