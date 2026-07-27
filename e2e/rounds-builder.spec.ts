import { test, expect, type Page } from "@playwright/test";

import { login, createRaffle, addPrizeType, cleanupRafflesByTitle } from "./helpers";

// Regression: the rounds accordion must keep growing as allocations are added
// to an ALREADY-OPEN round. --radix-accordion-content-height is measured once
// on open and never updated, so pinning the content wrapper to it clipped
// every row added afterwards behind the panel's overflow:hidden — the operator
// could not reach "Add allocation" after the first couple of prizes.

const TITLE = `e2e-${Date.now()}-rounds`;
const PRIZES = ["Notebook", "Smartwatch", "Voucher", "Headphones"];

test.describe.configure({ mode: "serial" });

test.describe("rounds builder growth (E1-03)", () => {
  let page: Page;
  let raffleId: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await login(page);
    raffleId = await createRaffle(page, TITLE);
    for (const prize of PRIZES) await addPrizeType(page, prize);
  });

  test.afterAll(async () => {
    await page?.close();
    await cleanupRafflesByTitle([TITLE]);
  });

  test("a round accepts four allocations without any being clipped", async () => {
    await page.goto(`/raffles/${raffleId}/rounds`);
    await page.getByRole("button", { name: "Add round" }).click();
    await expect(
      page.getByLabel("Label", { exact: true }).filter({ visible: true })
    ).toHaveValue("Round 1");

    // Add every prize as its own allocation WITHOUT collapsing in between —
    // this is the path that used to clip.
    for (const [index, prize] of PRIZES.entries()) {
      const addAllocation = page
        .getByRole("button", { name: "Add allocation" })
        .filter({ visible: true });
      // The control itself must stay reachable as the panel grows.
      await expect(addAllocation).toBeVisible();
      await addAllocation.click();

      await page
        .getByRole("combobox", { name: "Prize type", disabled: false })
        .filter({ visible: true })
        .click();
      await page.getByRole("option", { name: prize }).click();
      // The pending row always renders after the saved ones, so it is last.
      await page.getByRole("spinbutton", { name: "Quantity" }).last().fill("2");
      await page
        .getByRole("button", { name: "Save allocation" })
        .filter({ visible: true })
        .click();

      await expect(
        page.locator('[data-slot="accordion-trigger"]').filter({ hasText: "Round 1" })
      ).toContainText(`${(index + 1) * 2} planned draws`);
    }

    // Every saved allocation is on screen, none hidden behind the clip.
    for (const prize of PRIZES) {
      await expect(
        page.getByRole("combobox", { name: "Prize type" }).filter({ hasText: prize })
      ).toBeVisible();
    }

    // And the panel is not scroll-clipping: its rendered height covers its
    // content. This is the assertion that fails against the old fixed height.
    const overflow = await page
      .locator('[data-slot="accordion-content"]')
      .first()
      .evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(overflow, "accordion content must not clip its rows").toBeLessThanOrEqual(1);
  });
});
