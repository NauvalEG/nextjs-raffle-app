import { z } from "zod";

// Shared BroadcastChannel contract (E2-01 Feature 2). The admin tab posts,
// the display tab receives. Channel scoped per raffle so two raffles open in
// one browser never cross-talk. Payloads carry the minimum: fullName and
// prizeLabel only — never ticket numbers, statuses, contact, or reasons.

export function channelName(raffleId: string): string {
  return `raffle-display-${raffleId}`;
}

// Slot identity shared between admin and display (E2-01 BR5 / A10):
// `<roundAllocationId>:<sequenceInAllocation>` — matches E1-04's committed pick identity.
export function slotId(roundAllocationId: string, sequenceInAllocation: number): string {
  return `${roundAllocationId}:${sequenceInAllocation}`;
}

export const displayMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("reveal"),
    slotId: z.string().min(1),
    fullName: z.string().min(1),
    prizeLabel: z.string().min(1),
  }),
  z.object({
    type: z.literal("redraw-start"),
    slotId: z.string().min(1),
  }),
  z.object({
    type: z.literal("redraw-result"),
    slotId: z.string().min(1),
    fullName: z.string().min(1),
  }),
  // Round hand-off: the display renders exactly ONE round at a time and holds
  // it until the admin explicitly finishes the round. Carries a round id only
  // — the display already has every label from display-meta, so no round text
  // travels on the channel.
  z.object({
    type: z.literal("set-round"),
    roundId: z.string().min(1),
  }),
  // Internal (E2-01 A7): one-shot ping posted by the display tab on mount so the
  // admin connection indicator can switch to "connected". Not a reveal message.
  z.object({
    type: z.literal("display-ready"),
  }),
]);

export type DisplayMessage = z.infer<typeof displayMessageSchema>;

/** sessionStorage key for the display tab's reveal log (E2-01 A9). */
export function revealLogKey(raffleId: string): string {
  return `raffle-display-log-${raffleId}`;
}

/**
 * sessionStorage key for the round the display is currently showing. Same
 * per-tab lifetime as the reveal log (D-003): a mid-event projector refresh
 * must come back on the round the audience was already watching, not reset to
 * round 1.
 */
export function currentRoundKey(raffleId: string): string {
  return `raffle-display-round-${raffleId}`;
}

/**
 * sessionStorage key for the ADMIN tab's record of the last round it handed
 * off to the display. Read-back only — it keeps the draw screen's "Showing …"
 * line honest across an admin refresh and never causes a broadcast.
 */
export function adminDisplayRoundKey(raffleId: string): string {
  return `raffle-admin-display-round-${raffleId}`;
}

export type RevealLogEntry = { slotId: string; fullName: string };
