import { describe, expect, it } from "vitest";

import {
  raffleSchema,
  prizeTypeSchema,
  roundSchema,
  allocationSchema,
  entrantSchema,
  reasonSchema,
  statusChangeSchema,
  redrawSchema,
  pinSchema,
} from "@/lib/validation";

function firstMessage(result: { success: boolean; error?: { issues: Array<{ message: string }> } }): string {
  if (result.success || !result.error) throw new Error("expected a validation failure");
  return result.error.issues[0].message;
}

describe("raffleSchema", () => {
  it("accepts a valid title and trims it", () => {
    const parsed = raffleSchema.parse({ title: "  Year-End Raffle  " });
    expect(parsed.title).toBe("Year-End Raffle");
  });

  it('rejects an empty or whitespace-only title with "Title is required."', () => {
    expect(firstMessage(raffleSchema.safeParse({ title: "" }))).toBe("Title is required.");
    expect(firstMessage(raffleSchema.safeParse({ title: "   " }))).toBe(
      "Title is required."
    );
  });

  it("caps title at 200 characters with the exact message", () => {
    expect(raffleSchema.safeParse({ title: "a".repeat(200) }).success).toBe(true);
    expect(firstMessage(raffleSchema.safeParse({ title: "a".repeat(201) }))).toBe(
      "Title must be 200 characters or fewer."
    );
  });

  it("caps description at 2000 characters and allows omission", () => {
    expect(
      raffleSchema.safeParse({ title: "T", description: "d".repeat(2000) }).success
    ).toBe(true);
    expect(
      firstMessage(raffleSchema.safeParse({ title: "T", description: "d".repeat(2001) }))
    ).toBe("Description must be 2000 characters or fewer.");
    expect(raffleSchema.safeParse({ title: "T" }).success).toBe(true);
    expect(raffleSchema.safeParse({ title: "T", description: "" }).success).toBe(true);
  });
});

describe("prizeTypeSchema", () => {
  it("trims and accepts a valid name", () => {
    expect(prizeTypeSchema.parse({ name: " Grand Prize " }).name).toBe("Grand Prize");
  });

  it("rejects empty and over-100-char names with exact messages", () => {
    expect(firstMessage(prizeTypeSchema.safeParse({ name: "  " }))).toBe(
      "Prize type name is required."
    );
    expect(prizeTypeSchema.safeParse({ name: "n".repeat(100) }).success).toBe(true);
    expect(firstMessage(prizeTypeSchema.safeParse({ name: "n".repeat(101) }))).toBe(
      "Prize type name must be 100 characters or fewer."
    );
  });
});

describe("roundSchema", () => {
  it("accepts both reveal modes", () => {
    expect(roundSchema.safeParse({ label: "Round 1", revealMode: "SEQUENTIAL" }).success).toBe(true);
    expect(roundSchema.safeParse({ label: "Round 1", revealMode: "SIMULTANEOUS" }).success).toBe(true);
  });

  it("rejects a missing/empty label and caps at 100 chars", () => {
    expect(
      firstMessage(roundSchema.safeParse({ label: " ", revealMode: "SEQUENTIAL" }))
    ).toBe("Round label is required.");
    expect(
      firstMessage(
        roundSchema.safeParse({ label: "x".repeat(101), revealMode: "SEQUENTIAL" })
      )
    ).toBe("Round label must be 100 characters or fewer.");
  });

  it('rejects an invalid reveal mode with "Choose a reveal mode."', () => {
    expect(
      firstMessage(roundSchema.safeParse({ label: "R", revealMode: "RANDOM" }))
    ).toBe("Choose a reveal mode.");
    expect(firstMessage(roundSchema.safeParse({ label: "R" }))).toBe(
      "Choose a reveal mode."
    );
  });
});

describe("allocationSchema", () => {
  const base = { prizeTypeId: "pt1" };

  it("accepts quantities from 1 to 10,000", () => {
    expect(allocationSchema.safeParse({ ...base, quantity: 1 }).success).toBe(true);
    expect(allocationSchema.safeParse({ ...base, quantity: 10000 }).success).toBe(true);
  });

  it("rejects 0, negative, and fractional quantities with the exact message", () => {
    for (const q of [0, -1, 1.5]) {
      expect(firstMessage(allocationSchema.safeParse({ ...base, quantity: q }))).toBe(
        "Quantity must be a whole number of at least 1."
      );
    }
  });

  it("rejects non-number quantity with the exact message", () => {
    expect(firstMessage(allocationSchema.safeParse({ ...base, quantity: "5" }))).toBe(
      "Quantity must be a whole number of at least 1."
    );
    expect(firstMessage(allocationSchema.safeParse({ ...base }))).toBe(
      "Quantity must be a whole number of at least 1."
    );
  });

  it('rejects 10,001 with "Quantity cannot exceed 10,000."', () => {
    expect(firstMessage(allocationSchema.safeParse({ ...base, quantity: 10001 }))).toBe(
      "Quantity cannot exceed 10,000."
    );
  });

  it("requires a prize type id", () => {
    expect(firstMessage(allocationSchema.safeParse({ prizeTypeId: "", quantity: 1 }))).toBe(
      "Choose a prize type for this allocation."
    );
  });
});

