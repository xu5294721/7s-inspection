import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { createTestDb } from "../../db/database";
import { InspectionRepository } from "../../db/inspectionRepository";
import { validateReportReadiness } from "../../domain/reportValidation";
import { makeInspection, makePhoto, makePhotoGroup } from "../../test/fixtures";
import { renderWithRouter } from "../../test/renderWithRouter";

async function expandInspectionRoute() {
  fireEvent.click(await screen.findByRole("button", { name: "焊机间" }));
}

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn((blob: Blob) => `blob:${blob.size}`),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

test("persists a group category change from the inspection page", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`group-category-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup()],
    photos: [makePhoto()],
  });
  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });
  await expandInspectionRoute();

  await user.click(await screen.findByRole("radio", { name: "提醒问题" }));

  await waitFor(async () => {
    expect((await repository.getGraph("inspection-1"))?.groups[0]).toMatchObject({
      category: "reminder",
      description: makeInspection().entries[0].itemSnapshot.reminderText,
      awardAssessment: null,
    });
  });
});

test("allows an automatically generated evaluation description to be edited and saved", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`group-edit-automatic-description-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const inspection = makeInspection();
  const entry = {
    ...inspection.entries[0],
    checkSelections: [{ category: "environment" as const, value: "干净整洁", isCustom: false }],
  };
  await repository.saveGraph({
    inspection: { ...inspection, entries: [entry] },
    groups: [makePhotoGroup({ description: entry.itemSnapshot.goodText })],
    photos: [makePhoto()],
  });
  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });
  await expandInspectionRoute();

  const editor = await screen.findByTestId("photo-group-group-1");
  const description = within(editor).getByRole("textbox", { name: "评价说明" });
  expect(description).toHaveValue("焊机间：环境卫生干净整洁。");
  await user.type(description, "补充：地沟已清理。");
  await user.click(within(editor).getByRole("button", { name: "保存评价" }));

  await waitFor(async () => {
    expect((await repository.getGraph("inspection-1"))?.groups[0]).toMatchObject({
      description: "焊机间：环境卫生干净整洁。补充：地沟已清理。",
      descriptionManuallyEdited: true,
    });
  });
});

test("splits one photo from a multi-photo group transactionally", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`group-split-page-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const group = makePhotoGroup({ photoIds: ["photo-1", "photo-2"] });
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [group],
    photos: [makePhoto(), makePhoto(undefined, { id: "photo-2", order: 1 })],
  });
  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });
  await expandInspectionRoute();

  const groupEditor = await screen.findByTestId("photo-group-group-1");
  await user.click(within(groupEditor).getByRole("button", { name: "调整照片 photo-1" }));
  await user.click(within(groupEditor).getByRole("menuitem", { name: "考核问题" }));

  await waitFor(async () => {
    const restored = await repository.getGraph("inspection-1");
    expect(restored?.groups).toHaveLength(2);
    expect(restored?.groups.find((current) => current.id === "group-1")?.photoIds).toEqual([
      "photo-2",
    ]);
    const created = restored?.groups.find((current) => current.id !== "group-1");
    expect(created).toMatchObject({ category: "assessment", photoIds: ["photo-1"] });
    expect(restored?.photos.find((photo) => photo.id === "photo-1")?.groupId).toBe(created?.id);
    expect(restored?.inspection.entries[0].groupIds).toEqual(["group-1", created?.id]);
  });
});

test("changes the remaining source photo directly after a multi-photo split", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`group-split-then-change-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup({ photoIds: ["photo-1", "photo-2"] })],
    photos: [makePhoto(), makePhoto(undefined, { id: "photo-2", order: 1 })],
  });
  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });
  await expandInspectionRoute();

  const sourceEditor = await screen.findByTestId("photo-group-group-1");
  await user.click(within(sourceEditor).getByRole("button", { name: "调整照片 photo-1" }));
  await user.click(within(sourceEditor).getByRole("menuitem", { name: "考核问题" }));
  await waitFor(async () => {
    expect((await repository.getGraph("inspection-1"))?.groups).toHaveLength(2);
  });

  const updatedSourceEditor = screen.getByTestId("photo-group-group-1");
  await user.click(
    within(updatedSourceEditor).getByRole("button", { name: "调整照片 photo-2" }),
  );
  await user.click(within(updatedSourceEditor).getByRole("menuitem", { name: "提醒问题" }));

  await waitFor(async () => {
    const restored = await repository.getGraph("inspection-1");
    expect(restored?.groups).toHaveLength(2);
    expect(restored?.groups.find((group) => group.id === "group-1")).toMatchObject({
      category: "reminder",
      photoIds: ["photo-2"],
    });
  });
});

