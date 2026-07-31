import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { ensureRouteCatalog } from "../../app/routeCatalogMigration";
import { createTestDb } from "../../db/database";
import { InspectionRepository } from "../../db/inspectionRepository";
import { ItemRepository } from "../../db/itemRepository";
import { RouteTemplateRepository } from "../../db/routeTemplateRepository";
import type { InspectionRouteTemplate } from "../../domain/models";
import { renderWithRouter } from "../../test/renderWithRouter";

test("keeps a saved custom route rendered and selected when later catalog reads fail", async () => {
  const user = userEvent.setup();
  const database = await prepareDatabase();
  const view = renderWithRouter({ database, initialPath: "/inspections/new" });

  await screen.findAllByRole("checkbox");
  await user.click(screen.getByRole("button", { name: "全不选" }));
  const listTemplates = vi.spyOn(RouteTemplateRepository.prototype, "list")
    .mockRejectedValue(new Error("later template read failed"));
  const listItems = vi.spyOn(ItemRepository.prototype, "listEnabled")
    .mockRejectedValue(new Error("later item read failed"));
  await user.click(screen.getByRole("button", { name: "增加自定义" }));
  await user.type(screen.getByRole("textbox", { name: "检查项目名称" }), "No Reload Area");
  await user.click(screen.getByRole("button", { name: "保存" }));

  const customRoute = await screen.findByRole("checkbox", { name: "No Reload Area" });
  expect(customRoute).toBeChecked();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  listTemplates.mockRestore();
  listItems.mockRestore();
  await user.click(screen.getByRole("button", { name: "开始检查" }));
  await waitFor(async () => expect(await database.inspections.count()).toBe(1));
  const [stored] = await database.inspections.toArray();
  const graph = await new InspectionRepository(database).getGraph(stored.id);
  expect(graph?.inspection.entries).toHaveLength(1);
  expect(graph?.inspection.entries[0].itemSnapshot.routeName).toBe("No Reload Area");
  view.unmount();
});

test("traps custom-route dialog focus, restores the opener, and locks the captured template", async () => {
  const user = userEvent.setup();
  const database = await prepareDatabase(async (testDatabase) => {
    const items = await new ItemRepository(testDatabase).listEnabled();
    await addTemplate(testDatabase, items.slice(0, 2).map((item) => item.id));
  });
  const view = renderWithRouter({ database, initialPath: "/inspections/new" });

  await screen.findAllByRole("checkbox");
  const selector = screen.getByRole("combobox", { name: "检查路线模板" });
  const opener = screen.getByRole("button", { name: "增加自定义" });
  opener.focus();
  await user.click(opener);
  const input = screen.getByRole("textbox", { name: "检查项目名称" });
  expect(input).toHaveFocus();
  expect(selector).toBeDisabled();
  await user.selectOptions(selector, "route-template-night");
  expect(selector).toHaveValue("route-template-default");
  await user.type(input, "Focus Area");
  await user.tab();
  expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
  await user.tab();
  expect(screen.getByRole("button", { name: "保存" })).toHaveFocus();
  fireEvent.keyDown(screen.getByRole("button", { name: "保存" }), { key: "Tab" });
  expect(input).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();

  await user.click(opener);
  await user.type(screen.getByRole("textbox", { name: "检查项目名称" }), "Saving Area");
  vi.spyOn(RouteTemplateRepository.prototype, "addCustomItem").mockImplementationOnce(
    () => new Promise<never>(() => undefined),
  );
  await user.click(screen.getByRole("button", { name: "保存" }));
  expect(screen.getByRole("dialog")).toHaveAttribute("aria-busy", "true");
  expect(selector).toBeDisabled();
  expect(opener).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeVisible();
  view.unmount();
});

