import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { createTestDb } from "../../db/database";
import { InspectionRepository } from "../../db/inspectionRepository";
import { makeInspection, makePhoto, makePhotoGroup } from "../../test/fixtures";
import { renderWithRouter } from "../../test/renderWithRouter";

const globalCss = readFileSync(resolve("src/styles/global.css"), "utf8");
const EIGHTY_PHOTO_IMPORT_COMPLETION_TIMEOUT_MS = 30_000;
const EIGHTY_PHOTO_IMPORT_TEST_TIMEOUT_MS = 35_000;

const { mockProcessImage, mockSaveCapturedPhotoToGallery } = vi.hoisted(() => ({
  mockProcessImage: vi.fn(),
  mockSaveCapturedPhotoToGallery: vi.fn(),
}));

vi.mock("../../lib/images/compressImage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/images/compressImage")>()),
  processImage: mockProcessImage,
}));

vi.mock("../../platform/nativeFile", () => ({
  saveCapturedPhotoToGallery: mockSaveCapturedPhotoToGallery,
}));

function processed(label: string) {
  return {
    imageBlob: new Blob([`image-${label}`], { type: "image/jpeg" }),
    thumbnailBlob: new Blob([`thumb-${label}`], { type: "image/jpeg" }),
    width: 1200,
    height: 900,
    highQuality: false,
  };
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

function inspectionFor(id: string, part: string) {
  const base = makeInspection();
  return {
    ...base,
    id,
    title: `${id} 7S巡检通报`,
    entries: [{
      ...base.entries[0],
      id: `${id}-entry-1`,
      inspectionId: id,
      groupIds: [],
      itemSnapshot: { ...base.entries[0].itemSnapshot, part },
    }],
  };
}

async function expandInspectionEntry(
  user: ReturnType<typeof userEvent.setup>,
  routeName: string,
) {
  const opener = await screen.findByRole("button", { name: new RegExp(routeName) });
  await user.click(opener);
  return screen.findByRole("dialog", { name: new RegExp(`检查项：${routeName}`) });
}

beforeEach(() => {
  mockProcessImage.mockReset();
  mockSaveCapturedPhotoToGallery.mockReset();
  mockSaveCapturedPhotoToGallery.mockResolvedValue(undefined);
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((blob: Blob) => `blob:${blob.size}`),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

test("copies a newly captured photo to the Android gallery after saving the inspection record", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`photo-camera-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const inspection = makeInspection({
    entries: [{ ...makeInspection().entries[0], groupIds: [] }],
  });
  await repository.saveGraph({ inspection, groups: [], photos: [] });
  mockProcessImage.mockResolvedValueOnce(processed("camera"));
  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });

  const entry = await expandInspectionEntry(user, inspection.entries[0].itemSnapshot.routeName);
  const file = new File(["camera"], "camera.jpg", { type: "image/jpeg" });
  await user.upload(within(entry).getByLabelText("拍照文件"), file);

  await waitFor(async () => {
    expect((await repository.getGraph("inspection-1"))?.photos).toHaveLength(1);
  });
  expect(mockSaveCapturedPhotoToGallery).toHaveBeenCalledWith(file);
});

test("does not duplicate a photo selected from the gallery", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`photo-gallery-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const inspection = makeInspection({
    entries: [{ ...makeInspection().entries[0], groupIds: [] }],
  });
  await repository.saveGraph({ inspection, groups: [], photos: [] });
  mockProcessImage.mockResolvedValueOnce(processed("gallery"));
  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });

  const entry = await expandInspectionEntry(user, inspection.entries[0].itemSnapshot.routeName);
  const file = new File(["gallery"], "gallery.jpg", { type: "image/jpeg" });
  await user.upload(within(entry).getByLabelText("相册文件"), file);

  await waitFor(async () => {
    expect((await repository.getGraph("inspection-1"))?.photos).toHaveLength(1);
  });
  expect(mockSaveCapturedPhotoToGallery).not.toHaveBeenCalled();
});

