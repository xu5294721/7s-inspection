import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { createTestDb } from "../../db/database";
import { ItemRepository } from "../../db/itemRepository";
import { InspectionRepository } from "../../db/inspectionRepository";
import { makeChecklistItem, makeInspection, makePhoto, makePhotoGroup } from "../../test/fixtures";
import { renderWithRouter } from "../../test/renderWithRouter";

afterEach(() => {
  vi.restoreAllMocks();
});

test("initializes the stable route catalog even when the item library has user-created items", async () => {
  const emptyDatabase = createTestDb(`seed-empty-${Date.now()}`);
  const firstView = renderWithRouter({ database: emptyDatabase });

  await screen.findByText("开始巡检");
  expect(await emptyDatabase.checklistItems.count()).toBe(39);
  firstView.unmount();

  const existingDatabase = createTestDb(`seed-existing-${Date.now()}`);
  const items = new ItemRepository(existingDatabase);
  await items.put(makeChecklistItem({ id: "user-item", routeName: "用户路线" }));
  renderWithRouter({ database: existingDatabase });

  await screen.findByText("开始巡检");
  expect(await existingDatabase.checklistItems.count()).toBe(40);
  expect(await items.get("user-item")).toMatchObject({ routeName: "用户路线" });
});

test("starts with the default template selected", async () => {
  const view = renderWithRouter({ initialPath: "/inspections/new" });

  await screen.findByRole("checkbox", { name: "一线焊机" });
  expect(screen.getByRole("button", { name: "开始检查" })).toBeEnabled();
  view.unmount();
});

test("creates a draft from selected routes without requiring every item", async () => {
  const user = userEvent.setup();
  const view = renderWithRouter({ initialPath: "/inspections/new" });

  await screen.findByRole("button", { name: "全不选" });
  await user.click(screen.getByRole("button", { name: "全不选" }));
  await user.click(await screen.findByRole("checkbox", { name: "一线焊机" }));
  await user.click(screen.getByRole("button", { name: "开始检查" }));

  expect(await screen.findByRole("heading", { name: /7S巡检通报/ })).toBeVisible();
  expect(screen.getByRole("button", { name: /一线焊机未完成/ })).toBeVisible();
  expect(screen.queryByText("二线焊机")).not.toBeInTheDocument();
  expect(await view.database.inspections.count()).toBe(1);
  const [stored] = await view.database.inspections.toArray();
  const graph = await new InspectionRepository(view.database).getGraph(stored.id);
  const today = new Date();
  expect(graph?.inspection.title).toBe(
    `向塘钢轨焊接整修车间${today.getMonth() + 1}月${today.getDate()}日7S巡检通报`,
  );
  expect(graph?.inspection.entries).toHaveLength(1);
  expect(graph?.inspection.entries.every((entry) => entry.itemSnapshot.routeName === "一线焊机"))
    .toBe(true);
  expect(graph?.groups).toEqual([]);
  expect(graph?.photos).toEqual([]);
});

test("opens one inspection item in a bottom sheet and closes it after completion", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`inspection-route-accordion-${Date.now()}`);
  const inspection = makeInspection();
  const firstEntry = {
    ...inspection.entries[0],
    groupIds: ["group-1"],
    checkSelections: [],
  };
  const secondEntry = {
    ...firstEntry,
    id: "entry-2",
    itemId: "item-2",
    groupIds: [],
    order: 1,
    itemSnapshot: {
      ...firstEntry.itemSnapshot,
      id: "item-2",
      routeName: "探伤间",
      area: "探伤间",
      part: "探伤设备",
    },
  };
  const group = makePhotoGroup({ entryId: firstEntry.id });
  const photo = makePhoto(undefined, { groupId: group.id });
  await new InspectionRepository(database).saveGraph({
    inspection: { ...inspection, entries: [firstEntry, secondEntry] },
    groups: [group],
    photos: [photo],
  });
  const view = renderWithRouter({ database, initialPath: "/inspections/inspection-1" });

  const firstSummary = await screen.findByRole("button", { name: /焊机间/ });
  expect(firstSummary).toHaveAttribute("data-complete", "true");
  expect(screen.queryByRole("button", { name: "检查内容：请选择检查内容" })).not.toBeInTheDocument();

  await user.click(firstSummary);
  const firstSheet = screen.getByRole("dialog", { name: "检查项：焊机间" });
  expect(within(firstSheet).getByRole("button", { name: "检查内容：请选择检查内容" })).toBeVisible();
  expect(within(firstSheet).getByRole("button", { name: "关闭项点卡片" })).toHaveFocus();
  await user.tab({ shift: true });
  expect(within(firstSheet).getByRole("button", { name: "完成本项" })).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "检查项：焊机间" })).not.toBeInTheDocument();
  expect(firstSummary).toHaveFocus();

  await user.click(firstSummary);
  const reopenedSheet = screen.getByRole("dialog", { name: "检查项：焊机间" });

  await user.click(within(reopenedSheet).getByRole("button", { name: "完成本项" }));
  expect(screen.queryByRole("dialog", { name: "检查项：焊机间" })).not.toBeInTheDocument();
  expect(firstSummary).toHaveFocus();
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "检查项：探伤间" })).not.toBeInTheDocument());
  view.unmount();
});