test("keeps dialog state after rejection and permits a retry", async () => {
  const user = userEvent.setup();
  const database = await prepareDatabase();
  const addCustomItem = vi
    .spyOn(RouteTemplateRepository.prototype, "addCustomItem")
    .mockRejectedValueOnce(new Error("Save rejected"));
  const view = renderWithRouter({ database, initialPath: "/inspections/new" });

  await screen.findAllByRole("checkbox");
  await user.click(screen.getByRole("button", { name: "全不选" }));
  await user.click(screen.getByRole("button", { name: "增加自定义" }));
  const input = screen.getByRole("textbox", { name: "检查项目名称" });
  await user.type(input, "Retry Area");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Save rejected");
  expect(input).toHaveValue("Retry Area");
  expect(input).toHaveFocus();
  expect(screen.getByRole("combobox", { name: "检查路线模板" })).toHaveValue("route-template-default");
  expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(0);
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(await screen.findByRole("checkbox", { name: "Retry Area" })).toBeChecked();
  expect(addCustomItem).toHaveBeenCalledTimes(2);
  view.unmount();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function prepareDatabase(
  setup?: (database: ReturnType<typeof createTestDb>) => Promise<void>,
) {
  const database = createTestDb(`route-selection-${Date.now()}-${Math.random()}`);
  await ensureRouteCatalog(database);
  await setup?.(database);
  return database;
}

async function addTemplate(
  database: ReturnType<typeof createTestDb>,
  itemIds: string[],
  overrides: Partial<InspectionRouteTemplate> = {},
) {
  const template: InspectionRouteTemplate = {
    id: "route-template-night",
    name: "夜班路线",
    itemIds,
    isDefault: false,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
  await new RouteTemplateRepository(database).save(template);
  return template;
}

test("loads the default template's 39 enabled inspection items", async () => {
  const database = await prepareDatabase();
  const view = renderWithRouter({ database, initialPath: "/inspections/new" });

  expect(await screen.findAllByRole("checkbox")).toHaveLength(39);
  expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(39);
  expect(screen.getByRole("button", { name: "开始检查" })).toBeEnabled();
  view.unmount();
});

test("replaces the temporary selection when the operator changes template", async () => {
  const database = await prepareDatabase(async (testDatabase) => {
    const items = await new ItemRepository(testDatabase).listEnabled();
    await addTemplate(testDatabase, items.slice(0, 2).map((item) => item.id));
  });
  const view = renderWithRouter({ database, initialPath: "/inspections/new" });

  await screen.findAllByRole("checkbox");
  await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "检查路线模板" }), "route-template-night");

  expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(2);
  expect((await new RouteTemplateRepository(database).get("route-template-default"))?.itemIds).toHaveLength(39);
  view.unmount();
});

test("keeps a temporary item uncheck out of the saved template", async () => {
  const user = userEvent.setup();
  const database = await prepareDatabase();
  const view = renderWithRouter({ database, initialPath: "/inspections/new" });

  await user.click(await screen.findByRole("checkbox", { name: "卷扬机间" }));

  expect(screen.getByRole("checkbox", { name: "卷扬机间" })).not.toBeChecked();
  expect((await new RouteTemplateRepository(database).get("route-template-default"))?.itemIds).toHaveLength(39);
  view.unmount();
});

test("select all and clear all control the temporary item selection and start availability", async () => {
  const user = userEvent.setup();
  const database = await prepareDatabase();
  const view = renderWithRouter({ database, initialPath: "/inspections/new" });

  await screen.findAllByRole("checkbox");
  await user.click(screen.getByRole("button", { name: "全不选" }));
  expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(0);
  expect(screen.getByRole("button", { name: "开始检查" })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "全选" }));
  expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(39);
  expect(screen.getByRole("button", { name: "开始检查" })).toBeEnabled();
  view.unmount();
});

