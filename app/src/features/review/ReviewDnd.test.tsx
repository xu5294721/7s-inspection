import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { createAppDependencies } from "../../app/dependencies";
import { createTestDb } from "../../db/database";
import { InspectionRepository } from "../../db/inspectionRepository";
import { makeInspection, makePhoto, makePhotoGroup } from "../../test/fixtures";
import { renderWithRouter } from "../../test/renderWithRouter";

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:review") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

function rect(top: number, left = 0): DOMRect {
  return { x: left, y: top, top, left, right: left + 120, bottom: top + 80, width: 120, height: 80, toJSON: () => ({}) } as DOMRect;
}

function drag(handle: HTMLElement, target: HTMLElement, from: DOMRect, to: DOMRect) {
  vi.spyOn(handle.closest(".review-photo") ?? handle.closest("article") ?? handle, "getBoundingClientRect").mockReturnValue(from);
  vi.spyOn(target, "getBoundingClientRect").mockReturnValue(to);
  const shared = { pointerId: 1, pointerType: "mouse", isPrimary: true };
  fireEvent.pointerDown(handle, { ...shared, clientX: from.left + 10, clientY: from.top + 10, button: 0 });
  fireEvent.pointerMove(document.body, { ...shared, clientX: from.left + 24, clientY: from.top + 24 });
  fireEvent.pointerMove(document.body, { ...shared, clientX: to.left + 10, clientY: to.top + 10 });
  fireEvent.pointerUp(document.body, { ...shared, clientX: to.left + 10, clientY: to.top + 10 });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("same-category group and photo DnD persist consecutive order after reload", async () => {
  const database = createTestDb(`review-dnd-order-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const inspection = makeInspection({ entries: [{ ...makeInspection().entries[0], groupIds: ["group-1", "group-2"] }] });
  await repository.saveGraph({
    inspection,
    groups: [
      makePhotoGroup({ photoIds: ["photo-1", "photo-2"] }),
      makePhotoGroup({ id: "group-2", photoIds: ["photo-3"], order: 1 }),
    ],
    photos: [
      makePhoto(),
      makePhoto(undefined, { id: "photo-2", order: 1 }),
      makePhoto(undefined, { id: "photo-3", groupId: "group-2" }),
    ],
  });
  const view = renderWithRouter({ database, initialPath: "/inspections/inspection-1/review" });
  const firstGroupHandle = await screen.findByRole("button", { name: "拖动照片组 group-1" });
  drag(firstGroupHandle, screen.getByTestId("review-group-group-2"), rect(100), rect(300));
  await waitFor(async () => expect((await repository.getGraph("inspection-1"))?.groups.map((group) => group.id)).toEqual(["group-2", "group-1"]));

  const firstPhotoHandle = screen.getByRole("button", { name: "拖动照片 photo-1" });
  const secondPhoto = screen.getByRole("img", { name: "巡检照片 photo-2" }).closest<HTMLElement>(".review-photo")!;
  drag(firstPhotoHandle, secondPhoto, rect(500), rect(650));
  await waitFor(async () => expect((await repository.getGraph("inspection-1"))?.groups.find((group) => group.id === "group-1")?.photoIds).toEqual(["photo-2", "photo-1"]));

  view.unmount();
  renderWithRouter({ database, initialPath: "/inspections/inspection-1/review" });
  await screen.findByTestId("review-group-group-2");
  const restored = await repository.getGraph("inspection-1");
  expect(restored?.groups.map((group) => group.order)).toEqual([0, 1]);
  expect(restored?.inspection.entries[0].groupIds).toEqual(["group-2", "group-1"]);
  expect(restored?.photos.filter((photo) => photo.groupId === "group-1").map((photo) => [photo.id, photo.order])).toEqual([["photo-2", 0], ["photo-1", 1]]);
});

test("cross-category group DnD cleans incompatible fields and persists after reload", async () => {
  const database = createTestDb(`review-dnd-category-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup({ awardAssessment: { type: "reward", people: "甲", amount: 30 } })],
    photos: [makePhoto()],
  });
  const view = renderWithRouter({ database, initialPath: "/inspections/inspection-1/review" });
  const handle = await screen.findByRole("button", { name: "拖动照片组 group-1" });
  const assessmentTab = screen.getByRole("tab", { name: "考核问题 0张" });
  drag(handle, assessmentTab, rect(200), rect(20, 260));

  await waitFor(async () => expect((await repository.getGraph("inspection-1"))?.groups[0]).toMatchObject({ category: "assessment", awardAssessment: null }));
  view.unmount();
  renderWithRouter({ database, initialPath: "/inspections/inspection-1/review" });
  await screen.findByRole("tab", { name: "考核问题 1张" });
  const restored = await repository.getGraph("inspection-1");
  expect(restored?.groups[0].description).toBe(restored?.inspection.entries[0].itemSnapshot.assessmentText);
  expect(restored?.groups[0].order).toBe(0);
  expect(restored?.inspection.entries[0].groupIds).toEqual(["group-1"]);
});

