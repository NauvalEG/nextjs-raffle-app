import Papa from "papaparse";

// Pure CSV import logic for E1-02 (Bulk Import / Column Mapping / Preview).
// No IO, no React, no Prisma — unit-testable in isolation. The client uses
// this to build the preview; the Server Action re-runs the SAME validation
// (validateMappedRows) on every submitted row before committing (FSD Rule 5:
// "the preview is a courtesy, not the enforcement layer").
//
// Line-number contract (FSD Preview Rule 2): line numbers refer to the row's
// position in the original pasted text or file — header = line 1, first data
// row = line 2.

// ---------------------------------------------------------------------------
// Limits (D-E23) and header alias sets (D-E24 / FSD A5, A6)
// ---------------------------------------------------------------------------

export const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
export const MAX_IMPORT_ROWS = 50_000;

export const TICKET_ALIASES = ["ticket", "ticket_number", "id"] as const;
export const NAME_ALIASES = ["name", "full_name", "fullname"] as const;
export const CONTACT_ALIASES = ["contact", "email", "phone"] as const;

// Postgres Int (int4) ceiling — a "ticket" beyond this cannot be stored and is
// rejected as not a valid whole ticket number.
const MAX_TICKET_NUMBER = 2_147_483_647;

// ---------------------------------------------------------------------------
// Row-rejection reasons — exact strings per FSD / D-E04. Length reasons reuse
// the entrantSchema messages from @/lib/validation for client/server parity.
// ---------------------------------------------------------------------------

export const REASON_MISSING_TICKET = "Missing ticket/ID";
export const REASON_MISSING_NAME = "Missing full name";
export const REASON_TICKET_NOT_WHOLE = "Ticket must be a whole number";
export const REASON_DUPLICATE_TICKET = "Duplicate ticket number";
export const REASON_NAME_TOO_LONG = "Full name must be 200 characters or fewer.";
export const REASON_CONTACT_TOO_LONG = "Contact must be 200 characters or fewer.";

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export type CsvRow = {
  /** 1-based position in the source (header = 1, first data row = 2). */
  lineNumber: number;
  cells: string[];
};

export type ParseCsvResult =
  | { ok: true; headers: string[]; rows: CsvRow[] }
  | {
      ok: false;
      /** "empty" → "No entrant rows found in the input." · "unreadable" → "This file could not be read as CSV." */
      error: "empty" | "unreadable";
    };

/**
 * Parse raw CSV text (paste or file contents). Header row assumed present
 * (FSD A1); comma delimiter only (FSD A2); quoted fields honored via
 * papaparse. Blank lines are skipped but still occupy their line number, so
 * reported line numbers always match the source.
 */
export function parseCsvText(text: string): ParseCsvResult {
  // Binary sniff: NUL bytes never appear in legitimate CSV text.
  if (text.includes(String.fromCharCode(0))) return { ok: false, error: "unreadable" };

  let data: string[][];
  try {
    const result = Papa.parse<string[]>(text, {
      delimiter: ",",
      quoteChar: '"',
      header: false,
      skipEmptyLines: false, // keep positions so line numbers stay source-true
    });
    data = result.data;
  } catch {
    return { ok: false, error: "unreadable" };
  }

  // Drop rows that are entirely empty (e.g. trailing newline artifacts) while
  // preserving each remaining row's original index for line numbering.
  const nonEmpty: CsvRow[] = [];
  for (let i = 0; i < data.length; i++) {
    const cells = data[i];
    if (!Array.isArray(cells)) continue;
    if (cells.every((c) => typeof c !== "string" || c.trim() === "")) continue;
    nonEmpty.push({ lineNumber: i + 1, cells: cells.map((c) => (typeof c === "string" ? c : "")) });
  }

  if (nonEmpty.length === 0) return { ok: false, error: "empty" };

  const headerRow = nonEmpty[0];
  const headers = headerRow.cells.map((h) => h.trim());
  const rows = nonEmpty.slice(1);

  if (rows.length === 0) return { ok: false, error: "empty" };

  return { ok: true, headers, rows };
}

// ---------------------------------------------------------------------------
// Column auto-detection (case-insensitive, trimmed headers; D-E24)
// ---------------------------------------------------------------------------

export type AutoDetectedColumns = {
  ticket: number | null;
  name: number | null;
  contact: number | null;
};

/**
 * Auto-match columns by header alias. A column index is assigned to at most
 * one role (roles resolved in order ticket → name → contact). Auto-detection
 * is a convenience only — the administrator's explicit selection in the
 * mapping step is authoritative.
 */
export function autoDetectColumns(headers: string[]): AutoDetectedColumns {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  const used = new Set<number>();

  const find = (aliases: readonly string[]): number | null => {
    for (const alias of aliases) {
      for (let i = 0; i < normalized.length; i++) {
        if (!used.has(i) && normalized[i] === alias) {
          used.add(i);
          return i;
        }
      }
    }
    return null;
  };

  return {
    ticket: find(TICKET_ALIASES),
    name: find(NAME_ALIASES),
    contact: find(CONTACT_ALIASES),
  };
}