test("keeps every local group order aligned after splitting the first of three groups", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`group-split-local-order-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const inspection = makeInspection();
  const entry = {
    ...inspection.entries[0],
    groupIds: ["group-1", "group-2", "group-3"],
  };
  await repository.saveGraph({
    inspection: { ...inspection, entries: [entry] },
    groups: [
      makePhotoGroup({ photoIds: ["photo-1", "photo-2"] }),
      makePhotoGroup({ id: "group-2", photoIds: ["photo-3"], order: 1 }),
      makePhotoGroup({ id: "group-3", photoIds: ["photo-4"], order: 2 }),
    ],
    photos: [
      makePhoto(),
      makePhoto(undefined, { id: "photo-2", order: 1 }),
      makePhoto(undefined, { id: "photo-3", groupId: "group-2" }),
      makePhoto(undefined, { id: "photo-4", groupId: "group-3" }),
    ],
  });
  const view = renderWithRouter({ database, initialPath: "/inspections/inspection-1" });
  await expandInspectionRoute();

  const firstEditor = await screen.findByTestId("photo-group-group-1");
  await user.click(within(firstEditor).getByRole("button", { name: "调整照片 photo-1" }));
  await user.click(within(firstEditor).getByRole("menuitem", { name: "考核问题" }));
  await waitFor(async () => {
    expect((await repository.getGraph("inspection-1"))?.groups).toHaveLength(4);
  });

  const secondEditor = screen.getByTestId("photo-group-group-2");
  await user.click(within(secondEditor).getByRole("radio", { name: "提醒问题" }));

  let restored = await waitFor(async () => {
    const current = await repository.getGraph("inspection-1");
    expect(current?.groups.find((group) => group.id === "group-2")?.category).toBe("reminder");
    expect(current?.groups.map((group) => group.order)).toEqual([0, 1, 2, 3]);
    expect(current?.groups.map((group) => group.id)).toEqual(current?.inspection.entries[0].groupIds);
    return current;
  });

  view.unmount();
  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });
  await expandInspectionRoute();
  await screen.findByTestId("photo-group-group-2");
  const renderedIds = screen.getAllByTestId(/^photo-group-/).map((editor) =>
    editor.getAttribute("data-testid")?.replace("photo-group-", ""));
  restored = await repository.getGraph("inspection-1");
  expect(renderedIds).toEqual(restored?.inspection.entries[0].groupIds);
  expect(restored?.groups.find((group) => group.id === "group-2")?.category).toBe("reminder");
});

test("autosaves edited text against the latest source structure when split before debounce", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`group-split-during-debounce-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup({ photoIds: ["photo-1", "photo-2"] })],
    photos: [makePhoto(), makePhoto(undefined, { id: "photo-2", order: 1 })],
  });
  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });
  await expandInspectionRoute();

  const sourceEditor = await screen.findByTestId("photo-group-group-1");
  fireEvent.change(within(sourceEditor).getByRole("textbox", { name: "评价说明" }), {
    target: { value: "拆组前编辑的最新说明" },
  });
  await user.click(within(sourceEditor).getByRole("button", { name: "调整照片 photo-1" }));
  await user.click(within(sourceEditor).getByRole("menuitem", { name: "提醒问题" }));

  await waitFor(async () => {
    const restored = await repository.getGraph("inspection-1");
    expect(restored?.groups.find((group) => group.id === "group-1")).toMatchObject({
      description: "拆组前编辑的最新说明",
      photoIds: ["photo-2"],
    });
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("persists cleared assessment people on unmount and does not restore the old value", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`group-clear-assessment-people-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup({
      category: "assessment",
      awardAssessment: { type: "assessment", people: "张三", amount: 50 },
    })],
    photos: [makePhoto()],
  });
  await database.inspections.update("inspection-1", { status: "generated" });
  const firstView = renderWithRouter({ database, initialPath: "/inspections/inspection-1" });
  await expandInspectionRoute();

  await user.clear(await screen.findByRole("textbox", { name: "考核人员" }));
  firstView.unmount();

  await waitFor(async () => {
    const restored = await repository.getGraph("inspection-1");
    expect(restored?.groups[0].awardAssessment).toEqual({
      type: "assessment",
      people: "",
      amount: 50,
    });
    expect(restored?.inspection.status).toBe("draft");
    expect(restored && validateReportReadiness(restored).map((error) => error.code)).toContain(
      "ASSESSMENT_DETAILS_REQUIRED",
    );
  });

  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });
  await expandInspectionRoute();
  expect(await screen.findByRole("textbox", { name: "考核人员" })).toHaveValue("");
  expect(screen.getByRole("spinbutton", { name: "其他金额" })).toHaveValue(50);
});

test.each([
  ["cleared", ""],
  ["invalid", "1.5"],
])("persists a %s reward amount as an incomplete draft without restoring the old amount", async (_label, value) => {
  const database = createTestDb(`group-incomplete-reward-amount-${_label}-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup({
      awardAssessment: { type: "reward", people: "张三", amount: 50 },
    })],
    photos: [makePhoto()],
  });
  await database.inspections.update("inspection-1", { status: "generated" });
  const firstView = renderWithRouter({ database, initialPath: "/inspections/inspection-1" });
  await expandInspectionRoute();
  const amount = await screen.findByRole("spinbutton", { name: "其他金额" });

  fireEvent.change(amount, { target: { value } });
  firstView.unmount();

  await waitFor(async () => {
    const restored = await repository.getGraph("inspection-1");
    expect(restored?.groups[0].awardAssessment).toEqual({
      type: "reward",
      people: "张三",
      amount: 0,
    });
    expect(restored?.inspection.status).toBe("draft");
    expect(restored && validateReportReadiness(restored).map((error) => error.code)).toContain(
      "REWARD_DETAILS_INCOMPLETE",
    );
  });

  renderWithRouter({ database, initialPath: "/inspections/inspection-1" });
  await expandInspectionRoute();
  expect(await screen.findByRole("checkbox", { name: "设置奖励" })).toBeChecked();
  expect(screen.getByRole("spinbutton", { name: "其他金额" })).toHaveValue(null);
});
