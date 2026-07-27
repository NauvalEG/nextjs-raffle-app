require("dotenv").config();
const fs = require("fs");
const { PrismaClient } = require("@prisma/client");
const db = new PrismaClient();

const OUT_DIR =
  "C:/Users/MUHAMM~1/AppData/Local/Temp/claude/C--Users-muhamm081859-playground-nextjs-raffle-app/62ed8148-864b-4ea2-8345-3b5bd46b386a/scratchpad";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function withRetry(label, fn, attempts = 4) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < attempts) await sleep(500 * i);
    }
  }
  throw new Error(`${label}: ${String(last && last.message).split("\n")[0]}`);
}

// Same FK-safe order as deleteRaffleDeep() in tests/integration/helpers.ts.
async function deleteRaffleDeep(raffleId) {
  await withRetry("auditLog", () => db.auditLog.deleteMany({ where: { raffleId } }));
  const allocs = await withRetry("allocs", () =>
    db.roundAllocation.findMany({ where: { round: { raffleId } }, select: { id: true } })
  );
  const ids = allocs.map((a) => a.id);
  if (ids.length) {
    await withRetry("nullSuperseded", () =>
      db.drawEvent.updateMany({ where: { roundAllocationId: { in: ids } }, data: { supersededById: null } })
    );
    await withRetry("drawEvents", () => db.drawEvent.deleteMany({ where: { roundAllocationId: { in: ids } } }));
  }
  await withRetry("raffle", () => db.raffle.delete({ where: { id: raffleId } }));
}

(async () => {
  // ---- 1. snapshot ----
  const snapshot = {
    takenAt: new Date().toISOString(),
    raffle: await db.raffle.findMany(),
    prizeType: await db.prizeType.findMany(),
    drawRound: await db.drawRound.findMany(),
    roundAllocation: await db.roundAllocation.findMany(),
    entry: await db.entry.findMany(),
    retiredTicket: await db.retiredTicket.findMany(),
    drawEvent: await db.drawEvent.findMany(),
    auditLog: await db.auditLog.findMany(),
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = `${OUT_DIR}/db-snapshot-before-wipe.json`;
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2), "utf8");
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`SNAPSHOT written: ${file} (${kb} KB)`);
  console.log(
    `SNAPSHOT rows: raffle=${snapshot.raffle.length} entry=${snapshot.entry.length} retired=${snapshot.retiredTicket.length} events=${snapshot.drawEvent.length} audit=${snapshot.auditLog.length}`
  );

  // ---- 2. delete every raffle ----
  const targets = await withRetry("list", () => db.raffle.findMany({ select: { id: true, title: true } }));
  console.log(`\nDeleting ${targets.length} raffles...`);
  for (const r of targets) {
    await deleteRaffleDeep(r.id);
    console.log(`  deleted ${JSON.stringify(r.title)}`);
  }

  // ---- 3. verify ----
  console.log("\nRemaining row counts:");
  const counts = {
    Raffle: await db.raffle.count(),
    PrizeType: await db.prizeType.count(),
    DrawRound: await db.drawRound.count(),
    RoundAllocation: await db.roundAllocation.count(),
    Entry: await db.entry.count(),
    RetiredTicket: await db.retiredTicket.count(),
    DrawEvent: await db.drawEvent.count(),
    AuditLog: await db.auditLog.count(),
  };
  for (const [t, n] of Object.entries(counts)) console.log(`  ${t.padEnd(16)}${n}`);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  console.log(`\nTOTAL remaining rows: ${total}`);

  await db.$disconnect();
  process.exit(total === 0 ? 0 : 2);
})();
