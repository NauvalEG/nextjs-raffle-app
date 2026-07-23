// Pure CSV utilities for the E3-01 exports (FSD B-14, B-15, B-18).
// No I/O, no framework imports — unit-testable in isolation.

/**
 * UTF-8 byte order mark (EF BB BF once encoded) prepended to every export
 * body so Excel renders non-ASCII names correctly (FSD B-15).
 */
export const UTF8_BOM = "\uFEFF";

/**
 * Formula-injection hardening (D-E19 / FSD B-18): a cell whose FIRST character
 * is `=`, `+`, `-`, or `@` is prefixed with a single quote so spreadsheet
 * applications treat it as text rather than executing it as a formula.
 * All other values pass through byte-faithful.
 */
export function hardenCell(value: string): string {
  if (value.length === 0) return value;
  const first = value[0];
  if (first === "=" || first === "+" || first === "-" || first === "@") {
    return `'${value}`;
  }
  return value;
}

/**
 * RFC 4180 field encoding (FSD B-14): a field containing a comma, double
 * quote, CR, or LF is wrapped in double quotes with embedded double quotes
 * doubled. Fields without those characters are emitted verbatim.
 */
export function rfc4180Field(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Builds a complete CSV document from rows of raw cell values. Every cell is
 * formula-hardened (hardenCell) and then RFC 4180 encoded (rfc4180Field);
 * records are joined with CRLF line endings and the document ends with a
 * trailing CRLF. The BOM is NOT included — callers prepend UTF8_BOM.
 */
export function buildCsv(rows: string[][]): string {
  return rows
    .map((row) => row.map((cell) => rfc4180Field(hardenCell(cell))).join(","))
    .map((line) => `${line}\r\n`)
    .join("");
}
