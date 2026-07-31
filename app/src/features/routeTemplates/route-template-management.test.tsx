import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { createTestDb } from "../../db/database";
import { InspectionRepository } from "../../db/inspectionRepository";
import { ItemRepository } from "../../db/itemRepository";
import { RouteTemplateRepository } from "../../db/routeTemplateRepository";
import { createInspection } from "../../domain/inspection";
import type { ChecklistItem, InspectionRouteTemplate } from "../../domain/models";
import { renderWithRouter } from "../../test/renderWithRouter";
import { ensureRouteCatalog } from "../../app/routeCatalogMigration";

afterEach(() => {
  vi.restoreAllMocks();
});

function makeTemplate(
  itemIds: string[],
  overrides: Partial<InspectionRouteTemplate> = {},
): InspectionRouteTemplate {
  return {
    id: "route-template-custom",
    name: "自定义模板",
    itemIds,
    isDefault: false,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
}

async function prepareRouteTemplateDatabase(
  setup?: (database: ReturnType<typeof createTestDb>, items: ChecklistItem[]) => Promise<void>,
) {
  const database = createTestDb(`route-template-ui-${Date.now()}-${Math.random()}`);
  await ensureRouteCatalog(database);
  const items = await new ItemRepository(database).listEnabled();
  const routeTemplateRepository = new RouteTemplateRepository(database);
  if (!(await routeTemplateRepository.list()).some((template) => template.isDefault)) {
    await routeTemplateRepository.save({
      id: "test-default-route-template",
      name: "默认模板",
      itemIds: items.slice(0, 3).map((item) => item.id),
      isDefault: true,
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt: "2026-07-29T00:00:00.000Z",
    });
  }
  await setup?.(database, items);
  return { database, items };
}

async function renderRouteTemplatePage(
  setup?: (database: ReturnType<typeof createTestDb>, items: ChecklistItem[]) => Promise<void>,
) {
  const { database, items } = await prepareRouteTemplateDatabase(setup);
  const view = renderWithRouter({ database, initialPath: "/inspections/route-templates" });
  await screen.findByRole("heading", { name: "路线模板" });
  return { database, items, view };
}

async function createCustomTemplate(
  database: ReturnType<typeof createTestDb>,
  items: ChecklistItem[],
  overrides: Partial<InspectionRouteTemplate> = {},
) {
  const template = makeTemplate(items.slice(0, 2).map((item) => item.id), overrides);
  await new RouteTemplateRepository(database).save(template);
  return template;
}

test("loads existing templates and creates a template with selected routes", async () => {
  const user = userEvent.setup();
  const { database, items, view } = await renderRouteTemplatePage();

  expect(await screen.findByText("默认模板")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "新建模板" }));
  await user.type(screen.getByRole("textbox", { name: "模板名称" }), "夜班路线");
  await user.click(screen.getByRole("checkbox", { name: items[0].routeName }));
  await user.click(screen.getByRole("checkbox", { name: items[1].routeName }));
  await user.click(screen.getByRole("button", { name: "保存模板" }));

  await waitFor(async () => {
    expect((await new RouteTemplateRepository(database).list()).find((template) => template.name === "夜班路线")).toMatchObject({
      name: "夜班路线",
      itemIds: [items[0].id, items[1].id],
      isDefault: false,
    });
  });
  view.unmount();
});

test("adds a custom item to a new template and saves the chosen order", async () => {
  const user = userEvent.setup();
  const { database, items, view } = await renderRouteTemplatePage();

  await user.click(screen.getByRole("button", { name: "新建模板" }));
  await user.type(screen.getByRole("textbox", { name: "模板名称" }), "设备路线");
  await user.click(screen.getByRole("checkbox", { name: items[0].routeName }));
  await user.click(screen.getByRole("button", { name: "新增检查项" }));
  await user.type(screen.getByRole("textbox", { name: "检查项目名称" }), "新增区域");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(screen.getByRole("checkbox", { name: "新增区域" })).toBeChecked();
  await user.click(screen.getByRole("button", { name: "上移 新增区域" }));
  await user.click(screen.getByRole("button", { name: "保存模板" }));

  await waitFor(async () => {
    const customItem = (await new ItemRepository(database).listEnabled()).find((item) => item.routeName === "新增区域");
    expect(customItem).toBeDefined();
    expect((await new RouteTemplateRepository(database).list()).find((template) => template.name === "设备路线")?.itemIds).toEqual([
      customItem?.id,
      items[0].id,
    ]);
  });
  view.unmount();
});

