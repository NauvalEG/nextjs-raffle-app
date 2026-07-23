import { describe, expect, it } from "vitest";

import { UTF8_BOM, hardenCell, rfc4180Field, buildCsv } from "@/lib/csv";

describe("rfc4180Field", () => {
  it("leaves plain values untouched", () => {
    expect(rfc4180Field("Alice")).toBe("Alice");
    expect(rfc4180Field("")).toBe("");
    expect(rfc4180Field("1234")).toBe("1234");
    expect(rfc4180Field("Seán Ó Briain")).toBe("Seán Ó Briain");
  });

  it("quotes fields containing a comma", () => {
    expect(rfc4180Field("Smith, John")).toBe('"Smith, John"');
  });

  it("quotes fields containing a double quote and doubles embedded quotes", () => {
    expect(rfc4180Field('He said "hi"')).toBe('"He said ""hi"""');
    expect(rfc4180Field('"')).toBe('""""');
  });

  it("quotes fields containing CR or LF", () => {
    expect(rfc4180Field("line1\nline2")).toBe('"line1\nline2"');
    expect(rfc4180Field("line1\rline2")).toBe('"line1\rline2"');
    expect(rfc4180Field("line1\r\nline2")).toBe('"line1\r\nline2"');
  });
});

describe("hardenCell", () => {
  it("prefixes formula-leading characters with a single quote", () => {
    expect(hardenCell("=SUM(A1)")).toBe("'=SUM(A1)");
    expect(hardenCell("+1")).toBe("'+1");
    expect(hardenCell("-1")).toBe("'-1");
    expect(hardenCell("@cmd")).toBe("'@cmd");
  });

  it("leaves other values untouched", () => {
    expect(hardenCell("Alice")).toBe("Alice");
    expect(hardenCell("")).toBe("");
    expect(hardenCell("1=2")).toBe("1=2");
    expect(hardenCell("a+b")).toBe("a+b");
    expect(hardenCell(" =not-first")).toBe(" =not-first");
  });
});

describe("buildCsv", () => {
  it("joins records with CRLF and ends with a trailing CRLF", () => {
    const csv = buildCsv([
      ["a", "b"],
      ["c", "d"],
    ]);
    expect(csv).toBe("a,b\r\nc,d\r\n");
  });

  it("produces a valid header-only file", () => {
    expect(buildCsv([["ticket", "name", "contact"]])).toBe("ticket,name,contact\r\n");
  });

  it("runs every cell through hardening then quoting", () => {
    // "=1,2" is hardened to "'=1,2" and then quoted because of the comma.
    expect(buildCsv([["=1,2"]])).toBe("\"'=1,2\"\r\n");
    // Hardened cell without special chars stays unquoted.
    expect(buildCsv([["=SUM(A1)"]])).toBe("'=SUM(A1)\r\n");
  });

  it("encodes the acceptance case 'O\"Brien, Seán' as '\"O\"\"Brien, Seán\"'", () => {
    const csv = buildCsv([['O"Brien, Seán']]);
    expect(csv).toBe('"O""Brien, Seán"\r\n');
  });

  it("keeps a multiline field intact inside one quoted cell", () => {
    const csv = buildCsv([["before", "line1\nline2", "after"]]);
    expect(csv).toBe('before,"line1\nline2",after\r\n');
    // Exactly one record terminator — the embedded LF is not a record break.
    expect(csv.match(/\r\n/g)).toHaveLength(1);
  });

  it("returns an empty string for zero rows", () => {
    expect(buildCsv([])).toBe("");
  });
});

describe("UTF8_BOM", () => {
  it('is exactly "\\uFEFF"', () => {
    expect(UTF8_BOM).toBe(String.fromCharCode(0xfeff));
    expect(UTF8_BOM).toHaveLength(1);
    expect(UTF8_BOM.charCodeAt(0)).toBe(0xfeff);
  });
});
