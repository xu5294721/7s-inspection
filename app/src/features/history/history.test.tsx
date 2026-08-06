import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { createAppDependencies } from "../../app/dependencies";
import { createTestDb } from "../../db/database";
import { InspectionRepository } from "../../db/inspectionRepository";
import { makeChecklistItem, makeInspection, makePhoto, makePhotoGroup } from "../../test/fixtures";
import { renderWithRouter } from "../../test/renderWithRouter";

async function saveInspectionWithEvidence(database: ReturnType<typeof createTestDb>) {
  await database.checklistItems.put(makeChecklistItem());
  const inspection = makeInspection({
    id: "history-1",
    title: "焊机间7S巡检通报",
    inspectionDate: "2026-07-28",
    entries: [{
      ...makeInspection().entries[0],
      id: "history-entry-1",
      inspectionId: "history-1",
      checkSelections: [
        { category: "environment", value: "\u5e72\u51c0\u6574\u6d01", isCustom: false },
      ],
      groupIds: ["history-group-1"],
    }],
  });
  const group = makePhotoGroup({
    id: "history-group-1",
    inspectionId: "history-1",
    entryId: "history-entry-1",
    description: "设备保养良好",
    awardAssessment: { type: "reward", people: "张三", amount: 50 },
    photoIds: ["history-photo-1"],
  });
  const photo = makePhoto(undefined, {
    id: "history-photo-1",
    inspectionId: "history-1",
    groupId: "history-group-1",
  });
  await new InspectionRepository(database).saveGraph({ inspection, groups: [group], photos: [photo] });
}

async function addReminderAndAssessment(database: ReturnType<typeof createTestDb>) {
  const repository = new InspectionRepository(database);
  const graph = await repository.getGraph("history-1");
  if (!graph) throw new Error("history graph missing");
  const reminder = makePhotoGroup({ id: "history-reminder", inspectionId: "history-1", entryId: "history-entry-1", category: "reminder", photoIds: ["history-reminder-photo"], order: 1 });
  const assessment = makePhotoGroup({ id: "history-assessment", inspectionId: "history-1", entryId: "history-entry-1", category: "assessment", awardAssessment: { type: "assessment", people: "李四", amount: 70 }, photoIds: ["history-assessment-photo"], order: 2 });
  await repository.saveGraph({
    inspection: { ...graph.inspection, entries: graph.inspection.entries.map((entry) => ({ ...entry, groupIds: [...entry.groupIds, reminder.id, assessment.id] })) },
    groups: [...graph.groups, reminder, assessment],
    photos: [...graph.photos,
      makePhoto(undefined, { id: "history-reminder-photo", inspectionId: "history-1", groupId: reminder.id }),
      makePhoto(undefined, { id: "history-assessment-photo", inspectionId: "history-1", groupId: assessment.id }),
    ],
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("filters history and soft deletes a matching inspection into trash", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`history-filter-${Date.now()}`);
  await saveInspectionWithEvidence(database);
  const dependencies = createAppDependencies(database, { now: () => new Date("2026-07-29T08:00:00") });
  const view = renderWithRouter({ database, initialPath: "/history", appProps: { dependencies } });

  expect(await screen.findByText("焊机间7S巡检通报")).toBeVisible();
  expect(screen.getByText("好的方面 1")).toBeVisible();
  await user.type(screen.getByRole("searchbox", { name: "按路线或区域筛选" }), "焊机间");
  await user.type(screen.getByRole("textbox", { name: "按人员筛选" }), "张三");
  await user.click(screen.getByRole("button", { name: "删除 焊机间7S巡检通报" }));

  await waitFor(async () => expect((await database.inspections.get("history-1"))?.deletedAt).not.toBeNull());
  await waitFor(() => expect(screen.queryByText("焊机间7S巡检通报")).not.toBeInTheDocument());
  view.unmount();
});

test("copy creates a separate draft with snapshots but no evidence or awards", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`history-copy-${Date.now()}`);
  await saveInspectionWithEvidence(database);
  const dependencies = createAppDependencies(database, {
    createInspectionId: () => "history-copy-2",
    now: () => new Date("2026-07-29T08:00:00"),
  });
  const view = renderWithRouter({ database, initialPath: "/history", appProps: { dependencies } });

  await user.click(await screen.findByRole("button", { name: "复制为新巡检 焊机间7S巡检通报" }));
  await waitFor(async () => expect(await database.inspections.count()).toBe(2));
  const copied = await new InspectionRepository(database).getGraph("history-copy-2");

  expect(copied?.inspection).toMatchObject({
    id: "history-copy-2",
    inspectionDate: "2026-07-29",
    status: "draft",
    templateId: "template-default",
  });
  expect(copied?.inspection.entries).toHaveLength(1);
  expect(copied?.inspection.entries[0].itemSnapshot).toEqual(
    (await new InspectionRepository(database).getGraph("history-1"))?.inspection.entries[0].itemSnapshot,
  );
  expect(copied?.inspection.entries[0].checkSelections).toEqual([]);
  expect(copied?.groups).toEqual([]);
  expect(copied?.photos).toEqual([]);
  view.unmount();
});

