"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { redrawLiveSlot } from "@/actions/draw";
import type { DrawScreenSlot } from "@/actions/draw";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { emitRedrawStart, emitRedrawResult } from "./reveal-bus";

// Live redraw confirmation — the draw screen's counterpart to the winners
// screen's RedrawDialog (E2-02 Feature 4.3). Same contract, same mandatory
// reason; it redraws a slot that is still PENDING while the show is running.
//
// Broadcast obligations (E2-01, posting funnelled through reveal-bus, the
// draw screen's single seam):
//  - `redraw-start` posts IMMEDIATELY on confirmation, BEFORE the Server
//    Action is awaited (the one permitted pre-commit message),
//  - `redraw-result` posts only AFTER the action returns success,
//  - nothing further is posted on failure or cancel (D-E13: no redraw-cancel).

/** One-tap reasons for the common live cases; still fully editable. */
const PRESET_REASONS = [
  "Winner not present at the event.",
  "Winner declined the prize.",
  "Winner ineligible on verification.",
];

export function LiveRedrawDialog({
  slot,
  roundLabel,
  onOpenChange,
  onRedrawn,
}: {
  slot: DrawScreenSlot | null;
  roundLabel: string;
  onOpenChange: (open: boolean) => void;
  /** Called with the replacement so the draw screen can swap it in place. */
  onRedrawn: (replacement: DrawScreenSlot) => void;
}) {
  const router = useRouter();
  const [reason, setReason] = React.useState("");
  const [pending, setPending] = React.useState(false);

  // Reset the reason whenever a new slot opens the dialog (render-time reset,
  // per React's "adjusting state when a prop changes" pattern).
  const slotKey = slot?.drawEventId ?? null;
  const [lastSlotKey, setLastSlotKey] = React.useState(slotKey);
  if (slotKey !== lastSlotKey) {
    setLastSlotKey(slotKey);
    setReason("");
  }

  const confirm = async () => {
    if (!slot || reason.trim().length === 0) return;
    setPending(true);
    try {
      // Pre-commit message so the display isolates this slot as "redrawing…"
      // — posted before the Server Action resolves, carries no entrant data.
      emitRedrawStart(slot.slotId);

      const result = await redrawLiveSlot({
        drawEventId: slot.drawEventId,
        reason,
      });
      if (!result.ok) {
        // Post-commit-only rule: no redraw-result (and no cancel message,
        // D-E13) for a failed action. The display recovers via a retry.
        toast.error(result.error);
        onOpenChange(false);
        router.refresh();
        return;
      }

      emitRedrawResult(result.data.slotId, result.data.replacement.fullName);

      onRedrawn({
        ...slot,
        drawEventId: result.data.replacement.drawEventId,
        winner: {
          fullName: result.data.replacement.fullName,
          ticketNumber: result.data.replacement.ticketNumber,
        },
      });
      toast.success(
        `Slot redrawn: ${result.data.replacement.fullName} (ticket #${result.data.replacement.ticketNumber}) is the new pending winner.`
      );
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog
      open={slot !== null}
      onOpenChange={(open) => !pending && onOpenChange(open)}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Redraw this slot now?</AlertDialogTitle>
          <AlertDialogDescription>
            {slot
              ? `${roundLabel} — ${slot.prizeLabel} (slot #${slot.sequenceInAllocation}) will be redrawn live. A new winner is selected from the current eligible pool and replaces this slot on the public display. The original record for ${slot.winner.fullName} (ticket #${slot.winner.ticketNumber}) will be superseded — preserved in the audit history, not deleted — and released back to the pool, so ${slot.winner.fullName} can still win a later round or redraw (but not this slot).`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="live-redraw-reason">Reason</Label>
          <div className="flex flex-wrap gap-2">
            {PRESET_REASONS.map((preset) => (
              <Button
                key={preset}
                type="button"
                variant="outline"
                size="sm"
                disabled={pending}
                onClick={() => setReason(preset)}
              >
                {preset.replace(/\.$/, "")}
              </Button>
            ))}
          </div>
          <Textarea
            id="live-redraw-reason"
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