test("cross-category group DnD to general uses the independent general description", async () => {
  const database = createTestDb(`review-dnd-general-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const inspection = makeInspection({
    entries: [{
      ...makeInspection().entries[0],
      itemSnapshot: {
        ...makeInspection().entries[0].itemSnapshot,
        generalText: "油缸已基本清洁，后续继续提升定置标准。",
      },
    }],
  });
  await repository.saveGraph({
    inspection,
    groups: [makePhotoGroup({ awardAssessment: { type: "reward", people: "张三", amount: 30 } })],
    photos: [makePhoto()],
  });
  const view = renderWithRouter({ database, initialPath: "/inspections/inspection-1/review" });
  const handle = await screen.findByRole("button", { name: "拖动照片组 group-1" });
  drag(handle, screen.getByRole("tab", { name: "一般表现 0张" }), rect(200), rect(20, 160));

  await waitFor(async () => expect((await repository.getGraph("inspection-1"))?.groups[0]).toMatchObject({
    category: "general",
    description: "油缸已基本清洁，后续继续提升定置标准。",
    awardAssessment: null,
  }));
  view.unmount();
  renderWithRouter({ database, initialPath: "/inspections/inspection-1/review" });
  await screen.findByRole("tab", { name: "一般表现 1张" });
  expect((await repository.getGraph("inspection-1"))?.groups[0].description).toBe(
    "油缸已基本清洁，后续继续提升定置标准。",
  );
});

test("failed group DnD stops a queued assessment save, rolls back, and blocks completion", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-dnd-failure-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const inspection = makeInspection({
    entries: [{
      ...makeInspection().entries[0],
      groupIds: ["group-1", "group-2", "group-3"],
    }],
  });
  await repository.saveGraph({
    inspection,
    groups: [
      makePhotoGroup(),
      makePhotoGroup({ id: "group-2", photoIds: ["photo-2"], order: 1 }),
      makePhotoGroup({
        id: "group-3",
        category: "assessment",
        description: inspection.entries[0].itemSnapshot.assessmentText,
        awardAssessment: null,
        photoIds: ["photo-3"],
        order: 2,
      }),
    ],
    photos: [
      makePhoto(),
      makePhoto(undefined, { id: "photo-2", groupId: "group-2" }),
      makePhoto(undefined, { id: "photo-3", groupId: "group-3" }),
    ],
  });
  const dependencies = createAppDependencies(database);
  const reorderGate = deferred<void>();
  vi.spyOn(dependencies.inspectionRepository, "reorderGroups")
    .mockImplementationOnce(() => reorderGate.promise);
  const assessmentSave = vi.spyOn(dependencies.inspectionRepository, "updatePhotoGroup");
  const atomicReview = vi.spyOn(dependencies.inspectionRepository, "markReviewedIfReady");
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });

  const firstHandle = await screen.findByRole("button", { name: "拖动照片组 group-1" });
  drag(firstHandle, screen.getByTestId("review-group-group-2"), rect(100), rect(300));
  await waitFor(() => expect(dependencies.inspectionRepository.reorderGroups).toHaveBeenCalledTimes(1));
  await user.click(screen.getByRole("tab", { name: "考核问题 1张" }));
  await user.type(screen.getByRole("textbox", { name: "考核人员" }), "张三");
  await user.type(screen.getByRole("spinbutton", { name: "考核金额" }), "50");
  expect(screen.getByRole("button", { name: "生成Word" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "生成Word" }));
  expect(assessmentSave).not.toHaveBeenCalled();

  reorderGate.reject(new Error("排序保存失败"));
  expect(await screen.findByRole("alert")).toHaveTextContent("排序保存失败");
  await waitFor(() => expect(screen.getByRole("button", { name: "生成Word" })).toBeDisabled());

  expect(assessmentSave).not.toHaveBeenCalled();
  expect(atomicReview).not.toHaveBeenCalled();
  const restored = await repository.getGraph("inspection-1");
  expect(restored?.groups.map((group) => [group.id, group.order])).toEqual([
    ["group-1", 0],
    ["group-2", 1],
    ["group-3", 2],
  ]);
  expect(restored?.inspection.entries[0].groupIds).toEqual(["group-1", "group-2", "group-3"]);
  expect(restored?.groups[2].awardAssessment).toBeNull();
  expect(restored?.inspection.status).toBe("draft");
});

test("title DnD persists route order and refreshes the review title order", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-route-dnd-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const base = makeInspection();
  const weldingEntry = {
    ...base.entries[0],
    id: "entry-welding",
    itemId: "item-welding",
    order: 0,
    groupIds: ["group-welding"],
    itemSnapshot: { ...base.entries[0].itemSnapshot, id: "item-welding", routeName: "焊机间", part: "焊机间" },
  };
  const warehouseEntry = {
    ...base.entries[0],
    id: "entry-warehouse",
    itemId: "item-warehouse",
    order: 1,
    groupIds: ["group-warehouse"],
    itemSnapshot: { ...base.entries[0].itemSnapshot, id: "item-warehouse", routeName: "仓库外围院子", part: "仓库外围院子" },
  };
  await repository.saveGraph({
    inspection: { ...base, entries: [weldingEntry, warehouseEntry] },
    groups: [
      makePhotoGroup({ id: "group-welding", entryId: weldingEntry.id, photoIds: ["photo-welding"] }),
      makePhotoGroup({ id: "group-warehouse", entryId: warehouseEntry.id, photoIds: ["photo-warehouse"], order: 1 }),
    ],
    photos: [
      makePhoto(undefined, { id: "photo-welding", groupId: "group-welding" }),
      makePhoto(undefined, { id: "photo-warehouse", groupId: "group-warehouse" }),
    ],
  });
  const dependencies = createAppDependencies(database);
  const updateOrder = vi.spyOn(dependencies.inspectionRepository, "updateReviewRouteOrderByCategory");
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });

  await user.click(await screen.findByRole("button", { name: "排序" }));
  await user.click(screen.getByRole("button", { name: "保存排序" }));

  await waitFor(() => expect(updateOrder).toHaveBeenCalledWith("inspection-1", {
    good: ["焊机间", "仓库外围院子"],
    general: [],
    reminder: [],
    assessment: [],
  }));
  await waitFor(() => expect(screen.getAllByRole("button", { name: /编辑 / }).map((button) => button.getAttribute("aria-label"))).toEqual([
    "编辑 焊机间",
    "编辑 仓库外围院子",
  ]));
});
