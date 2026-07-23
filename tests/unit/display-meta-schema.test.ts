import { describe, expect, it } from "vitest";

// Importing the module pulls in @/lib/db (PrismaClient instantiation only —
// no connection is opened) alongside displayMetaSchema. We use ONLY the
// schema here; buildDisplayMeta is never called.
import { displayMetaSchema } from "@/lib/display-meta";

// ---------------------------------------------------------------------------
// Recursive zod-shape walker: collects every object-property key reachable
// anywhere in the schema tree (through objects, arrays, optionals, unions...).
// ---------------------------------------------------------------------------

function collectKeys(schema: unknown, keys = new Set<string>(), seen = new Set<unknown>()): Set<string> {
  if (!schema || typeof schema !== "object" || seen.has(schema)) return keys;
  seen.add(schema);

  const def = (schema as { def?: unknown; _def?: unknown }).def ??
    (schema as { _def?: unknown })._def;
  if (!def || typeof def !== "object") return keys;
  const d = def as Record<string, unknown>;

  // Object shape (zod v4: def.shape is a plain object; tolerate a getter fn).
  if (d.shape) {
    const shape = typeof d.shape === "function" ? (d.shape as () => object)() : d.shape;
    for (const [key, child] of Object.entries(shape as Record<string, unknown>)) {
      keys.add(key);
      collectKeys(child, keys, seen);
    }
  }

  // Arrays, optionals/nullables/defaults, unions, intersections, records...
  for (const wrapper of ["element", "innerType", "valueType", "keyType", "left", "right", "in", "out"]) {
    if (d[wrapper]) collectKeys(d[wrapper], keys, seen);
  }
  if (Array.isArray(d.options)) for (const opt of d.options) collectKeys(opt, keys, seen);
  if (Array.isArray(d.items)) for (const item of d.items) collectKeys(item, keys, seen);

  return keys;
}

const CONTRACT_KEYS = [
  "title",
  "rounds",
  "id",
  "order",
  "label",
  "revealMode",
  "slots",
  "slotId",
  "prizeLabel",
].sort();

const SENSITIVE_KEYS = [
  "fullName",
  "ticketNumber",
  "contact",
  "status",
  "reason",
  "winner",
];

describe("displayMetaSchema (E3-02 Feature 4: structural privacy)", () => {
  const allKeys = collectKeys(displayMetaSchema);

  it("walker sanity: finds keys at every nesting level", () => {
    // If the walker silently failed to descend, the privacy assertions below
    // would pass vacuously — guard against that.
    expect(allKeys.has("title")).toBe(true); // top level
    expect(allKeys.has("revealMode")).toBe(true); // inside rounds[]
    expect(allKeys.has("prizeLabel")).toBe(true); // inside rounds[].slots[]
  });

  it("has EXACTLY the structural contract keys and nothing else", () => {
    expect([...allKeys].sort()).toEqual(CONTRACT_KEYS);
  });

  it("has no field named fullName/ticketNumber/contact/status/reason/winner anywhere", () => {
    for (const forbidden of SENSITIVE_KEYS) {
      expect(allKeys.has(forbidden), `schema must not contain "${forbidden}"`).toBe(false);
    }
  });

  it("accepts a valid structural payload", () => {
    const parsed = displayMetaSchema.parse({
      title: "Year-End Raffle",
      rounds: [
        {
          id: "r1",
          order: 1,
          label: "Round 1",
          revealMode: "SEQUENTIAL",
          slots: [
            { slotId: "a1:1", prizeLabel: "Grand Prize" },
            { slotId: "a1:2", prizeLabel: "Grand Prize" },
          ],
        },
      ],
    });
    expect(parsed.rounds[0].slots).toHaveLength(2);
  });

  it("strips injected sensitive keys at every level when parsing", () => {
    const parsed = displayMetaSchema.parse({
      title: "T",
      status: "DRAWN", // injected — must be stripped
      winner: "Alice", // injected
      rounds: [
        {
          id: "r1",
          order: 1,
          label: "Round 1",
          revealMode: "SIMULTANEOUS",
          fullName: "Alice Leak", // injected
          reason: "disqualified", // injected
          slots: [
            {
              slotId: "a1:1",
              prizeLabel: "Prize",
              ticketNumber: 12345, // injected
              contact: "alice@example.com", // injected
              fullName: "Alice Leak", // injected
            },
          ],
        },
      ],
    } as unknown);

    expect(Object.keys(parsed).sort()).toEqual(["rounds", "title"]);
    expect(Object.keys(parsed.rounds[0]).sort()).toEqual([
      "id",
      "label",
      "order",
      "revealMode",
      "slots",
    ]);
    expect(Object.keys(parsed.rounds[0].slots[0]).sort()).toEqual([
      "prizeLabel",
      "slotId",
    ]);

    const json = JSON.stringify(parsed);
    expect(json).not.toContain("Alice");
    expect(json).not.toContain("12345");
    expect(json).not.toContain("example.com");
    expect(json).not.toContain("disqualified");
  });

  it("rejects structurally invalid payloads", () => {
    expect(displayMetaSchema.safeParse({ title: "T" }).success).toBe(false); // no rounds
    expect(
      displayMetaSchema.safeParse({
        title: "T",
        rounds: [
          { id: "r1", order: 1.5, label: "R", revealMode: "SEQUENTIAL", slots: [] },
        ],
      }).success
    ).toBe(false); // non-integer order
    expect(
      displayMetaSchema.safeParse({
        title: "T",
        rounds: [{ id: "r1", order: 1, label: "R", revealMode: "RANDOM", slots: [] }],
      }).success
    ).toBe(false); // invalid revealMode
  });
});
