"use client";

import * as React from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { createRound, reorderRounds } from "@/actions/rounds";
import { RoundItem } from "./round-item";
import { LockFooter } from "./lock-footer";
import type { PrizeTypeOption, RoundData } from "./types";

// Rounds screen client shell (E1-03): ordered, drag-reorderable accordion of
// rounds with optimistic reorder + revert on failure, "Add round", and the
// persistent lock footer.

const REORDER_FAILED_MESSAGE =
  "Could not save the new round order. The previous order has been restored — please try again.";

export function RoundsBuilder({
  raffleId,
  status,
  rounds,
  prizeTypes,
  totalPlanned,
  entryCount,
}: {
  raffleId: string;
  status: string;
  rounds: RoundData[];
  prizeTypes: PrizeTypeOption[];
  totalPlanned: number;
  entryCount: number;
}) {
  const editable = status === "DRAFT" || status === "OPEN";

  // Local display order for optimistic drag reorder. Server-persisted props
  // remain the source of truth; the local override resets whenever the server
  // round set/order changes (after revalidation).
  const serverOrder = rounds.map((r) => r.id).join("|");
  const [localOrder, setLocalOrder] = React.useState<string[] | null>(null);
  const lastServerOrder = React.useRef(serverOrder);
  if (lastServerOrder.current !== serverOrder) {
    lastServerOrder.current = serverOrder;
    if (localOrder !== null) setLocalOrder(null);
  }

  const byId = new Map(rounds.map((r) => [r.id, r]));
  const displayedRounds =
    localOrder === null
      ? rounds
      : (localOrder.map((id) => byId.get(id)).filter(Boolean) as RoundData[]);

  const [openItems, setOpenItems] = React.useState<string[]>([]);
  const [justCreatedId, setJustCreatedId] = React.useState<string | null>(null);
  const [creating, startCreate] = React.useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const currentIds = displayedRounds.map((r) => r.id);
    const oldIndex = currentIds.indexOf(String(active.id));
    const newIndex = currentIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const previous = localOrder ?? currentIds;
    const next = arrayMove(currentIds, oldIndex, newIndex);
    setLocalOrder(next); // optimistic

    void (async () => {
      try {
        const result = await reorderRounds(raffleId, next);
        if (!result.ok) {
          setLocalOrder(previous);
          toast.error(result.error);
        }
      } catch {
        setLocalOrder(previous);
        toast.error(REORDER_FAILED_MESSAGE);
      }
    })();
  }

  function addRound() {
    startCreate(async () => {
      const result = await createRound(raffleId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      // New round renders expanded with its label input focused (FSD A.3).
      setOpenItems((open) => [...open, result.data.roundId]);
      setJustCreatedId(result.data.roundId);
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          {displayedRounds.length === 0
            ? "No rounds yet. Add a round to start planning the run of show."
            : `${displayedRounds.length} ${displayedRounds.length === 1 ? "round" : "rounds"} in draw order.`}
        </p>
        {editable ? (
          <Button type="button" onClick={addRound} disabled={creating}>
            <PlusIcon className="size-4" />
            Add round
          </Button>
        ) : null}
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={displayedRounds.map((r) => r.id)}
          strategy={verticalListSortingStrategy}
        >
          <Accordion
            type="multiple"
            value={openItems}
            onValueChange={setOpenItems}
            className="gap-2"
          >
            {displayedRounds.map((round, index) => (
              <RoundItem
                key={round.id}
                round={round}
                position={index + 1}
                prizeTypes={prizeTypes}
                editable={editable}
                autoFocusLabel={round.id === justCreatedId}
              />
            ))}
          </Accordion>
        </SortableContext>
      </DndContext>

      <LockFooter
        raffleId={raffleId}
        status={status}
        totalPlanned={totalPlanned}
        entryCount={entryCount}
        editable={editable}
      />
    </div>
  );
}
