import { describe, expect, it } from "vitest";
import type { RaffleStatus } from "@prisma/client";

import { isLegalTransition, isStructureMutable, LEGAL_TRANSITIONS } from "@/lib/lifecycle";

const STATUSES: RaffleStatus[] = ["DRAFT", "OPEN", "LOCKED", "DRAWN", "COMPLETED"];

// The complete legal-transition matrix (E1-01 Feature E; lock-from-draft per
// E1-03 A7 / D-E06). Everything not listed here is illegal.
const LEGAL_PAIRS: Array<[RaffleStatus, RaffleStatus]> = [
  ["DRAFT", "OPEN"],
  ["DRAFT", "LOCKED"],
  ["OPEN", "LOCKED"],
  ["LOCKED", "DRAWN"],
  ["DRAWN", "COMPLETED"],
];

describe("isLegalTransition", () => {
  it.each(LEGAL_PAIRS)("%s → %s is legal", (from, to) => {
    expect(isLegalTransition(from, to)).toBe(true);
  });

  it("every other from/to pair is illegal (exhaustive over all 25 pairs)", () => {
    const legal = new Set(LEGAL_PAIRS.map(([f, t]) => `${f}→${t}`));
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        const expected = legal.has(`${from}→${to}`);
        expect(isLegalTransition(from, to), `${from} → ${to}`).toBe(expected);
      }
    }
  });

  it("self-transitions are illegal", () => {
    for (const s of STATUSES) {
      expect(isLegalTransition(s, s), `${s} → ${s}`).toBe(false);
    }
  });

  it("all backward paths are illegal (forward-only lifecycle)", () => {
    const order: Record<RaffleStatus, number> = {
      DRAFT: 0,
      OPEN: 1,
      LOCKED: 2,
      DRAWN: 3,
      COMPLETED: 4,
    };
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        if (order[to] < order[from]) {
          expect(isLegalTransition(from, to), `${from} → ${to}`).toBe(false);
        }
      }
    }
  });

  it("COMPLETED is terminal", () => {
    expect(LEGAL_TRANSITIONS.COMPLETED).toEqual([]);
    for (const to of STATUSES) {
      expect(isLegalTransition("COMPLETED", to)).toBe(false);
    }
  });
});

describe("isStructureMutable", () => {
  it("is true only for DRAFT and OPEN", () => {
    expect(isStructureMutable("DRAFT")).toBe(true);
    expect(isStructureMutable("OPEN")).toBe(true);
    expect(isStructureMutable("LOCKED")).toBe(false);
    expect(isStructureMutable("DRAWN")).toBe(false);
    expect(isStructureMutable("COMPLETED")).toBe(false);
  });
});
