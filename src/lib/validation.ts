import { z } from "zod";

// Shared Zod schemas — the single source of validation truth for both forms
// and Server Actions (PRD §6.1). Client validation is a convenience; the
// server re-validates with the SAME schema every time.

export const raffleSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Title is required.")
    .max(200, "Title must be 200 characters or fewer."),
  description: z
    .string()
    .trim()
    .max(2000, "Description must be 2000 characters or fewer.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const prizeTypeSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Prize type name is required.")
    .max(100, "Prize type name must be 100 characters or fewer."),
});

export const roundSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Round label is required.")
    .max(100, "Round label must be 100 characters or fewer."),
  revealMode: z.enum(["SEQUENTIAL", "SIMULTANEOUS"], {
    message: "Choose a reveal mode.",
  }),
});

export const allocationSchema = z.object({
  prizeTypeId: z.string().min(1, "Choose a prize type for this allocation."),
  quantity: z
    .number({ message: "Quantity must be a whole number of at least 1." })
    .int("Quantity must be a whole number of at least 1.")
    .min(1, "Quantity must be a whole number of at least 1.")
    .max(10000, "Quantity cannot exceed 10,000."),
});

// Ticket/UID rules (D-E29): free-form printable text, NOT digits-only. Any
// character an operator can reasonably type is accepted; only C0/C1 control
// characters are refused, because those signal a mangled file or the wrong
// column mapping rather than a real identifier. Uniqueness is case-sensitive.
export const MAX_TICKET_LENGTH = 64;

export const TICKET_REQUIRED = "Ticket/ID is required.";
export const TICKET_TOO_LONG = `Ticket/ID must be ${MAX_TICKET_LENGTH} characters or fewer.`;
export const TICKET_INVALID_CHARS = "Ticket/ID contains invalid characters.";

/** True if `v` contains a C0 (0–31) or C1 (127–159) control character. */
export function hasControlChars(v: string): boolean {
  for (let i = 0; i < v.length; i++) {
    const code = v.charCodeAt(i);
    if (code < 32 || (code >= 127 && code <= 159)) return true;
  }
  return false;
}

export const ticketNumberSchema = z
  .string({ message: TICKET_REQUIRED })
  .trim()
  .min(1, TICKET_REQUIRED)
  .max(MAX_TICKET_LENGTH, TICKET_TOO_LONG)
  .refine((v) => !hasControlChars(v), TICKET_INVALID_CHARS);

export const entrantSchema = z.object({
  ticketNumber: ticketNumberSchema,
  fullName: z
    .string()
    .trim()
    .min(1, "Full name is required.")
    .max(200, "Full name must be 200 characters or fewer."),
  contact: z
    .string()
    .trim()
    .max(200, "Contact must be 200 characters or fewer.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const reasonSchema = z
  .string()
  .trim()
  .min(1, "A reason is required for every status change.")
  .max(500, "Reason must be 500 characters or fewer.");

export const statusChangeSchema = z.object({
  drawEventId: z.string().min(1),
  newStatus: z.enum(["CLAIMED", "DISQUALIFIED", "RELEASED_TO_POOL"]),
  reason: reasonSchema,
});

export const redrawSchema = z.object({
  drawEventId: z.string().min(1),
  reason: reasonSchema,
});

export const pinSchema = z.object({
  pin: z.string().min(1, "Please enter your PIN."),
});
