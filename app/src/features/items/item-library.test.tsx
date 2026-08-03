import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ExcelJS from "exceljs";
import { vi } from "vitest";
import { createTestDb } from "../../db/database";
import { ItemRepository } from "../../db/itemRepository";
import { InspectionRepository } from "../../db/inspectionRepository";
import { createInspection } from "../../domain/inspection";
import { deriveChecklistItemId, EXCEL_HEADERS } from "./excelImport";
import { makeChecklistItem } from "../../test/fixtures";
import { renderWithRouter } from "../../test/renderWithRouter";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("edits and disables library items without changing an existing inspection snapshot", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`item-edit-${Date.now()}`);
  const repository = new ItemRepository(database);
  await repository.put(makeChecklistItem({ id: "item-edit", standard: "原检查标准" }));
  const view = renderWithRouter({ database, initialPath: "/items" });

  await user.click(await screen.findByRole("button", { name: "编辑 原检查标准" }));
  const standard = screen.getByRole("textbox", { name: "检查标准" });
  await user.clear(standard);
  await user.type(standard, "修订检查标准");
  await user.click(screen.getByRole("button", { name: "保存项点" }));
  await waitFor(async () => expect((await repository.get("item-edit"))?.standard).toBe("修订检查标准"));
  await user.click(screen.getByRole("button", { name: "停用 修订检查标准" }));
  await waitFor(async () => expect((await repository.get("item-edit"))?.enabled).toBe(false));
  view.unmount();
});

test("shows an Excel import preview before applying library mutations", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`item-import-${Date.now()}`);
  const existing = makeChecklistItem({ id: "unrelated-item", area: "保留区域" });
  await new ItemRepository(database).put(existing);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("导入模板");
  sheet.addRow(EXCEL_HEADERS);
  sheet.addRow([
    1, "导入路线", "导入区域", "", "导入部位", "导入标准", "导入工班", "清扫",
    "好的表述", "一般表现表述", "提醒表述", "考核表述", "短语", "是",
  ]);
  const file = new File([await workbook.xlsx.writeBuffer()], "items.xlsx", {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const view = renderWithRouter({ database, initialPath: "/items" });

  fireEvent.change(await screen.findByLabelText("导入Excel项点库"), { target: { files: [file] } });
  expect(await screen.findByRole("heading", { name: "导入预览" })).toBeVisible();
  expect(screen.getByText(/新增 1/)).toBeVisible();
  expect(await database.checklistItems.count()).toBe(40);
  const pending = deferred<void>();
  const originalBulkPut = ItemRepository.prototype.bulkPut;
  const bulkPut = vi.spyOn(ItemRepository.prototype, "bulkPut").mockImplementationOnce(async function (this: ItemRepository, items) {
    await pending.promise;
    return originalBulkPut.call(this, items);
  });
  const confirmImport = screen.getByRole("button", { name: "确认导入" });
  await user.click(confirmImport);
  expect(confirmImport).toBeDisabled();
  await user.click(confirmImport);
  expect(bulkPut).toHaveBeenCalledTimes(1);
  pending.resolve();
  await waitFor(async () => expect(await database.checklistItems.count()).toBe(41));
  expect(await database.checklistItems.get("unrelated-item")).toEqual(existing);
  bulkPut.mockRestore();
  view.unmount();
});

test("keeps a real historical snapshot unchanged after edit, disable, and confirmed import", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`item-snapshot-${Date.now()}`);
  const sourceItem = makeChecklistItem({ standard: "历史标准" });
  const item = {
    ...sourceItem,
    id: await deriveChecklistItemId(sourceItem),
  };
  const itemRepository = new ItemRepository(database);
  await itemRepository.put(item);
  const inspection = createInspection([item], "snapshot-inspection", "2026-07-28");
  await new InspectionRepository(database).saveGraph({ inspection, groups: [], photos: [] });
  const expectedSnapshot = inspection.entries[0].itemSnapshot;
  const view = renderWithRouter({ database, initialPath: "/items" });

  await user.click(await screen.findByRole("button", { name: "编辑 历史标准" }));
  const standard = screen.getByRole("textbox", { name: "检查标准" });
  await user.clear(standard);
  await user.type(standard, "编辑后标准");
  await user.click(screen.getByRole("button", { name: "保存项点" }));
  await user.click(await screen.findByRole("button", { name: "停用 编辑后标准" }));
  await waitFor(async () => expect((await itemRepository.get(item.id))?.enabled).toBe(false));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("导入模板");
  sheet.addRow(EXCEL_HEADERS);
  sheet.addRow([item.routeOrder, item.routeName, item.area, item.device, item.part, "导入后标准", item.team, item.sevenSCategory, item.goodText, item.generalText, item.reminderText, item.assessmentText, item.quickPhrases.join("|"), "是"]);
  const file = new File([await workbook.xlsx.writeBuffer()], "snapshot.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  fireEvent.change(screen.getByLabelText("导入Excel项点库"), { target: { files: [file] } });
  await screen.findByRole("heading", { name: "导入预览" });
  expect(screen.getByText(/新增 1/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "确认导入" }));
  const importedId = await deriveChecklistItemId({ ...item, standard: "导入后标准" });
  await waitFor(async () => expect((await itemRepository.get(importedId))?.standard).toBe("导入后标准"));
  expect(await itemRepository.get(item.id)).toMatchObject({
    standard: "编辑后标准",
    enabled: false,
  });
  expect((await new InspectionRepository(database).getGraph("snapshot-inspection"))?.inspection.entries[0].itemSnapshot).toEqual(expectedSnapshot);
  view.unmount();
});

test("shows a recoverable alert and re-enables disable after persistence fails", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`item-disable-failure-${Date.now()}`);
  await new ItemRepository(database).put(makeChecklistItem({ id: "disable-failure", standard: "停用失败标准" }));
  const pending = deferred<void>();
  const failure = vi.spyOn(ItemRepository.prototype, "disable").mockImplementationOnce(() => pending.promise);
  const view = renderWithRouter({ database, initialPath: "/items" });

  const button = await screen.findByRole("button", { name: "停用 停用失败标准" });
  await user.click(button);
  expect(button).toBeDisabled();
  pending.reject(new Error("停用保存失败"));
  expect(await screen.findByRole("alert")).toHaveTextContent("停用保存失败");
  expect(button).toBeEnabled();
  failure.mockRestore();
  view.unmount();
});
