import {
  closeInspectionEntry,
  createCategorizedDraft,
  expectNoHorizontalOverflow,
  importRealJpegForRoute,
  openInspectionEntry,
  openReview,
} from "./inspection-helpers";
import { expect, test } from "./fixtures";

const selectedContentRoute = "卷扬机间";
const selectedContentSummary = "检查内容：环境卫生干净整洁、物品定置工具摆放整齐";
const selectedEvaluationSentence = "卷扬机间：环境卫生干净整洁，物品定置工具摆放整齐。";
const oldGenericEvaluationSentence = "卷扬机间7S管理落实较好。";

test("selects inspection content, preserves it after reload, and reaches mobile review", async ({ page }, testInfo) => {
  const captureScreenshot = page.screenshot.bind(page);
  await page.goto("/#/inspections/new");
  await expect(page.getByRole("checkbox", { name: selectedContentRoute })).toBeVisible();
  await page.getByRole("button", { name: "全不选" }).click();
  await page.getByRole("checkbox", { name: selectedContentRoute }).check();
  await page.getByRole("button", { name: "开始检查" }).click();
  await page.waitForURL(/#\/inspections\/(?!new$)[^/]+$/);

  const route = page.locator(".inspection-route").filter({
    hasText: selectedContentRoute,
  });
  await expect(route).toHaveCount(1);
  const contentDialog = await openInspectionEntry(page, route);
  await contentDialog.getByRole("button", { name: "检查内容：请选择检查内容" }).click();
  await contentDialog.getByRole("combobox", { name: "环境卫生" }).selectOption("干净整洁");
  await contentDialog.getByRole("combobox", { name: "物品定置" }).selectOption({ label: "自定义" });
  await contentDialog.getByRole("textbox", { name: "物品定置自定义内容" }).fill("工具摆放整齐");
  await contentDialog.getByRole("button", { name: "确认" }).click();

  await expect(contentDialog.getByRole("button", { name: selectedContentSummary })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await captureScreenshot({
    path: testInfo.outputPath("inspection-content-selected.png"),
    fullPage: true,
  });
  await closeInspectionEntry(contentDialog);

  await page.reload();
  const restoredDialog = await openInspectionEntry(page, route);
  await expect(restoredDialog.getByRole("button", { name: selectedContentSummary })).toBeVisible();
  await restoredDialog.getByRole("button", { name: selectedContentSummary }).click();
  await expect(restoredDialog.getByRole("combobox", { name: "环境卫生" })).toHaveValue("干净整洁");
  await expect(restoredDialog.getByRole("combobox", { name: "物品定置" })).toHaveValue("__custom__");
  await expect(restoredDialog.getByRole("textbox", { name: "物品定置自定义内容" })).toHaveValue("工具摆放整齐");
  await restoredDialog.getByRole("button", { name: "取消" }).click();
  await closeInspectionEntry(restoredDialog);
  await expectNoHorizontalOverflow(page);

  await importRealJpegForRoute(page, selectedContentRoute);
  const photoDialog = await openInspectionEntry(page, route);
  const photoGroup = photoDialog.locator(".photo-group-editor");
  await expect(photoGroup).toHaveCount(1);
  const evaluationDescription = photoGroup.getByRole("textbox", { name: "评价说明" });
  await expect(evaluationDescription).toHaveValue(selectedEvaluationSentence);
  await expect(evaluationDescription).not.toHaveAttribute("readonly", "");
  await photoGroup.getByRole("radio", { name: "一般表现" }).check();
  await photoGroup.getByRole("button", { name: "保存评价" }).click();
  await openReview(page);

  await expect(page.getByRole("tab", { name: "好的方面 0张" })).toBeVisible();
  const generalTab = page.getByRole("tab", { name: "一般表现 1张" });
  await expect(generalTab).toBeVisible();
  await expect(page.getByRole("tab", { name: "提醒问题 0张" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "考核问题 0张" })).toBeVisible();
  await generalTab.click();
  await expect(generalTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(selectedEvaluationSentence, { exact: true })).toBeVisible();
  await expect(page.getByText(oldGenericEvaluationSentence, { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "生成Word" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await captureScreenshot({
    path: testInfo.outputPath("inspection-content-review.png"),
    fullPage: true,
  });
});

test("creates, classifies, splits, reloads, and resumes a field inspection", async ({ page }) => {
  await createCategorizedDraft(page, [3, 1, 1]);
  await openReview(page);

  await expect(page.getByText("5张", { exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "好的方面 2张" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "提醒问题 2张" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "考核问题 1张" })).toBeVisible();

  const layout = await page.evaluate(() => {
    const bodyText = document.body.innerText.trim();
    const topbar = document.querySelector(".topbar")?.getBoundingClientRect();
    const content = document.querySelector(".app-content")?.getBoundingClientRect();
    return {
      bodyTextLength: bodyText.length,
      horizontalOverflow: document.documentElement.scrollWidth - window.innerWidth,
      contentStartsAfterTopbar: Boolean(topbar && content && content.top >= topbar.bottom),
    };
  });
  expect(layout.bodyTextLength).toBeGreaterThan(20);
  expect(layout.horizontalOverflow).toBeLessThanOrEqual(0);
  expect(layout.contentStartsAfterTopbar).toBe(true);
  await expectNoHorizontalOverflow(page);
});

test("adds a temporary item in the field, photographs it, and opens review", async ({ page }) => {
  const temporaryName = "临时检查项-ABCDEFGHIJKLMNOPQRSTUVWXYZ01234567890123456789";
  await page.goto("/#/inspections/new");
  await expect(page.getByRole("checkbox").first()).toBeVisible();
  await page.getByRole("button", { name: "全不选" }).click();
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "开始检查" }).click();
  await page.waitForURL(/#\/inspections\/(?!new$)[^/]+$/);

  const opener = page.getByRole("button", { name: "新增检查项" });
  await expect(opener).toBeVisible();
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "新增本次检查项" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: "检查项名称" }).fill(temporaryName);
  const openLayout = await page.evaluate(() => {
    const toolbar = document.querySelector(".inspection-search-toolbar")?.getBoundingClientRect();
    const modal = document.querySelector(".confirmation-dialog")?.getBoundingClientRect();
    const insideViewport = (rect?: DOMRect) => Boolean(rect &&
      rect.left >= 0 && rect.right <= window.innerWidth &&
      rect.top >= 0 && rect.bottom <= window.innerHeight);
    return {
      toolbarInside: insideViewport(toolbar),
      dialogInside: insideViewport(modal),
    };
  });
  expect(openLayout).toEqual({ toolbarInside: true, dialogInside: true });
  await dialog.getByRole("button", { name: "保存" }).click();

  const temporaryRoute = page.locator(".inspection-route").filter({ hasText: temporaryName });
  const routeToggle = temporaryRoute.locator(".inspection-entry-summary__button");
  await expect(routeToggle).toBeVisible();
  await expect.poll(() => routeToggle.locator(".inspection-entry-summary__content").evaluate((element) => ({
    overflowWrap: getComputedStyle(element).overflowWrap,
    fitsWidth: element.scrollWidth <= element.clientWidth,
  }))).toEqual({ overflowWrap: "anywhere", fitsWidth: true });
  await expectNoHorizontalOverflow(page);

  await page.reload();
  const restoredTemporaryRoute = page.locator(".inspection-route").filter({ hasText: temporaryName });
  await expect(restoredTemporaryRoute).toHaveCount(1);
  const temporaryDialog = await openInspectionEntry(page, restoredTemporaryRoute);
  await expect(temporaryDialog.getByRole("heading", { name: `检查项：${temporaryName}`, exact: true, level: 3 })).toBeVisible();
  await closeInspectionEntry(temporaryDialog);
  await importRealJpegForRoute(page, temporaryName);
  await openReview(page);
  await expect(page.getByText(temporaryName, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("tab", { name: "好的方面 1张" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
