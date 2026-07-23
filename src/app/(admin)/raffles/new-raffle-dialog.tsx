"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createRaffle } from "@/actions/raffles";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { raffleSchema } from "@/lib/validation";

export function NewRaffleDialog({
  triggerLabel = "New raffle",
}: {
  triggerLabel?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    // Shared Zod schema is the single source of validation truth; this
    // client pass is a convenience — the Server Action re-validates.
    const parsed = raffleSchema.safeParse({ title, description });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Title is required.");
      return;
    }

    startTransition(async () => {
      const result = await createRaffle(parsed.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Raffle created.");
      setOpen(false);
      setTitle("");
      setDescription("");
      router.push(`/raffles/${result.data.id}`);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm">{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New raffle</DialogTitle>
          <DialogDescription>
            The raffle is created as a draft; you can configure prize types and
            rounds afterward.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="new-raffle-title">Title</Label>
            <Input
              id="new-raffle-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="Annual Gala 2026"
              disabled={pending}
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-raffle-description">
              Description{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="new-raffle-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              disabled={pending}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create raffle"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
