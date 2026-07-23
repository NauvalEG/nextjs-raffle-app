import { test, expect, type Page } from "@playwright/test";

import {
  login,
  createRaffle,
  addPrizeType,
  importEntrantsPaste,
  addRoundWithAllocation,
  lockRaffle,
  drawSimultaneousRound,
  changeWinnerStatus,
  redrawWinnerRow,
  drawEventSnapshot,
  auditActions,
  cleanupRafflesByTitle,
} from "./helpers";

// E3-02 Feature 2 (AC2): redraw is only reachable for DISQUALIFIED /
// RELEASED_TO_POOL slots — defense in depth.
//
// Layers covered here:
//  - UI layer: the Redraw control is ABSENT from the DOM (not merely
//    disabled) on PENDING and CLAIMED rows, and renders only after a
//    disqualification (positive control).
//  - Server/DB layer: after exercising the UI, the database contains no
//    supersession, no replacement DrawEvent, and no "redraw" audit row for
//    the guarded states. The RAW server-action bypass (calling redrawSlot
//    with an ineligible drawEventId) cannot be invoked over HTTP without
//    Next's encrypted action IDs; per the FSD's allowance, that action-layer
//    rejection is covered by the equivalent server-layer test in
//    tests/integration/winners.test.ts.

const TITLE = `e2e-${Date.now()}-guards`;

const CSV = [
  "ticket_number,full_name,email",
  "8001,Guard Aster,guard.aster@example.com",
  "8002,Guard Betony,",
  "8003,Guard Clover,guard.clover@example.com",
  "8004,Guard Dahlia,",
  "8005,Guard Erica,",
].join("\n");

test.describe.configure({ mode: "serial" });

test.describe("redraw guards (E3-02 Feature 2)", () => {
  let page: Page;
  let raffleId: string;
  let winnerNames: string[];
  let claimedName: string;
  let pendingName: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
    await cleanupRafflesByTitle([TITLE]);
  });

  test("seed: drawn raffle with one PENDING and one CLAIMED winner", async () => {
    await login(page);
    raffleId = await createRaffle(page, TITLE, "E2E redraw-guard raffle");
    await addPrizeType(page, "Guard Prize");
    await importEntrantsPaste(page, raffleId, CSV, 5);

    await page.goto(`/raffles/${raffleId}/rounds`);
    await addRoundWithAllocation(page, {
      position: 1,
      revealMode: "SIMULTANEOUS",
      prizeName: "Guard Prize",
      quantity: 2,
    });
    await lockRaffle(page, { planned: 2, entrants: 5 });

    await page.goto(`/raffles/${raffleId}/draw`);
    winnerNames = await drawSimultaneousRound(page);
    expect(winnerNames).toHaveLength(2);

    // Mark the first winner CLAIMED; the second stays PENDING.
    claimedName = winnerNames[0];
    pendingName = winnerNames[1];
    await page.goto(`/raffles/${raffleId}/winners`);
    await changeWinnerStatus(page, claimedName, "Mark claimed", "Prize handed over at the booth (e2e)");
    const claimedRow = page.getByRole("row").filter({ hasText: claimedName }).first();
    await expect(claimedRow.getByText("Claimed")).toBeVisible();
    const pendingRow = page.getByRole("row").filter({ hasText: pendingName }).first();
    await expect(pendingRow.getByText("Pending")).toBeVisible();
  });

  test("UI layer: redraw control absent from the DOM on pending and claimed rows", async () => {
    await page.goto(`/raffles/${raffleId}/winners`);
    const pendingRow = page.getByRole("row").filter({ hasText: pendingName }).first();
    const claimedRow = page.getByRole("row").filter({ hasText: claimedName }).first();
    await expect(pendingRow.getByText("Pending")).toBeVisible();
    await expect(claimedRow.getByText("Claimed")).toBeVisible();

    // Absent — not disabled: zero Redraw buttons anywhere in the table DOM.
    await expect(page.getByRole("button", { name: "Redraw" })).toHaveCount(0);
    await expect(pendingRow.locator("button", { hasText: "Redraw" })).toHaveCount(0);
    await expect(claimedRow.locator("button", { hasText: "Redraw" })).toHaveCount(0);
    // Even as raw text/markup, nothing "Redraw"-shaped exists in either row.
    expect(await pendingRow.innerHTML()).not.toContain("Redraw");
    expect(await claimedRow.innerHTML()).not.toContain("Redraw");
  });

  test("server/DB layer: no supersession, replacement, or redraw audit rows exist", async () => {
    // After all UI interaction against the guarded states, the DB must show
    // exactly the two original DrawEvents, none superseded, and no "redraw"
    // audit entry. (Raw action-layer bypass: tests/integration/winners.test.ts.)
    const events = await drawEventSnapshot(raffleId);
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.supersededById === null)).toBe(true);
    expect(events.map((e) => e.status).sort()).toEqual(["CLAIMED", "PENDING"]);

    const actions = await auditActions(raffleId);
    expect(actions).not.toContain("redraw");
  });

  test("positive control: disqualify → redraw control renders → redraw succeeds", async () => {
    await page.goto(`/raffles/${raffleId}/winners`);
    await changeWinnerStatus(page, pendingName, "Disqualify", "Ticket could not be verified (e2e)");
    const disqRow = page.getByRole("row").filter({ hasText: pendingName }).first();
    await expect(disqRow.getByText("Disqualified")).toBeVisible();

    // The Redraw control now renders — on exactly this one row.
    await expect(disqRow.getByRole("button", { name: "Redraw" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Redraw" })).toHaveCount(1);

    // And it works.
    const replacement = await redrawWinnerRow(
      page,
      pendingName,
      "Replacing unverifiable winner (e2e)"
    );
    expect(replacement).not.toBe(pendingName);
    expect(replacement).not.toBe(claimedName);
    const newRow = page.getByRole("row").filter({ hasText: replacement }).first();
    await expect(newRow.getByText("Pending")).toBeVisible();

    // DB reflects exactly one supersession and one redraw audit row.
    const events = await drawEventSnapshot(raffleId);
    expect(events).toHaveLength(3);
    expect(events.filter((e) => e.supersededById !== null)).toHaveLength(1);
    const actions = await auditActions(raffleId);
    expect(actions.filter((a) => a === "redraw")).toHaveLength(1);
  });
});
