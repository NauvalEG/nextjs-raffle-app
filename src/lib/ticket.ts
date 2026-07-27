// Ticket/UID ordering (D-E29).
//
// Ticket/IDs are stored as text, so a plain SQL `ORDER BY ticketNumber` sorts
// lexicographically and lists "1, 10, 2". Operator-facing lists (participant
// table, report entrant appendix) sort with a numeric-aware collator instead so
// "1" < "2" < "10" and "A-2" < "A-10" read the way an operator expects.
//
// This is presentation only. It is deliberately NOT used for the eligible pool:
// getEligiblePool needs a stable, DB-side order and nothing more, and changing
// pool order changes nothing about draw fairness (secureRandomIndex is uniform
// over the pool regardless of how it is ordered).

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "variant" });

/** Numeric-aware comparator for ticket/IDs: "1" < "2" < "10" < "A-2" < "A-10". */
export function compareTickets(a: string, b: string): number {
  return collator.compare(a, b);
}

/** Sort a copy of `rows` by their ticket/ID in natural order. */
export function sortByTicket<T extends { ticketNumber: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((x, y) => compareTickets(x.ticketNumber, y.ticketNumber));
}
