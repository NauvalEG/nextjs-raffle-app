"use client";

import * as React from "react";
import { Trash2Icon, CheckIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { allocationSchema } from "@/lib/validation";
import { createAllocation, updateAllocation, deleteAllocation } from "@/actions/allocations";
import type { AllocationData, PrizeTypeOption } from "./types";

// One persisted allocation row: prize-type select (fixed once saved — change
// by deleting the row and adding another), quantity input committed on blur,
// and a plain delete button (no confirmation, E1-03 A3).

export function AllocationRow({
  allocation,
  prizeTypes,
  editable,
}: {
  allocation: AllocationData;
  prizeTypes: PrizeTypeOption[];
  editable: boolean;
}) {
  const [quantity, setQuantity] = React.useState(String(allocation.quantity));
  const [pending, startTransition] = React.useTransition();

  // Reflect server-refreshed values (e.g. after a failed save was reverted).
  React.useEffect(() => {
    setQuantity(String(allocation.quantity));
  }, [allocation.quantity]);

  const prizeTypeMissing = !prizeTypes.some((p) => p.id === allocation.prizeTypeId);

  function commitQuantity() {
    const next = Number(quantity);
    if (next === allocation.quantity) return;
    const parsed = allocationSchema.shape.quantity.safeParse(next);
    if (!parsed.success) {
      toast.error(
        parsed.error.issues[0]?.message ?? "Quantity must be a whole number of at least 1."
      );
      setQuantity(String(allocation.quantity));
      return;
    }
    startTransition(async () => {
      const result = await updateAllocation(allocation.id, { quantity: parsed.data });
      if (!result.ok) {
        toast.error(result.error);
        setQuantity(String(allocation.quantity));
      }
    });
  }

  function remove() {
    startTransition(async () => {
      const result = await deleteAllocation(allocation.id);
      if (!result.ok) toast.error(result.error);
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={allocation.prizeTypeId} disabled>
        <SelectTrigger className="w-56" aria-label="Prize type">
          <SelectValue
            placeholder={prizeTypeMissing ? "Prize type no longer exists" : "Prize type"}
          />
        </SelectTrigger>
        <SelectContent>
          {prizeTypes.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
          {prizeTypeMissing ? (
            <SelectItem value={allocation.prizeTypeId}>Deleted prize type</SelectItem>
          ) : null}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground text-sm">×</span>
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        max={10000}
        step={1}
        className="w-24"
        aria-label="Quantity"
        value={quantity}
        disabled={!editable || pending}
        onChange={(e) => setQuantity(e.target.value)}
        onBlur={commitQuantity}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
      {editable ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Delete allocation"
          disabled={pending}
          onClick={remove}
        >
          <Trash2Icon className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

// A not-yet-persisted allocation row rendered after "Add allocation": pick a
// prize type and a quantity, then save (creates the allocation) or cancel.
export function PendingAllocationRow({
  roundId,
  prizeTypes,
  onDone,
}: {
  roundId: string;
  prizeTypes: PrizeTypeOption[];
  onDone: () => void;
}) {
  const [prizeTypeId, setPrizeTypeId] = React.useState("");
  const [quantity, setQuantity] = React.useState("1");
  const [pending, startTransition] = React.useTransition();

  function save() {
    if (!prizeTypeId) {
      toast.error("Choose a prize type for this allocation.");
      return;
    }
    const parsed = allocationSchema.safeParse({
      prizeTypeId,
      quantity: Number(quantity),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid allocation.");
      return;
    }
    startTransition(async () => {
      const result = await createAllocation(roundId, parsed.data);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      onDone();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={prizeTypeId} onValueChange={setPrizeTypeId} disabled={pending}>
        <SelectTrigger className="w-56" aria-label="Prize type">
          <SelectValue placeholder="Choose a prize type" />
        </SelectTrigger>
        <SelectContent>
          {prizeTypes.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground text-sm">×</span>
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        max={10000}
        step={1}
        className="w-24"
        aria-label="Quantity"
        value={quantity}
        disabled={pending}
        onChange={(e) => setQuantity(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Save allocation"
        disabled={pending}
        onClick={save}
      >
        <CheckIcon className="size-4" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Cancel allocation"
        disabled={pending}
        onClick={onDone}
      >
        <XIcon className="size-4" />
      </Button>
    </div>
  );
}
