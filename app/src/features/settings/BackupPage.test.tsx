import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import { createAppDependencies } from "../../app/dependencies";
import { createBackup, type RestoreResult } from "../../db/backupRepository";
import { createTestDb, type InspectionRecord } from "../../db/database";
import { InspectionRepository } from "../../db/inspectionRepository";
import {
  makeChecklistItem,
  makeInspection,
  makePhoto,
  makePhotoGroup,
  makeTemplate,
} from "../../test/fixtures";
import { renderWithRouter } from "../../test/renderWithRouter";

const originalStorage = navigator.storage;
const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "storage", { configurable: true, value: originalStorage });
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, value: originalCreateObjectUrl },
    revokeObjectURL: { configurable: true, value: originalRevokeObjectUrl },
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function installDownloadSpies() {
  let filename = "";
  const createObjectURL = vi.fn(() => "blob:backup-download");
  const revokeObjectURL = vi.fn();
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, value: createObjectURL },
    revokeObjectURL: { configurable: true, value: revokeObjectURL },
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    filename = this.download;
  });
  return { createObjectURL, revokeObjectURL, click, filename: () => filename };
}

async function sourceBackup(): Promise<Blob> {
  const source = createTestDb(`backup-ui-source-${Date.now()}-${Math.random()}`);
  await source.checklistItems.put(makeChecklistItem());
  await source.routeTemplates.put({
    id: "route-template-backup",
    name: "默认模板",
    itemIds: ["item-1"],
    isDefault: true,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
  });
  await source.templates.put(makeTemplate());
  await new InspectionRepository(source).saveGraph({
    inspection: makeInspection({ entries: [] }),
    groups: [],
    photos: [],
    template: makeTemplate(),
  });
  await source.settings.put({ key: "restored-setting", value: "yes", updatedAt: "2026-07-29T00:00:00.000Z" });
  return createBackup(source);
}

test("links backup management from Settings and routes to the full-width page", async () => {
  const user = userEvent.setup();
  const view = renderWithRouter({ initialPath: "/settings" });

  await user.click(await screen.findByRole("link", { name: "备份与存储" }));

  expect(await screen.findByRole("heading", { name: "备份与存储" })).toBeVisible();
  expect(view.container.querySelector(".backup-page.card")).not.toBeInTheDocument();
});

test("inspects a restore file before mutation and requires an explicit replace warning confirmation", async () => {
  const user = userEvent.setup();
  const backup = await sourceBackup();
  const target = createTestDb(`backup-ui-target-${Date.now()}`);
  await target.settings.put({ key: "sentinel", value: "keep", updatedAt: "2026-07-29T00:00:00.000Z" });
  renderWithRouter({ database: target, initialPath: "/settings/backup" });
  const file = new File([await backup.arrayBuffer()], "backup.zip", { type: "application/zip" });

  await user.upload(await screen.findByLabelText("选择备份文件"), file);

  const preview = await screen.findByRole("region", { name: "恢复预览" });
  expect(within(preview).getByText("巡检记录").closest("li")).toHaveTextContent(/巡检记录\s*1 条/);
  expect(within(preview).getByText("路线模板").closest("li")).toHaveTextContent(/路线模板\s*1 条/);
  expect(within(preview).getByText("合并预计新增 1 个路线模板，跳过 0 个路线模板。")).toBeVisible();
  expect(await target.settings.get("sentinel")).toBeDefined();
  expect(await target.inspections.count()).toBe(0);

  await user.click(within(preview).getByRole("button", { name: "替换恢复" }));
  const dialog = await screen.findByRole("dialog", { name: "确认替换当前数据" });
  expect(dialog).toHaveTextContent("当前本地数据将被备份中的数据全部替换");
  expect(await target.settings.get("sentinel")).toBeDefined();

  await user.click(within(dialog).getByRole("button", { name: "确认替换" }));
  await waitFor(async () => expect(await target.inspections.count()).toBe(1));
  expect(screen.getByText("已导入 1 个路线模板，跳过 0 个路线模板。")).toBeVisible();
  expect(await target.settings.get("sentinel")).toBeUndefined();
  expect((await target.settings.get("restored-setting"))?.value).toBe("yes");
});