describe("entrantSchema", () => {
  const valid = { ticketNumber: "1", fullName: "Alice" };

  it("accepts a valid entrant and trims ticketNumber/fullName/contact", () => {
    const parsed = entrantSchema.parse({
      ticketNumber: "  A-1024  ",
      fullName: "  Alice  ",
      contact: "  a@x.com  ",
    });
    expect(parsed).toEqual({
      ticketNumber: "A-1024",
      fullName: "Alice",
      contact: "a@x.com",
    });
  });

  it("accepts free-form ticket/IDs — letters, punctuation, leading zeros (D-E29)", () => {
    for (const t of ["A-1024", "EMP_0092", "7f3c9b", "abc", "0", "007", "#12/A", "a b"]) {
      expect(
        entrantSchema.safeParse({ ...valid, ticketNumber: t }).success,
        `ticketNumber=${t}`
      ).toBe(true);
    }
  });

  it("rejects an empty/whitespace-only ticket with the exact message", () => {
    for (const t of ["", "   "]) {
      expect(firstMessage(entrantSchema.safeParse({ ...valid, ticketNumber: t }))).toBe(
        "Ticket/ID is required."
      );
    }
    expect(firstMessage(entrantSchema.safeParse({ fullName: "Alice" }))).toBe(
      "Ticket/ID is required."
    );
  });

  it("caps the ticket at 64 characters with the exact message", () => {
    expect(
      entrantSchema.safeParse({ ...valid, ticketNumber: "t".repeat(64) }).success
    ).toBe(true);
    expect(
      firstMessage(entrantSchema.safeParse({ ...valid, ticketNumber: "t".repeat(65) }))
    ).toBe("Ticket/ID must be 64 characters or fewer.");
  });

  it("rejects control characters in the ticket with the exact message", () => {
    for (const code of [0x01, 0x09, 0x1f, 0x7f, 0x9f]) {
      expect(
        firstMessage(
          entrantSchema.safeParse({
            ...valid,
            ticketNumber: `A${String.fromCharCode(code)}B`,
          })
        ),
        `code=${code}`
      ).toBe("Ticket/ID contains invalid characters.");
    }
  });

  it("rejects a non-string ticket", () => {
    expect(entrantSchema.safeParse({ ...valid, ticketNumber: 3 }).success).toBe(false);
  });

  it("requires fullName and caps it at 200 chars", () => {
    expect(firstMessage(entrantSchema.safeParse({ ...valid, fullName: "  " }))).toBe(
      "Full name is required."
    );
    expect(
      entrantSchema.safeParse({ ...valid, fullName: "a".repeat(200) }).success
    ).toBe(true);
    expect(
      firstMessage(entrantSchema.safeParse({ ...valid, fullName: "a".repeat(201) }))
    ).toBe("Full name must be 200 characters or fewer.");
  });

  it("contact is optional, empty allowed, capped at 200 chars", () => {
    expect(entrantSchema.safeParse(valid).success).toBe(true);
    expect(entrantSchema.safeParse({ ...valid, contact: "" }).success).toBe(true);
    expect(
      entrantSchema.safeParse({ ...valid, contact: "c".repeat(200) }).success
    ).toBe(true);
    expect(
      firstMessage(entrantSchema.safeParse({ ...valid, contact: "c".repeat(201) }))
    ).toBe("Contact must be 200 characters or fewer.");
  });
});

describe("reasonSchema", () => {
  it("trims and accepts up to 500 characters", () => {
    expect(reasonSchema.parse("  ok  ")).toBe("ok");
    expect(reasonSchema.safeParse("r".repeat(500)).success).toBe(true);
  });

  it("rejects empty/whitespace-only with the exact required message", () => {
    expect(firstMessage(reasonSchema.safeParse(""))).toBe(
      "A reason is required for every status change."
    );
    expect(firstMessage(reasonSchema.safeParse("   "))).toBe(
      "A reason is required for every status change."
    );
  });

  it("rejects 501 characters with the exact cap message", () => {
    expect(firstMessage(reasonSchema.safeParse("r".repeat(501)))).toBe(
      "Reason must be 500 characters or fewer."
    );
  });
});

describe("statusChangeSchema", () => {
  it("accepts the three allowed statuses with an id and reason", () => {
    for (const s of ["CLAIMED", "DISQUALIFIED", "RELEASED_TO_POOL"]) {
      expect(
        statusChangeSchema.safeParse({ drawEventId: "d1", newStatus: s, reason: "why" })
          .success
      ).toBe(true);
    }
  });

  it("rejects an unknown status, missing id, or missing reason", () => {
    expect(
      statusChangeSchema.safeParse({ drawEventId: "d1", newStatus: "WON", reason: "x" })
        .success
    ).toBe(false);
    expect(
      statusChangeSchema.safeParse({ drawEventId: "", newStatus: "CLAIMED", reason: "x" })
        .success
    ).toBe(false);
    expect(
      statusChangeSchema.safeParse({ drawEventId: "d1", newStatus: "CLAIMED", reason: " " })
        .success
    ).toBe(false);
  });
});

describe("redrawSchema", () => {
  it("requires drawEventId and a non-empty reason", () => {
    expect(redrawSchema.safeParse({ drawEventId: "d1", reason: "ineligible" }).success).toBe(true);
    expect(redrawSchema.safeParse({ drawEventId: "", reason: "x" }).success).toBe(false);
    expect(firstMessage(redrawSchema.safeParse({ drawEventId: "d1", reason: "" }))).toBe(
      "A reason is required for every status change."
    );
  });
});

describe("pinSchema", () => {
  it("requires a non-empty pin with the exact message", () => {
    expect(pinSchema.safeParse({ pin: "1234" }).success).toBe(true);
    expect(firstMessage(pinSchema.safeParse({ pin: "" }))).toBe("Please enter your PIN.");
  });
});
