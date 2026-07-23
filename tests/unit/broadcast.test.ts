import { describe, expect, it } from "vitest";

import {
  channelName,
  slotId,
  revealLogKey,
  displayMessageSchema,
} from "@/lib/broadcast";

describe("channelName", () => {
  it('formats as "raffle-display-<id>"', () => {
    expect(channelName("abc123")).toBe("raffle-display-abc123");
  });

  it("is scoped per raffle (distinct ids → distinct channels)", () => {
    expect(channelName("r1")).not.toBe(channelName("r2"));
  });
});

describe("slotId", () => {
  it('formats as "<allocId>:<seq>"', () => {
    expect(slotId("alloc-1", 1)).toBe("alloc-1:1");
    expect(slotId("alloc-9", 42)).toBe("alloc-9:42");
  });
});

describe("revealLogKey", () => {
  it('formats as "raffle-display-log-<id>"', () => {
    expect(revealLogKey("abc123")).toBe("raffle-display-log-abc123");
  });
});

describe("displayMessageSchema", () => {
  const validReveal = {
    type: "reveal",
    slotId: "a:1",
    fullName: "Alice",
    prizeLabel: "Grand Prize",
  };

  it("accepts a valid reveal message", () => {
    expect(displayMessageSchema.safeParse(validReveal).success).toBe(true);
  });

  it("accepts a valid redraw-start message", () => {
    expect(
      displayMessageSchema.safeParse({ type: "redraw-start", slotId: "a:1" }).success
    ).toBe(true);
  });

  it("accepts a valid redraw-result message", () => {
    expect(
      displayMessageSchema.safeParse({
        type: "redraw-result",
        slotId: "a:1",
        fullName: "Bob",
      }).success
    ).toBe(true);
  });

  it("accepts a valid display-ready message", () => {
    expect(displayMessageSchema.safeParse({ type: "display-ready" }).success).toBe(true);
  });

  it("rejects an unknown type", () => {
    expect(
      displayMessageSchema.safeParse({ type: "leak-tickets", slotId: "a:1" }).success
    ).toBe(false);
  });

  it("rejects non-object and typeless payloads", () => {
    expect(displayMessageSchema.safeParse(null).success).toBe(false);
    expect(displayMessageSchema.safeParse("reveal").success).toBe(false);
    expect(displayMessageSchema.safeParse({ slotId: "a:1" }).success).toBe(false);
  });

  it("rejects missing or empty slotId where required", () => {
    expect(
      displayMessageSchema.safeParse({ type: "reveal", fullName: "A", prizeLabel: "P" })
        .success
    ).toBe(false);
    expect(
      displayMessageSchema.safeParse({ ...validReveal, slotId: "" }).success
    ).toBe(false);
    expect(displayMessageSchema.safeParse({ type: "redraw-start" }).success).toBe(false);
    expect(
      displayMessageSchema.safeParse({ type: "redraw-start", slotId: "" }).success
    ).toBe(false);
    expect(
      displayMessageSchema.safeParse({ type: "redraw-result", fullName: "B" }).success
    ).toBe(false);
  });

  it("rejects missing or empty fullName on reveal and redraw-result", () => {
    expect(
      displayMessageSchema.safeParse({ type: "reveal", slotId: "a:1", prizeLabel: "P" })
        .success
    ).toBe(false);
    expect(
      displayMessageSchema.safeParse({ ...validReveal, fullName: "" }).success
    ).toBe(false);
    expect(
      displayMessageSchema.safeParse({ type: "redraw-result", slotId: "a:1" }).success
    ).toBe(false);
    expect(
      displayMessageSchema.safeParse({ type: "redraw-result", slotId: "a:1", fullName: "" })
        .success
    ).toBe(false);
  });

  it("rejects missing or empty prizeLabel on reveal", () => {
    expect(
      displayMessageSchema.safeParse({ type: "reveal", slotId: "a:1", fullName: "A" })
        .success
    ).toBe(false);
    expect(
      displayMessageSchema.safeParse({ ...validReveal, prizeLabel: "" }).success
    ).toBe(false);
  });

  it("rejects one type's payload shape with another type's tag", () => {
    // redraw-start does not gain reveal's fields — but reveal's tag on a
    // redraw-start-shaped payload (no fullName/prizeLabel) must fail.
    expect(
      displayMessageSchema.safeParse({ type: "reveal", slotId: "a:1" }).success
    ).toBe(false);
    // redraw-result tag with only reveal-required prizeLabel and no fullName.
    expect(
      displayMessageSchema.safeParse({
        type: "redraw-result",
        slotId: "a:1",
        prizeLabel: "P",
      }).success
    ).toBe(false);
    // Wrong field types.
    expect(
      displayMessageSchema.safeParse({ ...validReveal, fullName: 123 }).success
    ).toBe(false);
    expect(
      displayMessageSchema.safeParse({ type: "redraw-start", slotId: 7 }).success
    ).toBe(false);
  });

  it("has no field for ticket numbers, statuses, or reasons — extra keys are stripped", () => {
    const parsed = displayMessageSchema.parse({
      ...validReveal,
      ticketNumber: 1234,
      status: "DISQUALIFIED",
      reason: "secret admin reason",
      contact: "alice@example.com",
    } as unknown);
    // Zod strips unknown keys: the wire contract structurally cannot carry
    // entrant-sensitive data (E2-01 privacy contract).
    expect(Object.keys(parsed).sort()).toEqual([
      "fullName",
      "prizeLabel",
      "slotId",
      "type",
    ]);
    expect(parsed).not.toHaveProperty("ticketNumber");
    expect(parsed).not.toHaveProperty("status");
    expect(parsed).not.toHaveProperty("reason");
    expect(parsed).not.toHaveProperty("contact");
  });
});
