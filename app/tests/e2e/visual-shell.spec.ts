import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

async function expectShellInsideViewport(page: Page) {
  const dimensions = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  const fixedBounds = await page.locator(".bottom-nav, .page-command-bar").evaluateAll((elements) =>
    elements
      .filter((element) => getComputedStyle(element).display !== "none")
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right };
      }),
  );
  for (const bounds of fixedBounds) {
    expect(bounds.left).toBeGreaterThanOrEqual(-1);
    expect(bounds.right).toBeLessThanOrEqual(dimensions.clientWidth + 1);
  }
}

test("keeps the Apple shell inside the viewport", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
  await expect(page.getByRole("link", { name: "首页", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "巡检", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "历史", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "项点", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "设置", exact: true })).toBeVisible();
  await expectShellInsideViewport(page);
});

test("keeps key pages and fixed actions inside the viewport", async ({ page }) => {
  for (const route of ["/#/settings", "/#/history", "/#/inspections/new"]) {
    await page.goto(route);
    await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
    await expect(page.getByRole("link", { name: "首页", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "巡检", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "历史", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "项点", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "设置", exact: true })).toBeVisible();

    const commandBar = page.locator(".page-command-bar");
    if (await commandBar.count()) await expect(commandBar).toBeVisible();
    await expectShellInsideViewport(page);
  }
});
