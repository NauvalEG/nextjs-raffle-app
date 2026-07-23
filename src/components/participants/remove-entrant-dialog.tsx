"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { removeEntrant } from "@/actions/entrants";
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
import type { EntryRow } from "@/components/participants/participants-view";

// Remove confirmation (E1-02 Remove Happy Path Step 2): states the entrant's
// ticket # and full name AND that the ticket number will not be reusable —
// "Irreversible means visibly irreversible" (PRD UX principle).

export function RemoveEntrantDialog({
  entry,
  onOpenChange,
}: {
  entry: EntryRow | null;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  const confirm = async () => {
    if (!entry) return;
    setPending(true);
    try {
      const result = await removeEntrant(entry.id);
      if (!result.ok) {
        toast.error(result.error);
      } else {
        toast.success(`Removed ${entry.fullName} (ticket ${entry.ticketNumber}).`);
      }
      onOpenChange(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <AlertDialog open={entry !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove entrant?</AlertDialogTitle>
          <AlertDialogDescription>
            {entry
              ? `This will remove ${entry.fullName} (ticket #${entry.ticketNumber}) from the raffle. Ticket number ${entry.ticketNumber} will not be reusable in this raffle.`
              : ""}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(e) => {
              e.preventDefault(); // keep the dialog open while pending
              void confirm();
            }}
          >
            {pending ? "Removing…" : "Remove entrant"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