test("adds one custom route atomically to the active template and selects it for this inspection", async () => {
  const user = userEvent.setup();
  const database = await prepareDatabase();
  const view = renderWithRouter({ database, initialPath: "/inspections/new" });

  await screen.findAllByRole("checkbox");
  await user.click(screen.getByRole("button", { name: "全不选" }));
  await user.click(screen.getByRole("button", { name: "增加自定义" }));
  await user.type(screen.getByRole("textbox", { name: "检查项目名称" }), "临时新增区域");
  await user.click(screen.getByRole("button", { name: "保存" }));

  const customItem = await waitFor(async () => {
    const item = (await new ItemRepository(database).listEnabled()).find((entry) => entry.routeName === "临时新增区域");
    expect(item).toBeDefined();
    return item!;
  });
  expect(customItem.routeOrder).toBe(40);
  expect(screen.getByRole("checkbox", { name: "临时新增区域" })).toBeChecked();
  expect((await new RouteTemplateRepository(database).get("route-template-default"))?.itemIds).toContain(customItem.id);
  view.unmount();
});

test("assigns a custom route one order after the current maximum including disabled items", async () => {
  const user = userEvent.setup();
  const database = await prepareDatabase(async (testDatabase) => {
    const [firstItem] = await new ItemRepository(testDatabase).listEnabled();
    await new ItemRepository(testDatabase).put({
      ...firstItem,
      id: "disabled-high-order-route",
      routeName: "停用高序号项目",
      routeOrder: 99,
      enabled: false,
    });
  });
  const view = renderWithRouter({ database, initialPath: "/inspections/new" });

  await screen.findAllByRole("checkbox");
  await user.click(screen.getByRole("button", { name: "增加自定义" }));
  await user.type(screen.getByRole("textbox", { name: "检查项目名称" }), "序号检查项目");
  await user.click(screen.getByRole("button", { name: "保存" }));

  await waitFor(async () => expect((await new ItemRepository(database).listAll()).find((item) => item.routeName === "序号检查项目")?.routeOrder).toBe(100));
  view.unmount();
});

test("keeps the current temporary selection when adding a custom route without reloading", async () => {
  const user = userEvent.setup();
  const database = await prepareDatabase();
  const view = renderWithRouter({ database, initialPath: "/inspections/new" });

  await screen.findAllByRole("checkbox");
  await new ItemRepository(database).disable("core-route-01");
  await user.click(screen.getByRole("button", { name: "增加自定义" }));
  await user.type(screen.getByRole("textbox", { name: "检查项目名称" }), "刷新后的新增项目");
  await user.click(screen.getByRole("button", { name: "保存" }));

  await waitFor(() => expect(screen.queryByRole("dialog", { name: "增加自定义检查项目" })).not.toBeInTheDocument());
  expect(screen.getByText("已选择 40 项")).toBeVisible();
  expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(40);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  view.unmount();
});

test("keeps the custom route dialog open after a duplicate-name rejection", async () => {
  const user = userEvent.setup();
  const database = await prepareDatabase();
  const view = renderWithRouter({ database, initialPath: "/inspections/new" });

  await screen.findAllByRole("checkbox");
  await user.click(screen.getByRole("button", { name: "增加自定义" }));
  const nameInput = screen.getByRole("textbox", { name: "检查项目名称" });
  await user.type(nameInput, "卷扬机间");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("检查项目名称已存在");
  expect(nameInput).toHaveValue("卷扬机间");
  view.unmount();
});

test("keeps the custom route dialog and temporary selection after a save error", async () => {
  const user = userEvent.setup();
  const database = await prepareDatabase();
  const addCustomItem = vi.spyOn(RouteTemplateRepository.prototype, "addCustomItem").mockRejectedValueOnce(new Error("保存失败"));
  const view = renderWithRouter({ database, initialPath: "/inspections/new" });

  await screen.findAllByRole("checkbox");
  await user.click(screen.getByRole("button", { name: "全不选" }));
  await user.click(screen.getByRole("button", { name: "增加自定义" }));
  const nameInput = screen.getByRole("textbox", { name: "检查项目名称" });
  await user.type(nameInput, "保存失败项目");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
  expect(nameInput).toHaveValue("保存失败项目");
  expect(screen.queryAllByRole("checkbox", { checked: true })).toHaveLength(0);
  addCustomItem.mockRestore();
  view.unmount();
});

