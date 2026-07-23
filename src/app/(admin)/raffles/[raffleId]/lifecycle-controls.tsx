"use client";

import type { RaffleStatus } from "@prisma/client";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { transitionRaffleStatus } from "@/actions/raffles";
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
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Lifecycle controls owned by E1-01: DRAFT→OPEN and DRAWN→COMPLETED.
// The Lock action (OPEN→LOCKED) is E1-03's deliverable and the LOCKED→DRAWN
// transition belongs to the draw engine (E1-04) — neither is rendered here.
export function LifecycleControls({
  raffleId,
  status,
}: {
  raffleId: string;
  status: RaffleStatus;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const transition =
    status === "DRAFT"
      ? {
          target: "OPEN" as const,
          buttonLabel: "Open raffle",
          title: "Open this raffle?",
          description:
            "Opening marks configuration as active. You can still edit the raffle's details, prize types, participants, and rounds while it is open — but a draft can never be returned to; there are no backward status transitions.",
          successToast: "Raffle opened.",
        }
      : status === "DRAWN"
        ? {
            target: "COMPLETED" as const,
            buttonLabel: "Complete raffle",
            title: "Complete this raffle?",
            description:
              "Completing closes the event permanently. Winner status changes and redraws become impossible, and the raffle can never be reopened — this is irreversible.",
            successToast: "Raffle completed.",
          }
        : null;

  if (!transition) {
    return null;
  }

  function performTransition() {
    if (!transition) return;
    setDialogOpen(false);
    startTransition(async () => {
      const result = await transitionRaffleStatus(raffleId, transition.target);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(transition.successToast);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Lifecycle</CardTitle>
        <CardDescription>
          Status transitions are forward-only and enforced server-side.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <AlertDialogTrigger asChild>
            <Button size="sm" disabled={pending}>
              {pending ? "Working…" : transition.buttonLabel}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{transition.title}</AlertDialogTitle>
              <AlertDialogDescription>
                {transition.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={performTransition}>
                {transition.buttonLabel}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