test("select all and clear all update route selection and save availability", async () => {
  const user = userEvent.setup();
  const { items, view } = await renderRouteTemplatePage();

  await user.click(screen.getByRole("button", { name: "新建模板" }));
  await user.type(screen.getByRole("textbox", { name: "模板名称" }), "模板1");
  await user.click(screen.getByRole("button", { name: "全选" }));
  expect(screen.getAllByRole("checkbox", { checked: true })).toHaveLength(items.length);
  await user.click(screen.getByRole("button", { name: "全不选" }));
  expect(screen.getByRole("button", { name: "保存模板" })).toBeDisabled();
  view.unmount();
});

test("requires a name and keeps the editor open when the template name conflicts", async () => {
  const user = userEvent.setup();
  const { items, view } = await renderRouteTemplatePage(async (database, enabledItems) => {
    await createCustomTemplate(database, enabledItems, { name: "已存在模板" });
  });
  await user.click(screen.getByRole("button", { name: "新建模板" }));

  expect(screen.getByRole("button", { name: "保存模板" })).toBeDisabled();
  await user.type(screen.getByRole("textbox", { name: "模板名称" }), "已存在模板");
  await user.click(screen.getByRole("checkbox", { name: items[0].routeName }));
  await user.click(screen.getByRole("button", { name: "保存模板" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("模板名称已存在");
  expect(screen.getByRole("textbox", { name: "模板名称" })).toHaveValue("已存在模板");
  view.unmount();
});

test("edits a custom template without changing an existing inspection snapshot", async () => {
  const user = userEvent.setup();
  let template!: InspectionRouteTemplate;
  let inspection!: ReturnType<typeof createInspection>;
  let expectedSnapshot!: ReturnType<typeof createInspection>["entries"][number]["itemSnapshot"][];
  const { database, items, view } = await renderRouteTemplatePage(async (testDatabase, enabledItems) => {
    template = await createCustomTemplate(testDatabase, enabledItems);
    inspection = createInspection(enabledItems.slice(0, 2), "route-template-history", "2026-07-29");
    expectedSnapshot = inspection.entries.map((entry) => entry.itemSnapshot);
    await new InspectionRepository(testDatabase).saveGraph({ inspection, groups: [], photos: [] });
  });

  await user.click(await screen.findByRole("button", { name: "编辑 自定义模板" }));
  await user.click(screen.getByRole("checkbox", { name: items[2].routeName }));
  await user.click(screen.getByRole("button", { name: "保存模板" }));

  await waitFor(async () => {
    expect((await new RouteTemplateRepository(database).get(template.id))?.itemIds).toEqual([
      items[0].id,
      items[1].id,
      items[2].id,
    ]);
  });
  expect((await new InspectionRepository(database).getGraph(inspection.id))?.inspection.entries.map(
    (entry) => entry.itemSnapshot,
  )).toEqual(expectedSnapshot);
  view.unmount();
});

test("locks default template name and deletion while retaining route editing", async () => {
  const user = userEvent.setup();
  const { view } = await renderRouteTemplatePage();

  expect(screen.queryByRole("button", { name: "删除 默认模板" })).not.toBeInTheDocument();
  await user.click(await screen.findByRole("button", { name: "编辑 默认模板" }));
  expect(screen.getByRole("textbox", { name: "模板名称" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "保存模板" })).toBeEnabled();
  view.unmount();
});

test("filters disabled template IDs in the editor, warns, and removes them only on explicit save", async () => {
  const user = userEvent.setup();
  const { database, view } = await renderRouteTemplatePage(async (testDatabase) => {
    await new ItemRepository(testDatabase).disable("core-route-01");
  });

  await user.click(await screen.findByRole("button", { name: "编辑 默认模板" }));
  expect(screen.getByRole("status")).toHaveTextContent("模板中有项目已停用，本次已自动忽略");
  expect(screen.queryByRole("checkbox", { name: "卷扬机间" })).not.toBeInTheDocument();
  expect(screen.getByText("已选择 38 条路线")).toBeVisible();
  expect((await database.routeTemplates.get("route-template-default"))?.itemIds).toContain("core-route-01");

  await user.click(screen.getByRole("button", { name: "保存模板" }));
  await waitFor(async () => {
    expect((await database.routeTemplates.get("route-template-default"))?.itemIds).not.toContain("core-route-01");
  });
  view.unmount();
});

test("confirms custom template deletion with a keyboard-accessible dialog", async () => {
  const user = userEvent.setup();
  let template!: InspectionRouteTemplate;
  const { database, view } = await renderRouteTemplatePage(async (testDatabase, items) => {
    template = await createCustomTemplate(testDatabase, items, { name: "待删除模板" });
  });
  const removeButton = await screen.findByRole("button", { name: "删除 待删除模板" });

  await user.click(removeButton);
  const dialog = await screen.findByRole("dialog", { name: "确认删除模板" });
  expect(dialog).toHaveAttribute("aria-modal", "true");
  expect(screen.getByRole("button", { name: "取消" })).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "确认删除模板" })).not.toBeInTheDocument();
  expect(removeButton).toHaveFocus();

  await user.click(removeButton);
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(async () => expect(await new RouteTemplateRepository(database).get(template.id)).toBeUndefined());
  view.unmount();
});

