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
  readRevealLog,
  supersedeRevealLog,
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

export function DisplayBoard({ raffleId }: { raffleId: string }) {
  const [phase, setPhase] = React.useState<Phase>("loading");
  const [meta, setMeta] = React.useState<DisplayMeta | null>(null);
  const [slotStates, setSlotStates] = React.useState<Record<string, SlotState>>(
    {}
  );
  // slotIds present on the load-time-static board (Feature 1 BR7); messages
  // addressing unknown slots are discarded from render (Feature 2 Alt 3).
  const knownSlotsRef = React.useRef<Set<string>>(new Set());

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
          setSlotStates((prev) => ({
            ...prev,
            [msg.slotId]: { kind: "redrawing" },
          }));
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

  if (phase !== "ready" || meta === null) {
    return (
      <main className="flex min-h-dvh flex-1 items-center justify-center bg-neutral-950 p-8 text-neutral-50">
        {phase === "loading" ? null : (
          <p className="text-center text-2xl font-medium text-neutral-300 lg:text-3xl">
            {phase === "not-found" ? MSG_NOT_AVAILABLE : MSG_LOAD_FAILED}
          </p>
        )}
      </main>
    );
  }

  return (
    <main className="min-h-dvh flex-1 bg-neutral-950 px-8 py-10 text-neutral-50 lg:px-14">
      <h1 className="text-center text-3xl font-bold tracking-tight lg:text-5xl">
        {meta.title}
      </h1>

      {meta.rounds.length === 0 ? (
        <p className="mt-24 text-center text-2xl font-medium text-neutral-300 lg:text-3xl">
          {MSG_NO_ROUNDS}
        </p>
      ) : (
        <div className="mx-auto mt-10 max-w-[110rem] space-y-12">
          {meta.rounds.map((round) => (
            <section key={round.id}>
              <h2 className="text-xl font-semibold tracking-widest text-neutral-400 uppercase lg:text-2xl">
                {round.label}
              </h2>
              <div className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(18rem,1fr))]">
                {round.slots.map((slot) => (
                  <DisplaySlot
                    key={slot.slotId}
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
          ))}
        </div>
      )}
    </main>
  );
}