// ---------------------------------------------------------------------------
// Mapping application + row validation
// ---------------------------------------------------------------------------

/** Confirmed column mapping: column indexes into the parsed header row. */
export type ColumnMapping = {
  ticket: number;
  name: number;
  contact: number | null;
};

/** A data row reduced to the three mapped raw string values. */
export type MappedRow = {
  lineNumber: number;
  ticket: string;
  name: string;
  contact: string;
};

/** A row that passed validation and is ready to persist. */
export type ImportableRow = {
  lineNumber: number;
  ticketNumber: number;
  fullName: string;
  contact?: string;
};

/** A row blocked from import, with its source line number and exact reason. */
export type RejectedRow = MappedRow & { reason: string };

export type RowPartition = {
  importable: ImportableRow[];
  rejected: RejectedRow[];
};

/** Reduce parsed CSV rows to their mapped raw values. */
export function applyMapping(rows: CsvRow[], mapping: ColumnMapping): MappedRow[] {
  return rows.map((row) => ({
    lineNumber: row.lineNumber,
    ticket: row.cells[mapping.ticket] ?? "",
    name: row.cells[mapping.name] ?? "",
    contact: mapping.contact === null ? "" : (row.cells[mapping.contact] ?? ""),
  }));
}

/**
 * Validate mapped rows and partition into importable / rejected. This is the
 * single validation implementation shared by the client preview and the
 * server-side re-validation in importEntrants.
 *
 * Rules (FSD Preview Validation + D-E04):
 *  - everything trimmed; whitespace-only counts as missing
 *  - ticket: required, positive whole number (digits only, > 0, fits int4)
 *  - name: required after trim, ≤ 200 chars
 *  - contact: optional, ≤ 200 chars, empty → omitted
 *  - duplicate tickets within the batch: first (valid) occurrence wins;
 *    later occurrences rejected with "Duplicate ticket number"
 *  - tickets in `knownUsedTickets` (e.g. the raffle's current entrants, for
 *    the client preview) rejected with "Duplicate ticket number" (FSD Alt 3)
 */
export function validateMappedRows(
  rows: MappedRow[],
  knownUsedTickets?: ReadonlySet<number>
): RowPartition {
  const importable: ImportableRow[] = [];
  const rejected: RejectedRow[] = [];
  const claimedTickets = new Set<number>(knownUsedTickets ?? []);

  for (const row of rows) {
    const ticketRaw = row.ticket.trim();
    const name = row.name.trim();
    const contact = row.contact.trim();

    const reject = (reason: string) =>
      rejected.push({ lineNumber: row.lineNumber, ticket: ticketRaw, name, contact, reason });

    if (ticketRaw === "") {
      reject(REASON_MISSING_TICKET);
      continue;
    }
    if (!/^\d+$/.test(ticketRaw)) {
      reject(REASON_TICKET_NOT_WHOLE);
      continue;
    }
    const ticketNumber = Number(ticketRaw);
    if (!Number.isSafeInteger(ticketNumber) || ticketNumber < 1 || ticketNumber > MAX_TICKET_NUMBER) {
      reject(REASON_TICKET_NOT_WHOLE);
      continue;
    }
    if (name === "") {
      reject(REASON_MISSING_NAME);
      continue;
    }
    if (name.length > 200) {
      reject(REASON_NAME_TOO_LONG);
      continue;
    }
    if (contact.length > 200) {
      reject(REASON_CONTACT_TOO_LONG);
      continue;
    }
    if (claimedTickets.has(ticketNumber)) {
      reject(REASON_DUPLICATE_TICKET);
      continue;
    }

    claimedTickets.add(ticketNumber);
    importable.push({
      lineNumber: row.lineNumber,
      ticketNumber,
      fullName: name,
      contact: contact === "" ? undefined : contact,
    });
  }

  return { importable, rejected };
}

/** Convenience: apply a mapping and validate in one step (preview pipeline). */
export function validateRows(
  rows: CsvRow[],
  mapping: ColumnMapping,
  knownUsedTickets?: ReadonlySet<number>
): RowPartition {
  return validateMappedRows(applyMapping(rows, mapping), knownUsedTickets);
}

/**
 * Convert client-submitted rows (of unknown trustworthiness) back into
 * MappedRow shape so the server can re-run validateMappedRows verbatim.
 */
export function toMappedRows(
  rows: ReadonlyArray<{
    lineNumber?: unknown;
    ticketNumber?: unknown;
    fullName?: unknown;
    contact?: unknown;
  }>
): MappedRow[] {
  return rows.map((r, i) => ({
    lineNumber:
      typeof r.lineNumber === "number" && Number.isFinite(r.lineNumber) ? r.lineNumber : i + 2,
    ticket:
      typeof r.ticketNumber === "number" || typeof r.ticketNumber === "string"
        ? String(r.ticketNumber)
        : "",
    name: typeof r.fullName === "string" ? r.fullName : "",
    contact: typeof r.contact === "string" ? r.contact : "",
  }));
}
