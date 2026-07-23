"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";

import { ok, fail, type ActionResult } from "@/lib/action-result";
import { db } from "@/lib/db";
import {
  MAX_IMPORT_ROWS,
  toMappedRows,
  validateMappedRows,
  type ImportableRow,
} from "@/lib/csv-import";
import { isStructureMutable } from "@/lib/lifecycle";
import { requireSession } from "@/lib/session";
import { entrantSchema } from "@/lib/validation";

// Server Actions for E1-02 — Participant Management & CSV Import.
// Every mutation re-validates raffle status and ticket uniqueness against the
// database; the UI is never the enforcement layer (FSD §7).

const LOCKED_ADD = "This raffle is locked. Entrants can no longer be added.";
const LOCKED_REMOVE = "This raffle is locked. Entrants can no longer be removed.";
const ALREADY_REMOVED = "This entrant was already removed.";

function alreadyUsedMessage(n: number): string {
  return `Ticket number ${n} is already used in this raffle.`;
}
function previouslyUsedMessage(n: number): string {
  return `Ticket number ${n} was previously used in this raffle and cannot be reused.`;
}

/** One server-side row rejection, addressed by the row's source line number. */
export type ImportRowError = { lineNumber: number; reason: string };

/**
 * Import commit result. All-or-nothing (FSD Preview Rule 4 / A9): when
 * `rowErrors` is non-empty, `imported` is 0 and NOTHING was written — the
 * client re-renders the preview with these row-level rejections.
 */
export type ImportResult = { imported: number; rowErrors: ImportRowError[] };

/** Sentinel error used to abort the transaction with a typed payload. */
class ImportAbort extends Error {
  constructor(public readonly result: ActionResult<ImportResult>) {
    super("IMPORT_ABORT");
  }
}

export async function importEntrants(
  raffleId: string,
  rows: ImportableRow[]
): Promise<ActionResult<ImportResult>> {
  await requireSession();

  if (!Array.isArray(rows) || rows.length === 0) {
    return fail("No entrant rows found in the input.");
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return fail(`Too many rows. Imports are limited to ${MAX_IMPORT_ROWS.toLocaleString("en-US")} rows.`);
  }

  // Re-validate EVERY submitted row with the exact same pure logic the
  // preview used. The client's partition is never trusted.
  const { importable, rejected } = validateMappedRows(toMappedRows(rows));
  const rowErrors: ImportRowError[] = rejected.map((r) => ({
    lineNumber: r.lineNumber,
    reason: r.reason,
  }));
  if (rowErrors.length > 0) {
    // Any server-side rejection blocks the whole batch (all-or-nothing).
    return ok({ imported: 0, rowErrors });
  }

  const tickets = importable.map((r) => r.ticketNumber);

  try {
    await db.$transaction(async (tx) => {
      const raffle = await tx.raffle.findUnique({
        where: { id: raffleId },
        select: { status: true },
      });
      if (!raffle) throw new ImportAbort(fail("Raffle not found."));
      if (!isStructureMutable(raffle.status)) throw new ImportAbort(fail(LOCKED_ADD));

      // Uniqueness against current entries AND the never-reuse ledger (D-E03).
      const [existing, retired] = await Promise.all([
        tx.entry.findMany({
          where: { raffleId, ticketNumber: { in: tickets } },
          select: { ticketNumber: true },
        }),
        tx.retiredTicket.findMany({
          where: { raffleId, ticketNumber: { in: tickets } },
          select: { ticketNumber: true },
        }),
      ]);
      const existingSet = new Set(existing.map((e) => e.ticketNumber));
      const retiredSet = new Set(retired.map((r) => r.ticketNumber));

      const conflicts: ImportRowError[] = [];
      for (const row of importable) {
        if (existingSet.has(row.ticketNumber)) {
          conflicts.push({ lineNumber: row.lineNumber, reason: alreadyUsedMessage(row.ticketNumber) });
        } else if (retiredSet.has(row.ticketNumber)) {
          conflicts.push({ lineNumber: row.lineNumber, reason: previouslyUsedMessage(row.ticketNumber) });
        }
      }
      if (conflicts.length > 0) {
        throw new ImportAbort(ok({ imported: 0, rowErrors: conflicts }));
      }

      await tx.entry.createMany({
        data: importable.map((row) => ({
          raffleId,
          ticketNumber: row.ticketNumber,
          fullName: row.fullName,
          contact: row.contact,
        })),
      });
      // Every ticket ever assigned is retired forever (D-E03). Retired rows
      // may already exist only in a race; the conflict check above plus the
      // unique constraint make plain createMany safe here.
      await tx.retiredTicket.createMany({
        data: tickets.map((ticketNumber) => ({ raffleId, ticketNumber })),
        skipDuplicates: true,
      });
    });
  } catch (err) {
    if (err instanceof ImportAbort) return err.result;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Concurrent import raced past the application check; the DB unique
      // constraint is the backstop. Re-query to name the conflicting tickets.
      const nowExisting = await db.entry.findMany({
        where: { raffleId, ticketNumber: { in: tickets } },
        select: { ticketNumber: true },
      });
      const clashSet = new Set(nowExisting.map((e) => e.ticketNumber));
      const conflicts = importable
        .filter((r) => clashSet.has(r.ticketNumber))
        .map((r) => ({ lineNumber: r.lineNumber, reason: alreadyUsedMessage(r.ticketNumber) }));
      if (conflicts.length > 0) return ok({ imported: 0, rowErrors: conflicts });
      return fail("Import failed — no entrants were added. A ticket number was already used in this raffle.");
    }
    throw err;
  }

  revalidatePath(`/raffles/${raffleId}/participants`);
  return ok({ imported: importable.length, rowErrors: [] });
}