test("copy excludes temporary entries and leaves the copied database backup-valid", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`history-copy-temporary-${Date.now()}`);
  await saveInspectionWithEvidence(database);
  const repository = new InspectionRepository(database);
  await repository.addTemporaryEntry(
    "history-1",
    "本次临时配电间",
    "temporary-entry-00000000-0000-4000-8000-000000000301",
    "temporary-item-00000000-0000-4000-8000-000000000301",
  );
  const dependencies = createAppDependencies(database, {
    createInspectionId: () => "history-copy-without-temporary",
    now: () => new Date("2026-07-30T08:00:00"),
  });
  const view = renderWithRouter({ database, initialPath: "/history", appProps: { dependencies } });

  await user.click(await screen.findByRole("button", { name: "复制为新巡检 焊机间7S巡检通报" }));
  await waitFor(async () => expect(await database.inspections.count()).toBe(2));
  const copied = await repository.getGraph("history-copy-without-temporary");

  expect(copied?.inspection.entries).toHaveLength(1);
  expect(copied?.inspection.entries.some((entry) =>
    entry.id.startsWith("temporary-entry-") || entry.itemId.startsWith("temporary-item-")))
    .toBe(false);
  await expect(dependencies.backupRepository.createBackup()).resolves.toBeInstanceOf(Blob);
  view.unmount();
});

test("prevents duplicate copy and soft-delete submissions while persistence is pending", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`history-pending-${Date.now()}`);
  await saveInspectionWithEvidence(database);
  const copyDependencies = createAppDependencies(database, { createInspectionId: () => "pending-copy" });
  const copyPending = deferred<void>();
  const originalSaveGraph = InspectionRepository.prototype.saveGraph;
  const saveGraph = vi.spyOn(InspectionRepository.prototype, "saveGraph").mockImplementationOnce(async function (this: InspectionRepository, graph) {
    await copyPending.promise;
    return originalSaveGraph.call(this, graph);
  });
  const copyView = renderWithRouter({ database, initialPath: "/history", appProps: { dependencies: copyDependencies } });

  const copy = await screen.findByRole("button", { name: "复制为新巡检 焊机间7S巡检通报" });
  await user.click(copy);
  expect(copy).toBeDisabled();
  await user.click(copy);
  expect(saveGraph).toHaveBeenCalledTimes(1);
  copyPending.resolve();
  await waitFor(async () => expect(await database.inspections.count()).toBe(2));
  saveGraph.mockRestore();
  copyView.unmount();

  const deletePending = deferred<void>();
  const originalMoveToTrash = InspectionRepository.prototype.moveToTrash;
  const moveToTrash = vi.spyOn(InspectionRepository.prototype, "moveToTrash").mockImplementationOnce(async function (this: InspectionRepository, id, deletedAt) {
    await deletePending.promise;
    return originalMoveToTrash.call(this, id, deletedAt);
  });
  const deleteView = renderWithRouter({ database, initialPath: "/history" });
  const remove = await screen.findByRole("button", { name: "删除 焊机间7S巡检通报" });
  await user.click(remove);
  expect(remove).toBeDisabled();
  await user.click(remove);
  expect(moveToTrash).toHaveBeenCalledTimes(1);
  deletePending.resolve();
  await waitFor(async () => expect((await database.inspections.get("history-1"))?.deletedAt).not.toBeNull());
  moveToTrash.mockRestore();
  deleteView.unmount();
});

test("requires a modal confirmation naming the report before permanent purge", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`history-purge-${Date.now()}`);
  await saveInspectionWithEvidence(database);
  await new InspectionRepository(database).moveToTrash("history-1", "2026-07-29T09:00:00.000Z");
  const view = renderWithRouter({ database, initialPath: "/history/trash" });

  await user.click(await screen.findByRole("button", { name: "彻底删除 焊机间7S巡检通报" }));
  const dialog = await screen.findByRole("dialog", { name: "确认彻底删除" });
  expect(dialog).toHaveTextContent("焊机间7S巡检通报");
  expect(dialog).toHaveTextContent("照片无法恢复");
  expect(await database.inspections.get("history-1")).toBeDefined();
  await user.click(screen.getByRole("button", { name: "确认彻底删除" }));
  await waitFor(async () => expect(await database.inspections.get("history-1")).toBeUndefined());
  expect(await database.entries.where("inspectionId").equals("history-1").count()).toBe(0);
  expect(await database.photoGroups.where("inspectionId").equals("history-1").count()).toBe(0);
  expect(await database.photos.where("inspectionId").equals("history-1").count()).toBe(0);
  view.unmount();
});

