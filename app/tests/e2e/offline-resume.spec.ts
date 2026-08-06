import { expect, test } from "./fixtures";

test("reloads the cached shell and saved draft while offline", async ({ context, page }) => {
  const routeName = "卷扬机间";
  try {
    await page.goto("/#/inspections/new");
    await page.getByRole("button", { name: "全不选" }).click();
    await page.getByRole("checkbox", { name: routeName }).check();
    await page.getByRole("button", { name: "开始检查" }).click();
    await page.waitForURL(/#\/inspections\/(?!new$)[^/]+$/);
    const title = await page.getByRole("heading", { level: 2 }).textContent();
    if (!title) throw new Error("巡检标题未生成");

    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      timeout: 30_000,
    }).toBe(true);

    await context.setOffline(true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "7S巡检", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: title, level: 2 })).toBeVisible();
    await expect(page.locator(".inspection-route").filter({ hasText: routeName })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
});
