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

export type RevealLogEntry = { slotId: string; fullName: string };
