// Integration: export/report data assembly (src/lib/report-data.ts) and the
// public display-meta payload (src/lib/display-meta.ts) against the real Neon
// database. The scenario is arranged exclusively through the real actions so
// the export reflects genuine app history (B-12, D-E12, D-E20, E3-02).

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "test" }), set: () => {}, delete: () => {} }),
}));
vi.mock("@/lib/session", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  requireSession: async () => {},
  hasValidSession: async () => true,
}));

import { getResultsExportRows, getLogExportRows } from "@/lib/report-data";
import { buildDisplayMeta, displayMetaSchema } from "@/lib/display-meta";
import { lockRaffle } from "@/actions/lock";
import { executeRound } from "@/actions/draw";
import { changeDrawEventStatus, redrawSlot } from "@/actions/winners";
import { db } from "@/lib/db";
import {
  raffleTracker,
  uniqueTitle,
  expectOk,
  seedStructure,
  drawEventsOf,
  auditRowsOf,
  type SeedResult,
} from "./helpers";

const tracker = raffleTracker();
afterAll(() => tracker.cleanup());

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

// Shared scenario, built once:
//   4 entrants (tickets 1-4), 1 round "Round 1", 3x "Gold" (SIMULTANEOUS).
//   Draw -> winners A, B, C; leftover L.
//   1. disqualify A's slot, redraw -> pool is exactly {L} -> replacement RA = L
//   2. release B's slot -> B re-enters the pool
//   3. disqualify C's slot, redraw -> pool is exactly {B} -> replacement RB = B
//      (B now has TWO chronological outcomes: released, then pending)
//   4. release RA -> L's latest status is RELEASED_TO_POOL
let seed: SeedResult;
let ticketOf: Map<string, string>; // entryId -> ticketNumber
let aId: string, bId: string, cId: string, lId: string; // entry ids

beforeAll(async () => {
  seed = await seedStructure({
    title: uniqueTitle("it-export"),
    entrantCount: 4,
    namePrefix: "SENSITIVE_NAME_XYZ Entrant",
    contactFor: (t) => (t === 1 ? "SENSITIVE_CONTACT_XYZ_1" : undefined),
    rounds: [
      {
        label: "Round 1",
        revealMode: "SIMULTANEOUS",
        allocations: [{ prize: "Gold", quantity: 3 }],
      },
    ],
  });
  tracker.track(seed.raffleId);
  ticketOf = new Map(seed.entries.map((e) => [e.id, e.ticketNumber]));

  expectOk(await lockRaffle(seed.raffleId));
  expectOk(await executeRound(seed.rounds[0].id));

  const drawn = await drawEventsOf(seed.raffleId);
  expect(drawn).toHaveLength(3);
  const [evA, evB, evC] = drawn;
  [aId, bId, cId] = [evA.winnerEntryId, evB.winnerEntryId, evC.winnerEntryId];
  const winnerIds = new Set([aId, bId, cId]);
  lId = seed.entries.map((e) => e.id).find((id) => !winnerIds.has(id))!;

  // 1. A disqualified, slot redrawn -> replacement must be L (pool of one).
  expectOk(
    await changeDrawEventStatus({
      drawEventId: evA.id,
      newStatus: "DISQUALIFIED",
      reason: "SENSITIVE_REASON_XYZ dq A",
    })
  );
  const redrawA = expectOk(
    await redrawSlot({ drawEventId: evA.id, reason: "SENSITIVE_REASON_XYZ redraw A" })
  );
  expect(
    (await db.drawEvent.findUniqueOrThrow({ where: { id: redrawA.replacement.drawEventId } }))
      .winnerEntryId
  ).toBe(lId);

  // 2. B released back to the pool.
  expectOk(
    await changeDrawEventStatus({
      drawEventId: evB.id,
      newStatus: "RELEASED_TO_POOL",
      reason: "SENSITIVE_REASON_XYZ release B",
    })
  );

  // 3. C disqualified, slot redrawn -> replacement must be B (pool of one).
  expectOk(
    await changeDrawEventStatus({
      drawEventId: evC.id,
      newStatus: "DISQUALIFIED",
      reason: "SENSITIVE_REASON_XYZ dq C",
    })
  );
  const redrawC = expectOk(
    await redrawSlot({ drawEventId: evC.id, reason: "SENSITIVE_REASON_XYZ redraw C" })
  );
  expect(
    (await db.drawEvent.findUniqueOrThrow({ where: { id: redrawC.replacement.drawEventId } }))
      .winnerEntryId
  ).toBe(bId);

  // 4. L's replacement event released -> "released" appears in the export.
  expectOk(
    await changeDrawEventStatus({
      drawEventId: redrawA.replacement.drawEventId,
      newStatus: "RELEASED_TO_POOL",
      reason: "SENSITIVE_REASON_XYZ release L",
    })
  );
});

