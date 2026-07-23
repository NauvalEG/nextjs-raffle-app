import "dotenv/config";
import { expect, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";

// Shared E2E helpers (E3-02). Every spec creates its own raffle with a unique
// `e2e-${Date.now()}` title and removes it again in test.afterAll via
// cleanupRafflesByTitle (direct Prisma access against the same Neon DB the
// app under test uses).

export const PIN = "123456";

// ---------------------------------------------------------------- database --

let prisma: PrismaClient | null = null;

function db(): PrismaClient {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}

/**
 * Deletes every raffle with one of the given titles, in dependency order:
 * auditLogs → (null-out supersededById, then delete) drawEvents → raffle
 * (cascades prizeTypes / rounds / allocations / entries / retiredTickets).
 */
export async function cleanupRafflesByTitle(titles: string[]): Promise<void> {
  const client = db();
  try {
    for (const title of titles) {
      const raffles = await client.raffle.findMany({
        where: { title },
        select: { id: true },
      });
      for (const raffle of raffles) {
        await client.auditLog.deleteMany({ where: { raffleId: raffle.id } });
        const eventWhere = {
          roundAllocation: { round: { raffleId: raffle.id } },
        };
        await client.drawEvent.updateMany({
          where: eventWhere,
          data: { supersededById: null },
        });
        await client.drawEvent.deleteMany({ where: eventWhere });
        await client.raffle.delete({ where: { id: raffle.id } });
      }
    }
  } finally {
    await client.$disconnect();
    prisma = null;
  }
}

export async function findRaffleIdByTitle(title: string): Promise<string | null> {
  const raffle = await db().raffle.findFirst({ where: { title }, select: { id: true } });
  return raffle?.id ?? null;
}

export async function countAuditLogs(raffleId: string): Promise<number> {
  return db().auditLog.count({ where: { raffleId } });
}

export async function auditActions(raffleId: string): Promise<string[]> {
  const rows = await db().auditLog.findMany({
    where: { raffleId },
    select: { action: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  return rows.map((r) => r.action);
}

export async function drawEventSnapshot(raffleId: string): Promise<
  { id: string; status: string; supersededById: string | null }[]
> {
  return db().drawEvent.findMany({
    where: { roundAllocation: { round: { raffleId } } },
    select: { id: true, status: true, supersededById: true },
    orderBy: { createdAt: "asc" },
  });
}

// -------------------------------------------------------------------- auth --

/** PIN login: /login → fill PIN → submit → dashboard. */
export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("PIN").fill(PIN);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/raffles$/);
  await expect(page.getByRole("heading", { name: "Raffles" })).toBeVisible();
}

// ------------------------------------------------------------------ set-up --

/** Creates a raffle from the dashboard dialog and returns its id (from URL). */
export async function createRaffle(
  page: Page,
  title: string,
  description = ""
): Promise<string> {
  await page.goto("/raffles");
  await page.getByRole("button", { name: "New raffle" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Title").fill(title);
  if (description) {
    await dialog.getByLabel(/Description/).fill(description);
  }
  await dialog.getByRole("button", { name: "Create raffle" }).click();
  await expect(page).toHaveURL(/\/raffles\/[a-z0-9]+$/);
  const id = page.url().split("/").pop()!;
  return id;
}

/** Adds a prize type on the Setup screen (must already be on /raffles/[id]). */
export async function addPrizeType(page: Page, name: string): Promise<void> {
  await page.getByLabel("Prize type name").fill(name);
  await page.getByRole("button", { name: "Add", exact: true }).click();
  const list = page
    .getByRole("listitem")
    .filter({ hasText: name });
  await expect(list.first()).toBeVisible();
}

/** Imports entrants via the PASTE path of the import dialog. */
export async function importEntrantsPaste(
  page: Page,
  raffleId: string,
  csvText: string,
  expectedCount: number
): Promise<void> {
  await page.goto(`/raffles/${raffleId}/participants`);
  await page.getByRole("button", { name: "Import entrants" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("textarea").fill(csvText);
  await dialog.getByRole("button", { name: "Continue", exact: true }).click();
  await dialog.getByRole("button", { name: "Continue to preview" }).click();
  await expect(
    dialog.getByText(`${expectedCount} rows ready to import, 0 rows blocked.`)
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: `Import ${expectedCount} entrants` })
    .click();
  await expect(dialog).toBeHidden();
  await expect(
    page.getByText(`${expectedCount} entrants`, { exact: false }).first()
  ).toBeVisible();
}

// ------------------------------------------------------------------ rounds --

/**
 * On /raffles/[id]/rounds: clicks "Add round", configures the newly created
 * (auto-expanded) round's reveal mode and one allocation, then collapses it.
 * Rounds get default labels "Round 1", "Round 2", … in creation order.
 */
export async function addRoundWithAllocation(
  page: Page,
  opts: {
    position: number; // 1-based; the default label will be `Round ${position}`
    revealMode: "SEQUENTIAL" | "SIMULTANEOUS";
    prizeName: string;
    quantity: number;
  }
): Promise<void> {
  const label = `Round ${opts.position}`;
  await page.getByRole("button", { name: "Add round" }).click();
  // The new round renders expanded with its label input focused.
  const labelInput = page.getByLabel("Label", { exact: true }).filter({ visible: true });
  await expect(labelInput).toHaveValue(label);

  if (opts.revealMode === "SIMULTANEOUS") {
    await page.getByLabel("Reveal mode").filter({ visible: true }).click();
    await page.getByRole("option", { name: "Simultaneous" }).click();
    await expect(
      page.getByLabel("Reveal mode").filter({ visible: true })
    ).toContainText("Simultaneous");
  }

  await page.getByRole("button", { name: "Add allocation" }).filter({ visible: true }).click();
  await page
    .getByRole("combobox", { name: "Prize type", disabled: false })
    .filter({ visible: true })
    .click();
  await page.getByRole("option", { name: opts.prizeName }).click();
  const qty = page.getByRole("spinbutton", { name: "Quantity" }).filter({ visible: true });
  await qty.fill(String(opts.quantity));
  await page.getByRole("button", { name: "Save allocation" }).filter({ visible: true }).click();

  // Round header summary reflects the saved allocation.
  const trigger = page
    .locator('[data-slot="accordion-trigger"]')
    .filter({ hasText: label });
  await expect(trigger).toContainText(
    `${opts.quantity} planned ${opts.quantity === 1 ? "draw" : "draws"}`
  );
  // Collapse so the next round's controls are the only visible ones.
  await trigger.click();
  await expect(labelInput).toBeHidden();
}

/** Locks the raffle from the Rounds screen, asserting the footer counter first. */
export async function lockRaffle(
  page: Page,
  opts: { planned: number; entrants: number }
): Promise<void> {
  await expect(
    page.getByText(`${opts.planned} of ${opts.entrants} entrants allocated`)
  ).toBeVisible();
  await page.getByRole("button", { name: "Lock raffle" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm.getByText("Lock this raffle?")).toBeVisible();
  await confirm.getByRole("button", { name: "Lock raffle" }).click();
  // Locked state: badge appears, editing affordances gone.
  await expect(page.getByText("Locked").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Add round" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Lock raffle" })).toHaveCount(0);
}

// -------------------------------------------------------------------- draw --

/**
 * Draws a FINAL SIMULTANEOUS round on /raffles/[id]/draw (one "Reveal round"
 * gesture) and returns the revealed winner names in slot order. On the final
 * round the screen completes immediately (FSD 4.5 A4) and the round joins
 * the drawn-rounds history panel — names are read from there.
 */
export async function drawSimultaneousRound(page: Page): Promise<string[]> {
  await page.getByRole("button", { name: /^Reveal round — / }).click();
  const confirm = page.getByRole("alertdialog");
  await confirm.getByRole("button", { name: "Reveal round" }).click();
  // The commit transaction runs against the remote Neon DB — allow headroom.
  await expect(page.getByText("All rounds drawn")).toBeVisible({ timeout: 60_000 });
  const names = page
    .getByRole("complementary", { name: "Drawn rounds" })
    .locator('[data-slot="card"]')
    .last()
    .locator("span.font-medium");
  await expect(names.first()).toBeVisible();
  return (await names.allInnerTexts()).map((s) => s.trim());
}

// ----------------------------------------------------------------- winners --

/**
 * Runs a status-change action (dropdown → dialog with mandatory reason) on
 * the winners row containing `rowText`. `menuItem` is e.g. "Disqualify",
 * "Mark claimed", "Release to pool"; the dialog submit carries the same name.
 */
export async function changeWinnerStatus(
  page: Page,
  rowText: string,
  menuItem: "Mark claimed" | "Disqualify" | "Release to pool",
  reason: string
): Promise<void> {
  const row = page.getByRole("row").filter({ hasText: rowText }).first();
  await row.getByRole("button", { name: /^Actions for / }).click();
  await page.getByRole("menuitem", { name: menuItem }).click();
  const dialog = page.getByRole("dialog");
  const submit = dialog.getByRole("button", { name: menuItem });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel("Reason").fill(reason);
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(dialog).toBeHidden();
}

/**
 * Redraws the slot of the winners row containing `rowText` and returns the
 * replacement winner's full name (parsed from the success toast).
 */
export async function redrawWinnerRow(
  page: Page,
  rowText: string,
  reason: string
): Promise<string> {
  const row = page.getByRole("row").filter({ hasText: rowText }).first();
  await row.getByRole("button", { name: "Redraw" }).click();
  const dialog = page.getByRole("alertdialog");
  const submit = dialog.getByRole("button", { name: "Redraw slot" });
  await expect(submit).toBeDisabled();
  await dialog.getByLabel("Reason").fill(reason);
  await expect(submit).toBeEnabled();
  await submit.click();
  const toast = page.getByText(/^Slot redrawn: /).first();
  await expect(toast).toBeVisible({ timeout: 30_000 });
  const text = (await toast.innerText()).trim();
  const match = text.match(/^Slot redrawn: (.+) \(ticket #\d+\)/);
  if (!match) throw new Error(`Could not parse redraw toast: ${text}`);
  await expect(dialog).toBeHidden();
  return match[1];
}
