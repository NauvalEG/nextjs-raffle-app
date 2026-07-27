"use client";

import * as React from "react";

import {
  channelName,
  displayMessageSchema,
  type DisplayMessage,
} from "@/lib/broadcast";
import type { DisplayMeta } from "@/lib/display-meta";

import {
  appendRevealLog,
  readCurrentRound,
  readRevealLog,
  supersedeRevealLog,
  writeCurrentRound,
} from "./reveal-log";
import { DisplaySlot, type SlotState } from "./display-slot";

// Public display board (E2-01 Features 1, 2, 4, 5). Mount sequence is STRICT
// (Feature 4 BR3): fetch display-meta → render board → replay sessionStorage
// log (settled, no re-animation, latest-name-wins) → subscribe to the
// BroadcastChannel → post the one-shot {type:'display-ready'} ping (A7).
// The display-meta fetch is this page's ONLY server contact (BR2); no retry
// loop on failure (A3). Every inbound message is validated against
// displayMessageSchema; non-conforming messages are dropped silently (BR5).

type Phase = "loading" | "not-found" | "error" | "ready";

// Exact user-facing strings (FSD Feature 1 Error States / Alt 3).
const MSG_NOT_AVAILABLE = "This raffle display is not available.";
const MSG_LOAD_FAILED = "Unable to load the display. Refresh to try again.";
const MSG_NO_ROUNDS = "The draw has not been set up yet.";

// Full-bleed projector backdrop. Static asset in /public; the space-bearing
// filename must stay percent-encoded inside the CSS url().
const BACKGROUND_URL = "/BG_Undian.jpeg";

// Card block geometry, in rem. The block stays CENTRED on the stage — it is
// not stretched edge to edge — and the grid is laid out in `columns * 2`
// half-columns of 1fr with each card spanning 2, so the column count is
// guaranteed at any viewport (cards narrow, they never re-wrap into a ragged
// shape) and a partial final row can be offset by one half-column to centre
// under the rows above.
//
// Squeeze order is deliberate: the GAP absorbs the shrink first, and only once
// it bottoms out at COLUMN_GAP_MIN_REM do the cards themselves start to narrow.
// That falls out of `columnGap` below — with 1fr tracks, whatever the gap does
// not take, the cards do. At the block's max width the formula lands exactly on
// COLUMN_GAP_MAX_REM with cards at CARD_MAX_REM; below it the gap term drops
// linearly until the clamp floor takes over.
// The card target is a FIXED width, not a viewport-scaled one. That is what
// makes the squeeze order hold: a `vw`-based target would shrink the card at
// every step alongside the gap, whereas a fixed one lets the card sit still at
// its target while the gap alone absorbs the surplus, and only give ground once
// the gap has hit COLUMN_GAP_MIN_REM. The consequence is that a very wide
// screen leaves margins either side of the centred block — that is the
// centre-anchored look, not wasted space.
const CARD_TARGET_REM = 72;
const COLUMN_GAP_MAX_REM = 7;
const COLUMN_GAP_MIN_REM = 2.5; // still a comfortable gutter, not a hairline
const MAX_COLUMNS = 4; // beyond this the cards get too small to read from a room

/**
 * `column-gap` that eats the surplus width before the cards give any up.
 *
 * Derivation for the half-column grid: with `2·cols` tracks there are `2·cols−1`
 * gaps of `g`, and a card spans two tracks plus the gap between them, so
 * `cols·card + (cols−1)·g = W`. Holding `card` at CARD_TARGET_REM and solving
 * for `g` gives the middle term — the internal half-column gap cancels exactly.
 * Above the block's max width the middle term saturates at the ceiling; below
 * it, it falls linearly until the floor takes over and the cards start to
 * narrow instead.
 */
function columnGapFor(columns: number): string {
  if (columns < 2) return `${COLUMN_GAP_MAX_REM}rem`;
  const surplus = `calc((100% - ${columns * CARD_TARGET_REM}rem) / ${columns - 1})`;
  return `clamp(${COLUMN_GAP_MIN_REM}rem, ${surplus}, ${COLUMN_GAP_MAX_REM}rem)`;
}

