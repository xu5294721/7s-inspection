import type { Locator } from "@playwright/test";
import { expectNoHorizontalOverflow } from "./inspection-helpers";
import { expect, test } from "./fixtures";

const selectedRoute = "卷扬机间";
const uncheckedRoute = "焊后间与门吊之间区域";
const templateCustomRoute = "模板内新增检查项点";
const customRoute = "移动端自定义超长巡检路线名称换行验证区域以及设备间安全通道";

interface ControlSize {
  width: number;
  height: number;
}

async function controlSizes(controls: Locator): Promise<ControlSize[]> {
  return controls.evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    return { width: bounds.width, height: bounds.height };
  }));
}

async function expectControlsNotToOverlap(controls: Locator): Promise<void> {
  const bounds = await controls.evaluateAll((elements) => elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  }));
  for (let first = 0; first < bounds.length; first += 1) {
    for (let second = first + 1; second < bounds.length; second += 1) {
      const overlaps = bounds[first].left < bounds[second].right
        && bounds[first].right > bounds[second].left
        && bounds[first].top < bounds[second].bottom
        && bounds[first].bottom > bounds[second].top;
      expect(overlaps).toBe(false);
    }
  }
}

test("creates and uses a mobile route template without persisting a temporary route adjustment", async ({ page }) => {
  await page.goto("/#/inspections/route-templates");
  await page.getByRole("button", { name: "新建模板" }).click();
  await page.getByRole("textbox", { name: "模板名称" }).fill("模板1");
  await page.getByRole("checkbox", { name: selectedRoute }).check();
  await page.getByRole("checkbox", { name: uncheckedRoute }).check();

  const longBuiltInRoute = page.getByText("装整工班钢轨整修间辊道梁", { exact: true });
  await expect(longBuiltInRoute).toHaveText("装整工班钢轨整修间辊道梁");
  const editorControls = page.locator(".route-template-editor__toolbar > div > button");
  await expect(editorControls).toHaveCount(3);
  await expectControlsNotToOverlap(editorControls);
  await page.getByRole("button", { name: "新增检查项" }).click();
  const templateDialog = page.getByRole("dialog", { name: "新增检查项" });
  await expect(templateDialog).toBeVisible();
  await page.getByRole("textbox", { name: "检查项目名称" }).fill(templateCustomRoute);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("checkbox", { name: templateCustomRoute })).toBeChecked();
  await page.getByRole("button", { name: `上移 ${templateCustomRoute}` }).click();
  await page.locator(".route-template-editor__routes li").last().evaluate((element) => {
    element.scrollIntoView({ block: "center" });
  });
  const editorActionsLayout = await page.evaluate(() => {
    const route = document.querySelector(".route-template-editor__routes li:last-child")?.getBoundingClientRect();
    const actions = document.querySelector(".route-template-editor__actions")?.getBoundingClientRect();
    return {
      routeVisibleAboveActions: Boolean(route && actions && route.bottom <= actions.top),
      routeBottom: route?.bottom ?? -1,
      actionsTop: actions?.top ?? -1,
    };
  });
  expect(editorActionsLayout.routeVisibleAboveActions).toBe(true);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "保存模板" }).click();
  await expect(page.getByText("模板1", { exact: true })).toBeVisible();

  await page.goto("/#/inspections/new");
  const templateSelect = page.getByRole("combobox", { name: "检查路线模板" });
  await expect(templateSelect).toBeVisible();
  const selectionControls = page.locator(".route-selection-toolbar > div > button");
  await expect(selectionControls).toHaveCount(3);
  const defaultControlSizes = await controlSizes(selectionControls);
  const defaultSelectSize = await controlSizes(templateSelect);
  await templateSelect.selectOption({ label: "模板1" });
  await expect(page.getByRole("checkbox", { name: selectedRoute })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: uncheckedRoute })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: templateCustomRoute })).toBeChecked();
  expect(await controlSizes(selectionControls)).toEqual(defaultControlSizes);
  expect(await controlSizes(templateSelect)).toEqual(defaultSelectSize);

  await templateSelect.selectOption({ label: "默认模板" });
  expect(await controlSizes(selectionControls)).toEqual(defaultControlSizes);
  expect(await controlSizes(templateSelect)).toEqual(defaultSelectSize);
  await templateSelect.selectOption({ label: "模板1" });
  expect(await controlSizes(selectionControls)).toEqual(defaultControlSizes);
  expect(await controlSizes(templateSelect)).toEqual(defaultSelectSize);

  await page.getByRole("checkbox", { name: uncheckedRoute }).uncheck();
  await page.getByRole("button", { name: "增加自定义" }).click();
  const dialog = page.getByRole("dialog", { name: "增加自定义检查项目" });
  await expect(dialog).toBeVisible();
  await expect(page.getByRole("textbox", { name: "检查项目名称" })).toBeFocused();
  const dialogLayout = await dialog.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const buttons = Array.from(element.querySelectorAll("button"), (button) => {
      const buttonBounds = button.getBoundingClientRect();
      return {
        visible: buttonBounds.top >= 0 && buttonBounds.bottom <= window.innerHeight,
        height: buttonBounds.height,
      };
    });
    return {
      withinViewport: bounds.top >= 0 && bounds.bottom <= window.innerHeight,
      buttons,
    };
  });
  expect(dialogLayout.withinViewport).toBe(true);
  expect(dialogLayout.buttons.every((button) => button.visible && button.height >= 44)).toBe(true);
  await page.getByRole("textbox", { name: "检查项目名称" }).fill(customRoute);
  await page.getByRole("button", { name: "保存", exact: true }).click();

  const customRouteCheckbox = page.getByRole("checkbox", { name: customRoute });
  await expect(customRouteCheckbox).toBeChecked();
  const customRouteName = page.locator(".route-option__name", { hasText: customRoute });
  await expect(customRouteName).toHaveCount(1);
  const wrapLayout = await customRouteName.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const styles = getComputedStyle(element);
    const lineHeight = Number.parseFloat(styles.lineHeight);
    const contentHeight = bounds.height
      - Number.parseFloat(styles.paddingTop)
      - Number.parseFloat(styles.paddingBottom);
    return {
      fullText: element.textContent,
      wraps: contentHeight > lineHeight + 1,
      fitsWidth: element.scrollWidth <= element.clientWidth,
      overflowWrap: styles.overflowWrap,
    };
  });
  expect(wrapLayout).toMatchObject({
    fullText: customRoute,
    fitsWidth: true,
    overflowWrap: "anywhere",
  });
  expect(wrapLayout.wraps).toBe((page.viewportSize()?.width ?? 0) <= 430);

  const finalRoute = page.locator(".route-list li").last();
  await finalRoute.evaluate((element) => {
    element.scrollIntoView({ block: "center" });
  });
  const commandBarLayout = await page.evaluate(() => {
    const route = document.querySelector(".route-list li:last-child")?.getBoundingClientRect();
    const commandBar = document.querySelector(".page-command-bar")?.getBoundingClientRect();
    return {
      routeVisibleAboveBar: Boolean(route && commandBar && route.bottom <= commandBar.top),
      routeBottom: route?.bottom ?? -1,
      commandBarTop: commandBar?.top ?? -1,
    };
  });
  expect(commandBarLayout.routeVisibleAboveBar).toBe(true);
  await expectNoHorizontalOverflow(page);

  await page.getByRole("button", { name: "开始检查" }).click();
  await page.waitForURL(/#\/inspections\/(?!new$)[^/]+$/);
  await expect(page.locator(".inspection-route").filter({ hasText: selectedRoute })).toBeVisible();
  await expect(page.locator(".inspection-route").filter({ hasText: templateCustomRoute })).toBeVisible();
  await expect(page.locator(".inspection-route").filter({ hasText: customRoute })).toBeVisible();
  await expect(page.getByText(uncheckedRoute, { exact: true })).toHaveCount(0);
  await expect(page.locator(".inspection-route")).toHaveCount(3);
  await expectNoHorizontalOverflow(page);

  await page.goto("/#/inspections/new");
  await templateSelect.selectOption({ label: "模板1" });
  await expect(page.getByRole("checkbox", { name: selectedRoute })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: uncheckedRoute })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: templateCustomRoute })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: customRoute })).toBeChecked();
});