test("saves files sequentially, keeps successes, and retries the failed file", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`photo-import-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const inspection = makeInspection({
    entries: [{ ...makeInspection().entries[0], groupIds: [] }],
  });
  await repository.saveGraph({ inspection, groups: [], photos: [] });
  mockProcessImage
    .mockResolvedValueOnce(processed("first"))
    .mockRejectedValueOnce(new Error("处理失败"))
    .mockResolvedValueOnce(processed("third"));
  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });

  const entry = await expandInspectionEntry(user, inspection.entries[0].itemSnapshot.routeName);
  const files = [
    new File(["first"], "first.jpg", { type: "image/jpeg" }),
    new File(["bad"], "bad.jpg", { type: "image/jpeg" }),
    new File(["third"], "third.jpg", { type: "image/jpeg" }),
  ];
  await user.upload(within(entry).getByLabelText("相册文件"), files);

  expect(await screen.findByText("已处理 3/3")).toBeVisible();
  expect(screen.getByText(/bad\.jpg/)).toBeVisible();
  expect(screen.getByRole("button", { name: "重试 bad.jpg" })).toBeVisible();
  let stored = await repository.getGraph("inspection-1");
  expect(stored?.photos).toHaveLength(2);
  expect(stored?.groups[0]).toMatchObject({
    category: "good",
    description: inspection.entries[0].itemSnapshot.goodText,
  });
  expect(mockProcessImage.mock.calls.map(([file]) => file.name)).toEqual([
    "first.jpg",
    "bad.jpg",
    "third.jpg",
  ]);

  mockProcessImage.mockResolvedValueOnce(processed("retried"));
  await user.click(screen.getByRole("button", { name: "重试 bad.jpg" }));

  await waitFor(async () => {
    stored = await repository.getGraph("inspection-1");
    expect(stored?.photos).toHaveLength(3);
  });
  expect(screen.getByText("已处理 1/1")).toBeVisible();
  expect(screen.queryByRole("button", { name: "重试 bad.jpg" })).not.toBeInTheDocument();
});

test("imports 80 photos with one graph read and incremental local updates", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`photo-import-80-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const inspection = inspectionFor("inspection-80", "油缸");
  await repository.saveGraph({ inspection, groups: [], photos: [] });
  const getGraph = vi.spyOn(InspectionRepository.prototype, "getGraph");
  mockProcessImage.mockImplementation(async (file: File) => processed(file.name));
  renderWithRouter({ database, initialPath: "/inspections/inspection-80" });

  const entry = await expandInspectionEntry(user, inspection.entries[0].itemSnapshot.routeName);
  const files = Array.from({ length: 80 }, (_, index) =>
    new File([`photo-${index}`], `photo-${index}.jpg`, { type: "image/jpeg" }));
  await user.upload(within(entry).getByLabelText("相册文件"), files);

  expect(await screen.findByText("已处理 80/80", {}, {
    timeout: EIGHTY_PHOTO_IMPORT_COMPLETION_TIMEOUT_MS,
  })).toBeVisible();
  expect(getGraph).toHaveBeenCalledTimes(1);
  expect(await database.photos.count()).toBe(80);
  expect(within(entry).getByLabelText("照片80张")).toBeVisible();
}, EIGHTY_PHOTO_IMPORT_TEST_TIMEOUT_MS);

