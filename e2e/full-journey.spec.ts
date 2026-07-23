import path from "node:path";
import { test, expect, type Page } from "@playwright/test";

import {
  login,
  addPrizeType,
  countAuditLogs,
  cleanupRafflesByTitle,
} from "./helpers";

// E3-02 Feature 1 (AC1): one continuous journey — login → create → configure
// → import (file upload) → rounds → lock → draw both rounds → winner
// management (disqualify + redraw) → results and log exports.

const TITLE = `e2e-${Date.now()}-journey`;
const DESCRIPTION = "E2E full-journey raffle (safe to delete)";
const DISQUALIFY_REASON = "Winner was not present at the venue (e2e journey)";
const REDRAW_REASON = "Replacing the disqualified winner (e2e journey)";

test.describe.configure({ mode: "serial" });

test.describe("full journey (E3-02 Feature 1)", () => {
  let page: Page;
  let raffleId: string;
  // Winner names captured on the draw screen.
  let round1Winner: string;
  let round2Winners: string[];
  let disqualifiedName: string;
  let replacementName: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
    await cleanupRafflesByTitle([TITLE]);
  });

  test("login sets a session cookie and renders the dashboard", async () => {
    await login(page);
    const cookies = await page.context().cookies();
    const session = cookies.find((c) => c.name === "raffle_session");
    expect(session, "raffle_session cookie should be set").toBeTruthy();
    expect(session!.value.length).toBeGreaterThan(0);
    await expect(page.getByRole("heading", { name: "Raffles" })).toBeVisible();
  });

  test("create raffle → appears with draft badge → open workspace", async () => {
    await page.getByRole("button", { name: "New raffle" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title").fill(TITLE);
    await dialog.getByLabel(/Description/).fill(DESCRIPTION);
    await dialog.getByRole("button", { name: "Create raffle" }).click();
    await expect(page).toHaveURL(/\/raffles\/[a-z0-9]+$/);
    raffleId = page.url().split("/").pop()!;

    // Back on the dashboard, the new raffle card carries the Draft badge.
    await page.goto("/raffles");
    const card = page.getByRole("link").filter({ hasText: TITLE });
    await expect(card).toBeVisible();
    await expect(card.getByText("Draft")).toBeVisible();
    await card.click();
    await expect(page).toHaveURL(new RegExp(`/raffles/${raffleId}$`));
  });

  test("add prize types Grand Prize and Door Prize", async () => {
    await addPrizeType(page, "Grand Prize");
    await addPrizeType(page, "Door Prize");
  });

  test("import 20 entrants from CSV file upload", async () => {
    await page.goto(`/raffles/${raffleId}/participants`);
    await page.getByRole("button", { name: "Import entrants" }).click();
    const dialog = page.getByRole("dialog");

    await dialog.getByRole("tab", { name: "Upload" }).click();
    await dialog
      .getByLabel("CSV file (max 5 MB)")
      .setInputFiles(path.join(__dirname, "fixtures", "entrants-20.csv"));

    // Mapping step: auto-detected columns pre-selected (D-E24 aliases).
    await expect(
      dialog.getByText("Confirm which column holds each field", { exact: false })
    ).toBeVisible();
    const mappingSelects = dialog.getByRole("combobox");
    await expect(mappingSelects.nth(0)).toContainText("ticket_number");
    await expect(mappingSelects.nth(1)).toContainText("full_name");
    await expect(mappingSelects.nth(2)).toContainText("email");
    await dialog.getByRole("button", { name: "Continue to preview" }).click();

    // Preview: 20 ready / 0 blocked; commit.
    await expect(
      dialog.getByText("20 rows ready to import, 0 rows blocked.")
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Import 20 entrants" }).click();
    await expect(dialog).toBeHidden();

    // Table shows all 20 entrants, accented name intact.
    await expect(page.getByText("20 entrants").first()).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "Ngô Bảo Châu", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("cell", { name: "Amara Okafor", exact: true })
    ).toBeVisible();
  });

  test("configure rounds, verify allocation footer, lock", async () => {
    await page.goto(`/raffles/${raffleId}/rounds`);

    // Round 1: SEQUENTIAL, 1× Grand Prize.
    await page.getByRole("button", { name: "Add round" }).click();
    const labelInput = page.getByLabel("Label", { exact: true }).filter({ visible: true });
    await expect(labelInput).toHaveValue("Round 1");
    await page.getByRole("button", { name: "Add allocation" }).filter({ visible: true }).click();
    await page
      .getByRole("combobox", { name: "Prize type", disabled: false })
      .filter({ visible: true })
      .click();
    await page.getByRole("option", { name: "Grand Prize" }).click();
    await page.getByRole("spinbutton", { name: "Quantity" }).filter({ visible: true }).fill("1");
    await page.getByRole("button", { name: "Save allocation" }).filter({ visible: true }).click();
    const trigger1 = page
      .locator('[data-slot="accordion-trigger"]')
      .filter({ hasText: "Round 1" });
    await expect(trigger1).toContainText("1 planned draw");
    await expect(trigger1).toContainText("Sequential");
    await trigger1.click(); // collapse

    // Round 2: SIMULTANEOUS, 3× Door Prize.
    await page.getByRole("button", { name: "Add round" }).click();
    await expect(
      page.getByLabel("Label", { exact: true }).filter({ visible: true })
    ).toHaveValue("Round 2");
    await page.getByLabel("Reveal mode").filter({ visible: true }).click();
    await page.getByRole("option", { name: "Simultaneous" }).click();
    await expect(
      page.getByLabel("Reveal mode").filter({ visible: true })
    ).toContainText("Simultaneous");
    await page.getByRole("button", { name: "Add allocation" }).filter({ visible: true }).click();
    await page
      .getByRole("combobox", { name: "Prize type", disabled: false })
      .filter({ visible: true })
      .click();
    await page.getByRole("option", { name: "Door Prize" }).click();
    await page.getByRole("spinbutton", { name: "Quantity" }).filter({ visible: true }).fill("3");
    await page.getByRole("button", { name: "Save allocation" }).filter({ visible: true }).click();
    const trigger2 = page
      .locator('[data-slot="accordion-trigger"]')
      .filter({ hasText: "Round 2" });
    await expect(trigger2).toContainText("3 planned draws");
    await expect(trigger2).toContainText("Simultaneous");

    // Footer counter (E1-03 Feature C).
    await expect(page.getByText("4 of 20 entrants allocated")).toBeVisible();

    // Lock via confirm dialog; locked state renders read-only.
    await page.getByRole("button", { name: "Lock raffle" }).click();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm.getByText("Lock this raffle?")).toBeVisible();
    await confirm.getByRole("button", { name: "Lock raffle" }).click();
    await expect(page.getByText("Locked").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Add round" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Lock raffle" })).toHaveCount(0);
  });

  test("draw round 1 (sequential) and round 2 (simultaneous)", async () => {
    await page.goto(`/raffles/${raffleId}/draw`);

    // Round 1: first Draw click opens the confirm dialog; confirming commits.
    await expect(page.getByText("Round 1 of 2").first()).toBeVisible();
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    const confirm1 = page.getByRole("alertdialog");
    await expect(confirm1.getByText("Draw Round 1?")).toBeVisible();
    await confirm1.getByRole("button", { name: "Draw round" }).click();
    // The commit transaction runs against the remote Neon DB — allow headroom.
    await expect(page.getByText("Round committed — ready to reveal")).toBeVisible({
      timeout: 60_000,
    });

    // Subsequent Draw click reveals exactly one winner; progress updates.
    await page.getByRole("button", { name: "Draw — Grand Prize" }).click();
    await expect(
      page.getByText("Round 1 of 2 — Grand Prize 1 of 1")
    ).toBeVisible();
    round1Winner = (await page.locator(".text-2xl.font-semibold").innerText()).trim();
    expect(round1Winner.length).toBeGreaterThan(0);

    // Advance to round 2.
    await page.getByRole("button", { name: "Next round — Round 2" }).click();

    // Round 2: one "Reveal round" gesture reveals all 3 winners together.
    await page
      .getByRole("button", { name: "Reveal round — Round 2 (3 slots)" })
      .click();
    const confirm2 = page.getByRole("alertdialog");
    await expect(confirm2.getByText("Draw Round 2?")).toBeVisible();
    await confirm2.getByRole("button", { name: "Reveal round" }).click();

    // Final round: the screen completes immediately (FSD 4.5 A4) and the
    // round's 3 winners appear together in the drawn-rounds history panel.
    await expect(page.getByText("All rounds drawn")).toBeVisible({
      timeout: 60_000,
    });
    const revealed = page
      .getByRole("complementary", { name: "Drawn rounds" })
      .locator('[data-slot="card"]')
      .last()
      .locator("span.font-medium");
    await expect(revealed).toHaveCount(3);
    round2Winners = (await revealed.allInnerTexts()).map((s) => s.trim());

    // 4 distinct winner names across rounds.
    const allWinners = [round1Winner, ...round2Winners];
    expect(new Set(allWinners).size).toBe(4);
  });

  test("disqualify a Round 2 winner with mandatory reason", async () => {
    await page.goto(`/raffles/${raffleId}/winners`);
    await expect(page.getByRole("row")).toHaveCount(5); // header + 4 winners

    const doorRow = page.getByRole("row").filter({ hasText: "Door Prize" }).first();
    disqualifiedName = (await doorRow.getByRole("cell").nth(3).innerText()).trim();
    expect(round2Winners).toContain(disqualifiedName);

    await doorRow.getByRole("button", { name: /^Actions for / }).click();
    await page.getByRole("menuitem", { name: "Disqualify" }).click();
    const dialog = page.getByRole("dialog");
    const submit = dialog.getByRole("button", { name: "Disqualify" });
    // Submit is disabled until a reason is typed.
    await expect(submit).toBeDisabled();
    await dialog.getByLabel("Reason").fill(DISQUALIFY_REASON);
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(dialog).toBeHidden();

    // Status badge updates on the row.
    const row = page.getByRole("row").filter({ hasText: disqualifiedName }).first();
    await expect(row.getByText("Disqualified")).toBeVisible();

    // Expanded history shows the disqualification entry with its reason.
    await row.getByRole("button", { name: "Expand audit history" }).click();
    const historyRow = page.getByRole("row").filter({ hasText: "Audit history" });
    await expect(historyRow.getByText("disqualified", { exact: true })).toBeVisible();
    await expect(historyRow.getByText(DISQUALIFY_REASON)).toBeVisible();
    // Collapse again to keep the table predictable for the next step.
    await row.getByRole("button", { name: "Collapse audit history" }).click();
  });

  test("redraw the disqualified slot; original superseded in history", async () => {
    const row = page.getByRole("row").filter({ hasText: disqualifiedName }).first();
    await row.getByRole("button", { name: "Redraw" }).click();
    const dialog = page.getByRole("alertdialog");
    const submit = dialog.getByRole("button", { name: "Redraw slot" });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel("Reason").fill(REDRAW_REASON);
    await expect(submit).toBeEnabled();
    await submit.click();

    const toast = page.getByText(/^Slot redrawn: /).first();
    await expect(toast).toBeVisible({ timeout: 30_000 });
    const match = (await toast.innerText()).match(
      /^Slot redrawn: (.+) \(ticket #\d+\)/
    );
    expect(match).toBeTruthy();
    replacementName = match![1];

    // Replacement differs from every active winner (pool excludes them).
    const activeWinners = [round1Winner, ...round2Winners];
    expect(activeWinners).not.toContain(replacementName);

    // Replacement row is present and PENDING.
    const newRow = page.getByRole("row").filter({ hasText: replacementName }).first();
    await expect(newRow).toBeVisible();
    await expect(newRow.getByText("Pending")).toBeVisible();

    // Original remains visible as superseded in the expanded history.
    await newRow.getByRole("button", { name: "Expand audit history" }).click();
    const historyRow = page.getByRole("row").filter({ hasText: "Supersession chain" });
    await expect(historyRow.getByText(disqualifiedName).first()).toBeVisible();
    await expect(historyRow.getByText("superseded").first()).toBeVisible();
    await expect(historyRow.getByText(REDRAW_REASON).first()).toBeVisible();
  });

  test("results export: BOM, 20 rows, winner columns, accented name", async () => {
    const response = await page.request.get(
      `/api/raffles/${raffleId}/export/results`
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");

    const body = await response.text();
    expect(body.charCodeAt(0)).toBe(0xfeff); // UTF-8 BOM

    const lines = body.slice(1).split(/\r?\n/).filter((l) => l.length > 0);
    expect(lines[0]).toBe(
      "ticket_number,full_name,contact,draw_round,prize,winner_status"
    );
    const dataRows = lines.slice(1);
    expect(dataRows).toHaveLength(20); // exactly one row per entrant

    // Accented name survives round-trip.
    expect(body).toContain("Ngô Bảo Châu");

    // Winners (4 revealed + the redraw replacement) have round/prize/status
    // populated; all other entrants have those columns empty.
    const winnerNames = new Set([round1Winner, ...round2Winners, replacementName]);
    for (const line of dataRows) {
      const cells = line.split(",");
      expect(cells).toHaveLength(6);
      const [, fullName, , drawRound, prize, status] = cells;
      if (winnerNames.has(fullName)) {
        expect(drawRound, `${fullName} draw_round`).not.toBe("");
        expect(prize, `${fullName} prize`).not.toBe("");
        expect(status, `${fullName} winner_status`).not.toBe("");
      } else {
        expect(drawRound, `${fullName} draw_round`).toBe("");
        expect(prize, `${fullName} prize`).toBe("");
        expect(status, `${fullName} winner_status`).toBe("");
      }
    }

    // Spot-check statuses: disqualified original and pending replacement.
    const rowOf = (name: string) => dataRows.find((l) => l.includes(name))!;
    expect(rowOf(disqualifiedName)).toContain("disqualified");
    expect(rowOf(replacementName)).toContain("pending");
    expect(rowOf(round1Winner)).toContain("Round 1");
    expect(rowOf(round1Winner)).toContain("Grand Prize");
  });

  test("log export: one row per audit action, disqualify + redraw present", async () => {
    const response = await page.request.get(`/api/raffles/${raffleId}/export/log`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("text/csv");

    const body = await response.text();
    expect(body.charCodeAt(0)).toBe(0xfeff);
    const lines = body.slice(1).split(/\r?\n/).filter((l) => l.length > 0);
    expect(lines[0]).toBe(
      "timestamp,action,entity_type,entity_id,old_value,new_value,reason,actor"
    );
    const dataRows = lines.slice(1);

    // One row per AuditLog entry of the raffle.
    const auditCount = await countAuditLogs(raffleId);
    expect(dataRows).toHaveLength(auditCount);
    // Expected shape of this journey: 1 lock + 4 per-event draws + 1 raffle
    // LOCKED→DRAWN transition (also action "draw", D-E07/D-E02) + 1
    // disqualify + 1 redraw.
    expect(dataRows.length).toBe(8);
    expect(dataRows.filter((l) => l.includes(",lock,"))).toHaveLength(1);
    expect(dataRows.filter((l) => l.includes(",draw,draw_event,"))).toHaveLength(4);
    expect(dataRows.filter((l) => l.includes(",draw,raffle,"))).toHaveLength(1);

    const disqRow = dataRows.find((l) => l.includes(",disqualified,"));
    expect(disqRow).toBeTruthy();
    expect(disqRow!).toContain(DISQUALIFY_REASON);
    expect(disqRow!).toContain("admin");
    // ISO 8601 UTC timestamp at the start of the row (D-E21).
    expect(disqRow!).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z,/);

    const redrawRow = dataRows.find((l) => l.includes(",redraw,"));
    expect(redrawRow).toBeTruthy();
    expect(redrawRow!).toContain(REDRAW_REASON);
    expect(redrawRow!).toContain("admin");
    expect(redrawRow!).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z,/);
  });
});
