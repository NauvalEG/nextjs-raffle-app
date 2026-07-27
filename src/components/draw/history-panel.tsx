"use client";

import type * as React from "react";

import type { DrawScreenRound, DrawScreenSlot } from "@/actions/draw";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// History of drawn rounds (E1-04 Feature 4.5 / S6): summary cards only — no
// draw, reveal, or edit controls, and no navigation back to a drawn round's
// controls. Server-side re-execution rejection is the backstop.
//
// The one exception is `renderSlotAction`, the draw screen's live-redraw
// control. A redraw does not re-run a round: it replaces ONE committed slot
// through its own audited path, and the operator needs it on the round just
// revealed (which lands here the moment they advance) and on every round once
// the last one is drawn and the central card is gone.

export function HistoryPanel({
  rounds,
  renderSlotAction,
}: {
  rounds: DrawScreenRound[];
  /** Per-slot control rendered at the end of each row (live redraw). */
  renderSlotAction?: (slot: DrawScreenSlot) => React.ReactNode;
}) {
  return (
    <aside
      aria-label="Drawn rounds"
      className="flex min-w-0 flex-col gap-3 lg:max-h-[calc(100vh-14rem)] lg:overflow-y-auto"
    >
      <h2 className="text-muted-foreground text-sm font-medium">Drawn rounds</h2>
      {rounds.length === 0 ? (
        <p className="text-muted-foreground text-sm">No rounds drawn yet.</p>
      ) : (
        rounds.map((round) => (
          <Card key={round.id} className="gap-2 py-4">
            <CardHeader className="px-4">
              <CardTitle className="flex flex-wrap items-center gap-2 text-sm">
                <span>{round.label}</span>
                <Badge variant="outline" className="font-normal">
                  {round.revealMode === "SEQUENTIAL" ? "Sequential" : "Simultaneous"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <ul className="space-y-1.5">
                {round.slots.map((slot) => (
                  <li
                    key={slot.slotId}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{slot.winner.fullName}</span>{" "}
                      <span className="text-muted-foreground">
                        #{slot.winner.ticketNumber} — {slot.prizeLabel}{" "}
                        {slot.sequenceInAllocation}
                      </span>
                    </span>
                    {renderSlotAction?.(slot)}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </aside>
  );
}
