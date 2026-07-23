// Integration: participant management (src/actions/entrants.ts) against the
// real Neon database — import atomicity, ticket never-reuse ledger, gating.

import { describe, it, expect, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "test" }), set: () => {}, delete: () => {} }),
}));
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireSession: async () => {},
  hasValidSession: async () => true,
}));

import { importEntrants, addEntrant, removeEntrant } from "@/actions/entrants";
import { createRaffle } from "@/actions/raffles";
import { db } from "@/lib/db";
import { raffleTracker, uniqueTitle, expectOk, expectFail } from "./helpers";

const tracker = raffleTracker();
afterAll(() => tracker.cleanup());

async function newRaffle() {
  const { id } = expectOk(await createRaffle({ title: uniqueTitle("it-ent") }));
  return tracker.track(id);
}

describe("importEntrants", () => {
  it("imports N valid rows as N entries + N retired tickets in one transaction", async () => {
    const raffleId = await newRaffle();
    const rows = [
      { lineNumber: 2, ticketNumber: 1, fullName: "Alice" },
      { lineNumber: 3, ticketNumber: 2, fullName: "Bob", contact: "bob@example.com" },
      { lineNumber: 4, ticketNumber: 3, fullName: "Cara" },
    ];

    const data = expectOk(await importEntrants(raffleId, rows));
    expect(data).toEqual({ imported: 3, rowErrors: [] });

    const entries = await db.entry.findMany({
      where: { raffleId },
      orderBy: { ticketNumber: "asc" },
    });
    expect(entries.map((e) => [e.ticketNumber, e.fullName, e.contact])).toEqual([
      [1, "Alice", null],
      [2, "Bob", "bob@example.com"],
      [3, "Cara", null],
    ]);
    expect(await db.retiredTicket.count({ where: { raffleId } })).toBe(3);
  });

  it("re-validates server-side: one bad row blocks the whole batch, zero rows written", async () => {
    const raffleId = await newRaffle();
    const rows = [
      { lineNumber: 2, ticketNumber: 10, fullName: "Good Row" },
      { lineNumber: 3, ticketNumber: 11, fullName: "" }, // invalid: missing name
      { lineNumber: 4, ticketNumber: 12, fullName: "Also Good" },
    ];

    const data = expectOk(await importEntrants(raffleId, rows));
    expect(data.imported).toBe(0);
    expect(data.rowErrors).toEqual([{ lineNumber: 3, reason: "Missing full name" }]);

    expect(await db.entry.count({ where: { raffleId } })).toBe(0);
    expect(await db.retiredTicket.count({ where: { raffleId } })).toBe(0);
  });

  it("rejects import into a LOCKED raffle with zero rows written", async () => {
    const raffleId = await newRaffle();
    await db.raffle.update({ where: { id: raffleId }, data: { status: "LOCKED" } });

    const error = expectFail(
      await importEntrants(raffleId, [{ lineNumber: 2, ticketNumber: 1, fullName: "X" }])
    );
    expect(error).toBe("This raffle is locked. Entrants can no longer be added.");
    expect(await db.entry.count({ where: { raffleId } })).toBe(0);
    expect(await db.retiredTicket.count({ where: { raffleId } })).toBe(0);
  });

  it("rejects a batch whose ticket duplicates an existing entrant, writing nothing", async () => {
    const raffleId = await newRaffle();
    expectOk(await addEntrant(raffleId, { ticketNumber: 5, fullName: "Existing" }));

    const data = expectOk(
      await importEntrants(raffleId, [
        { lineNumber: 2, ticketNumber: 5, fullName: "Clash" },
        { lineNumber: 3, ticketNumber: 6, fullName: "Fine" },
      ])
    );
    expect(data.imported).toBe(0);
    expect(data.rowErrors).toEqual([
      { lineNumber: 2, reason: "Ticket number 5 is already used in this raffle." },
    ]);
    // The valid row 6 was NOT written (all-or-nothing).
    expect(await db.entry.count({ where: { raffleId } })).toBe(1);
  });
});

describe("ticket integrity (never-reuse ledger)", () => {
  it("rejects addEntrant with a ticket already used by an existing entrant", async () => {
    const raffleId = await newRaffle();
    expectOk(await addEntrant(raffleId, { ticketNumber: 7, fullName: "First" }));

    const error = expectFail(
      await addEntrant(raffleId, { ticketNumber: 7, fullName: "Second" })
    );
    expect(error).toBe("Ticket number 7 is already used in this raffle.");
    expect(await db.entry.count({ where: { raffleId } })).toBe(1);
  });

  it("add -> remove -> re-add of the same ticket is rejected as previously used", async () => {
    const raffleId = await newRaffle();
    const { entryId } = expectOk(
      await addEntrant(raffleId, { ticketNumber: 9, fullName: "Removed Later" })
    );
    expectOk(await removeEntrant(entryId));

    const error = expectFail(
      await addEntrant(raffleId, { ticketNumber: 9, fullName: "Comeback" })
    );
    expect(error).toBe(
      "Ticket number 9 was previously used in this raffle and cannot be reused."
    );
    expect(await db.entry.count({ where: { raffleId } })).toBe(0);
  });

  it("the same ticket number succeeds in a DIFFERENT raffle", async () => {
    const raffleA = await newRaffle();
    const raffleB = await newRaffle();

    expectOk(await addEntrant(raffleA, { ticketNumber: 42, fullName: "In A" }));
    expectOk(await addEntrant(raffleB, { ticketNumber: 42, fullName: "In B" }));

    expect(await db.entry.count({ where: { raffleId: raffleB, ticketNumber: 42 } })).toBe(1);
  });

  it("removeEntrant hard-deletes the Entry but the RetiredTicket ledger row survives", async () => {
    const raffleId = await newRaffle();
    const { entryId } = expectOk(
      await addEntrant(raffleId, { ticketNumber: 3, fullName: "Ledgered" })
    );

    expectOk(await removeEntrant(entryId));

    expect(await db.entry.count({ where: { id: entryId } })).toBe(0);
    expect(
      await db.retiredTicket.count({ where: { raffleId, ticketNumber: 3 } })
    ).toBe(1);
  });
});

describe("addEntrant validation + status gating", () => {
  it("rejects a non-positive ticket number without writing", async () => {
    const raffleId = await newRaffle();
    const error = expectFail(
      await addEntrant(raffleId, { ticketNumber: 0, fullName: "Zero" })
    );
    expect(error).toBe("Ticket must be a whole number");
    expect(await db.entry.count({ where: { raffleId } })).toBe(0);
  });

  it("rejects an empty full name without writing", async () => {
    const raffleId = await newRaffle();
    const error = expectFail(
      await addEntrant(raffleId, { ticketNumber: 1, fullName: "   " })
    );
    expect(error).toBe("Full name is required.");
    expect(await db.entry.count({ where: { raffleId } })).toBe(0);
  });

  it("rejects add and remove on a LOCKED raffle", async () => {
    const raffleId = await newRaffle();
    const { entryId } = expectOk(
      await addEntrant(raffleId, { ticketNumber: 1, fullName: "Kept" })
    );
    await db.raffle.update({ where: { id: raffleId }, data: { status: "LOCKED" } });

    const addError = expectFail(
      await addEntrant(raffleId, { ticketNumber: 2, fullName: "Late" })
    );
    expect(addError).toBe("This raffle is locked. Entrants can no longer be added.");

    const removeError = expectFail(await removeEntrant(entryId));
    expect(removeError).toBe("This raffle is locked. Entrants can no longer be removed.");

    expect(await db.entry.count({ where: { raffleId } })).toBe(1);
  });
});