test("classifying an item without a photo marks it complete and survives reload", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`photo-free-evaluation-${Date.now()}`);
  const base = makeInspection();
  const inspection = {
    ...base,
    entries: base.entries.map((entry) => ({ ...entry, groupIds: [], checkSelections: [] })),
  };
  const repository = new InspectionRepository(database);
  await repository.saveGraph({ inspection, groups: [], photos: [] });

  const firstView = renderWithRouter({ database, initialPath: "/inspections/inspection-1" });
  const summary = await screen.findByRole("button", { name: /焊机间/ });
  expect(summary).toHaveAttribute("data-complete", "false");

  await user.click(summary);
  const sheet = screen.getByRole("dialog", { name: "检查项：焊机间" });
  await user.click(within(sheet).getByRole("radio", { name: "一般表现" }));

  await waitFor(async () => {
    expect((await repository.getGraph("inspection-1"))?.groups).toMatchObject([
      { category: "general", photoIds: [] },
    ]);
  });
  expect(summary).toHaveAttribute("data-complete", "true");
  expect(summary).toHaveTextContent("已完成");

  firstView.unmount();
  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });
  const reloadedSummary = await screen.findByRole("button", { name: /焊机间/ });
  expect(reloadedSummary).toHaveAttribute("data-complete", "true");
  await user.click(reloadedSummary);
  expect(await screen.findByRole("radio", { name: "一般表现" })).toBeChecked();
});

test("restores selected draft entries after a hash-route reload", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`reload-${Date.now()}`);
  const firstView = renderWithRouter({ database, initialPath: "/inspections/new" });

  await screen.findByRole("button", { name: "全不选" });
  await user.click(screen.getByRole("button", { name: "全不选" }));
  await user.click(await screen.findByRole("checkbox", { name: "一线焊机" }));
  await user.click(screen.getByRole("button", { name: "开始检查" }));
  await screen.findByRole("button", { name: /一线焊机未完成/ });
  const inspectionId = window.location.hash.replace("#/inspections/", "");
  firstView.unmount();

  renderWithRouter({ database, initialPath: `/inspections/${inspectionId}` });
  expect(
    await screen.findByRole("button", { name: /一线焊机未完成/ }),
  ).toBeVisible();
});

test("filters inspection entries by route, area, device, part, and standard", async () => {
  const user = userEvent.setup();
  const view = renderWithRouter({ initialPath: "/inspections/new" });

  await screen.findByRole("button", { name: "全不选" });
  await user.click(screen.getByRole("button", { name: "全不选" }));
  await user.click(await screen.findByRole("checkbox", { name: "一线焊机" }));
  await user.click(screen.getByRole("button", { name: "开始检查" }));
  const search = await screen.findByRole("searchbox", { name: "搜索巡检项点" });
  await user.type(search, "不存在的内容");
  expect(screen.getByText("没有匹配的巡检项点。")).toBeVisible();
  await user.clear(search);
  await user.type(search, "一线焊机");
  expect(
    await screen.findByRole("button", { name: /一线焊机未完成/ }),
  ).toBeVisible();
  view.unmount();
});

