import { PrismaClient } from "@prisma/client";

// Prisma singleton — serverless-safe. Production uses Neon's pooled
// (pgbouncer-backed) connection string via DATABASE_URL (PRD §6.1).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
