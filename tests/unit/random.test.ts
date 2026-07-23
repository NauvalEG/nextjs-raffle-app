import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { secureRandomIndex } from "@/lib/random";

describe("secureRandomIndex", () => {
  it("throws on n = 0", () => {
    expect(() => secureRandomIndex(0)).toThrow();
  });

  it("throws on n = -1", () => {
    expect(() => secureRandomIndex(-1)).toThrow();
  });

  it("throws on n = 1.5 (non-integer)", () => {
    expect(() => secureRandomIndex(1.5)).toThrow();
  });

  it("throws on NaN", () => {
    expect(() => secureRandomIndex(NaN)).toThrow();
  });

  it("returns 0 for n = 1", () => {
    for (let i = 0; i < 100; i++) {
      expect(secureRandomIndex(1)).toBe(0);
    }
  });

  it("always returns an integer within [0, n-1]", () => {
    const n = 7;
    for (let i = 0; i < 10_000; i++) {
      const v = secureRandomIndex(n);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(n - 1);
    }
  });

  it("is uniform over a non-power-of-two pool (chi-squared sanity, E1-04 AC: uniform selection)", () => {
    // n = 10 does not divide 2^32 evenly, so a naive modulo would be biased.
    // Rejection sampling must produce counts consistent with uniformity.
    const n = 10;
    const draws = 50_000;
    const counts = new Array<number>(n).fill(0);
    for (let i = 0; i < draws; i++) {
      counts[secureRandomIndex(n)]++;
    }

    const expected = draws / n;
    const chiSquared = counts.reduce(
      (sum, observed) => sum + ((observed - expected) ** 2) / expected,
      0
    );

    // df = 9. Critical value at p ~= 1e-6 is ~46; use a generous bound so the
    // test only fails on a systematic bias, never on ordinary sampling noise.
    expect(chiSquared).toBeLessThan(45);

    // Every bucket must actually be hit at this sample size.
    for (const c of counts) expect(c).toBeGreaterThan(0);
  });

  describe("static fairness check (PRD E1-04 AC1: no Math.random in any draw path)", () => {
    const root = path.resolve(__dirname, "..", "..");

    function collectFiles(dir: string): string[] {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...collectFiles(full));
        else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
      }
      return out;
    }

    /** Remove // line comments and /* *\/ block comments so documentation
     *  mentioning the rule does not trip the check — only code counts. */
    function stripComments(source: string): string {
      return source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\s\/\/[^\n]*$/gm, "");
    }

    it("no file under src/actions or src/lib contains Math.random in code", () => {
      const files = [
        ...collectFiles(path.join(root, "src", "actions")),
        ...collectFiles(path.join(root, "src", "lib")),
      ];
      expect(files.length).toBeGreaterThan(0);

      const offenders = files.filter((f) =>
        stripComments(fs.readFileSync(f, "utf8")).includes("Math.random")
      );
      expect(offenders).toEqual([]);
    });
  });
});