test("persists check content, shows its summary immediately, restores it after reload, and searches it", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`check-content-persistence-${Date.now()}`);
  const inspection = makeInspection();
  await new InspectionRepository(database).saveGraph({
    inspection: { ...inspection, entries: inspection.entries.map((entry) => ({ ...entry, groupIds: [] })) },
    groups: [],
    photos: [],
  });
  const firstView = renderWithRouter({ database, initialPath: "/inspections/inspection-1" });

  await user.click(await screen.findByRole("button", { name: /焊机间/ }));
  await user.click(await screen.findByRole("button", { name: "检查内容：请选择检查内容" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "环境卫生" }), "干净整洁");
  await user.click(screen.getByRole("button", { name: "确认" }));

  const summary = "检查内容：环境卫生干净整洁";
  expect(await screen.findByRole("button", { name: summary })).toBeVisible();
  const goodEditor = await screen.findByTestId(/^photo-group-/);
  expect(within(goodEditor).getByRole("radio", { name: "好的方面" })).toBeChecked();
  const savedGraph = await new InspectionRepository(database).getGraph("inspection-1");
  expect(savedGraph?.inspection).toMatchObject({
    status: "draft",
    entries: [{
      checkSelections: [
        { category: "environment", value: "干净整洁", isCustom: false },
      ],
    }],
  });
  expect(savedGraph?.groups).toMatchObject([{ category: "good", photoIds: [] }]);
  expect(savedGraph?.inspection.entries[0]?.groupIds).toHaveLength(1);

  const search = screen.getByRole("searchbox", { name: "搜索巡检项点" });
  await user.type(search, "干净整洁");
  expect(screen.queryByText("没有匹配的巡检项点。")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: summary })).toBeVisible();
  firstView.unmount();

  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });
  await user.click(await screen.findByRole("button", { name: /焊机间/ }));
  expect(await screen.findByRole("button", { name: summary })).toBeVisible();
});

test.each([
  ["category name", "环境卫生"],
  ["full displayed summary", "环境卫生干净整洁"],
] as const)("searches persisted check content by %s after a route reload", async (_case, query) => {
  const user = userEvent.setup();
  const database = createTestDb(`check-content-search-${_case}-${Date.now()}`);
  const inspection = makeInspection();
  await new InspectionRepository(database).saveGraph({
    inspection: {
      ...inspection,
      entries: inspection.entries.map((entry) => ({
        ...entry,
        checkSelections: [
          { category: "environment", value: "干净整洁", isCustom: false },
        ],
        groupIds: [],
      })),
    },
    groups: [],
    photos: [],
  });
  const firstView = renderWithRouter({ database, initialPath: "/inspections/inspection-1" });
  const summary = "检查内容：环境卫生干净整洁";
  await screen.findByRole("searchbox", { name: "搜索巡检项点" });
  firstView.unmount();

  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });
  const search = await screen.findByRole("searchbox", { name: "搜索巡检项点" });
  await user.type(search, query);

  expect(screen.queryByText("没有匹配的巡检项点。")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /焊机间/ }));
  expect(screen.getByRole("button", { name: summary })).toBeVisible();
});

test("keeps the check-content draft open after repository rejection", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`check-content-rejection-${Date.now()}`);
  const inspection = makeInspection();
  await new InspectionRepository(database).saveGraph({
    inspection: { ...inspection, entries: inspection.entries.map((entry) => ({ ...entry, groupIds: [] })) },
    groups: [],
    photos: [],
  });
  const save = vi.spyOn(InspectionRepository.prototype, "updateEntryCheckSelections")
    .mockRejectedValueOnce(new Error("检查内容保存被拒绝"));
  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });

  await user.click(await screen.findByRole("button", { name: /焊机间/ }));
  await user.click(await screen.findByRole("button", { name: "检查内容：请选择检查内容" }));
  const environment = screen.getByRole("combobox", { name: "环境卫生" });
  await user.selectOptions(environment, "干净整洁");
  await user.click(screen.getByRole("button", { name: "确认" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("检查内容保存被拒绝");
  expect(environment).toHaveValue("干净整洁");
  expect(environment).toHaveFocus();
  save.mockRestore();
});

test("ignores a delayed check-content save after navigating to another inspection", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`check-content-stale-${Date.now()}`);
  const first = makeInspection();
  const second = makeInspection({
    id: "inspection-2",
    title: "第二份巡检",
    entries: [{
      ...makeInspection().entries[0],
      id: "entry-2",
      inspectionId: "inspection-2",
      checkSelections: [],
    }],
  });
  const repository = new InspectionRepository(database);
  await repository.saveGraph({
    inspection: { ...first, entries: first.entries.map((entry) => ({ ...entry, groupIds: [] })) },
    groups: [],
    photos: [],
  });
  await repository.saveGraph({
    inspection: { ...second, entries: second.entries.map((entry) => ({ ...entry, groupIds: [] })) },
    groups: [],
    photos: [],
  });
  let resolveSave!: (value: Awaited<ReturnType<InspectionRepository["updateEntryCheckSelections"]>>) => void;
  const pending = new Promise<Awaited<ReturnType<InspectionRepository["updateEntryCheckSelections"]>>>((resolve) => {
    resolveSave = resolve;
  });
  const save = vi.spyOn(InspectionRepository.prototype, "updateEntryCheckSelections")
    .mockReturnValueOnce(pending);
  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });

  await user.click(await screen.findByRole("button", { name: /焊机间/ }));
  await user.click(await screen.findByRole("button", { name: "检查内容：请选择检查内容" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "环境卫生" }), "干净整洁");
  await user.click(screen.getByRole("button", { name: "确认" }));
  window.location.hash = "#/inspections/inspection-2";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  resolveSave({
    entry: {
      ...first.entries[0],
      checkSelections: [{ category: "environment", value: "干净整洁", isCustom: false }],
    },
    updatedAt: "2026-07-30T10:00:00.000Z",
  });

  expect(await screen.findByRole("heading", { name: "第二份巡检", level: 2 })).toBeVisible();
  await user.click(screen.getByRole("button", { name: /焊机间/ }));
  expect(screen.getByRole("button", { name: "检查内容：请选择检查内容" })).toBeVisible();
  save.mockRestore();
});

