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

export const entrantSchema = z.object({
  ticketNumber: z
    .number({ message: "Ticket must be a whole number" })
    .int("Ticket must be a whole number")
    .positive("Ticket must be a whole number"),
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
