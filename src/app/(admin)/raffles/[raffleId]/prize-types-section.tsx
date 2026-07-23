"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { addPrizeType, deletePrizeType } from "@/actions/prize-types";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { prizeTypeSchema } from "@/lib/validation";

type PrizeTypeRow = {
  id: string;
  name: string;
  allocationCount: number;
};

type CascadePrompt = {
  prizeType: PrizeTypeRow;
  allocationCount: number;
};

export function PrizeTypesSection({
  raffleId,
  prizeTypes,
  mutable,
}: {
  raffleId: string;
  prizeTypes: PrizeTypeRow[];
  mutable: boolean;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [cascadePrompt, setCascadePrompt] = useState<CascadePrompt | null>(null);
  const [pending, startTransition] = useTransition();

  function handleAdd(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = prizeTypeSchema.safeParse({ name });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Prize type name is required.");
      return;
    }

    startTransition(async () => {
      const result = await addPrizeType(raffleId, parsed.data);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setName("");
      toast.success("Prize type added.");
    });
  }

  function requestDelete(prizeType: PrizeTypeRow) {
    startTransition(async () => {
      // First call without confirmation: the server decides whether this
      // delete needs the cascade confirmation (Feature D, Alt 1). The
      // confirmation must be explicit in the request, never assumed.
      const result = await deletePrizeType(prizeType.id, false);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      if (result.data.requiresConfirmation) {
        setCascadePrompt({
          prizeType,
          allocationCount: result.data.allocationCount,
        });
        return;
      }
      toast.success("Prize type deleted.");
    });
  }

  function confirmCascadeDelete() {
    const prompt = cascadePrompt;
    if (!prompt) return;
    setCascadePrompt(null);
    startTransition(async () => {
      const result = await deletePrizeType(prompt.prizeType.id, true);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Prize type and its allocations deleted.");
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Prize types</CardTitle>
        <CardDescription>
          {mutable
            ? "Prizes that rounds can allocate. A prize type belongs to this raffle only."
            : "This raffle's structure is frozen. Prize types can no longer be changed."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {prizeTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No prize types yet.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {prizeTypes.map((pt) => (
              <li
                key={pt.id}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="block truncate text-sm">{pt.name}</span>
                  {pt.allocationCount > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      Used by {pt.allocationCount} round allocation
                      {pt.allocationCount === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
                {mutable ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={pending}
                    onClick={() => requestDelete(pt)}
                  >
                    Delete
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {mutable ? (
          <form onSubmit={handleAdd} className="flex items-start gap-2" noValidate>
            <div className="flex-1 space-y-1">
              <Input
                aria-label="Prize type name"
                placeholder="e.g. Door Prize"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                disabled={pending}
                aria-invalid={error ? true : undefined}
              />
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
            <Button type="submit" size="sm" disabled={pending}>
              Add
            </Button>
          </form>
        ) : null}
      </CardContent>

      <AlertDialog
        open={cascadePrompt !== null}
        onOpenChange={(open) => {
          if (!open) setCascadePrompt(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete &ldquo;{cascadePrompt?.prizeType.name}&rdquo;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This prize type is used by{" "}
              {cascadePrompt?.allocationCount === 1
                ? "1 round allocation"
                : `${cascadePrompt?.allocationCount ?? 0} round allocations`}
              . Deleting it will also remove those allocations. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={confirmCascadeDelete}
            >
              Delete prize type and allocations
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
