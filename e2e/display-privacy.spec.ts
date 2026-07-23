import { test, expect, request as playwrightRequest, type Page } from "@playwright/test";

import {
  login,
  createRaffle,
  addPrizeType,
  importEntrantsPaste,
  addRoundWithAllocation,
  lockRaffle,
  drawSimultaneousRound,
  changeWinnerStatus,
  cleanupRafflesByTitle,
} from "./helpers";

// E3-02 Feature 4 complement: schema/response-level privacy of the public
// display surfaces, plus auth boundaries of the admin/export routes.

const TITLE = `e2e-${Date.now()}-privacy`;
const REASON = "e2e-privacy-secret-reason-4f8a";
const CONTACT = "privacy.contact.9x@example.test";

// 9-digit tickets: cannot collide with substrings of the Date.now()
// timestamp embedded in the raffle title.
const ENTRANTS: [number, string][] = [
  [910000001, "Pxavier Secretline"],
  [910000002, "Pxenia Hiddenrose"],
  [910000003, "Pxander Covertson"],
  [910000004, "Pxiomara Shadewell"],
];
const CSV = [
  "ticket_number,full_name,email",
  ...ENTRANTS.map(([t, n], i) => `${t},${n},${i === 0 ? CONTACT : ""}`),
].join("\n");

const ALLOWED_KEYS = new Set([
  "title",
  "rounds",
  "id",
  "order",
  "label",
  "revealMode",
  "slots",
  "slotId",
  "prizeLabel",
]);

function collectKeys(value: unknown, found: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
  } else if (value !== null && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      found.add(key);
      collectKeys(nested, found);
    }
  }
}

test.describe.configure({ mode: "serial" });

test.describe("display privacy (E3-02 Feature 4)", () => {
  let page: Page;
  let raffleId: string;
  let winnerName: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    // Seed a DRAWN raffle with a disqualified winner so every category of
    // sensitive value (names, tickets, contact, status, reason) exists.
    await login(page);
    raffleId = await createRaffle(page, TITLE, "E2E display-privacy raffle");
    await addPrizeType(page, "Privacy Prize");
    await importEntrantsPaste(page, raffleId, CSV, 4);
    await page.goto(`/raffles/${raffleId}/rounds`);
    await addRoundWithAllocation(page, {
      position: 1,
      revealMode: "SIMULTANEOUS",
      prizeName: "Privacy Prize",
      quantity: 1,
    });
    await lockRaffle(page, { planned: 1, entrants: 4 });
    await page.goto(`/raffles/${raffleId}/draw`);
    const names = await drawSimultaneousRound(page);
    winnerName = names[0];
    await page.goto(`/raffles/${raffleId}/winners`);
    await changeWinnerStatus(page, winnerName, "Disqualify", REASON);
  });

  test.afterAll(async () => {
    await page.close();
    await cleanupRafflesByTitle([TITLE]);
  });

  test("unauthenticated display-meta returns only structural keys, no sensitive values", async () => {
    const anon = await playwrightRequest.newContext({
      baseURL: "http://localhost:3000",
    });
    try {
      const response = await anon.get(`/api/display-meta/${raffleId}`);
      expect(response.status()).toBe(200);

      const raw = await response.text();
      const json = JSON.parse(raw) as unknown;

      // Walk the JSON: every key must be on the structural allowlist.
      const keys = new Set<string>();
      collectKeys(json, keys);
      for (const key of keys) {
        expect(ALLOWED_KEYS.has(key), `unexpected key "${key}" in display-meta`).toBe(true);
      }

      // None of the seeded sensitive values appear in the raw body.
      for (const [ticket, name] of ENTRANTS) {
        expect(raw, `display-meta must not contain name ${name}`).not.toContain(name);
        expect(raw, `display-meta must not contain ticket ${ticket}`).not.toContain(String(ticket));
      }
      expect(raw).not.toContain(CONTACT);
      expect(raw).not.toContain(REASON);
      for (const status of ["PENDING", "CLAIMED", "DISQUALIFIED", "RELEASED_TO_POOL"]) {
        expect(raw, `display-meta must not contain status ${status}`).not.toContain(status);
      }
      // Structural fields are present.
      expect(raw).toContain(TITLE);
      expect(raw).toContain("Privacy Prize");
      expect(raw).toContain("Round 1");
    } finally {
      await anon.dispose();
    }
  });

  test("unauthenticated /display renders; /raffles redirects; exports yield no CSV bytes", async ({
    browser,
  }) => {
    // /display/[id] renders without any redirect in a cookie-less context.
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    await anonPage.goto(`/display/${raffleId}`);
    await expect(anonPage).toHaveURL(new RegExp(`/display/${raffleId}$`));
    await expect(anonPage.getByRole("heading", { name: TITLE })).toBeVisible();
    await anonContext.close();

    const anon = await playwrightRequest.newContext({
      baseURL: "http://localhost:3000",
    });
    try {
      // Admin dashboard redirects to /login.
      const dash = await anon.get("/raffles", { maxRedirects: 0 });
      expect([302, 307, 308]).toContain(dash.status());
      expect(dash.headers()["location"]).toContain("/login");

      // Export routes return no CSV bytes without a session.
      for (const kind of ["results", "log"]) {
        const res = await anon.get(`/api/raffles/${raffleId}/export/${kind}`, {
          maxRedirects: 0,
        });
        expect(
          [301, 302, 307, 308, 401],
          `${kind} export must reject unauthenticated requests`
        ).toContain(res.status());
        const body = await res.text();
        expect(body).not.toContain("﻿");
        expect(body).not.toContain("ticket_number");
        for (const [ticket, name] of ENTRANTS) {
          expect(body).not.toContain(String(ticket));
          expect(body).not.toContain(name);
        }
        expect(body).not.toContain(REASON);
      }
    } finally {
      await anon.dispose();
    }
  });

  test("unknown raffle id shows the neutral not-available message", async ({ browser }) => {
    const anonContext = await browser.newContext();
    const anonPage = await anonContext.newPage();
    await anonPage.goto("/display/xyz");
    await expect(
      anonPage.getByText("This raffle display is not available.")
    ).toBeVisible();
    await anonContext.close();
  });
});