test("adds a one-field temporary item, clears search, and restores it after reload", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`temporary-item-ui-${Date.now()}`);
  const inspection = makeInspection();
  await new InspectionRepository(database).saveGraph({
    inspection: {
      ...inspection,
      entries: inspection.entries.map((entry) => ({ ...entry, groupIds: [] })),
    },
    groups: [],
    photos: [],
  });
  const firstView = renderWithRouter({ database, initialPath: "/inspections/inspection-1" });

  const search = await screen.findByRole("searchbox", { name: "搜索巡检项点" });
  const itemCountBefore = await database.checklistItems.count();
  const templateCountBefore = await database.routeTemplates.count();
  await user.type(search, "没有匹配内容");
  await user.click(screen.getByRole("button", { name: "新增检查项" }));
  const dialog = screen.getByRole("dialog", { name: "新增本次检查项" });
  expect(within(dialog).getAllByRole("textbox")).toHaveLength(1);
  const nameInput = within(dialog).getByRole("textbox", { name: "检查项名称" });
  await user.type(nameInput, "  临时配电间  ");
  await user.click(within(dialog).getByRole("button", { name: "保存" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(search).toHaveValue("");
  const temporaryItem = await screen.findByRole("button", { name: /临时配电间未完成/ });
  expect(temporaryItem).toBeVisible();
  const stored = await new InspectionRepository(database).getGraph("inspection-1");
  expect(stored?.inspection.entries.at(-1)?.itemSnapshot.routeName).toBe("临时配电间");
  expect(await database.checklistItems.count()).toBe(itemCountBefore);
  expect(await database.routeTemplates.count()).toBe(templateCountBefore);
  firstView.unmount();

  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });
  expect(await screen.findByRole("button", { name: /临时配电间未完成/ })).toBeVisible();
});

test("keeps the temporary-item dialog and typed name after save rejection", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`temporary-item-error-${Date.now()}`);
  const inspection = makeInspection();
  await new InspectionRepository(database).saveGraph({
    inspection: {
      ...inspection,
      entries: inspection.entries.map((entry) => ({ ...entry, groupIds: [] })),
    },
    groups: [],
    photos: [],
  });
  const save = vi.spyOn(InspectionRepository.prototype, "addTemporaryEntry")
    .mockRejectedValueOnce(new Error("模拟保存失败"));
  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });

  await user.click(await screen.findByRole("button", { name: "新增检查项" }));
  const input = screen.getByRole("textbox", { name: "检查项名称" });
  await user.type(input, "临时配电间");
  await user.click(screen.getByRole("button", { name: "保存" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("模拟保存失败");
  expect(screen.getByRole("dialog", { name: "新增本次检查项" })).toBeVisible();
  expect(input).toHaveValue("临时配电间");
  expect(input).toHaveFocus();
  save.mockRestore();
});

test("ignores a delayed temporary-item save after navigating to another inspection", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`temporary-item-stale-${Date.now()}`);
  const first = makeInspection();
  await new InspectionRepository(database).saveGraph({
    inspection: {
      ...first,
      title: "第一份巡检",
      entries: first.entries.map((entry) => ({ ...entry, groupIds: [] })),
    },
    groups: [],
    photos: [],
  });
  const secondBase = makeInspection();
  await new InspectionRepository(database).saveGraph({
    inspection: {
      ...secondBase,
      id: "inspection-2",
      title: "第二份巡检",
      entries: secondBase.entries.map((entry) => ({
        ...entry,
        id: "entry-2",
        inspectionId: "inspection-2",
        groupIds: [],
      })),
    },
    groups: [],
    photos: [],
  });
  let resolveSave!: (value: Awaited<ReturnType<InspectionRepository["addTemporaryEntry"]>>) => void;
  const pending = new Promise<Awaited<ReturnType<InspectionRepository["addTemporaryEntry"]>>>((resolve) => {
    resolveSave = resolve;
  });
  const save = vi.spyOn(InspectionRepository.prototype, "addTemporaryEntry")
    .mockReturnValueOnce(pending);
  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });

  const search = await screen.findByRole("searchbox", { name: "搜索巡检项点" });
  await user.type(search, "应保留的搜索");
  await user.click(screen.getByRole("button", { name: "新增检查项" }));
  await user.type(screen.getByRole("textbox", { name: "检查项名称" }), "旧巡检临时项");
  await user.click(screen.getByRole("button", { name: "保存" }));

  window.location.hash = "#/inspections/inspection-2";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  resolveSave({
    entry: {
      id: "temporary-entry-00000000-0000-4000-8000-000000000202",
      inspectionId: "inspection-1",
      itemId: "temporary-item-00000000-0000-4000-8000-000000000202",
      itemSnapshot: {
        ...first.entries[0].itemSnapshot,
        id: "temporary-item-00000000-0000-4000-8000-000000000202",
        routeName: "旧巡检临时项",
      },
      checkSelections: [],
      groupIds: [],
      order: 1,
    },
    updatedAt: "2026-07-30T10:00:00.000Z",
  });

  expect(await screen.findByRole("heading", { name: "第二份巡检", level: 2 })).toBeVisible();
  expect(screen.getByRole("searchbox", { name: "搜索巡检项点" })).toHaveValue("应保留的搜索");
  expect(screen.queryByText("旧巡检临时项")).not.toBeInTheDocument();
  save.mockRestore();
});

