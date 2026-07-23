import type { DrawEventStatus, RaffleStatus } from "@prisma/client";

import { db } from "@/lib/db";

// E3-01 server-side data assembly, shared by the report page and both export
// route handlers. Everything here is READ-ONLY: zero writes, zero audit
// entries (FSD B-3, B-17, B-21 / D-E28). Each function resolves its FULL
// result before returning so route handlers never stream a partial file
// (FSD §7 "no partial files").
//
// Query discipline: a constant number of queries per call — never one query
// per entrant/slot (FSD §7 performance). Chains and outcomes are joined in
// memory.

// ---------- Shared status vocabulary ----------

/**
 * Export vocabulary for winner_status (FSD B-10): lowercase, with
 * RELEASED_TO_POOL mapped to "released".
 */
export const EXPORT_STATUS: Record<DrawEventStatus, string> = {
  PENDING: "pending",
  CLAIMED: "claimed",
  DISQUALIFIED: "disqualified",
  RELEASED_TO_POOL: "released",
};

// ---------- Feature 1: report data ----------

export type ReportHistoryEvent = {
  drawEventId: string;
  fullName: string;
  ticketNumber: number;
  /** Terminal status at supersession time (disqualified / released). */
  status: DrawEventStatus;
  /** Draw timestamp of the superseded event, ISO 8601 UTC. */
  createdAt: string;
  /** Reason recorded for the terminal status change; admin-gated (B-5). */
  reason: string | null;
};

export type ReportSlot = {
  /** Stable slot identity `<roundAllocationId>:<sequenceInAllocation>`. */
  slotKey: string;
  roundAllocationId: string;
  sequenceInAllocation: number;
  prizeName: string;
  /** Final winner (the chain event with supersededById null); null = not drawn. */
  winner: {
    drawEventId: string;
    fullName: string;
    ticketNumber: number;
    status: DrawEventStatus;
    createdAt: string;
  } | null;
  /** Superseded predecessors, oldest first; empty when the slot has no history. */
  history: ReportHistoryEvent[];
};

export type ReportRound = {
  id: string;
  order: number;
  label: string;
  slots: ReportSlot[];
};

export type ReportData = {
  raffle: { id: string; title: string; status: RaffleStatus };
  /** Server time the report data was assembled, ISO 8601 UTC. */
  generatedAt: string;
  rounds: ReportRound[];
};

/**
 * Assembles the full report: rounds in configured order, slots in allocation
 * order (stored order, id asc — matching the draw screen) then sequence
 * order, each slot resolved to its final winner plus its superseded
 * predecessors oldest-first (FSD B-2, B-4, B-5). Undrawn slots have
 * winner: null. Returns null when the raffle does not exist.
 */
export async function getReportData(raffleId: string): Promise<ReportData | null> {
  const raffle = await db.raffle.findUnique({
    where: { id: raffleId },
    select: {
      id: true,
      title: true,
      status: true,
      rounds: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          order: true,
          label: true,
          allocations: {
            // Same stored allocation order the draw engine uses (draw.ts).
            orderBy: { id: "asc" },
            select: {
              id: true,
              quantity: true,
              prizeType: { select: { name: true } },
            },
          },
        },
      },
    },
  });
  if (!raffle) return null;

  // All DrawEvents of the raffle (current AND superseded) in one query, with
  // their status-change audit entries so superseded predecessors can surface
  // the recorded reason (B-5; admin-gated route).
  const events = await db.drawEvent.findMany({
    where: { roundAllocation: { round: { raffleId } } },
    select: {
      id: true,
      roundAllocationId: true,
      sequenceInAllocation: true,
      status: true,
      supersededById: true,
      createdAt: true,
      winnerEntry: { select: { fullName: true, ticketNumber: true } },
      auditLogs: {
        orderBy: { createdAt: "asc" },
        select: { action: true, reason: true },
      },
    },
  });

  // original.supersededById points AT its replacement, so the predecessor of
  // event E is the event whose supersededById === E.id.
  const predecessorOf = new Map<string, (typeof events)[number]>();
  const finalBySlot = new Map<string, (typeof events)[number]>();
  for (const e of events) {
    if (e.supersededById !== null) {
      predecessorOf.set(e.supersededById, e);
    } else {
      finalBySlot.set(`${e.roundAllocationId}:${e.sequenceInAllocation}`, e);
    }
  }

  const rounds: ReportRound[] = raffle.rounds.map((round) => ({
    id: round.id,
    order: round.order,
    label: round.label,
    slots: round.allocations.flatMap((allocation) =>
      Array.from({ length: allocation.quantity }, (_, i): ReportSlot => {
        const seq = i + 1;
        const slotKey = `${allocation.id}:${seq}`;
        const final = finalBySlot.get(slotKey);
        if (!final) {
          return {
            slotKey,
            roundAllocationId: allocation.id,
            sequenceInAllocation: seq,
            prizeName: allocation.prizeType.name,
            winner: null,
            history: [],
          };
        }

        // Walk supersedes links back to the chain's origin, then reverse so
        // history reads oldest-first (B-5).
        const predecessorsNewestFirst: (typeof events)[number][] = [];
        let cursor = predecessorOf.get(final.id);
        while (cursor) {
          predecessorsNewestFirst.push(cursor);
          cursor = predecessorOf.get(cursor.id);
        }
        const history: ReportHistoryEvent[] = predecessorsNewestFirst
          .reverse()
          .map((e) => ({
            drawEventId: e.id,
            fullName: e.winnerEntry.fullName,
            ticketNumber: e.winnerEntry.ticketNumber,
            status: e.status,
            createdAt: e.createdAt.toISOString(),
            // The terminal status change carries the reason (E2-02 writes
            // one "disqualified"/"released_to_pool" entry per change).
            reason:
              e.auditLogs.find(
                (log) =>
                  log.action === "disqualified" ||
                  log.action === "released_to_pool"
              )?.reason ?? null,
          }));

        return {
          slotKey,
          roundAllocationId: allocation.id,
          sequenceInAllocation: seq,
          prizeName: allocation.prizeType.name,
          winner: {
            drawEventId: final.id,
            fullName: final.winnerEntry.fullName,
            ticketNumber: final.winnerEntry.ticketNumber,
            status: final.status,
            createdAt: final.createdAt.toISOString(),
          },
          history,
        };
      })
    ),
  }));

  return {
    raffle: { id: raffle.id, title: raffle.title, status: raffle.status },
    generatedAt: new Date().toISOString(),
    rounds,
  };
}