describe("getResultsExportRows", () => {
  it("emits one row per entrant, ticket ascending, with D-E12/B-12 outcome semantics", async () => {
    const csv = await getResultsExportRows(seed.raffleId);
    expect(csv).not.toBeNull();
    const { header, rows } = csv!;

    // Contact present (one entrant has one) -> 6-column header (D-E20).
    expect(header).toEqual([
      "ticket_number",
      "full_name",
      "contact",
      "draw_round",
      "prize",
      "winner_status",
    ]);

    // One row per entrant, ordered by ticket asc.
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r[0])).toEqual(["1", "2", "3", "4"]);

    const rowOf = (entryId: string) =>
      rows.find((r) => r[0] === ticketOf.get(entryId))!;

    // Superseded original shows "disqualified" (B-12) ...
    expect(rowOf(aId).slice(3)).toEqual(["Round 1", "Gold", "disqualified"]);
    expect(rowOf(cId).slice(3)).toEqual(["Round 1", "Gold", "disqualified"]);

    // ... while the replacement shows its OWN status; RELEASED_TO_POOL maps
    // to "released" (B-10).
    expect(rowOf(lId).slice(3)).toEqual(["Round 1", "Gold", "released"]);

    // Multi-win entrant (win -> release -> win again): "; "-joined
    // chronological outcomes with the LATEST status (D-E12).
    expect(rowOf(bId).slice(3)).toEqual(["Round 1; Round 1", "Gold; Gold", "pending"]);

    // Contact column: value only for ticket 1, empty for the rest.
    expect(rows[0][2]).toBe("SENSITIVE_CONTACT_XYZ_1");
    expect(rows.slice(1).map((r) => r[2])).toEqual(["", "", ""]);
  });

  it("omits the contact column entirely when no entrant has a contact; non-winners get empty strings", async () => {
    const bare = await seedStructure({
      title: uniqueTitle("it-export-nocontact"),
      entrantCount: 2,
    });
    tracker.track(bare.raffleId);

    const csv = await getResultsExportRows(bare.raffleId);
    expect(csv).not.toBeNull();
    expect(csv!.header).toEqual([
      "ticket_number",
      "full_name",
      "draw_round",
      "prize",
      "winner_status",
    ]);
    // No draw events -> outcome columns are empty strings, not "N/A" (B-11).
    expect(csv!.rows.map((r) => r.slice(2))).toEqual([
      ["", "", ""],
      ["", "", ""],
    ]);
  });
});

describe("getLogExportRows", () => {
  it("emits one chronological row per audit entry, with disqualify/redraw rows carrying reason, actor and ISO-UTC timestamps", async () => {
    const csv = await getLogExportRows(seed.raffleId);
    expect(csv).not.toBeNull();
    const { header, rows } = csv!;

    expect(header).toEqual([
      "timestamp",
      "action",
      "entity_type",
      "entity_id",
      "old_value",
      "new_value",
      "reason",
      "actor",
    ]);

    // One row per AuditLog entry of the raffle:
    // lock(1) + draw(3 events + 1 raffle) + disqualified(2) + redraw(2) + released(2) = 11
    const audits = await auditRowsOf(seed.raffleId);
    expect(rows).toHaveLength(audits.length);
    expect(rows).toHaveLength(11);

    // Chronological ascending.
    const timestamps = rows.map((r) => r[0]);
    expect([...timestamps].sort()).toEqual(timestamps);
    for (const t of timestamps) expect(t).toMatch(ISO_UTC);

    const disqualifyRows = rows.filter((r) => r[1] === "disqualified");
    expect(disqualifyRows).toHaveLength(2);
    expect(disqualifyRows.map((r) => r[6]).sort()).toEqual([
      "SENSITIVE_REASON_XYZ dq A",
      "SENSITIVE_REASON_XYZ dq C",
    ]);
    expect(disqualifyRows.every((r) => r[7] === "admin")).toBe(true);

    const redrawRows = rows.filter((r) => r[1] === "redraw");
    expect(redrawRows).toHaveLength(2);
    expect(redrawRows.every((r) => r[6].startsWith("SENSITIVE_REASON_XYZ redraw"))).toBe(
      true
    );
    expect(redrawRows.every((r) => r[7] === "admin")).toBe(true);
  });
});

describe("buildDisplayMeta (E3-02 payload-level assertion)", () => {
  it("contains NONE of the seeded sensitive strings and matches displayMetaSchema", async () => {
    const meta = await buildDisplayMeta(seed.raffleId);
    expect(meta).not.toBeNull();

    // Payload-level walk: the serialized JSON of a drawn raffle with contact
    // data, statuses and reasons must never leak any of it.
    const serialized = JSON.stringify(meta);
    expect(serialized).not.toContain("SENSITIVE"); // names, contacts, reasons
    expect(serialized.toLowerCase()).not.toContain("disqualified");
    expect(serialized.toLowerCase()).not.toContain("released");
    expect(serialized.toLowerCase()).not.toContain("pending");
    expect(serialized.toLowerCase()).not.toContain("claimed");

    const parsed = displayMetaSchema.safeParse(meta);
    expect(parsed.success).toBe(true);

    // Structural content: 1 round, 3 per-slot entries in reveal order.
    expect(meta!.rounds).toHaveLength(1);
    expect(meta!.rounds[0].label).toBe("Round 1");
    expect(meta!.rounds[0].revealMode).toBe("SIMULTANEOUS");
    const allocationId = seed.rounds[0].allocationIds[0];
    expect(meta!.rounds[0].slots).toEqual([
      { slotId: `${allocationId}:1`, prizeLabel: "Gold" },
      { slotId: `${allocationId}:2`, prizeLabel: "Gold" },
      { slotId: `${allocationId}:3`, prizeLabel: "Gold" },
    ]);
  });
});
