require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

(async () => {
  const raffles = await db.raffle.findMany({
    select: { id: true, title: true, status: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  console.log(`Raffles: ${raffles.length}`);
  for (const r of raffles) {
    const entries = await db.entry.count({ where: { raffleId: r.id } });
    console.log(`  [${r.status}] ${JSON.stringify(r.title)} entries=${entries} created=${r.createdAt.toISOString()}`);
  }
  console.log("");
  console.log("Row counts per table:");
  console.log(`  Raffle          ${await db.raffle.count()}`);
  console.log(`  PrizeType       ${await db.prizeType.count()}`);
  console.log(`  DrawRound       ${await db.drawRound.count()}`);
  console.log(`  RoundAllocation ${await db.roundAllocation.count()}`);
  console.log(`  Entry           ${await db.entry.count()}`);
  console.log(`  RetiredTicket   ${await db.retiredTicket.count()}`);
  console.log(`  DrawEvent       ${await db.drawEvent.count()}`);
  console.log(`  AuditLog        ${await db.auditLog.count()}`);
  await db.$disconnect();
})();