test("retains editor values and re-enables saving after a template save failure", async () => {
  const user = userEvent.setup();
  const { items, view } = await renderRouteTemplatePage(async (database, enabledItems) => {
    await createCustomTemplate(database, enabledItems);
  });
  const saveFailure = vi.spyOn(RouteTemplateRepository.prototype, "save").mockRejectedValueOnce(new Error("保存失败"));

  await user.click(await screen.findByRole("button", { name: "编辑 自定义模板" }));
  const nameInput = screen.getByRole("textbox", { name: "模板名称" });
  await user.clear(nameInput);
  await user.type(nameInput, "保留修改");
  await user.click(screen.getByRole("checkbox", { name: items[2].routeName }));
  const save = screen.getByRole("button", { name: "保存模板" });
  await user.click(save);

  expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
  expect(nameInput).toHaveValue("保留修改");
  expect(screen.getByRole("checkbox", { name: items[2].routeName })).toBeChecked();
  expect(save).toBeEnabled();
  saveFailure.mockRestore();
  view.unmount();
});

test("retries initial route and template loading without navigating away", async () => {
  const user = userEvent.setup();
  const { database } = await prepareRouteTemplateDatabase();
  const itemList = vi.spyOn(ItemRepository.prototype, "listEnabled").mockRejectedValueOnce(new Error("项点加载失败"));
  const templateList = vi.spyOn(RouteTemplateRepository.prototype, "list").mockRejectedValueOnce(new Error("模板加载失败"));
  const view = renderWithRouter({ database, initialPath: "/inspections/route-templates" });

  expect(await screen.findByRole("alert")).toHaveTextContent("项点加载失败");
  const retry = screen.getByRole("button", { name: "重新加载" });
  await user.click(retry);

  await waitFor(() => {
    expect(itemList).toHaveBeenCalledTimes(2);
    expect(templateList).toHaveBeenCalledTimes(2);
  });
  expect(await screen.findByText("默认模板")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  itemList.mockRestore();
  templateList.mockRestore();
  view.unmount();
});

test("keeps successful create and edit visible without a second template list read", async () => {
  const user = userEvent.setup();
  const { database, items } = await prepareRouteTemplateDatabase(async (testDatabase, enabledItems) => {
    await createCustomTemplate(testDatabase, enabledItems, { id: "route-template-zulu", name: "Zulu" });
  });
  const originalList = RouteTemplateRepository.prototype.list;
  const templateList = vi.spyOn(RouteTemplateRepository.prototype, "list").mockImplementation(function (this: RouteTemplateRepository) {
    return originalList.call(this);
  });
  templateList.mockImplementationOnce(function (this: RouteTemplateRepository) {
    return originalList.call(this);
  }).mockRejectedValueOnce(new Error("后续列表读取失败"));
  const view = renderWithRouter({ database, initialPath: "/inspections/route-templates" });

  await screen.findByRole("button", { name: "新建模板" });
  await user.click(screen.getByRole("button", { name: "新建模板" }));
  await user.type(screen.getByRole("textbox", { name: "模板名称" }), "Alpha");
  await user.click(screen.getByRole("checkbox", { name: items[0].routeName }));
  await user.click(screen.getByRole("button", { name: "保存模板" }));

  expect(await screen.findByText("Alpha")).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "模板名称" })).not.toBeInTheDocument();
  expect(templateList).toHaveBeenCalledTimes(1);
  expect(Array.from(document.querySelectorAll(".route-template-list__summary strong"), (element) => element.textContent)).toEqual([
    "默认模板",
    "Alpha",
    "Zulu",
  ]);

  await user.click(screen.getByRole("button", { name: "编辑 Alpha" }));
  const nameInput = screen.getByRole("textbox", { name: "模板名称" });
  await user.clear(nameInput);
  await user.type(nameInput, "Beta");
  await user.click(screen.getByRole("button", { name: "保存模板" }));

  expect(await screen.findByText("Beta")).toBeVisible();
  expect(screen.queryByRole("textbox", { name: "模板名称" })).not.toBeInTheDocument();
  expect(templateList).toHaveBeenCalledTimes(1);
  templateList.mockRestore();
  view.unmount();
});

