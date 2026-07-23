"use client";

import * as React from "react";
import { LockIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { lockRaffle } from "@/actions/lock";

// Persistent footer bar (E1-03 Feature C + D): the live "X of Y entrants
// allocated" counter — neutral while X ≤ Y, a destructive alert while X > Y —
// and the "Lock raffle" button with its confirming AlertDialog. Pinned to the
// bottom of the Rounds screen regardless of scroll position.

export function LockFooter({
  raffleId,
  status,
  totalPlanned,
  entryCount,
  editable,
}: {
  raffleId: string;
  status: string;
  totalPlanned: number;
  entryCount: number;
  editable: boolean;
}) {
  const [pending, startTransition] = React.useTransition();
  const overAllocated = totalPlanned > entryCount;

  function confirmLock() {
    startTransition(async () => {
      const result = await lockRaffle(raffleId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Raffle locked. Rounds, allocations, and entrants are now frozen.");
    });
  }

  return (
    <div className="bg-background/95 supports-[backdrop-filter]:bg-background/80 sticky bottom-0 z-20 mt-6 border-t py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-3">
        {overAllocated ? (
          <Alert variant="destructive" className="flex-1 basis-64 border-destructive/50">
            <TriangleAlertIcon />
            <AlertTitle>
              {totalPlanned} of {entryCount} entrants allocated — reduce allocations or
              add entrants before locking.
            </AlertTitle>
            <AlertDescription>
              The raffle cannot be locked while planned draws exceed entrants.
            </AlertDescription>
          </Alert>
        ) : (
          <p className="flex-1 basis-64 text-sm font-medium">
            {totalPlanned} of {entryCount} entrants allocated
          </p>
        )}

        {editable ? (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" disabled={overAllocated || pending}>
                <LockIcon className="size-4" />
                Lock raffle
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Lock this raffle?</AlertDialogTitle>
                <AlertDialogDescription>
                  Locking makes the raffle structurally immutable: rounds, allocations,
                  and entrants can no longer be changed, and drawing becomes available.
                  There is no unlock.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={confirmLock}>Lock raffle</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        ) : (
          <Badge variant="secondary">
            <LockIcon className="size-3" />
            {status === "LOCKED" ? "Locked" : status.charAt(0) + status.slice(1).toLowerCase()}
          </Badge>
        )}
      </div>
    </div>
  );
}