test("keeps replace confirmation keyboard-safe through cancel, Escape, busy failure, and retry", async () => {
  const user = userEvent.setup();
  const backup = await sourceBackup();
  const target = createTestDb(`backup-modal-target-${Date.now()}`);
  await target.settings.put({ key: "sentinel", value: "keep", updatedAt: "2026-07-29T00:00:00.000Z" });
  const dependencies = createAppDependencies(target);
  renderWithRouter({ database: target, initialPath: "/settings/backup", appProps: { dependencies } });
  const file = new File([await backup.arrayBuffer()], "backup.zip", { type: "application/zip" });
  await user.upload(await screen.findByLabelText("选择备份文件"), file);
  const preview = await screen.findByRole("region", { name: "恢复预览" });
  const opener = within(preview).getByRole("button", { name: "替换恢复" });

  await user.click(opener);
  let cancel = await screen.findByRole("button", { name: "取消" });
  let confirm = screen.getByRole("button", { name: "确认替换" });
  expect(cancel).toHaveFocus();
  await user.tab({ shift: true });
  expect(confirm).toHaveFocus();
  await user.tab();
  expect(cancel).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  expect(await target.settings.get("sentinel")).toBeDefined();

  await user.click(opener);
  cancel = await screen.findByRole("button", { name: "取消" });
  await user.click(cancel);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  expect(await target.inspections.count()).toBe(0);

  const pending = deferred<RestoreResult>();
  const realRestore = dependencies.backupRepository.restoreBackup.bind(dependencies.backupRepository);
  const restore = vi.spyOn(dependencies.backupRepository, "restoreBackup")
    .mockImplementationOnce(() => pending.promise)
    .mockImplementationOnce(realRestore);
  await user.click(opener);
  confirm = await screen.findByRole("button", { name: "确认替换" });
  await user.click(confirm);
  const busyDialog = screen.getByRole("dialog", { name: "确认替换当前数据" });
  expect(busyDialog).toHaveAttribute("aria-busy", "true");
  expect(confirm).toBeDisabled();
  expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog", { name: "确认替换当前数据" })).toBeVisible();
  await user.tab();
  expect(busyDialog.contains(document.activeElement)).toBe(true);
  await user.click(confirm);
  expect(restore).toHaveBeenCalledTimes(1);
  expect(await target.settings.get("sentinel")).toBeDefined();

  pending.reject(new Error("模拟恢复失败"));
  expect(await screen.findByRole("alert")).toHaveTextContent("模拟恢复失败");
  cancel = screen.getByRole("button", { name: "取消" });
  expect(cancel).toBeEnabled();
  expect(cancel).toHaveFocus();
  expect(screen.getByRole("button", { name: "确认替换" })).toBeEnabled();
  const restoreOpenerFocus = opener.focus.bind(opener);
  vi.spyOn(opener, "focus").mockImplementation(() => {
    setTimeout(restoreOpenerFocus, 0);
  });
  await user.click(screen.getByRole("button", { name: "确认替换" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(opener).toHaveFocus());
  expect(await target.inspections.count()).toBe(1);
  expect(await target.settings.get("sentinel")).toBeUndefined();
  expect(restore).toHaveBeenCalledTimes(2);
});

test("confirms and completes merge restore without replacing local settings", async () => {
  const user = userEvent.setup();
  const backup = await sourceBackup();
  const target = createTestDb(`backup-merge-ui-target-${Date.now()}`);
  await target.settings.put({ key: "sentinel", value: "keep", updatedAt: "2026-07-29T00:00:00.000Z" });
  renderWithRouter({ database: target, initialPath: "/settings/backup" });
  await user.upload(
    await screen.findByLabelText("选择备份文件"),
    new File([await backup.arrayBuffer()], "backup.zip", { type: "application/zip" }),
  );

  await user.click(await screen.findByRole("button", { name: "合并恢复" }));
  const dialog = await screen.findByRole("dialog", { name: "确认合并备份" });
  expect(within(dialog).getByRole("button", { name: "取消" })).toHaveFocus();
  await user.click(within(dialog).getByRole("button", { name: "确认合并" }));

  expect(await screen.findByText("备份数据已完成合并。")).toBeVisible();
  expect(screen.getByText("已导入 1 个路线模板，跳过 0 个路线模板。")).toBeVisible();
  expect((await target.settings.get("sentinel"))?.value).toBe("keep");
  expect((await target.settings.get("restored-setting"))?.value).toBe("yes");
  expect(await target.inspections.count()).toBe(1);
});

test("clears the restore input so the same file can be retried after inspection failure", async () => {
  const user = userEvent.setup();
  const backup = await sourceBackup();
  const target = createTestDb(`backup-same-file-target-${Date.now()}`);
  const dependencies = createAppDependencies(target);
  const inspect = vi.spyOn(dependencies.backupRepository, "inspectBackup")
    .mockRejectedValueOnce(new Error("模拟读取失败"));
  renderWithRouter({ database: target, initialPath: "/settings/backup", appProps: { dependencies } });
  const input = await screen.findByLabelText("选择备份文件");
  const file = new File([await backup.arrayBuffer()], "same-backup.zip", { type: "application/zip" });

  await user.upload(input, file);
  expect(await screen.findByRole("alert")).toHaveTextContent("模拟读取失败");
  expect(input).toHaveValue("");
  await user.upload(input, file);

  expect(await screen.findByRole("region", { name: "恢复预览" })).toBeVisible();
  expect(inspect).toHaveBeenCalledTimes(2);
});

test("disables repeated export while pending and downloads a clearly named ZIP", async () => {
  const user = userEvent.setup();
  const target = createTestDb(`backup-export-ui-${Date.now()}`);
  const dependencies = createAppDependencies(target, { now: () => new Date("2026-07-29T08:09:10") });
  const pending = deferred<Blob>();
  const create = vi.spyOn(dependencies.backupRepository, "createBackup").mockImplementation(() => pending.promise);
  const download = installDownloadSpies();
  renderWithRouter({ database: target, initialPath: "/settings/backup", appProps: { dependencies } });
  const exportButton = await screen.findByRole("button", { name: "导出ZIP备份" });

  await user.click(exportButton);
  expect(screen.getByRole("button", { name: "正在生成..." })).toBeDisabled();
  expect(screen.getByLabelText("选择备份文件")).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "正在生成..." }));
  expect(create).toHaveBeenCalledTimes(1);
  pending.resolve(new Blob(["zip"], { type: "application/zip" }));

  await waitFor(() => expect(download.createObjectURL).toHaveBeenCalledOnce());
  expect(download.click).toHaveBeenCalledOnce();
  expect(download.filename()).toBe("7S巡检备份-20260729-080910.zip");
  expect(screen.getByRole("button", { name: "导出ZIP备份" })).toBeEnabled();
});