// ---------- Feature 2: results export rows ----------

export type CsvExport = {
  /** Column header row, in order. */
  header: string[];
  /** Raw (unhardened, unquoted) data rows — csv.ts buildCsv encodes them. */
  rows: string[][];
};

/**
 * Results export (FSD Feature 2): exactly one row per imported entrant,
 * ordered by ticket number ascending (B-7, B-8). The contact column is
 * omitted when NO entrant of the raffle has a contact value; otherwise it is
 * present with empty cells for entrants without one (D-E20). Outcome columns
 * per D-E12 (Interpretation A): ALL of the entrant's DrawEvents in
 * chronological order joined with "; " in draw_round / prize;
 * winner_status = the latest event's status in export vocabulary. Entrants
 * with no DrawEvent get empty strings, not "N/A" (B-11).
 * Returns null when the raffle does not exist.
 */
export async function getResultsExportRows(
  raffleId: string
): Promise<CsvExport | null> {
  const raffle = await db.raffle.findUnique({
    where: { id: raffleId },
    select: { id: true },
  });
  if (!raffle) return null;

  // Constant query count: entries + all draw events, joined in memory.
  const [entries, events] = await Promise.all([
    db.entry.findMany({
      where: { raffleId },
      orderBy: { ticketNumber: "asc" },
      select: { id: true, ticketNumber: true, fullName: true, contact: true },
    }),
    db.drawEvent.findMany({
      where: { roundAllocation: { round: { raffleId } } },
      // Chronological per D-E12; id asc tie-breaks same-transaction batches.
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: {
        winnerEntryId: true,
        status: true,
        roundAllocation: {
          select: {
            prizeType: { select: { name: true } },
            round: { select: { label: true } },
          },
        },
      },
    }),
  ]);

  const eventsByEntry = new Map<string, typeof events>();
  for (const e of events) {
    const list = eventsByEntry.get(e.winnerEntryId);
    if (list) list.push(e);
    else eventsByEntry.set(e.winnerEntryId, [e]);
  }

  // D-E20: contact column present iff any entrant has a contact value.
  const includeContact = entries.some(
    (entry) => entry.contact !== null && entry.contact !== ""
  );

  const header = includeContact
    ? ["ticket_number", "full_name", "contact", "draw_round", "prize", "winner_status"]
    : ["ticket_number", "full_name", "draw_round", "prize", "winner_status"];

  const rows = entries.map((entry) => {
    const own = eventsByEntry.get(entry.id) ?? [];
    const drawRound = own.map((e) => e.roundAllocation.round.label).join("; ");
    const prize = own.map((e) => e.roundAllocation.prizeType.name).join("; ");
    const winnerStatus =
      own.length > 0 ? EXPORT_STATUS[own[own.length - 1].status] : "";

    const row = [String(entry.ticketNumber), entry.fullName];
    if (includeContact) row.push(entry.contact ?? "");
    row.push(drawRound, prize, winnerStatus);
    return row;
  });

  return { header, rows };
}

// ---------- Feature 3: complete log export rows ----------

/**
 * Complete log export (FSD Feature 3): one row per AuditLog entry of the
 * raffle, chronological ascending with insertion-order (id asc) tie-break
 * (B-19). Values are exported as recorded (B-20): old/new values serialized
 * with JSON.stringify (empty when null), reasons verbatim (empty when null),
 * timestamps ISO 8601 UTC (D-E21). Returns null when the raffle does not
 * exist.
 */
export async function getLogExportRows(
  raffleId: string
): Promise<CsvExport | null> {
  const raffle = await db.raffle.findUnique({
    where: { id: raffleId },
    select: { id: true },
  });
  if (!raffle) return null;

  const logs = await db.auditLog.findMany({
    where: { raffleId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      createdAt: true,
      action: true,
      entityType: true,
      entityId: true,
      oldValue: true,
      newValue: true,
      reason: true,
      actor: true,
    },
  });

  return {
    header: [
      "timestamp",
      "action",
      "entity_type",
      "entity_id",
      "old_value",
      "new_value",
      "reason",
      "actor",
    ],
    rows: logs.map((log) => [
      log.createdAt.toISOString(),
      log.action,
      log.entityType,
      log.entityId,
      log.oldValue === null ? "" : JSON.stringify(log.oldValue),
      log.newValue === null ? "" : JSON.stringify(log.newValue),
      log.reason ?? "",
      log.actor,
    ]),
  };
}
