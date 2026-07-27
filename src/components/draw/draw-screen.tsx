"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { adminDisplayRoundKey } from "@/lib/broadcast";
import { executeRound } from "@/actions/draw";
import type { DrawScreenRound, DrawScreenSlot, DrawScreenState } from "@/actions/draw";

import { emitReveal, emitSetRound, initRevealChannel } from "./reveal-bus";
import { DisplayControl } from "./display-control";
import { HistoryPanel } from "./history-panel";

// Draw screen client flow (E1-04 Features 4.3–4.5).
//
// Reveal pacing is presentation only over ALREADY-COMMITTED results: the
// server action commits every DrawEvent of the round in one transaction
// before this component reveals anything (commit-before-reveal). Reveal order
// is deterministic: allocation order, then sequenceInAllocation asc.
//
// Rounds committed before this page load render fully revealed in the history
// panel (D-E09 — the admin surface is trusted; the secrecy boundary is
// E2-01's display page). Every reveal funnels through emitReveal (reveal-bus)
// — E2-01's broadcast seam.

export function DrawScreen({ state }: { state: DrawScreenState }) {
  const router = useRouter();

  const [currentRoundId, setCurrentRoundId] = React.useState<string | null>(
    state.nextRoundId
  );
  // Slots committed by executeRound during THIS session, keyed by round id.
  const [sessionSlots, setSessionSlots] = React.useState<
    Record<string, DrawScreenSlot[]>
  >({});
  // Reveal progress for session-drawn rounds. The ref mirrors the state and is
  // the authoritative counter so a rapid double click can never reveal the
  // same slot twice or emit a duplicate broadcast (one reveal per click).
  const [revealedCount, setRevealedCount] = React.useState<Record<string, number>>({});
  const revealedRef = React.useRef<Record<string, number>>({});
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  // The round the PUBLIC DISPLAY is showing. Deliberately separate from
  // currentRoundId: the operator can read ahead on the admin screen while the
  // audience stays on the round still being celebrated.
  //
  // NOTHING here ever pushes a round change on its own — not mount, not a
  // draw, not advancing the admin's own round. set-round is emitted ONLY from
  // finishDisplayRound(), i.e. only when the operator clicks Finish round.
  // Without that rule an admin page refresh would silently move the audience.
  //
  // The display defaults to the first round on its own, so this mirror starts
  // there too (restored from this tab's storage across an admin refresh, which
  // keeps the "Showing …" line honest without emitting anything).
  const [displayRoundId, setDisplayRoundId] = React.useState<string | null>(
    state.rounds[0]?.id ?? null
  );
  const [finishedRoundIds, setFinishedRoundIds] = React.useState<string[]>([]);
  // Set once the operator has handed off at least one round. Until then a
  // late-connecting display is already on the round we think it is, so there
  // is nothing to re-send.
  const hasHandedOffRef = React.useRef(false);
  // Mirror for the display-ready callback, whose identity must stay stable.
  const displayRoundIdRef = React.useRef(displayRoundId);
  displayRoundIdRef.current = displayRoundId;

  // Restore which round the operator last handed off to, so an admin refresh
  // mid-event does not reset the "Showing …" line to round 1.
  React.useEffect(() => {
    try {
      const stored = sessionStorage.getItem(adminDisplayRoundKey(state.raffleId));
      if (stored && state.rounds.some((r) => r.id === stored)) {
        hasHandedOffRef.current = true;
        setDisplayRoundId(stored);
      }
    } catch {
      // Storage unavailable: the line just starts at round 1.
    }
  }, [state.raffleId, state.rounds]);

  // E2-01: open the raffle-scoped BroadcastChannel emitReveal posts on.
  // initRevealChannel returns its own cleanup. A display tab that connects
  // AFTER a hand-off gets the current round re-sent, so a projector opened
  // late does not sit on round 1 while the audience is on round 3.
  React.useEffect(
    () =>
      initRevealChannel(state.raffleId, () => {
        if (hasHandedOffRef.current && displayRoundIdRef.current) {
          emitSetRound(displayRoundIdRef.current);
        }
      }),
    [state.raffleId]
  );

  // Merge server-committed rounds with rounds drawn during this session.
  const rounds: DrawScreenRound[] = state.rounds.map((r) => {
    const local = sessionSlots[r.id];
    return local ? { ...r, drawn: true, slots: local } : r;
  });

  // Rounds already drawn at page load count as fully revealed (D-E09).
  const revealedOf = (round: DrawScreenRound): number =>
    sessionSlots[round.id] !== undefined
      ? (revealedCount[round.id] ?? 0)
      : round.drawn
        ? round.slots.length
        : 0;

  const current = currentRoundId
    ? (rounds.find((r) => r.id === currentRoundId) ?? null)
    : null;
  const currentIndex = current ? rounds.findIndex((r) => r.id === current.id) : -1;
  const currentRevealed = current ? revealedOf(current) : 0;
  const currentExhausted =
    !!current && current.drawn && currentRevealed >= current.slots.length;
  const nextUndrawn =
    rounds.find((r) => !r.drawn && r.id !== currentRoundId) ?? null;
  const done = rounds.length > 0 && rounds.every((r) => r.drawn && revealedOf(r) >= r.slots.length);

  // Drawn rounds shown as read-only history; the active central round joins it
  // once the admin advances past it (or on completion, per FSD 4.5 A4).
  const history = rounds.filter((r) => r.drawn && (done || r.id !== currentRoundId));

  // --- Public display round hand-off -------------------------------------
  const displayRound = displayRoundId
    ? (rounds.find((r) => r.id === displayRoundId) ?? null)
    : null;
  const displayRevealed = displayRound ? revealedOf(displayRound) : 0;
  const displayNext = displayRound
    ? (rounds[rounds.findIndex((r) => r.id === displayRound.id) + 1] ?? null)
    : null;
  const displayFinished = !!displayRound && finishedRoundIds.includes(displayRound.id);
  // Always available: the operator runs the room and may need to move on with
  // slots unrevealed (a prize withdrawn, time running out). Unrevealed slots
  // are called out below as a caution, not enforced as a block.
  const canFinishDisplayRound = !!displayRound && !displayFinished;
  const displayFullyRevealed =
    !!displayRound && displayRound.drawn && displayRevealed >= displayRound.totalSlots;

  function finishDisplayRound() {
    if (!displayRound || !canFinishDisplayRound) return;
    setFinishedRoundIds((prev) => [...prev, displayRound.id]);
    // The ONLY place a round change reaches the display. With no next round
    // the final round stays on screen.
    const target = displayNext ?? displayRound;
    hasHandedOffRef.current = true;
    setDisplayRoundId(target.id);
    emitSetRound(target.id);
    try {
      sessionStorage.setItem(adminDisplayRoundKey(state.raffleId), target.id);
    } catch {
      // Storage unavailable: the hand-off still happened on the channel.
    }
  }

  function runExecute(round: DrawScreenRound) {
    startTransition(async () => {
      const result = await executeRound(round.id);
      if (!result.ok) {
        toast.error(result.error);
        // Re-sync committed state (double submission / second tab — FSD Alt 1).
        if (result.error.startsWith("This round has already been drawn")) {
          router.refresh();
        }
        return;
      }
      const { slots, revealMode } = result.data;
      setSessionSlots((prev) => ({ ...prev, [round.id]: slots }));
      if (revealMode === "SIMULTANEOUS") {
        // Reveal the whole round as one batch — post-commit only.
        revealedRef.current[round.id] = slots.length;
        setRevealedCount((prev) => ({ ...prev, [round.id]: slots.length }));
        for (const slot of slots) {
          emitReveal({
            slotId: slot.slotId,
            fullName: slot.winner.fullName,
            prizeLabel: slot.prizeLabel,
          });
        }
      } else {
        // Sequential: enter the reveal phase with zero slots revealed.
        revealedRef.current[round.id] = 0;
        setRevealedCount((prev) => ({ ...prev, [round.id]: 0 }));
      }
    });
  }

  function revealNext(round: DrawScreenRound) {
    const slots = sessionSlots[round.id];
    if (!slots) return;
    const n = revealedRef.current[round.id] ?? 0;
    if (n >= slots.length) return; // guard: a click never reveals zero or two
    const slot = slots[n];
    revealedRef.current[round.id] = n + 1;
    setRevealedCount((prev) => ({ ...prev, [round.id]: n + 1 }));
    emitReveal({
      slotId: slot.slotId,
      fullName: slot.winner.fullName,
      prizeLabel: slot.prizeLabel,
    });
  }

  // "Round {r} of {R} — {prize label} {k} of {n}" (FSD 4.5 Rule / AC).
  function progressText(): string | null {
    if (!current) return null;
    const prefix = `Round ${currentIndex + 1} of ${rounds.length}`;
    if (current.drawn && currentRevealed > 0) {
      const slot = current.slots[currentRevealed - 1];
      const allocation = current.allocations.find(
        (a) => a.id === slot.roundAllocationId
      );
      return `${prefix} — ${slot.prizeLabel} ${slot.sequenceInAllocation} of ${allocation?.quantity ?? slot.sequenceInAllocation}`;
    }
    return prefix;
  }

  const totalWinners = rounds.reduce((sum, r) => sum + r.totalSlots, 0);
  const nextSlotPrizeLabel =
    current && !current.drawn ? (current.allocations[0]?.prizeLabel ?? "") : null;
  const upcoming =
    current && current.drawn && !currentExhausted && sessionSlots[current.id]
      ? current.slots[currentRevealed]
      : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold tracking-tight">Draw</h1>
          {progressText() && !done && (
            <Badge variant="secondary" className="font-normal">
              {progressText()}
            </Badge>
          )}
        </div>
        {/*
          E2-01 mount point: the "Open public display" control renders in this
          slot. Do not place other controls here.
        */}
        <div data-slot="display-control">
          <DisplayControl raffleId={state.raffleId} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          {done ? (
            <Card>
              <CardHeader>
                <CardTitle>All rounds drawn</CardTitle>
                <CardDescription>
                  {rounds.length} {rounds.length === 1 ? "round" : "rounds"} committed —{" "}
                  {totalWinners} {totalWinners === 1 ? "winner" : "winners"} in total.
                  Every result is recorded and immutable. Review and manage winners
                  from the Winners tab.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : current ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  <span>{current.label}</span>
                  <Badge variant="outline" className="font-normal">
                    {current.revealMode === "SEQUENTIAL" ? "Sequential" : "Simultaneous"}
                  </Badge>
                </CardTitle>
                <CardDescription>
                  {current.totalSlots} {current.totalSlots === 1 ? "slot" : "slots"}
                  {current.drawn
                    ? ` — ${currentRevealed} of ${current.slots.length} revealed`
                    : " — not yet drawn"}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!current.drawn ? (
                  <>
                    {current.revealMode === "SEQUENTIAL" ? (
                      <div className="bg-muted/40 rounded-lg border border-dashed p-8 text-center">
                        <p className="text-muted-foreground text-sm">Next up</p>
                        <p className="mt-1 text-lg font-medium">{nextSlotPrizeLabel}</p>
                      </div>
                    ) : (
                      <div className="bg-muted/40 rounded-lg border border-dashed p-8 text-center">
                        <p className="text-muted-foreground text-sm">
                          Reveals all {current.totalSlots}{" "}
                          {current.totalSlots === 1 ? "winner" : "winners"} at once
                        </p>
                        <p className="mt-1 text-lg font-medium">{current.label}</p>
                      </div>
                    )}
                    <Button
                      className="w-full"
                      size="lg"
                      disabled={pending}
                      onClick={() => setConfirmOpen(true)}
                    >
                      {pending
                        ? "Drawing…"
                        : current.revealMode === "SEQUENTIAL"
                          ? "Draw"
                          : `Reveal round — ${current.label} (${current.totalSlots} ${current.totalSlots === 1 ? "slot" : "slots"})`}
                    </Button>
                  </>
                ) : (
                  <>
                    {currentRevealed > 0 ? (
                      current.revealMode === "SIMULTANEOUS" ? (
                        <ul className="grid gap-2 sm:grid-cols-2">
                          {current.slots.map((slot) => (
                            <li key={slot.slotId} className="rounded-lg border p-3">
                              <p className="font-medium">{slot.winner.fullName}</p>
                              <p className="text-muted-foreground text-sm">
                                Ticket #{slot.winner.ticketNumber} — {slot.prizeLabel}
                              </p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <div className="space-y-3">
                          <div className="rounded-lg border p-8 text-center">
                            <p className="text-muted-foreground text-sm">
                              {current.slots[currentRevealed - 1].prizeLabel}
                            </p>
                            <p className="mt-1 text-2xl font-semibold">
                              {current.slots[currentRevealed - 1].winner.fullName}
                            </p>
                            <p className="text-muted-foreground mt-1 text-sm">
                              Ticket #{current.slots[currentRevealed - 1].winner.ticketNumber}
                            </p>
                          </div>
                          {currentRevealed > 1 && (
                            <ul className="space-y-1">
                              {current.slots.slice(0, currentRevealed - 1).map((slot) => (
                                <li key={slot.slotId} className="text-muted-foreground text-sm">
                                  {slot.winner.fullName} — #{slot.winner.ticketNumber} —{" "}
                                  {slot.prizeLabel}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )
                    ) : (
                      <div className="bg-muted/40 rounded-lg border border-dashed p-8 text-center">
                        <p className="text-muted-foreground text-sm">
                          Round committed — ready to reveal
                        </p>
                        <p className="mt-1 text-lg font-medium">
                          {upcoming?.prizeLabel}
                        </p>
                      </div>
                    )}
                    {!currentExhausted && current.revealMode === "SEQUENTIAL" && (
                      <Button className="w-full" size="lg" onClick={() => revealNext(current)}>
                        Draw
                        {upcoming ? ` — ${upcoming.prizeLabel}` : ""}
                      </Button>
                    )}
                    {currentExhausted && nextUndrawn && (
                      <Button
                        className="w-full"
                        size="lg"
                        variant="secondary"
                        onClick={() => setCurrentRoundId(nextUndrawn.id)}
                      >
                        Next round — {nextUndrawn.label}
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ) : null}

          {displayRound && (
            <Card className="mt-4" data-slot="display-round-control">
              <CardHeader>
                <CardTitle className="text-base">Public display</CardTitle>
                <CardDescription>
                  Showing{" "}
                  <span className="text-foreground font-medium">
                    {displayRound.label}
                  </span>{" "}
                  — {displayRevealed} of {displayRound.totalSlots} revealed
                  {displayFinished ? " — finished" : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {displayFinished && !displayNext ? (
                  <p className="text-muted-foreground text-sm">
                    All rounds shown. {displayRound.label} stays on the display.
                  </p>
                ) : (
                  <>
                    <Button
                      className="w-full"
                      variant="secondary"
                      disabled={!canFinishDisplayRound}
                      onClick={finishDisplayRound}
                    >
                      {displayNext
                        ? `Finish round — show ${displayNext.label}`
                        : "Finish round"}
                    </Button>
                    {!displayFullyRevealed && (
                      <p className="text-muted-foreground mt-2 text-sm">
                        {displayRevealed} of {displayRound.totalSlots} slots
                        revealed — finishing now moves the audience on without
                        showing the rest.
                      </p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <HistoryPanel rounds={history} />
      </div>

      {current && (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Draw {current.label}?</AlertDialogTitle>
              <AlertDialogDescription>
                This commits all {current.totalSlots}{" "}
                {current.totalSlots === 1 ? "winner" : "winners"} for this round in one
                transaction. The results become immutable — a drawn round can never be
                re-run.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                onClick={() => {
                  setConfirmOpen(false);
                  runExecute(current);
                }}
              >
                {current.revealMode === "SEQUENTIAL" ? "Draw round" : "Reveal round"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}