test("keeps export failure retryable and never downloads an invalid local snapshot", async () => {
  const user = userEvent.setup();
  const target = createTestDb(`backup-export-retry-${Date.now()}`);
  const dependencies = createAppDependencies(target);
  const create = vi.spyOn(dependencies.backupRepository, "createBackup")
    .mockRejectedValueOnce(new Error("模拟导出失败"))
    .mockResolvedValueOnce(new Blob(["zip"], { type: "application/zip" }));
  const download = installDownloadSpies();
  renderWithRouter({ database: target, initialPath: "/settings/backup", appProps: { dependencies } });

  await user.click(await screen.findByRole("button", { name: "导出ZIP备份" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("模拟导出失败");
  expect(download.createObjectURL).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "导出ZIP备份" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "导出ZIP备份" }));
  await waitFor(() => expect(download.createObjectURL).toHaveBeenCalledOnce());
  expect(create).toHaveBeenCalledTimes(2);
});

test("does not call browser download when the real local graph is invalid", async () => {
  const user = userEvent.setup();
  const target = createTestDb(`backup-export-invalid-local-${Date.now()}`);
  await target.checklistItems.put(makeChecklistItem());
  await target.templates.put(makeTemplate());
  await new InspectionRepository(target).saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup()],
    photos: [makePhoto()],
    template: makeTemplate(),
  });
  await target.entries.update("entry-1", { inspectionId: "missing-inspection" });
  const download = installDownloadSpies();
  renderWithRouter({ database: target, initialPath: "/settings/backup" });

  await user.click(await screen.findByRole("button", { name: "导出ZIP备份" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(/巡检条目.*巡检记录/);
  expect(download.createObjectURL).not.toHaveBeenCalled();
  expect(download.click).not.toHaveBeenCalled();
});

test("requests persistent storage only after the explicit button and shows the result", async () => {
  const persist = vi.fn().mockResolvedValue(true);
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: {
      persist,
      estimate: vi.fn().mockResolvedValue({ usage: 20, quota: 100 }),
    },
  });
  const user = userEvent.setup();
  renderWithRouter({ initialPath: "/settings/backup" });

  await screen.findByRole("button", { name: "申请持久存储" });
  expect(persist).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "申请持久存储" }));

  expect(await screen.findByText("持久存储已授权")).toBeVisible();
  expect(persist).toHaveBeenCalledOnce();
});

