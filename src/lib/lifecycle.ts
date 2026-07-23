import type { RaffleStatus } from "@prisma/client";

// Raffle lifecycle state machine (E1-01 Feature E). Forward-only; no reverse
// transitions exist in v1. Enforcement is ALWAYS against the current persisted
// status re-read from the database — never client-supplied state.

export const LEGAL_TRANSITIONS: Record<RaffleStatus, RaffleStatus[]> = {
  DRAFT: ["OPEN", "LOCKED"], // lock permitted from draft or open (E1-03 A7 / D-E06)
  OPEN: ["LOCKED"],
  LOCKED: ["DRAWN"], // performed by the draw engine when the final round commits
  DRAWN: ["COMPLETED"],
  COMPLETED: [],
};

export function isLegalTransition(from: RaffleStatus, to: RaffleStatus): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Structural mutations (raffle details, prize types, rounds, allocations, entrants) allowed only pre-lock. */
export function isStructureMutable(status: RaffleStatus): boolean {
  return status === "DRAFT" || status === "OPEN";
}

export const LOCKED_MESSAGE = "This raffle is locked. Its structure can no longer be changed.";