export async function addEntrant(
  raffleId: string,
  input: { ticketNumber: number; fullName: string; contact?: string }
): Promise<ActionResult<{ entryId: string }>> {
  await requireSession();

  const parsed = entrantSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Invalid entrant.");
  }
  const { ticketNumber, fullName } = parsed.data;
  // entrantSchema lets "" through its optional branch; store empty as null.
  const contact = parsed.data.contact ? parsed.data.contact : undefined;

  try {
    const entryId = await db.$transaction(async (tx) => {
      const raffle = await tx.raffle.findUnique({
        where: { id: raffleId },
        select: { status: true },
      });
      if (!raffle) throw new ImportAbort(fail("Raffle not found."));
      if (!isStructureMutable(raffle.status)) throw new ImportAbort(fail(LOCKED_ADD));

      const [existing, retired] = await Promise.all([
        tx.entry.findUnique({
          where: { raffleId_ticketNumber: { raffleId, ticketNumber } },
          select: { id: true },
        }),
        tx.retiredTicket.findUnique({
          where: { raffleId_ticketNumber: { raffleId, ticketNumber } },
          select: { id: true },
        }),
      ]);
      if (existing) throw new ImportAbort(fail(alreadyUsedMessage(ticketNumber)));
      if (retired) throw new ImportAbort(fail(previouslyUsedMessage(ticketNumber)));

      const entry = await tx.entry.create({
        data: { raffleId, ticketNumber, fullName, contact },
        select: { id: true },
      });
      await tx.retiredTicket.create({ data: { raffleId, ticketNumber } });
      return entry.id;
    });

    revalidatePath(`/raffles/${raffleId}/participants`);
    return ok({ entryId });
  } catch (err) {
    if (err instanceof ImportAbort) return err.result as ActionResult<{ entryId: string }>;
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      // Concurrency backstop: unique (raffleId, ticketNumber) constraint.
      return fail(alreadyUsedMessage(ticketNumber));
    }
    throw err;
  }
}

export async function removeEntrant(entryId: string): Promise<ActionResult> {
  await requireSession();

  const entry = await db.entry.findUnique({
    where: { id: entryId },
    select: { id: true, raffleId: true, raffle: { select: { status: true } } },
  });
  if (!entry) return fail(ALREADY_REMOVED);
  if (!isStructureMutable(entry.raffle.status)) return fail(LOCKED_REMOVE);

  try {
    // Hard-delete the Entry only. The RetiredTicket ledger row is NEVER
    // deleted — the ticket number stays retired forever (D-E03 / FSD S5).
    await db.entry.delete({ where: { id: entryId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return fail(ALREADY_REMOVED); // deleted between the read and the delete
    }
    throw err;
  }

  revalidatePath(`/raffles/${entry.raffleId}/participants`);
  return ok(undefined);
}
