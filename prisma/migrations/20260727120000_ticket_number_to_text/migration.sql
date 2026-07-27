-- Ticket/UIDs become free-form text (D-E29): operators import entrant IDs such
-- as "A-1024" or "EMP_0092", not just whole numbers.
--
-- Existing INTEGER values convert losslessly to their decimal string form, so
-- no row is lost and no duplicate can appear: the int -> text mapping is
-- injective (distinct integers always render as distinct strings). Postgres
-- rebuilds the unique indexes on Entry(raffleId, ticketNumber) and
-- RetiredTicket(raffleId, ticketNumber) as part of ALTER COLUMN TYPE, so the
-- uniqueness and never-reuse invariants hold throughout.
--
-- Uniqueness stays case-SENSITIVE — the default for a plain text/varchar
-- column, and the semantics the application layer assumes.

-- AlterTable
ALTER TABLE "Entry"
  ALTER COLUMN "ticketNumber" TYPE VARCHAR(64) USING "ticketNumber"::text;

-- AlterTable
ALTER TABLE "RetiredTicket"
  ALTER COLUMN "ticketNumber" TYPE VARCHAR(64) USING "ticketNumber"::text;
