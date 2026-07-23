"use client";

import * as React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { roundSchema } from "@/lib/validation";
import { updateRound, deleteRound } from "@/actions/rounds";
import { AllocationRow, PendingAllocationRow } from "./allocation-row";
import type { PrizeTypeOption, RevealModeValue, RoundData } from "./types";

// One sortable accordion item: drag handle, label input (commit on blur),
// reveal-mode select, delete (confirmed when the round has allocations —
// E1-03 Feature A Alt 2), and the round's allocation rows.

export function RoundItem({
  round,
  position,
  prizeTypes,
  editable,
  autoFocusLabel,
}: {
  round: RoundData;
  position: number;
  prizeTypes: PrizeTypeOption[];
  editable: boolean;
  autoFocusLabel: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: round.id, disabled: !editable });

  const [label, setLabel] = React.useState(round.label);
  const [addingAllocation, setAddingAllocation] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  React.useEffect(() => {
    setLabel(round.label);
  }, [round.label]);

  const plannedInRound = round.allocations.reduce((sum, a) => sum + a.quantity, 0);

  function commitLabel() {
    const trimmed = label.trim();
    if (trimmed === round.label) {
      setLabel(round.label);
      return;
    }
    const parsed = roundSchema.shape.label.safeParse(trimmed);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Round label is required.");
      setLabel(round.label);
      return;
    }
    startTransition(async () => {
      const result = await updateRound(round.id, {
        label: parsed.data,
        revealMode: round.revealMode,
      });
      if (!result.ok) {
        toast.error(result.error);
        setLabel(round.label);
      }
    });
  }

  function commitRevealMode(mode: RevealModeValue) {
    if (mode === round.revealMode) return;
    startTransition(async () => {
      const result = await updateRound(round.id, {
        label: round.label,
        revealMode: mode,
      });
      if (!result.ok) toast.error(result.error);
    });
  }

  function removeRound() {
    startTransition(async () => {
      const result = await deleteRound(round.id);
      if (!result.ok) toast.error(result.error);
    });
  }

  const deleteButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={`Delete round ${round.label}`}
      disabled={pending}
    >
      <Trash2Icon className="size-4" />
    </Button>
  );

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={isDragging ? "relative z-10 opacity-80" : undefined}
    >
      <AccordionItem value={round.id} className="rounded-lg border px-3 not-last:mb-2">
        <div className="flex items-center gap-1">
          {editable ? (
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground cursor-grab touch-none py-2"
              aria-label={`Drag to reorder round ${round.label}`}
              {...attributes}
              {...listeners}
            >
              <GripVerticalIcon className="size-4" />
            </button>
          ) : null}
          <AccordionTrigger className="hover:no-underline">
            <span className="flex items-baseline gap-2">
              <span className="text-muted-foreground tabular-nums">{position}.</span>
              <span>{round.label}</span>
              <span className="text-muted-foreground text-xs font-normal">
                {plannedInRound} planned {plannedInRound === 1 ? "draw" : "draws"} ·{" "}
                {round.revealMode === "SEQUENTIAL" ? "Sequential" : "Simultaneous"}
              </span>
            </span>
          </AccordionTrigger>
        </div>
        <AccordionContent className="space-y-4 pl-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor={`round-label-${round.id}`}>Label</Label>
              <Input
                id={`round-label-${round.id}`}
                className="w-64"
                value={label}
                maxLength={100}
                disabled={!editable || pending}
                autoFocus={autoFocusLabel}
                onChange={(e) => setLabel(e.target.value)}
                onBlur={commitLabel}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`round-reveal-${round.id}`}>Reveal mode</Label>
              <Select
                value={round.revealMode}
                disabled={!editable || pending}
                onValueChange={(v) => commitRevealMode(v as RevealModeValue)}
              >
                <SelectTrigger id={`round-reveal-${round.id}`} className="w-44">
                  <SelectValue placeholder="Choose a reveal mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="SEQUENTIAL">Sequential</SelectItem>
                  <SelectItem value="SIMULTANEOUS">Simultaneous</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editable ? (
              <div className="ml-auto">
                {round.allocations.length > 0 ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>{deleteButton}</AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          Delete round &ldquo;{round.label}&rdquo;?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          This round has {round.allocations.length}{" "}
                          {round.allocations.length === 1 ? "allocation" : "allocations"}{" "}
                          totaling {plannedInRound} planned{" "}
                          {plannedInRound === 1 ? "draw" : "draws"}. Deleting the round
                          removes its allocations as well. Remaining rounds are
                          renumbered.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={removeRound}>
                          Delete round
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Delete round ${round.label}`}
                    disabled={pending}
                    onClick={removeRound}
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                )}
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
              Allocations
            </div>
            {round.allocations.length === 0 && !addingAllocation ? (
              <p className="text-muted-foreground text-sm">
                No allocations yet — this round plans zero draws.
              </p>
            ) : null}
            {round.allocations.map((allocation) => (
              <AllocationRow
                key={allocation.id}
                allocation={allocation}
                prizeTypes={prizeTypes}
                editable={editable}
              />
            ))}
            {addingAllocation ? (
              <PendingAllocationRow
                roundId={round.id}
                prizeTypes={prizeTypes}
                onDone={() => setAddingAllocation(false)}
              />
            ) : null}
            {editable ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={prizeTypes.length === 0 || addingAllocation}
                  onClick={() => setAddingAllocation(true)}
                >
                  <PlusIcon className="size-4" />
                  Add allocation
                </Button>
                {prizeTypes.length === 0 ? (
                  <span className="text-muted-foreground text-xs">
                    Add prize types on the Prize Types screen before allocating.
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
        </AccordionContent>
      </AccordionItem>
    </div>
  );
}
