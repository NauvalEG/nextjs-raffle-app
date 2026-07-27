import { test, expect, type Page } from "@playwright/test";

import {
  login,
  createRaffle,
  addPrizeType,
  importEntrantsPaste,
  addRoundWithAllocation,
  lockRaffle,
  changeWinnerStatus,
  redrawWinnerRow,
  cleanupRafflesByTitle,
} from "./helpers";

// E3-02 Feature 3 (sync-correctness): admin draw tab (A) and public display
// tab (B) in the SAME browser context — BroadcastChannel is same-origin,
// same-browsing-context-group only. Also automates Feature 5's refresh
// replay and the display privacy assertions (network + DOM).

const TITLE = `e2e-${Date.now()}-sync`;
const DISQUALIFY_REASON = "e2e-sync-secret-disqualify-reason-7c1f";
const REDRAW_REASON = "e2e-sync-secret-redraw-reason-2b9d";

// Distinctive names/tickets so privacy scans cannot false-positive on
// framework chunks or incidental page text.
// 9-digit tickets: long enough that they cannot collide with substrings of
// the Date.now() timestamp embedded in the raffle title.
const ENTRANTS: [number, string][] = [
  [900000001, "Zxavier Alphaline"],
  [900000002, "Zxenia Bravossa"],
  [900000003, "Zxander Charlieux"],
  [900000004, "Zxiomara Deltaric"],
  [900000005, "Zxavius Echolane"],
  [900000006, "Zxinnia Foxtrotta"],
  [900000007, "Zxolan Golfredo"],
  [900000008, "Zxena Hotelia"],
];
const CSV = [
  "ticket_number,full_name,email",
  ...ENTRANTS.map(([t, n]) => `${t},${n},`),
].join("\n");

const STATUS_WORDS = [
  "PENDING",
  "CLAIMED",
  "DISQUALIFIED",
  "RELEASED_TO_POOL",
  "Pending",
  "Claimed",
  "Disqualified",
  "Released to pool",
];

test.describe.configure({ mode: "serial" });

