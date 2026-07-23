-- CreateEnum
CREATE TYPE "RaffleStatus" AS ENUM ('DRAFT', 'OPEN', 'LOCKED', 'DRAWN', 'COMPLETED');

-- CreateEnum
CREATE TYPE "RevealMode" AS ENUM ('SEQUENTIAL', 'SIMULTANEOUS');

-- CreateEnum
CREATE TYPE "DrawEventStatus" AS ENUM ('PENDING', 'CLAIMED', 'DISQUALIFIED', 'RELEASED_TO_POOL');

-- CreateTable
CREATE TABLE "Raffle" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "status" "RaffleStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Raffle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrizeType" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "name" VARCHAR(100) NOT NULL,

    CONSTRAINT "PrizeType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawRound" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "revealMode" "RevealMode" NOT NULL DEFAULT 'SEQUENTIAL',

    CONSTRAINT "DrawRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoundAllocation" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "prizeTypeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "RoundAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entry" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "ticketNumber" INTEGER NOT NULL,
    "fullName" VARCHAR(200) NOT NULL,
    "contact" VARCHAR(200),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetiredTicket" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "ticketNumber" INTEGER NOT NULL,

    CONSTRAINT "RetiredTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DrawEvent" (
    "id" TEXT NOT NULL,
    "roundAllocationId" TEXT NOT NULL,
    "sequenceInAllocation" INTEGER NOT NULL,
    "winnerEntryId" TEXT NOT NULL,
    "status" "DrawEventStatus" NOT NULL DEFAULT 'PENDING',
    "supersededById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrawEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "raffleId" TEXT NOT NULL,
    "drawEventId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "reason" VARCHAR(500),
    "actor" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PrizeType_raffleId_name_key" ON "PrizeType"("raffleId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "DrawRound_raffleId_order_key" ON "DrawRound"("raffleId", "order");

-- CreateIndex
CREATE INDEX "Entry_raffleId_idx" ON "Entry"("raffleId");

-- CreateIndex
CREATE UNIQUE INDEX "Entry_raffleId_ticketNumber_key" ON "Entry"("raffleId", "ticketNumber");

-- CreateIndex
CREATE UNIQUE INDEX "RetiredTicket_raffleId_ticketNumber_key" ON "RetiredTicket"("raffleId", "ticketNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DrawEvent_supersededById_key" ON "DrawEvent"("supersededById");

-- CreateIndex
CREATE INDEX "DrawEvent_roundAllocationId_idx" ON "DrawEvent"("roundAllocationId");

-- CreateIndex
CREATE INDEX "DrawEvent_winnerEntryId_idx" ON "DrawEvent"("winnerEntryId");

-- CreateIndex
CREATE INDEX "AuditLog_raffleId_createdAt_idx" ON "AuditLog"("raffleId", "createdAt");

-- AddForeignKey
ALTER TABLE "PrizeType" ADD CONSTRAINT "PrizeType_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawRound" ADD CONSTRAINT "DrawRound_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundAllocation" ADD CONSTRAINT "RoundAllocation_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "DrawRound"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoundAllocation" ADD CONSTRAINT "RoundAllocation_prizeTypeId_fkey" FOREIGN KEY ("prizeTypeId") REFERENCES "PrizeType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entry" ADD CONSTRAINT "Entry_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetiredTicket" ADD CONSTRAINT "RetiredTicket_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawEvent" ADD CONSTRAINT "DrawEvent_roundAllocationId_fkey" FOREIGN KEY ("roundAllocationId") REFERENCES "RoundAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawEvent" ADD CONSTRAINT "DrawEvent_winnerEntryId_fkey" FOREIGN KEY ("winnerEntryId") REFERENCES "Entry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DrawEvent" ADD CONSTRAINT "DrawEvent_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "DrawEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_raffleId_fkey" FOREIGN KEY ("raffleId") REFERENCES "Raffle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_drawEventId_fkey" FOREIGN KEY ("drawEventId") REFERENCES "DrawEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