/** Width at which the gap is at its ceiling and the cards are at target. */
function blockMaxWidthFor(columns: number): string {
  return `${columns * CARD_TARGET_REM + (columns - 1) * COLUMN_GAP_MAX_REM}rem`;
}

/**
 * Chooses the column count that makes the most balanced block for `count`
 * slots: start near-square, then widen only when a wider row leaves fewer
 * empty cells. 9 → 3 (a 3×3 block), 6 → 3 (3+3), 5 → 3 (3+2), 8 → 4 (4+4),
 * 7 → 4 (4+3).
 */
function columnsFor(count: number): number {
  if (count <= 1) return 1;
  const emptyCells = (cols: number) => (cols - (count % cols)) % cols;
  let columns = Math.min(MAX_COLUMNS, Math.ceil(Math.sqrt(count)));
  while (columns < MAX_COLUMNS && emptyCells(columns + 1) < emptyCells(columns)) {
    columns++;
  }
  return columns;
}

/**
 * Viewport-aware column count. The projector (wide, landscape) gets the full
 * balanced block from `columnsFor`; narrow and portrait screens step down so a
 * card never collapses below a readable width. Responsiveness has to happen in
 * JS rather than CSS breakpoints because the half-column trick that centres a
 * partial final row depends on knowing the column count.
 */
function useResponsiveColumns(count: number): number {
  // Server render and first paint assume the projector case, which is what
  // this surface is actually for; the effect corrects it before it matters.
  const [width, setWidth] = React.useState<number | null>(null);

  React.useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const balanced = columnsFor(count);
  if (width === null) return balanced;
  if (width < 640) return 1;
  if (width < 1024) return Math.min(2, balanced);
  return balanced;
}

/** Fixed backdrop shared by every phase; scrim keeps white cards legible. */
function Backdrop() {
  return (
    <div
      aria-hidden
      className="fixed inset-0 -z-10 bg-neutral-950 bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url("${BACKGROUND_URL}")` }}
    >
      <div className="absolute inset-0 bg-black/25" />
    </div>
  );
}

