import {
  channelName,
  displayMessageSchema,
  type DisplayMessage,
} from "@/lib/broadcast";

// Broadcast seam for E2-01 (display sync). Every reveal on the draw screen —
// one call per sequential reveal click, one call per slot in a synchronous
// burst for simultaneous rounds — funnels through emitReveal, and ONLY after
// the round's transaction has committed server-side (commit-before-reveal
// contract, FSD E1-04 §2.2 / §2.4; E2-01 Feature 3 BR1 post-commit-only).
//
// The module holds one BroadcastChannel, initialized by the draw screen via
// initRevealChannel(raffleId) in a mount effect. Posting with no channel (or
// no subscriber) is a silent no-op — admin flows never depend on a listener
// existing (E2-01 Feature 3 BR5 / Alt 3).

export type RevealedSlot = {
  /** Stable slot identity from broadcast.ts slotId: `<roundAllocationId>:<sequenceInAllocation>`. */
  slotId: string;
  fullName: string;
  prizeLabel: string;
};

let channel: BroadcastChannel | null = null;

/**
 * Opens the raffle-scoped reveal channel. Call from a client mount effect;
 * returns the cleanup that closes it. Safe when BroadcastChannel is
 * unsupported (channel stays null; emitReveal no-ops — E2-01 A4).
 */
export function initRevealChannel(
  raffleId: string,
  /**
   * Called when a display tab announces itself. A projector opened after the
   * admin has already advanced rounds would otherwise sit on round 1, so the
   * draw screen re-sends its current round in response.
   */
  onDisplayReady?: () => void
): () => void {
  channel?.close();
  channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(channelName(raffleId))
      : null;
  if (channel && onDisplayReady) {
    channel.onmessage = (event) => {
      const parsed = displayMessageSchema.safeParse(event.data);
      if (parsed.success && parsed.data.type === "display-ready") {
        onDisplayReady();
      }
    };
  }
  return () => {
    channel?.close();
    channel = null;
  };
}

/**
 * Tells the display which round to show. The display renders that round and
 * holds it until the next set-round — reveals never move it (E2-01 round
 * hand-off is admin-driven).
 */
export function emitSetRound(roundId: string): void {
  const message: DisplayMessage = { type: "set-round", roundId };
  channel?.postMessage(message);
}

/**
 * Posts a {type:'reveal'} message on the raffle's channel. Payload carries
 * the minimum — fullName and prizeLabel only, never ticket numbers, statuses,
 * contact, or reasons (E2-01 Feature 3 BR3). Callers guarantee this runs only
 * after the Server Action returned success (post-commit only).
 */
export function emitReveal(slot: RevealedSlot): void {
  const message: DisplayMessage = {
    type: "reveal",
    slotId: slot.slotId,
    fullName: slot.fullName,
    prizeLabel: slot.prizeLabel,
  };
  channel?.postMessage(message);
}

/**
 * Isolates one slot as "redrawing…" on the display. The ONE permitted
 * pre-commit message (E2-01 Feature 3 BR1): posted before the redraw Server
 * Action is awaited, and carrying no entrant data. On failure nothing further
 * is posted — there is no redraw-cancel (D-E13); the slot holds until a
 * retried redraw resolves it.
 */
export function emitRedrawStart(slotId: string): void {
  const message: DisplayMessage = { type: "redraw-start", slotId };
  channel?.postMessage(message);
}

/**
 * Settles a redrawn slot on the display with its replacement winner. Post-
 * commit only: callers guarantee the redraw Server Action returned success.
 */
export function emitRedrawResult(slotId: string, fullName: string): void {
  const message: DisplayMessage = { type: "redraw-result", slotId, fullName };
  channel?.postMessage(message);
}
