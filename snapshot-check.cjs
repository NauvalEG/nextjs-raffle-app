const fs = require("fs");
const FILE =
  "C:/Users/MUHAMM~1/AppData/Local/Temp/claude/C--Users-muhamm081859-playground-nextjs-raffle-app/62ed8148-864b-4ea2-8345-3b5bd46b386a/scratchpad/db-snapshot-before-wipe.json";

const s = JSON.parse(fs.readFileSync(FILE, "utf8"));
console.log(`snapshot takenAt: ${s.takenAt}`);
console.log(`parses OK; tables: ${Object.keys(s).filter((k) => k !== "takenAt").join(", ")}`);
console.log("");
for (const r of s.raffle) {
  const entries = s.entry.filter((e) => e.raffleId === r.id).length;
  const rounds = s.drawRound.filter((x) => x.raffleId === r.id).length;
  const audits = s.auditLog.filter((a) => a.raffleId === r.id).length;
  console.log(
    `  ${JSON.stringify(r.title).padEnd(24)} status=${String(r.status).padEnd(9)} entries=${String(entries).padEnd(5)} rounds=${rounds} audits=${audits} created=${r.createdAt}`
  );
}
console.log("");
console.log(
  `totals: entry=${s.entry.length} retired=${s.retiredTicket.length} events=${s.drawEvent.length} audit=${s.auditLog.length} prizeType=${s.prizeType.length} alloc=${s.roundAllocation.length}`
);