export function DisplayBoard({ raffleId }: { raffleId: string }) {
  const [phase, setPhase] = React.useState<Phase>("loading");
  const [meta, setMeta] = React.useState<DisplayMeta | null>(null);
  const [slotStates, setSlotStates] = React.useState<Record<string, SlotState>>(
    {}
  );
  // slotIds present on the load-time-static board (Feature 1 BR7); messages
  // addressing unknown slots are discarded from render (Feature 2 Alt 3).
  const knownSlotsRef = React.useRef<Set<string>>(new Set());
  // The single round the audience is watching. The board renders this round
  // and nothing else; it changes ONLY on an admin {type:'set-round'} message,
  // never as a side effect of a reveal.
  const [currentRoundId, setCurrentRoundId] = React.useState<string | null>(null);
  const knownRoundsRef = React.useRef<Set<string>>(new Set());

  const handleMessage = React.useCallback(
    (data: unknown) => {
      const parsed = displayMessageSchema.safeParse(data);
      if (!parsed.success) return; // dropped silently (Feature 2 BR5)
      const msg = parsed.data;

      switch (msg.type) {
        case "reveal": {
          // Log BEFORE rendering (Feature 2 Step 2) — including unknown
          // slotIds, so a refresh after a structural fix replays them.
          appendRevealLog(raffleId, {
            slotId: msg.slotId,
            fullName: msg.fullName,
          });
          if (!knownSlotsRef.current.has(msg.slotId)) return;
          setSlotStates((prev) => {
            const current = prev[msg.slotId];
            // Duplicate reveal for an already-settled (or already-animating)
            // slot with the same name is idempotent — no re-animation (A11).
            if (
              current &&
              current.kind !== "redrawing" &&
              current.fullName === msg.fullName
            ) {
              return prev;
            }
            return {
              ...prev,
              [msg.slotId]: { kind: "scrambling", fullName: msg.fullName },
            };
          });
          return;
        }
        case "redraw-start": {
          // ONLY the addressed slot changes (Feature 5 BR1); unknown slotId
          // dropped; redraw-start is never logged (pre-commit, no name).
          if (!knownSlotsRef.current.has(msg.slotId)) return;
          setSlotStates((prev) => {
            const current = prev[msg.slotId];
            // Carry only the WIDTH of the outgoing name into the redraw
            // scramble so the card does not jump; the name itself is dropped
            // the instant redraw-start lands.
            const length =
              current && current.kind !== "redrawing"
                ? current.fullName.length
                : current?.length;
            return { ...prev, [msg.slotId]: { kind: "redrawing", length } };
          });
          return;
        }
        case "redraw-result": {
          // Supersede the log entry so replay yields the latest name
          // (Feature 4 BR4); self-sufficient without a prior redraw-start.
          supersedeRevealLog(raffleId, {
            slotId: msg.slotId,
            fullName: msg.fullName,
          });
          if (!knownSlotsRef.current.has(msg.slotId)) return;
          setSlotStates((prev) => {
            const current = prev[msg.slotId];
            // Idempotent when the name equals the current one — no visible
            // double-flash (Feature 5 Error States).
            if (
              current &&
              current.kind !== "redrawing" &&
              current.fullName === msg.fullName
            ) {
              return prev;
            }
            return {
              ...prev,
              [msg.slotId]: { kind: "scrambling", fullName: msg.fullName },
            };
          });
          return;
        }
        case "set-round": {
          // Unknown round ids are dropped silently, same rule as unknown
          // slotIds (BR5) — a stale admin tab can never blank the board.
          if (!knownRoundsRef.current.has(msg.roundId)) return;
          writeCurrentRound(raffleId, msg.roundId);
          setCurrentRoundId(msg.roundId);
          return;
        }
        case "display-ready":
          // Admin-indicator ping from another display tab — not for us.
          return;
      }
    },
    [raffleId]
  );

  const settleSlot = React.useCallback((slotId: string, fullName: string) => {
    setSlotStates((prev) => {
      const current = prev[slotId];
      if (
        !current ||
        current.kind !== "scrambling" ||
        current.fullName !== fullName
      ) {
        return prev; // superseded mid-animation; don't clobber
      }
      return { ...prev, [slotId]: { kind: "settled", fullName } };
    });
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    let channel: BroadcastChannel | null = null;

    async function mount() {
      // (1) Fetch display-meta — the page's only server contact (BR2).
      let response: Response;
      try {
        response = await fetch(
          `/api/display-meta/${encodeURIComponent(raffleId)}`,
          { cache: "no-store" }
        );
      } catch {
        if (!cancelled) setPhase("error");
        return;
      }
      if (cancelled) return;
      if (response.status === 404) {
        setPhase("not-found");
        return;
      }
      if (!response.ok) {
        // 5xx / 429 all treated as fetch failure (Feature 1 Alt 2).
        setPhase("error");
        return;
      }
      let data: DisplayMeta;
      try {
        data = (await response.json()) as DisplayMeta;
      } catch {
        if (!cancelled) setPhase("error");
        return;
      }
      if (cancelled) return;

      knownSlotsRef.current = new Set(
        data.rounds.flatMap((round) => round.slots.map((slot) => slot.slotId))
      );
      knownRoundsRef.current = new Set(data.rounds.map((round) => round.id));

      // Restore the round the projector was already showing across a refresh;
      // fall back to the first round when nothing is stored or the stored id
      // no longer exists (structural change since it was written).
      const stored = readCurrentRound(raffleId);
      const restored =
        stored !== null && knownRoundsRef.current.has(stored)
          ? stored
          : (data.rounds[0]?.id ?? null);

      // (2)+(3) Render board with the replayed log applied in the same
      // commit: each logged slot renders directly in its settled state — no
      // re-animation (Feature 4 Step 2). Later entries overwrite earlier
      // ones, so replay is latest-name-wins per slot (BR4). Entries for
      // unknown slotIds are skipped but retained in the log (Feature 4 Alt 2).
      const replayed: Record<string, SlotState> = {};
      for (const entry of readRevealLog(raffleId)) {
        if (knownSlotsRef.current.has(entry.slotId)) {
          replayed[entry.slotId] = {
            kind: "settled",
            fullName: entry.fullName,
          };
        }
      }
      setMeta(data);
      setSlotStates(replayed);
      setCurrentRoundId(restored);
      setPhase("ready");

      // (4) Subscribe only after replay (Feature 4 BR3), then (5) post the
      // one-shot mount ping (A7). No BroadcastChannel support → static board,
      // no fallback transport (A4).
      if (typeof BroadcastChannel !== "undefined") {
        channel = new BroadcastChannel(channelName(raffleId));
        channel.onmessage = (event) => handleMessage(event.data);
        channel.postMessage({ type: "display-ready" } satisfies DisplayMessage);
      }
    }

    void mount();
    return () => {
      cancelled = true;
      channel?.close();
    };
  }, [raffleId, handleMessage]);

  // Exactly one round is on screen. currentRound is only ever null when the
  // raffle has no rounds at all, which the MSG_NO_ROUNDS branch covers.
  // Resolved before the early returns below so the layout hook keeps a stable
  // call order across every phase.
  const currentRound =
    meta?.rounds.find((round) => round.id === currentRoundId) ?? null;
  const columns = useResponsiveColumns(currentRound?.slots.length ?? 0);

  if (phase !== "ready" || meta === null) {
    return (
      <main className="flex min-h-dvh flex-1 items-center justify-center p-8 text-neutral-50">
        <Backdrop />
        {phase === "loading" ? null : (
          <p className="text-center text-2xl font-medium drop-shadow-lg lg:text-3xl">
            {phase === "not-found" ? MSG_NOT_AVAILABLE : MSG_LOAD_FAILED}
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="flex h-dvh min-h-dvh flex-1 flex-col gap-[2vh] px-[2.5vw] py-[3vh] text-neutral-50">
      <Backdrop />

      {/* The raffle title stays in the accessibility tree only — the projector
          header is the round label (below). */}
      <h1 className="sr-only">{meta.title}</h1>

      {currentRound === null ? (
        <p className="m-auto text-center text-2xl font-medium drop-shadow-lg lg:text-3xl">
          {MSG_NO_ROUNDS}
        </p>
      ) : (
        <>
          <h2 className="shrink-0 text-center text-[clamp(1.75rem,4.2vw,4.5rem)] leading-tight font-bold tracking-tight text-balance drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)]">
            {currentRound.label}
          </h2>

          {(() => {
            const round = currentRound;
            const count = round.slots.length;
            // Cards in the final row are shifted right by one half-column
            // per missing card, centring them under the full rows above.
            const lastRowCount = count % columns || columns;
            const firstOfLastRow = count - lastRowCount;
            const halfColumnOffset = columns - lastRowCount;
            return (
              // The block is centred in the leftover space, both axes.
              <section className="flex min-h-0 w-full flex-1 items-center justify-center overflow-y-auto">
                <div
                  className="mx-auto grid w-full items-stretch"
                  style={{
                    gridTemplateColumns: `repeat(${columns * 2}, minmax(0, 1fr))`,
                    maxWidth: blockMaxWidthFor(columns),
                    columnGap: columnGapFor(columns),
                    rowGap: "clamp(1.25rem, 4.5vh, 4rem)",
                  }}
                >
                  {round.slots.map((slot, index) => (
                    <DisplaySlot
                      key={slot.slotId}
                      style={{
                        gridColumn:
                          index === firstOfLastRow
                            ? `${halfColumnOffset + 1} / span 2`
                            : "auto / span 2",
                      }}
                      prizeLabel={slot.prizeLabel}
                      state={slotStates[slot.slotId]}
                      onSettle={() => {
                        const state = slotStates[slot.slotId];
                        if (state && state.kind === "scrambling") {
                          settleSlot(slot.slotId, state.fullName);
                        }
                      }}
                    />
                  ))}
                </div>
              </section>
            );
          })()}
        </>
      )}
    </main>
  );
}