test("filters by date and category, exposes summary/status, and routes open/regenerate actions", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`history-complete-${Date.now()}`);
  await saveInspectionWithEvidence(database);
  await addReminderAndAssessment(database);
  const originalCreateObjectUrl = URL.createObjectURL;
  const originalRevokeObjectUrl = URL.revokeObjectURL;
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, value: vi.fn(() => "blob:history-photo") },
    revokeObjectURL: { configurable: true, value: vi.fn() },
  });
  const view = renderWithRouter({ database, initialPath: "/history" });

  await screen.findByText("焊机间7S巡检通报");
  expect(screen.getByText(/2026-07-28.*草稿/)).toBeVisible();
  expect(screen.getByText("奖励 50元")).toBeVisible();
  expect(screen.getByText("考核 70元")).toBeVisible();
  await user.type(screen.getByLabelText("巡检日期"), "2026-07-27");
  expect(screen.queryByText("焊机间7S巡检通报")).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText("巡检日期"));
  await user.selectOptions(screen.getByRole("combobox", { name: "按类别筛选" }), "assessment");
  expect(screen.getByText("焊机间7S巡检通报")).toBeVisible();
  await user.click(screen.getByRole("link", { name: "继续巡检 焊机间7S巡检通报" }));
  expect(window.location.hash).toBe("#/inspections/history-1");
  view.unmount();
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, value: originalCreateObjectUrl },
    revokeObjectURL: { configurable: true, value: originalRevokeObjectUrl },
  });
});

test("puts a saved draft in the resume section with a clear continuation action", async () => {
  const database = createTestDb(`history-resume-draft-${Date.now()}`);
  await saveInspectionWithEvidence(database);
  renderWithRouter({ database, initialPath: "/history" });

  const resumeSection = await screen.findByRole("region", { name: "待继续巡检" });
  expect(resumeSection).toHaveTextContent("草稿，已自动保存");
  expect(within(resumeSection).getByRole("link", {
    name: "继续巡检 焊机间7S巡检通报",
  })).toHaveAttribute("href", "#/inspections/history-1");
  expect(screen.queryByRole("link", { name: "打开 焊机间7S巡检通报" })).not.toBeInTheDocument();
});

test("restores trash and keeps purge dialog keyboard-safe through cancel, escape, failure, and retry", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`trash-a11y-${Date.now()}`);
  await saveInspectionWithEvidence(database);
  const repository = new InspectionRepository(database);
  await repository.moveToTrash("history-1", "2026-07-29T09:00:00.000Z");
  const view = renderWithRouter({ database, initialPath: "/history/trash" });

  const restore = await screen.findByRole("button", { name: "恢复 焊机间7S巡检通报" });
  await user.click(restore);
  await waitFor(async () => expect((await database.inspections.get("history-1"))?.deletedAt).toBeNull());
  await repository.moveToTrash("history-1", "2026-07-29T09:00:00.000Z");
  view.unmount();
  const trashView = renderWithRouter({ database, initialPath: "/history/trash" });
  const opener = await screen.findByRole("button", { name: "彻底删除 焊机间7S巡检通报" });
  await user.click(opener);
  const cancel = await screen.findByRole("button", { name: "取消" });
  const confirm = screen.getByRole("button", { name: "确认彻底删除" });
  expect(cancel).toHaveFocus();
  await user.tab({ shift: true });
  expect(confirm).toHaveFocus();
  await user.tab();
  expect(cancel).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  expect(await database.inspections.get("history-1")).toBeDefined();

  await user.click(opener);
  const pending = deferred<void>();
  const failingPurge = vi.spyOn(InspectionRepository.prototype, "purgeInspection")
    .mockImplementationOnce(() => pending.promise);
  const retryConfirm = screen.getByRole("button", { name: "确认彻底删除" });
  const busyDialog = screen.getByRole("dialog", { name: "确认彻底删除" });
  await user.click(retryConfirm);
  expect(retryConfirm).toBeDisabled();
  expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  await user.tab();
  expect(document.activeElement instanceof HTMLElement && busyDialog.contains(document.activeElement)).toBe(true);
  await user.tab({ shift: true });
  expect(document.activeElement instanceof HTMLElement && busyDialog.contains(document.activeElement)).toBe(true);
  await user.click(retryConfirm);
  expect(failingPurge).toHaveBeenCalledTimes(1);
  pending.reject(new Error("删除失败"));
  expect(await screen.findByRole("alert")).toHaveTextContent("删除失败");
  const recoveredCancel = screen.getByRole("button", { name: "取消" });
  expect(recoveredCancel).toBeEnabled();
  expect(recoveredCancel).toHaveFocus();
  expect(screen.getByRole("button", { name: "确认彻底删除" })).toBeEnabled();
  failingPurge.mockRestore();
  await user.click(screen.getByRole("button", { name: "确认彻底删除" }));
  await waitFor(async () => expect(await database.inspections.get("history-1")).toBeUndefined());
  trashView.unmount();
});
