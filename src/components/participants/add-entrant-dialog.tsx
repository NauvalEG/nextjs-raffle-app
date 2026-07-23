"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { addEntrant } from "@/actions/entrants";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { entrantSchema } from "@/lib/validation";

// Individual add form (E1-02 Feature: Participant Table & Individual Add).
// Client validation uses the same entrantSchema the Server Action re-runs.

export function AddEntrantDialog({
  raffleId,
  open,
  onOpenChange,
}: {
  raffleId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [ticket, setTicket] = React.useState("");
  const [fullName, setFullName] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const reset = () => {
    setTicket("");
    setFullName("");
    setContact("");
    setError(null);
    setPending(false);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const ticketTrimmed = ticket.trim();
    if (ticketTrimmed === "") {
      setError("Missing ticket/ID");
      return;
    }
    const ticketNumber = /^\d+$/.test(ticketTrimmed) ? Number(ticketTrimmed) : NaN;
    const parsed = entrantSchema.safeParse({
      ticketNumber,
      fullName,
      contact,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid entrant.");
      return;
    }

    setPending(true);
    try {
      const result = await addEntrant(raffleId, parsed.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success(`Entrant added with ticket ${parsed.data.ticketNumber}.`);
      handleOpenChange(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add entrant</DialogTitle>
          <DialogDescription>
            Ticket numbers must be unique within this raffle and are never reused, even
            after removal.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="add-entrant-ticket">Ticket #</Label>
            <Input
              id="add-entrant-ticket"
              inputMode="numeric"
              autoComplete="off"
              value={ticket}
              onChange={(e) => setTicket(e.target.value)}
              placeholder="e.g. 42"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-entrant-name">Full name</Label>
            <Input
              id="add-entrant-name"
              autoComplete="off"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="add-entrant-contact">Contact (optional)</Label>
            <Input
              id="add-entrant-contact"
              autoComplete="off"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              maxLength={200}
              placeholder="Email or phone"
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : "Add entrant"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
