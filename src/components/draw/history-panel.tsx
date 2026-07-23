"use client";

import type { DrawScreenRound } from "@/actions/draw";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Read-only history of drawn rounds (E1-04 Feature 4.5 / S6): summary cards
// only — no draw, reveal, or edit controls, and no navigation back to a drawn
// round's controls. Server-side re-execution rejection is the backstop.

export function HistoryPanel({ rounds }: { rounds: DrawScreenRound[] }) {
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
                  <li key={slot.slotId} className="text-sm">
                    <span className="font-medium">{slot.winner.fullName}</span>{" "}
                    <span className="text-muted-foreground">
                      #{slot.winner.ticketNumber} — {slot.prizeLabel}{" "}
                      {slot.sequenceInAllocation}
                    </span>
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
