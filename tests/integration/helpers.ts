// Shared helpers for the integration suite. These run against the REAL Neon
// Postgres database (DATABASE_URL from .env via dotenv/config in vitest
// setup). Every test tracks the raffles it creates and removes them with
// deleteRaffleDeep so concurrent suites (unit / e2e) sharing the DB are not
// disturbed. Titles are always unique per run.
//
// NOTE: vi.mock calls are hoisted per test FILE and therefore live at the top
// of each *.test.ts file, not here.

import { db } from "@/lib/db";
import { sortByTicket } from "@/lib/ticket";
import type { ActionResult } from "@/lib/action-result";

export function uniqueTitle(prefix = "it"): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Narrow an ActionResult to its data, failing the test with the error text otherwise. */
export function expectOk<T>(res: ActionResult<T>, context = ""): T {
  if (!res.ok) {
    throw new Error(
      `Expected ok${context ? ` (${context})` : ""} but got error: ${res.error}`
    );
  }
  return res.data;
}

/** Narrow an ActionResult to its error string, failing the test if it succeeded. */
export function expectFail<T>(res: ActionResult<T>, context = ""): string {
  if (res.ok) {
    throw new Error(
      `Expected failure${context ? ` (${context})` : ""} but the action succeeded`
    );
  }
  return res.error;
}

/**
 * Deep-delete a raffle and every dependent row, in FK-safe order:
 *  1. AuditLog rows (FK to raffle AND optionally to draw events).
 *  2. DrawEvents of the raffle's allocations — supersededById self-references
 *     are nulled first so the self-FK never blocks the delete.
 *  3. The raffle itself — cascades entries, retiredTickets, prizeTypes,
 *     rounds and (via rounds) allocations.
 */
export async function deleteRaffleDeep(raffleId: string): Promise<void> {
  await db.auditLog.deleteMany({ where: { raffleId } });

  const allocations = await db.roundAllocation.findMany({
    where: { round: { raffleId } },
    select: { id: true },
  });
  const allocationIds = allocations.map((a) => a.id);
  if (allocationIds.length > 0) {
    await db.drawEvent.updateMany({
      where: { roundAllocationId: { in: allocationIds } },
      data: { supersededById: null },
    });
    await db.drawEvent.deleteMany({
      where: { roundAllocationId: { in: allocationIds } },
    });
  }

  await db.raffle.delete({ where: { id: raffleId } }).catch(() => {
    // Already gone (test deleted it, or was never created) — cleanup is idempotent.
  });
}

/** Tracks every raffle a test file creates so afterAll can clean the DB. */
export function raffleTracker() {
  const ids: string[] = [];
  return {
    track(id: string): string {
      ids.push(id);
      return id;
    },
    async cleanup(): Promise<void> {
      for (const id of ids.splice(0)) {
        await deleteRaffleDeep(id);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Structural seeding (direct db writes — the actions under test are exercised
// separately; seeds only build the fixture the action needs)
// ---------------------------------------------------------------------------

export type SeedRoundSpec = {
  label?: string;
  revealMode?: "SEQUENTIAL" | "SIMULTANEOUS";
  allocations: { prize: string; quantity: number }[];
};

export type SeedEntry = { id: string; ticketNumber: string; fullName: string };

export type SeedResult = {
  raffleId: string;
  /** prize name -> PrizeType id */
  prizeTypes: Record<string, string>;
  rounds: { id: string; order: number; label: string; allocationIds: string[] }[];
  /** ordered by ticketNumber ascending, in natural (numeric-aware) order */
  entries: SeedEntry[];
};

export async function seedStructure(spec: {
  title?: string;
  entrantCount: number;
  namePrefix?: string;
  /** contact per 1-based entrant index; undefined -> null contact */
  contactFor?: (ticketNumber: number) => string | undefined;
  rounds?: SeedRoundSpec[];
}): Promise<SeedResult> {
  const raffle = await db.raffle.create({
    data: { title: spec.title ?? uniqueTitle() },
  });

  const prizeNames = new Set<string>();
  for (const r of spec.rounds ?? []) {
    for (const a of r.allocations) prizeNames.add(a.prize);
  }
  const prizeTypes: Record<string, string> = {};
  for (const name of prizeNames) {
    const pt = await db.prizeType.create({ data: { raffleId: raffle.id, name } });
    prizeTypes[name] = pt.id;
  }

  const rounds: SeedResult["rounds"] = [];
  let order = 0;
  for (const r of spec.rounds ?? []) {
    order += 1;
    const round = await db.drawRound.create({
      data: {
        raffleId: raffle.id,
        order,
        label: r.label ?? `Round ${order}`,
        revealMode: r.revealMode ?? "SEQUENTIAL",
      },
    });
    const allocationIds: string[] = [];
    for (const a of r.allocations) {
      const alloc = await db.roundAllocation.create({
        data: {
          roundId: round.id,
          prizeTypeId: prizeTypes[a.prize],
          quantity: a.quantity,
        },
      });
      allocationIds.push(alloc.id);
    }
    rounds.push({ id: round.id, order, label: round.label, allocationIds });
  }

  let entries: SeedEntry[] = [];
  if (spec.entrantCount > 0) {
    await db.entry.createMany({
      data: Array.from({ length: spec.entrantCount }, (_, i) => ({
        raffleId: raffle.id,
        ticketNumber: String(i + 1),
        fullName: `${spec.namePrefix ?? "Entrant"} ${i + 1}`,
        contact: spec.contactFor?.(i + 1) ?? null,
      })),
    });
    // Ticket/IDs are text (D-E29), so a SQL ORDER BY would give "1, 10, 2".
    // Sort naturally in memory to keep `entries` in 1..N order.
    entries = sortByTicket(
      await db.entry.findMany({
        where: { raffleId: raffle.id },
        select: { id: true, ticketNumber: true, fullName: true },
      })
    );
  }

  return { raffleId: raffle.id, prizeTypes, rounds, entries };
}

/** All DrawEvents of a raffle (via its allocations), ordered stably. */
export async function drawEventsOf(raffleId: string) {
  return db.drawEvent.findMany({
    where: { roundAllocation: { round: { raffleId } } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

/** All AuditLog rows of a raffle, chronological with id tie-break. */
export async function auditRowsOf(raffleId: string) {
  return db.auditLog.findMany({
    where: { raffleId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}
