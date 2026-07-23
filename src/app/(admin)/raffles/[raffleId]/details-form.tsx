"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { updateRaffle } from "@/actions/raffles";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { raffleSchema } from "@/lib/validation";

export function DetailsForm({
  raffleId,
  initialTitle,
  initialDescription,
  mutable,
}: {
  raffleId: string;
  initialTitle: string;
  initialDescription: string;
  mutable: boolean;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = raffleSchema.safeParse({ title, description });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Title is required.");
      return;
    }

    startTransition(async () => {
      const result = await updateRaffle(raffleId, parsed.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast.success("Raffle details saved.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Raffle details</CardTitle>
        {!mutable ? (
          <CardDescription>
            This raffle&apos;s structure is frozen. Its title and description
            can no longer be edited.
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor="raffle-title">Title</Label>
            <Input
              id="raffle-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              readOnly={!mutable}
              disabled={pending}
              aria-invalid={error ? true : undefined}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="raffle-description">
              Description{" "}
              <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="raffle-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              rows={3}
              readOnly={!mutable}
              disabled={pending}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {mutable ? (
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "Saving…" : "Save details"}
            </Button>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
