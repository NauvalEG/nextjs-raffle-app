import type { Prisma } from "@prisma/client";

// Append-only audit writer. MUST be called inside the same transaction as the
// change it records (E1-01 Feature E Rule 4; E2-02 Rule 7). There is no
// update or delete path for AuditLog anywhere in the application.

export type AuditInput = {
  raffleId: string;
  entityType: "raffle" | "draw_event";
  entityId: string;
  action:
    | "open"
    | "lock"
    | "complete"
    | "draw"
    | "claimed"
    | "disqualified"
    | "released_to_pool"
    | "redraw";
  drawEventId?: string;
  oldValue?: Prisma.InputJsonValue;
  newValue?: Prisma.InputJsonValue;
  reason?: string;
  actor?: string;
};

export async function writeAudit(
  tx: Prisma.TransactionClient,
  input: AuditInput
): Promise<void> {
  await tx.auditLog.create({
    data: {
      raffleId: input.raffleId,
      entityType: input.entityType,
      entityId: input.entityId,
      action: input.action,
      drawEventId: input.drawEventId,
      oldValue: input.oldValue,
      newValue: input.newValue,
      reason: input.reason,
      actor: input.actor ?? "admin",
    },
  });
}