test("creates exactly one draft entry from a selected item and omits unselected names", async () => {
  const user = userEvent.setup();
  const database = await prepareDatabase();
  const view = renderWithRouter({ database, initialPath: "/inspections/new" });

  await screen.findAllByRole("checkbox");
  await user.click(screen.getByRole("button", { name: "全不选" }));
  await user.click(screen.getByRole("checkbox", { name: "卷扬机间" }));
  await user.click(screen.getByRole("button", { name: "开始检查" }));

  await waitFor(async () => expect(await database.inspections.count()).toBe(1));
  const [stored] = await database.inspections.toArray();
  const graph = await new InspectionRepository(database).getGraph(stored.id);
  expect(graph?.inspection.entries).toHaveLength(1);
  expect(graph?.inspection.entries[0].itemSnapshot.routeName).toBe("卷扬机间");
  expect(graph?.inspection.entries.some((entry) => entry.itemSnapshot.routeName === "百米轨场平移小车")).toBe(false);
  view.unmount();
});

test("re-reads selected items before saving and excludes a route disabled after page load", async () => {
  const user = userEvent.setup();
  const database = await prepareDatabase();
  const view = renderWithRouter({ database, initialPath: "/inspections/new" });

  await screen.findAllByRole("checkbox");
  await user.click(screen.getByRole("button", { name: "全不选" }));
  await user.click(screen.getByRole("checkbox", { name: "卷扬机间" }));
  await user.click(screen.getByRole("checkbox", { name: "百米轨场平移小车" }));
  await new ItemRepository(database).disable("core-route-01");
  await user.click(screen.getByRole("button", { name: "开始检查" }));

  await waitFor(async () => expect(await database.inspections.count()).toBe(1));
  const [stored] = await database.inspections.toArray();
  const graph = await new InspectionRepository(database).getGraph(stored.id);
  expect(graph?.inspection.entries.map((entry) => entry.itemSnapshot.routeName))
    .toEqual(["百米轨场平移小车"]);
  view.unmount();
});

test("uses template item order for display and draft entries, with a custom route appended to the template", async () => {
  const user = userEvent.setup();
  const database = await prepareDatabase(async (testDatabase) => {
    await addTemplate(testDatabase, ["core-route-03", "core-route-01"]);
  });
  const view = renderWithRouter({ database, initialPath: "/inspections/new" });

  await screen.findAllByRole("checkbox");
  await user.selectOptions(screen.getByRole("combobox", { name: "检查路线模板" }), "route-template-night");
  expect(screen.getAllByRole("checkbox").slice(0, 2).map((checkbox) => checkbox.getAttribute("aria-label")))
    .toEqual(["热一线外围", "卷扬机间"]);

  await user.click(screen.getByRole("button", { name: "增加自定义" }));
  await user.type(screen.getByRole("textbox", { name: "检查项目名称" }), "模板末尾路线");
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => {
    expect(screen.getAllByRole("checkbox").slice(0, 3).map((checkbox) => checkbox.getAttribute("aria-label")))
      .toEqual(["热一线外围", "卷扬机间", "模板末尾路线"]);
  });

  await user.click(screen.getByRole("button", { name: "开始检查" }));
  await waitFor(async () => expect(await database.inspections.count()).toBe(1));
  const [stored] = await database.inspections.toArray();
  const graph = await new InspectionRepository(database).getGraph(stored.id);
  expect(graph?.inspection.entries.map((entry) => entry.itemSnapshot.routeName)).toEqual([
    "热一线外围",
    "卷扬机间",
    "模板末尾路线",
  ]);
  view.unmount();
});