test.each([
  ["denied", vi.fn().mockResolvedValue(false), "持久存储申请未获授权"],
  ["thrown", vi.fn().mockRejectedValue(new Error("permission failed")), "持久存储申请未获授权"],
] as const)("shows %s persistent-storage result", async (_case, persist, expected) => {
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: { persist, estimate: vi.fn().mockResolvedValue({ usage: 20, quota: 100 }) },
  });
  const user = userEvent.setup();
  renderWithRouter({ initialPath: "/settings/backup" });

  await user.click(await screen.findByRole("button", { name: "申请持久存储" }));

  expect(await screen.findByText(expected)).toBeVisible();
  expect(persist).toHaveBeenCalledOnce();
});

test("shows unsupported persistence without making a request", async () => {
  const estimate = vi.fn().mockResolvedValue({ usage: 20, quota: 100 });
  Object.defineProperty(navigator, "storage", { configurable: true, value: { estimate } });
  renderWithRouter({ initialPath: "/settings/backup" });

  expect(await screen.findByText("当前浏览器不支持持久存储申请")).toBeVisible();
  expect(screen.getByRole("button", { name: "申请持久存储" })).toBeDisabled();
  expect(estimate).toHaveBeenCalled();
});

test("shows used, quota, available and a warning at exactly 80 percent", async () => {
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: {
      persist: vi.fn(),
      estimate: vi.fn().mockResolvedValue({ usage: 80, quota: 100 }),
    },
  });
  renderWithRouter({ initialPath: "/settings/backup" });

  const storage = await screen.findByRole("region", { name: "存储空间" });
  await waitFor(() => expect(storage).toHaveTextContent("已使用"));
  expect(storage).toHaveTextContent("总容量");
  expect(storage).toHaveTextContent("可用");
  expect(storage).toHaveTextContent("80.0%");
  expect(within(storage).getByRole("alert")).toHaveTextContent("空间使用率已达到80%");
});

test.each([
  ["thrown", vi.fn().mockRejectedValue(new Error("estimate failed"))],
  ["incomplete", vi.fn().mockResolvedValue({ usage: 80 })],
] as const)("fails open when storage estimate is %s", async (_case, estimate) => {
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: { persist: vi.fn(), estimate },
  });
  renderWithRouter({ initialPath: "/settings/backup" });

  const storage = await screen.findByRole("region", { name: "存储空间" });
  expect(await within(storage).findByText("浏览器未提供完整的存储用量信息。")).toBeVisible();
  expect(within(storage).queryByRole("alert")).not.toBeInTheDocument();
});

test("shows the exact critical copy at 95 percent", async () => {
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: {
      persist: vi.fn(),
      estimate: vi.fn().mockResolvedValue({ usage: 95, quota: 100 }),
    },
  });
  renderWithRouter({ initialPath: "/settings/backup" });

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "空间使用率已达到95%，新照片已暂停保存。请先备份或删除数据。",
  );
});

function generatedRecord(id: string): InspectionRecord {
  const { entries: _entries, ...record } = makeInspection({ id, entries: [], status: "generated" });
  return record;
}

test("shows each new four-generated backup milestone and dismissal does not hide the next one", async () => {
  const database = createTestDb(`backup-reminder-${Date.now()}`);
  await database.inspections.bulkAdd(Array.from({ length: 4 }, (_, index) => generatedRecord(`generated-${index}`)));
  const dependencies = createAppDependencies(database);
  const user = userEvent.setup();
  const first = renderWithRouter({ database, appProps: { dependencies } });

  const reminder = await screen.findByRole("region", { name: "备份提醒" });
  expect(reminder).toHaveTextContent("已生成4份巡检通报");
  expect(within(reminder).getByRole("link", { name: "立即备份" })).toHaveAttribute("href", "#/settings/backup");
  await user.click(within(reminder).getByRole("button", { name: "暂时关闭备份提醒" }));
  await waitFor(() => expect(screen.queryByRole("region", { name: "备份提醒" })).not.toBeInTheDocument());
  first.unmount();

  await database.inspections.bulkAdd(Array.from({ length: 3 }, (_, index) => generatedRecord(`generated-${index + 4}`)));
  const seven = renderWithRouter({ database, appProps: { dependencies } });
  await screen.findByRole("heading", { name: "首页" });
  expect(screen.queryByRole("region", { name: "备份提醒" })).not.toBeInTheDocument();
  seven.unmount();

  await database.inspections.add(generatedRecord("generated-7"));
  renderWithRouter({ database, appProps: { dependencies } });
  expect(await screen.findByRole("region", { name: "备份提醒" })).toHaveTextContent("已生成8份巡检通报");
});