test("aborts an in-flight import on unmount and does not persist its result", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`photo-unmount-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const inspection = inspectionFor("inspection-unmount", "油缸");
  await repository.saveGraph({ inspection, groups: [], photos: [] });
  const pending = deferred<ReturnType<typeof processed>>();
  let signal: AbortSignal | undefined;
  mockProcessImage.mockImplementation((_file, options) => {
    signal = options.signal;
    return pending.promise;
  });
  const view = renderWithRouter({ database, initialPath: "/inspections/inspection-unmount" });

  const entry = await expandInspectionEntry(user, inspection.entries[0].itemSnapshot.routeName);
  await user.upload(
    within(entry).getByLabelText("相册文件"),
    new File(["photo"], "pending.jpg", { type: "image/jpeg" }),
  );
  await waitFor(() => expect(mockProcessImage).toHaveBeenCalledOnce());
  view.unmount();

  expect(signal?.aborted).toBe(true);
  pending.resolve(processed("pending"));
  await waitFor(async () => expect(await database.photos.count()).toBe(0));
});

test("switching inspection aborts old work and clears its retry queue", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`photo-switch-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const first = inspectionFor("inspection-first", "油缸");
  const second = inspectionFor("inspection-second", "控制柜");
  await repository.saveGraph({ inspection: first, groups: [], photos: [] });
  await repository.saveGraph({ inspection: second, groups: [], photos: [] });
  const pending = deferred<ReturnType<typeof processed>>();
  let signal: AbortSignal | undefined;
  mockProcessImage
    .mockRejectedValueOnce(new Error("处理失败"))
    .mockImplementationOnce((_file, options) => {
      signal = options.signal;
      return pending.promise;
    });
  renderWithRouter({ database, initialPath: "/inspections/inspection-first" });

  const entry = await expandInspectionEntry(user, first.entries[0].itemSnapshot.routeName);
  await user.upload(within(entry).getByLabelText("相册文件"), [
    new File(["bad"], "old-bad.jpg", { type: "image/jpeg" }),
    new File(["pending"], "old-pending.jpg", { type: "image/jpeg" }),
  ]);
  expect(await screen.findByRole("button", { name: "重试 old-bad.jpg" })).toBeVisible();

  await act(async () => {
    window.location.hash = "#/inspections/inspection-second";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(await screen.findByRole("heading", { name: "inspection-second 7S巡检通报", level: 2 })).toBeVisible();
  expect(signal?.aborted).toBe(true);
  expect(screen.queryByRole("button", { name: "重试 old-bad.jpg" })).not.toBeInTheDocument();
  pending.resolve(processed("old-pending"));
  await waitFor(async () => expect(await database.photos.count()).toBe(0));
});

test("replaces, keeps a high-quality source, and deletes a photo through the component", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`photo-actions-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const inspection = inspectionFor("inspection-actions", "油缸");
  await repository.saveGraph({ inspection, groups: [], photos: [] });
  mockProcessImage
    .mockResolvedValueOnce(processed("initial"))
    .mockImplementationOnce(async (_file, options) => ({
      ...processed("high-quality"),
      highQuality: options.highQuality,
    }))
    .mockResolvedValueOnce({ ...processed("replacement"), width: 900, height: 1200 });
  renderWithRouter({ database, initialPath: "/inspections/inspection-actions" });

  const entry = await expandInspectionEntry(user, inspection.entries[0].itemSnapshot.routeName);
  await user.upload(
    within(entry).getByLabelText("相册文件"),
    new File(["initial"], "initial.jpg", { type: "image/jpeg" }),
  );
  await screen.findByAltText("巡检照片缩略图");
  const originalId = (await database.photos.toArray())[0].id;
  const highQualityLabel = within(entry).getByText("高清保留").closest("label");
  if (!highQualityLabel) throw new Error("high quality label not found");
  expect(globalCss).toMatch(/\.photo-item__actions label\s*\{[^}]*min-height:\s*44px/s);
  await user.click(within(highQualityLabel).getByRole("checkbox"));
  await waitFor(async () => expect((await database.photos.get(originalId))?.highQuality).toBe(true));

  await user.upload(
    within(entry).getByLabelText("替换照片 1"),
    new File(["replacement"], "replacement.jpg", { type: "image/jpeg" }),
  );
  await waitFor(async () => expect((await database.photos.get(originalId))?.width).toBe(900));
  expect(await database.photos.count()).toBe(1);

  await user.click(within(entry).getByRole("button", { name: "删除照片 1" }));
  await waitFor(async () => expect(await database.photos.count()).toBe(0));
  expect(within(entry).getByLabelText("照片0张")).toBeVisible();
});

test("reorders the local group after deleting its first photo so the next photo can be replaced", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`photo-delete-reorder-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const inspection = inspectionFor("inspection-delete-reorder", "油缸");
  await repository.saveGraph({ inspection, groups: [], photos: [] });
  mockProcessImage
    .mockResolvedValueOnce(processed("first"))
    .mockResolvedValueOnce(processed("second"))
    .mockResolvedValueOnce(processed("third"))
    .mockResolvedValueOnce({ ...processed("replacement"), width: 777 });
  renderWithRouter({ database, initialPath: "/inspections/inspection-delete-reorder" });

  const entry = await expandInspectionEntry(user, inspection.entries[0].itemSnapshot.routeName);
  await user.upload(within(entry).getByLabelText("相册文件"), [
    new File(["first"], "first.jpg", { type: "image/jpeg" }),
    new File(["second"], "second.jpg", { type: "image/jpeg" }),
    new File(["third"], "third.jpg", { type: "image/jpeg" }),
  ]);
  await waitFor(async () => expect(await database.photos.count()).toBe(3));
  const [, secondPhoto] = (await database.photos.toArray()).sort((left, right) => left.order - right.order);

  await user.click(within(entry).getByRole("button", { name: "删除照片 1" }));
  await waitFor(async () => {
    expect((await database.photos.toArray())
      .sort((left, right) => left.order - right.order)
      .map((photo) => photo.order)).toEqual([0, 1]);
  });

  await user.upload(
    within(entry).getByLabelText("替换照片 1"),
    new File(["replacement"], "replacement.jpg", { type: "image/jpeg" }),
  );
  await waitFor(async () => expect((await database.photos.get(secondPhoto.id))?.width).toBe(777));
});