test.describe("two-tab sync (E3-02 Feature 3)", () => {
  let admin: Page; // tab A
  let display: Page; // tab B — same context as A
  let raffleId: string;

  // Everything tab B receives over the network, recorded from the start.
  const responses: { url: string; body: string }[] = [];
  const dataRequests: string[] = []; // fetch/xhr request URLs from tab B

  // Winner names as revealed in tab A.
  const round1Names: string[] = [];
  let round2Names: string[] = [];
  let replacementName: string;

  const slots = () => display.locator('main section [data-slot="display-slot"]');
  const slotTexts = async () => {
    const texts = await slots().allInnerTexts();
    return texts.map((t) => t.replace(/\s+/g, " ").trim());
  };

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    admin = await context.newPage();

    await login(admin);
    raffleId = await createRaffle(admin, TITLE, "E2E two-tab sync raffle");
    await addPrizeType(admin, "Prize A");
    await addPrizeType(admin, "Prize B");
    await importEntrantsPaste(admin, raffleId, CSV, 8);
    await admin.goto(`/raffles/${raffleId}/rounds`);
    await addRoundWithAllocation(admin, {
      position: 1,
      revealMode: "SEQUENTIAL",
      prizeName: "Prize A",
      quantity: 2,
    });
    await addRoundWithAllocation(admin, {
      position: 2,
      revealMode: "SIMULTANEOUS",
      prizeName: "Prize B",
      quantity: 3,
    });
    await lockRaffle(admin, { planned: 5, entrants: 8 });

    // Tab B — same context (BroadcastChannel requirement). Record network
    // traffic before the first navigation.
    display = await context.newPage();
    display.on("response", (response) => {
      void (async () => {
        try {
          const body = await response.text();
          responses.push({ url: response.url(), body });
        } catch {
          // Binary/aborted bodies (fonts, images) — record URL only.
          responses.push({ url: response.url(), body: "" });
        }
      })();
    });
    display.on("request", (request) => {
      const type = request.resourceType();
      if (type === "fetch" || type === "xhr") dataRequests.push(request.url());
    });
  });

  test.afterAll(async () => {
    await display?.close();
    await admin?.close();
    await cleanupRafflesByTitle([TITLE]);
  });

  test("display tab shows only the current round: Round 1, 2 slots, all undrawn", async () => {
    await display.goto(`/display/${raffleId}`);
    await expect(display.getByRole("heading", { name: TITLE })).toBeVisible();
    // Exactly one round is on screen, and its label is the visible header.
    await expect(display.getByRole("heading", { name: "Round 1" })).toBeVisible();
    await expect(display.getByRole("heading", { name: "Round 2" })).toHaveCount(0);
    await expect(slots()).toHaveCount(2);
    await expect(display.getByText("not yet drawn")).toHaveCount(2);

    // Prize labels are structural and allowed; Round 2's must not be present.
    await expect(display.getByText("Prize A")).toHaveCount(2);
    await expect(display.getByText("Prize B")).toHaveCount(0);
  });

  test("sequential round: each Draw click reveals exactly the matching slot in B", async () => {
    await admin.goto(`/raffles/${raffleId}/draw`);
    await admin.getByRole("button", { name: "Draw", exact: true }).click();
    const confirm = admin.getByRole("alertdialog");
    await expect(confirm.getByText("Draw Round 1?")).toBeVisible();
    await confirm.getByRole("button", { name: "Draw round" }).click();
    await expect(admin.getByText("Round committed — ready to reveal")).toBeVisible({
      timeout: 60_000,
    });

    // Commit alone reveals nothing on the display.
    await expect(display.getByText("not yet drawn")).toHaveCount(2);

    for (let i = 0; i < 2; i++) {
      const before = await slotTexts();
      await admin.getByRole("button", { name: "Draw — Prize A" }).click();
      const name = (
        await admin.locator(".text-2xl.font-semibold").innerText()
      ).trim();
      round1Names.push(name);

      // Exactly slot i animates and settles on the same full name shown in A.
      await expect(slots().nth(i)).toContainText(name, { timeout: 15_000 });
      const after = await slotTexts();
      for (let j = 0; j < before.length; j++) {
        if (j !== i) {
          expect(after[j], `slot ${j} must not change on reveal ${i}`).toBe(before[j]);
        }
      }
    }
    expect(new Set(round1Names).size).toBe(2);
  });

  test("refresh replay: the current round is restored with its revealed slots settled", async () => {
    await display.reload();
    await expect(display.getByRole("heading", { name: TITLE })).toBeVisible();
    // The projector comes back on Round 1, not reset to the first round by
    // accident — and previously revealed slots render settled immediately
    // (replay, no re-animation).
    await expect(display.getByRole("heading", { name: "Round 1" })).toBeVisible();
    await expect(slots()).toHaveCount(2);
    await expect(slots().nth(0)).toContainText(round1Names[0]);
    await expect(slots().nth(1)).toContainText(round1Names[1]);
    await expect(display.getByText("not yet drawn")).toHaveCount(0);
  });

  test("round hand-off: the display holds Round 1 until the admin finishes it", async () => {
    // Advancing the ADMIN screen must not move the audience on by itself.
    await admin.getByRole("button", { name: "Next round — Round 2" }).click();
    await expect(display.getByRole("heading", { name: "Round 1" })).toBeVisible();
    await expect(slots()).toHaveCount(2);

    // The explicit finish control is what hands the display over.
    await admin
      .getByRole("button", { name: "Finish round — show Round 2" })
      .click();
    await expect(display.getByRole("heading", { name: "Round 2" })).toBeVisible();
    await expect(display.getByRole("heading", { name: "Round 1" })).toHaveCount(0);
    await expect(slots()).toHaveCount(3);
    await expect(display.getByText("not yet drawn")).toHaveCount(3);
    await expect(display.getByText("Prize B")).toHaveCount(3);
  });

  test("simultaneous round: all 3 slots settle as one batch", async () => {
    await admin
      .getByRole("button", { name: "Reveal round — Round 2 (3 slots)" })
      .click();
    const confirm = admin.getByRole("alertdialog");
    await confirm.getByRole("button", { name: "Reveal round" }).click();
    // Final round: completes immediately; names land in the history panel.
    await expect(admin.getByText("All rounds drawn")).toBeVisible({
      timeout: 60_000,
    });
    const revealed = admin
      .getByRole("complementary", { name: "Drawn rounds" })
      .locator('[data-slot="card"]')
      .last()
      .locator("span.font-medium");
    await expect(revealed).toHaveCount(3);
    round2Names = (await revealed.allInnerTexts()).map((s) => s.trim());

    // All three Round 2 slots settle on the names from A (slot order =
    // reveal order), within the same single animation window. The board shows
    // Round 2 only, so these are slots 0..2.
    for (let i = 0; i < 3; i++) {
      await expect(slots().nth(i)).toContainText(round2Names[i], {
        timeout: 15_000,
      });
    }
    await expect(display.getByText("not yet drawn")).toHaveCount(0);
  });

  test("redraw isolation: only the affected slot changes on the display", async () => {
    // Disqualify + redraw the first Round 2 winner from tab A — Round 2 is
    // the round currently on the display.
    await admin.goto(`/raffles/${raffleId}/winners`);
    const targetName = round2Names[0];
    await changeWinnerStatus(admin, targetName, "Disqualify", DISQUALIFY_REASON);

    const before = await slotTexts();

    // Kick off the redraw, then watch slot 0 go through the redrawing
    // treatment and settle on the replacement.
    const row = admin.getByRole("row").filter({ hasText: targetName }).first();
    await row.getByRole("button", { name: "Redraw" }).click();
    const dialog = admin.getByRole("alertdialog");
    await dialog.getByLabel("Reason").fill(REDRAW_REASON);
    await dialog.getByRole("button", { name: "Redraw slot" }).click();

    // redraw-start posts before the server action resolves — the slot shows
    // the distinct redrawing treatment first.
    await expect(slots().nth(0)).toContainText("Redrawing…", { timeout: 15_000 });

    const toast = admin.getByText(/^Slot redrawn: /).first();
    await expect(toast).toBeVisible({ timeout: 30_000 });
    const match = (await toast.innerText()).match(
      /^Slot redrawn: (.+) \(ticket #\d+\)/
    );
    expect(match).toBeTruthy();
    replacementName = match![1];

    await expect(slots().nth(0)).toContainText(replacementName, { timeout: 15_000 });

    // Every sibling slot's text is byte-identical before vs after.
    const after = await slotTexts();
    for (let j = 1; j < before.length; j++) {
      expect(after[j], `sibling slot ${j} must be untouched by the redraw`).toBe(
        before[j]
      );
    }
  });

  test("privacy: display tab traffic and DOM leak no entrant data", async () => {
    // Give the recorded-response queue a beat to flush.
    await display.waitForTimeout(500);

    // (a) No response tab B received contains winner names, ticket numbers,
    // status words, or reasons.
    const winnerNames = [...round1Names, ...round2Names, replacementName];
    const allEntrantNames = ENTRANTS.map(([, n]) => n);
    const tickets = ENTRANTS.map(([t]) => String(t));
    expect(responses.length).toBeGreaterThan(0);
    for (const { url, body } of responses) {
      for (const name of allEntrantNames) {
        expect(body, `response ${url} must not contain name ${name}`).not.toContain(name);
      }
      expect(body, `response ${url} must not contain the disqualify reason`).not.toContain(DISQUALIFY_REASON);
      expect(body, `response ${url} must not contain the redraw reason`).not.toContain(REDRAW_REASON);
    }
    // Ticket numbers are digit strings — scan them on app responses only
    // (static framework chunks could coincidentally contain any 4-digit run).
    for (const { url, body } of responses.filter((r) => !r.url.includes("/_next/static/"))) {
      for (const ticket of tickets) {
        expect(body, `response ${url} must not contain ticket ${ticket}`).not.toContain(ticket);
      }
    }
    // display-meta responses additionally must not contain status words.
    for (const { url, body } of responses.filter((r) => r.url.includes("/api/display-meta/"))) {
      for (const word of STATUS_WORDS) {
        expect(body, `display-meta ${url} must not contain ${word}`).not.toContain(word);
      }
    }
    void winnerNames; // names reach the board via BroadcastChannel only — asserted above via network absence

    // The display tab's only data fetches are the display-meta route.
    expect(dataRequests.length).toBeGreaterThan(0);
    for (const url of dataRequests) {
      expect(url, "display tab must fetch nothing but display-meta").toContain(
        `/api/display-meta/${raffleId}`
      );
    }

    // (b) The display DOM never contains ticket numbers or status words.
    const bodyText = await display.locator("body").innerText();
    for (const ticket of tickets) {
      expect(bodyText, `display DOM must not contain ticket ${ticket}`).not.toContain(ticket);
    }
    for (const word of STATUS_WORDS) {
      expect(bodyText, `display DOM must not contain status word ${word}`).not.toContain(word);
    }
    expect(bodyText).not.toContain(DISQUALIFY_REASON);
    expect(bodyText).not.toContain(REDRAW_REASON);
  });
});
