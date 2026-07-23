import {
  channelName,
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
export function initRevealChannel(raffleId: string): () => void {
  channel?.close();
  channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(channelName(raffleId))
      : null;
  return () => {
    channel?.close();
    channel = null;
  };
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