test("deduplicates inconsistent enabled names before full-select and draft creation", async () => {
  const user = userEvent.setup();
  const database = await prepareDatabase();
  const original = await database.checklistItems.get("core-route-01");
  if (!original) throw new Error("core route missing");
  await database.checklistItems.put({ ...original, id: "duplicate-route", routeOrder: 100, routeName: " 卷扬机间 " });
  await database.routeTemplates.update("route-template-default", {
    itemIds: [...(await database.routeTemplates.get("route-template-default"))!.itemIds, "duplicate-route"],
  });
  const view = renderWithRouter({ database, initialPath: "/inspections/new" });

  await screen.findAllByRole("checkbox");
  expect(screen.getAllByRole("checkbox", { name: "卷扬机间" })).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "全选" }));
  await user.click(screen.getByRole("button", { name: "开始检查" }));
  await waitFor(async () => expect(await database.inspections.count()).toBe(1));
  const [stored] = await database.inspections.toArray();
  const graph = await new InspectionRepository(database).getGraph(stored.id);
  expect(graph?.inspection.entries.filter((entry) => entry.itemSnapshot.routeName.trim() === "卷扬机间"))
    .toHaveLength(1);
  view.unmount();
});

test("preserves the visibly selected duplicate ID when global order prefers a different duplicate", async () => {
  const user = userEvent.setup();
  const database = await prepareDatabase();
  const original = await database.checklistItems.get("core-route-01");
  const defaultTemplate = await database.routeTemplates.get("route-template-default");
  if (!original || !defaultTemplate) throw new Error("default route data missing");
  const visibleDuplicateId = "duplicate-route-b";
  await database.checklistItems.put({
    ...original,
    id: visibleDuplicateId,
    routeOrder: 100,
  });
  await database.routeTemplates.update(defaultTemplate.id, {
    itemIds: [visibleDuplicateId, ...defaultTemplate.itemIds.filter((itemId) => itemId !== original.id)],
  });
  const view = renderWithRouter({ database, initialPath: "/inspections/new" });

  await screen.findAllByRole("checkbox");
  await user.click(screen.getByRole("button", { name: "全不选" }));
  await user.click(screen.getByRole("checkbox", { name: "卷扬机间" }));
  await user.click(screen.getByRole("button", { name: "开始检查" }));

  await waitFor(async () => expect(await database.inspections.count()).toBe(1));
  const [stored] = await database.inspections.toArray();
  const graph = await new InspectionRepository(database).getGraph(stored.id);
  expect(graph?.inspection.entries).toHaveLength(1);
  expect(graph?.inspection.entries[0]).toMatchObject({
    itemId: visibleDuplicateId,
    itemSnapshot: { id: visibleDuplicateId, routeName: "卷扬机间" },
  });
  view.unmount();
});

test("disables retry while a controlled reload is pending", async () => {
  let resolveItems!: (items: Awaited<ReturnType<ItemRepository["listEnabled"]>>) => void;
  const pendingItems = new Promise<Awaited<ReturnType<ItemRepository["listEnabled"]>>>((resolve) => {
    resolveItems = resolve;
  });
  const database = await prepareDatabase();
  const realItems = await new ItemRepository(database).listEnabled();
  const listItems = vi.spyOn(ItemRepository.prototype, "listEnabled")
    .mockRejectedValueOnce(new Error("首次失败"))
    .mockImplementationOnce(() => pendingItems);
  const view = renderWithRouter({ database, initialPath: "/inspections/new" });

  const retry = await screen.findByRole("button", { name: "重新加载" });
  await userEvent.setup().click(retry);
  expect(retry).toBeDisabled();
  fireEvent.click(retry);
  expect(listItems).toHaveBeenCalledTimes(2);
  resolveItems(realItems);
  expect(await screen.findByRole("checkbox", { name: "卷扬机间" })).toBeVisible();
  view.unmount();
});