test("shows a delete error and re-enables controls when persistence fails", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`photo-delete-error-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup()],
    photos: [makePhoto()],
  });
  vi.spyOn(InspectionRepository.prototype, "deletePhoto").mockRejectedValueOnce(
    new Error("删除保存失败"),
  );
  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });

  await expandInspectionEntry(user, "焊机间");
  await user.click(await screen.findByRole("button", { name: "删除照片 1" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("删除保存失败");
  expect(screen.getByRole("button", { name: "删除照片 1" })).toBeEnabled();
});

test("blocks each new photo at exactly 95 percent and keeps the selected file retryable", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`photo-storage-guard-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const inspection = inspectionFor("inspection-storage", "油缸");
  await repository.saveGraph({ inspection, groups: [], photos: [] });
  let usage = 95;
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: {
      persist: vi.fn(),
      estimate: vi.fn(async () => ({ usage, quota: 100 })),
    },
  });
  mockProcessImage.mockImplementation(async (file: File) => processed(file.name));
  renderWithRouter({ database, initialPath: "/inspections/inspection-storage" });

  const entry = await expandInspectionEntry(user, inspection.entries[0].itemSnapshot.routeName);
  await user.upload(
    within(entry).getByLabelText("相册文件"),
    new File(["critical"], "critical.jpg", { type: "image/jpeg" }),
  );

  expect(await screen.findByRole("button", { name: "重试 critical.jpg" })).toBeVisible();
  expect(screen.getByText(/请先备份或删除数据/)).toBeVisible();
  expect(await database.photos.count()).toBe(0);
  expect(await database.inspections.get("inspection-storage")).toBeDefined();

  usage = 94;
  await user.click(screen.getByRole("button", { name: "重试 critical.jpg" }));
  await waitFor(async () => expect(await database.photos.count()).toBe(1));
  expect(screen.queryByRole("button", { name: "重试 critical.jpg" })).not.toBeInTheDocument();
});