test("prevents closing, reopening, and duplicate submission while a temporary item is saving", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`temporary-item-pending-${Date.now()}`);
  const inspection = makeInspection();
  await new InspectionRepository(database).saveGraph({
    inspection: {
      ...inspection,
      entries: inspection.entries.map((entry) => ({ ...entry, groupIds: [] })),
    },
    groups: [],
    photos: [],
  });
  let resolveSave!: (value: Awaited<ReturnType<InspectionRepository["addTemporaryEntry"]>>) => void;
  const pending = new Promise<Awaited<ReturnType<InspectionRepository["addTemporaryEntry"]>>>((resolve) => {
    resolveSave = resolve;
  });
  const save = vi.spyOn(InspectionRepository.prototype, "addTemporaryEntry")
    .mockReturnValueOnce(pending);
  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });

  const opener = await screen.findByRole("button", { name: "新增检查项" });
  await user.click(opener);
  await user.type(screen.getByRole("textbox", { name: "检查项名称" }), "临时配电间");
  const saveButton = screen.getByRole("button", { name: "保存" });
  await user.dblClick(saveButton);

  expect(save).toHaveBeenCalledTimes(1);
  expect(opener).toBeDisabled();
  expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  expect(screen.getByRole("textbox", { name: "检查项名称" })).toBeDisabled();
  expect(screen.getByRole("dialog", { name: "新增本次检查项" })).toHaveAttribute("aria-busy", "true");
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "新增本次检查项" })).toBeVisible();

  resolveSave({
    entry: {
      id: "temporary-entry-00000000-0000-4000-8000-000000000201",
      inspectionId: "inspection-1",
      itemId: "temporary-item-00000000-0000-4000-8000-000000000201",
      itemSnapshot: {
        ...inspection.entries[0].itemSnapshot,
        id: "temporary-item-00000000-0000-4000-8000-000000000201",
        routeName: "临时配电间",
        area: "临时配电间",
        part: "临时配电间",
      },
      checkSelections: [],
      groupIds: [],
      order: 1,
    },
    updatedAt: "2026-07-30T10:00:00.000Z",
  });
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  save.mockRestore();
});

test("finishes field checking and opens review directly from the inspection page", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`direct-review-${Date.now()}`);
  const inspection = makeInspection();
  await new InspectionRepository(database).saveGraph({
    inspection: {
      ...inspection,
      entries: inspection.entries.map((entry) => ({ ...entry, groupIds: [] })),
    },
    groups: [],
    photos: [],
  });
  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });

  await user.click(await screen.findByRole("button", { name: "完成检查，进入复核" }));

  expect(await screen.findByRole("heading", { name: "通报复核", level: 2 })).toBeVisible();
  expect(window.location.hash).toBe("#/inspections/inspection-1/review");
});