test("removes a confirmed template from local state without a second template list read", async () => {
  const user = userEvent.setup();
  let template!: InspectionRouteTemplate;
  const { database } = await prepareRouteTemplateDatabase(async (testDatabase, items) => {
    template = await createCustomTemplate(testDatabase, items, { name: "待删除模板" });
  });
  const originalList = RouteTemplateRepository.prototype.list;
  const templateList = vi.spyOn(RouteTemplateRepository.prototype, "list").mockImplementation(function (this: RouteTemplateRepository) {
    return originalList.call(this);
  });
  templateList.mockImplementationOnce(function (this: RouteTemplateRepository) {
    return originalList.call(this);
  }).mockRejectedValueOnce(new Error("后续列表读取失败"));
  const view = renderWithRouter({ database, initialPath: "/inspections/route-templates" });

  const removeButton = await screen.findByRole("button", { name: "删除 待删除模板" });
  await user.click(removeButton);
  await user.click(screen.getByRole("button", { name: "确认删除" }));

  await waitFor(async () => expect(await new RouteTemplateRepository(database).get(template.id)).toBeUndefined());
  expect(screen.queryByRole("dialog", { name: "确认删除模板" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "删除 待删除模板" })).not.toBeInTheDocument();
  expect(templateList).toHaveBeenCalledTimes(1);
  templateList.mockRestore();
  view.unmount();
});

test("keeps the deletion dialog open after direct removal rejection so it can be retried", async () => {
  const user = userEvent.setup();
  let template!: InspectionRouteTemplate;
  const { database, view } = await renderRouteTemplatePage(async (testDatabase, items) => {
    template = await createCustomTemplate(testDatabase, items, { name: "删除失败模板" });
  });
  const originalRemove = RouteTemplateRepository.prototype.remove;
  const remove = vi.spyOn(RouteTemplateRepository.prototype, "remove")
    .mockRejectedValueOnce(new Error("删除失败"))
    .mockImplementation(function (this: RouteTemplateRepository, id: string) {
      return originalRemove.call(this, id);
    });

  await user.click(await screen.findByRole("button", { name: "删除 删除失败模板" }));
  await user.click(screen.getByRole("button", { name: "确认删除" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("删除失败");
  expect(screen.getByRole("dialog", { name: "确认删除模板" })).toBeVisible();
  expect(screen.getByRole("button", { name: "确认删除" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(async () => expect(await new RouteTemplateRepository(database).get(template.id)).toBeUndefined());
  expect(screen.queryByRole("dialog", { name: "确认删除模板" })).not.toBeInTheDocument();
  remove.mockRestore();
  view.unmount();
});
