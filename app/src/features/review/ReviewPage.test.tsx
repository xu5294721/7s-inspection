import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { createAppDependencies } from "../../app/dependencies";
import { PwaUpdatePrompt } from "../../app/PwaUpdatePrompt";
import { createTestDb, type SevenSDb } from "../../db/database";
import { InspectionRepository } from "../../db/inspectionRepository";
import { TemplateRepository } from "../../db/templateRepository";
import type { InspectionGraph } from "../../domain/models";
import { makeInspection, makePhoto, makePhotoGroup, makeTemplate } from "../../test/fixtures";
import { renderWithRouter } from "../../test/renderWithRouter";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function mockSuccessfulGeneration(
  dependencies: ReturnType<typeof createAppDependencies>,
  database: SevenSDb,
) {
  const blob = new Blob(["test-docx"], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  vi.spyOn(dependencies.reportGenerator, "generateReport").mockImplementation(async (inspectionId) => {
    await database.inspections.update(inspectionId, {
      status: "generated",
      updatedAt: new Date().toISOString(),
    });
    const graph = await dependencies.inspectionRepository.getGraph(inspectionId);
    if (!graph) throw new Error("test inspection missing");
    return {
      graph,
      blob,
      filename: "向塘钢轨焊接整修车间7月28日7S巡检通报.docx",
    };
  });
  vi.spyOn(dependencies.reportGenerator, "shareOrDownloadReport").mockResolvedValue("shared");
  return blob;
}

test("shows selected check content instead of the legacy preset description", async () => {
  const database = createTestDb(`review-selected-description-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const base = makeInspection();
  const entry = {
    ...base.entries[0],
    itemSnapshot: {
      ...base.entries[0].itemSnapshot,
      routeName: "卷扬机间",
      part: "卷扬机间",
      goodText: "卷扬机间7S管理落实较好。",
    },
    checkSelections: [
      { category: "environment" as const, value: "干净整洁", isCustom: false },
      { category: "placement" as const, value: "规范有序", isCustom: false },
    ],
  };
  await repository.saveGraph({
    inspection: { ...base, entries: [entry] },
    groups: [makePhotoGroup({ description: "卷扬机间7S管理落实较好。" })],
    photos: [makePhoto()],
  });

  renderWithRouter({ database, initialPath: "/inspections/inspection-1/review" });

  expect(await screen.findByText("卷扬机间：环境卫生干净整洁，物品定置规范有序。")).toBeVisible();
  expect(screen.queryByText("卷扬机间7S管理落实较好。")).not.toBeInTheDocument();
});

test("shows the general-performance tab and its photo", async () => {
  const database = createTestDb(`review-general-tab-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup({ category: "general", description: "油缸一般表现说明" })],
    photos: [makePhoto()],
  });

  renderWithRouter({ database, initialPath: "/inspections/inspection-1/review" });

  const tab = await screen.findByRole("tab", { name: "一般表现 1张" });
  await userEvent.setup().click(tab);
  expect(screen.getByRole("tabpanel", { name: "一般表现 1张" })).toContainElement(
    screen.getByRole("img", { name: "巡检照片 photo-1" }),
  );
  expect(screen.getByText("油缸一般表现说明")).toBeVisible();
});

test("shows a manually edited evaluation description instead of selected check content", async () => {
  const database = createTestDb(`review-manual-description-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const base = makeInspection();
  const entry = {
    ...base.entries[0],
    checkSelections: [{ category: "environment" as const, value: "干净整洁", isCustom: false }],
  };
  const manualDescription = "焊机间：环境卫生干净整洁，补充：地沟已清理。";
  await repository.saveGraph({
    inspection: { ...base, entries: [entry] },
    groups: [makePhotoGroup({ description: manualDescription, descriptionManuallyEdited: true })],
    photos: [makePhoto()],
  });

  renderWithRouter({ database, initialPath: "/inspections/inspection-1/review" });

  expect(await screen.findByText(manualDescription)).toBeVisible();
});

test("links an incomplete assessment to its group and reviews after details are complete", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-page-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const base = makeInspection();
  const unphotographed = {
    ...base.entries[0],
    id: "entry-unphotographed",
    itemId: "item-unphotographed",
    itemSnapshot: { ...base.entries[0].itemSnapshot, id: "item-unphotographed", part: "未拍固定项" },
    groupIds: [],
    order: 1,
  };
  await repository.saveGraph({
    inspection: { ...base, entries: [base.entries[0], unphotographed] },
    groups: [makePhotoGroup({ category: "assessment", description: "现场未落实要求。", awardAssessment: null })],
    photos: [makePhoto()],
  });

  const dependencies = createAppDependencies(database);
  mockSuccessfulGeneration(dependencies, database);
  const generateReport = vi.mocked(dependencies.reportGenerator.generateReport);
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });

  expect(await screen.findByRole("heading", { name: "通报复核" })).toBeVisible();
  expect(screen.getByRole("tab", { name: "考核问题 1张" })).toBeVisible();
  expect(screen.queryByText("未拍固定项")).not.toBeInTheDocument();
  const generate = screen.getByRole("button", { name: "生成Word" });
  expect(generate).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "考核必须填写责任人员和正数金额。" }));
  const group = screen.getByTestId("review-group-group-1");
  expect(group).toHaveFocus();

  await user.click(screen.getByRole("textbox", { name: "考核人员" }));
  await user.paste("张三");
  await user.click(screen.getByRole("spinbutton", { name: "考核金额" }));
  await user.paste("50");
  await waitFor(() => expect(generate).toBeEnabled());
  await user.click(generate);

  await waitFor(() => expect(generateReport).toHaveBeenCalledOnce(), { timeout: 20_000 });
  await expect(generateReport.mock.results[0].value).resolves.toMatchObject({
    graph: { inspection: { status: "generated" } },
  });
  expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("generated");
  expect(screen.getByText("Word已生成，可分享或下载。")).toBeVisible();
}, 30_000);

test("keeps the latest complete assessment available while an older save reloads", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-assessment-save-order-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup({ category: "assessment", awardAssessment: null })],
    photos: [makePhoto()],
  });
  const dependencies = createAppDependencies(database);
  mockSuccessfulGeneration(dependencies, database);
  const generateReport = vi.mocked(dependencies.reportGenerator.generateReport);
  const originalUpdate = dependencies.inspectionRepository.updatePhotoGroup.bind(dependencies.inspectionRepository);
  const originalGetGraph = dependencies.inspectionRepository.getGraph.bind(dependencies.inspectionRepository);
  const firstSave = deferred<void>();
  const secondSave = deferred<void>();
  const staleReload = deferred<InspectionGraph | null>();
  const updatePhotoGroup = vi.spyOn(dependencies.inspectionRepository, "updatePhotoGroup")
    .mockImplementationOnce(async (group) => {
      await firstSave.promise;
      await originalUpdate(group);
    })
    .mockImplementationOnce(async (group) => {
      await secondSave.promise;
      await originalUpdate(group);
    });
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });

  await screen.findByRole("heading", { name: "通报复核" });
  await user.click(screen.getByRole("tab", { name: "考核问题 1张" }));
  await user.click(screen.getByRole("textbox", { name: "考核人员" }));
  await user.paste("张三");
  await waitFor(() => expect(updatePhotoGroup).toHaveBeenCalledOnce());
  const incomplete = await repository.getGraph("inspection-1");
  const getGraph = vi.spyOn(dependencies.inspectionRepository, "getGraph")
    .mockImplementationOnce(() => staleReload.promise)
    .mockImplementation(originalGetGraph);

  await act(async () => {
    firstSave.resolve();
  });
  await waitFor(() => expect(getGraph).toHaveBeenCalledOnce());

  await user.click(screen.getByRole("spinbutton", { name: "考核金额" }));
  await user.paste("50");
  const generate = screen.getByRole("button", { name: "生成Word" });
  expect(generate).toBeEnabled();

  await act(async () => {
    staleReload.resolve(incomplete);
  });
  await waitFor(() => expect(updatePhotoGroup).toHaveBeenCalledTimes(2));

  expect(generate).toBeEnabled();
  await user.click(generate);
  expect(generateReport).not.toHaveBeenCalled();
  await act(async () => {
    secondSave.resolve();
  });
  await waitFor(() => expect(generateReport).toHaveBeenCalledOnce());
});

test("disables Word generation when the inspection has no persisted photos", async () => {
  const database = createTestDb(`review-no-photos-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await new TemplateRepository(database).save(makeTemplate());
  const inspection = makeInspection({
    entries: [{ ...makeInspection().entries[0], groupIds: [] }],
  });
  await repository.saveGraph({ inspection, groups: [], photos: [] });

  renderWithRouter({ database, initialPath: "/inspections/inspection-1/review" });

  expect(await screen.findByRole("button", { name: "生成Word" })).toBeDisabled();
  expect(screen.getAllByText("报告至少需要一张已归组照片。").length).toBeGreaterThan(0);
});

test("shows a photo-free evaluation group in review", async () => {
  const database = createTestDb(`review-empty-group-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await new TemplateRepository(database).save(makeTemplate());
  const inspection = makeInspection({
    entries: [{ ...makeInspection().entries[0], checkSelections: [{ category: "environment", value: "干净整洁", isCustom: false }], groupIds: ["empty-good"] }],
  });
  await repository.saveGraph({
    inspection,
    groups: [makePhotoGroup({ id: "empty-good", photoIds: [], description: "环境卫生：干净整洁" })],
    photos: [],
  });

  renderWithRouter({ database, initialPath: "/inspections/inspection-1/review" });

  expect(await screen.findByTestId("review-group-empty-good")).toBeVisible();
  expect(screen.getByTestId("review-group-empty-good")).toHaveTextContent("环境卫生");
  expect(screen.getByTestId("review-group-empty-good")).toHaveTextContent("干净整洁");
});

test("clearing a complete assessment immediately disables review and persists the incomplete draft", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-clear-assessment-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await new TemplateRepository(database).save(makeTemplate());
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup({
      category: "assessment",
      description: "现场未落实要求。",
      awardAssessment: { type: "assessment", people: "张三", amount: 50 },
    })],
    photos: [makePhoto()],
  });
  await database.inspections.update("inspection-1", { status: "generated" });
  renderWithRouter({ database, initialPath: "/inspections/inspection-1/review" });

  await user.click(await screen.findByRole("tab", { name: "考核问题 1张" }));
  const generate = screen.getByRole("button", { name: "生成Word" });
  expect(generate).toBeEnabled();
  await user.clear(screen.getByRole("textbox", { name: "考核人员" }));

  expect(generate).toBeDisabled();
  expect(screen.getAllByText("考核必须填写责任人员和正数金额。").length).toBeGreaterThan(0);
  await waitFor(async () => {
    const restored = await repository.getGraph("inspection-1");
    expect(restored?.groups[0].awardAssessment).toEqual({
      type: "assessment",
      people: "",
      amount: 50,
    });
    expect(restored?.inspection.status).toBe("draft");
  });
});

test("shows each photo in exactly one category tab", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-tabs-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const inspection = makeInspection({
    entries: [{ ...makeInspection().entries[0], groupIds: ["group-1", "group-2", "group-3"] }],
  });
  await repository.saveGraph({
    inspection,
    groups: [
      makePhotoGroup(),
      makePhotoGroup({ id: "group-2", category: "reminder", description: "提醒问题", photoIds: ["photo-2"], order: 1 }),
      makePhotoGroup({ id: "group-3", category: "assessment", description: "考核问题", awardAssessment: { type: "assessment", people: "李四", amount: 30 }, photoIds: ["photo-3"], order: 2 }),
    ],
    photos: [
      makePhoto(),
      makePhoto(undefined, { id: "photo-2", groupId: "group-2" }),
      makePhoto(undefined, { id: "photo-3", groupId: "group-3" }),
    ],
  });
  renderWithRouter({ database, initialPath: "/inspections/inspection-1/review" });

  await screen.findByRole("tab", { name: "好的方面 1张" });
  expect(screen.getAllByRole("img")).toHaveLength(1);
  await user.click(screen.getByRole("tab", { name: "提醒问题 1张" }));
  expect(screen.getAllByRole("img")).toHaveLength(1);
  await user.click(screen.getByRole("tab", { name: "考核问题 1张" }));
  expect(screen.getAllByRole("img")).toHaveLength(1);
});

test("uses roving tab focus, arrow switching, and linked tabpanel semantics", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-tab-a11y-${Date.now()}`);
  await new InspectionRepository(database).saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup()],
    photos: [makePhoto()],
  });
  renderWithRouter({ database, initialPath: "/inspections/inspection-1/review" });

  const good = await screen.findByRole("tab", { name: "好的方面 1张" });
  const general = screen.getByRole("tab", { name: "一般表现 0张" });
  const panel = screen.getByRole("tabpanel");
  expect(good).toHaveAttribute("tabindex", "0");
  expect(general).toHaveAttribute("tabindex", "-1");
  expect(good).toHaveAttribute("aria-controls", panel.id);
  expect(panel).toHaveAttribute("aria-labelledby", good.id);

  good.focus();
  await user.keyboard("{ArrowRight}");
  expect(general).toHaveFocus();
  expect(general).toHaveAttribute("aria-selected", "true");
  expect(panel).toHaveAttribute("aria-labelledby", general.id);
});

test("focuses settings and global targets for damaged non-group validation errors", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-validation-target-${Date.now()}`);
  const dependencies = createAppDependencies(database);
  const inspection = makeInspection({
    entries: [{ ...makeInspection().entries[0], inspectionId: "other-inspection" }],
  });
  const damaged = {
    inspection,
    groups: [makePhotoGroup()],
    photos: [makePhoto()],
    template: makeTemplate({ name: "" }),
  };
  vi.spyOn(dependencies.inspectionRepository, "getGraph").mockResolvedValue(damaged);
  vi.spyOn(dependencies.templateRepository, "listVersions").mockResolvedValue([]);
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });

  await user.click(await screen.findByRole("button", { name: "报告模板结构无效。" }));
  expect(screen.getByTestId("review-settings")).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "巡检项点所属巡检记录不一致。" }));
  expect(screen.getByRole("region", { name: "复核问题" })).toHaveFocus();
});

test("lists immutable template versions and persists the selected inspection snapshot", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-template-${Date.now()}`);
  const templates = new TemplateRepository(database);
  await templates.save(makeTemplate());
  await templates.save(makeTemplate({ version: 2, name: "新版模板", photosPerRow: 2 }));
  const repository = new InspectionRepository(database);
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup()],
    photos: [makePhoto()],
  });
  renderWithRouter({ database, initialPath: "/inspections/inspection-1/review" });

  const version = await screen.findByRole("combobox", { name: "通报模板版本" });
  expect(screen.getByRole("option", { name: "默认模板 v1" })).toBeVisible();
  expect(screen.getByRole("option", { name: "新版模板 v2" })).toBeVisible();
  await user.selectOptions(version, "2");

  await waitFor(async () => {
    const restored = await repository.getGraph("inspection-1");
    expect(restored?.inspection).toMatchObject({ templateId: "template-default", templateVersion: 2 });
    expect(restored?.template?.name).toBe("新版模板");
  });
  expect((await templates.get("template-default", 1))?.name).toBe("默认模板");
});

test("supports adaptive photo layout and persists the selected mode and four-photo limit", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-photo-layout-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup()],
    photos: [makePhoto()],
  });

  renderWithRouter({ database, initialPath: "/inspections/inspection-1/review" });

  const mode = await screen.findByRole("combobox", { name: "照片排版模式" });
  const rows = screen.getByRole("combobox", { name: "每行照片数" });
  expect(Array.from((rows as HTMLSelectElement).options).map((option) => option.value)).toEqual(["1", "2", "3", "4"]);

  await user.selectOptions(mode, "adaptive");
  await user.selectOptions(rows, "4");

  await waitFor(async () => expect((await repository.getGraph("inspection-1"))?.inspection).toMatchObject({
    photoLayoutModeOverride: "adaptive",
    photosPerRowOverride: 4,
  }));
  expect(mode).toHaveValue("adaptive");
  expect(rows).toHaveValue("4");
});

test("defaults review photo layout to adaptive even when its template is fixed", async () => {
  const database = createTestDb(`review-default-adaptive-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup()],
    photos: [makePhoto()],
    template: makeTemplate({ photoLayoutMode: "fixed" }),
  });

  renderWithRouter({ database, initialPath: "/inspections/inspection-1/review" });

  expect(await screen.findByRole("combobox", { name: "照片排版模式" })).toHaveValue("adaptive");
});

test("generates through repository atomic readiness and packaged snapshot transitions", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-atomic-completion-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await repository.saveGraph({ inspection: makeInspection(), groups: [makePhotoGroup()], photos: [makePhoto()] });
  const dependencies = createAppDependencies(database);
  mockSuccessfulGeneration(dependencies, database);
  const generateReport = vi.spyOn(dependencies.reportGenerator, "generateReport");
  const directStatus = vi.spyOn(dependencies.inspectionRepository, "setInspectionStatus");
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });

  await user.click(await screen.findByRole("button", { name: "生成Word" }));

  await waitFor(() => expect(generateReport).toHaveBeenCalledWith("inspection-1", expect.any(Function)));
  expect(directStatus).not.toHaveBeenCalled();
  expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("generated");
});

test.each(["resolve", "reject"] as const)(
  "ignores a delayed completion %s after changing to another inspection route",
  async (outcome) => {
    const user = userEvent.setup();
    const database = createTestDb(`review-completion-route-${outcome}-${Date.now()}`);
    const repository = new InspectionRepository(database);
    const firstGraph: InspectionGraph = {
      inspection: makeInspection(),
      groups: [makePhotoGroup()],
      photos: [makePhoto()],
      template: makeTemplate(),
    };
    await repository.saveGraph(firstGraph);
    const secondBase = makeInspection();
    const secondInspection = makeInspection({
      id: "inspection-2",
      title: "第二条巡检保持显示",
      entries: [{
        ...secondBase.entries[0],
        id: "entry-second",
        inspectionId: "inspection-2",
        groupIds: ["group-second"],
      }],
    });
    await repository.saveGraph({
      inspection: secondInspection,
      groups: [makePhotoGroup({
        id: "group-second",
        inspectionId: "inspection-2",
        entryId: "entry-second",
        photoIds: ["photo-second"],
      })],
      photos: [makePhoto(undefined, {
        id: "photo-second",
        inspectionId: "inspection-2",
        groupId: "group-second",
      })],
    });
    const dependencies = createAppDependencies(database);
    const completion = deferred<Awaited<ReturnType<typeof dependencies.reportGenerator.generateReport>>>();
    const generateReport = vi.spyOn(dependencies.reportGenerator, "generateReport")
      .mockImplementation(() => completion.promise);
    renderWithRouter({
      database,
      initialPath: "/inspections/inspection-1/review",
      appProps: { dependencies },
    });

    await user.click(await screen.findByRole("button", { name: "生成Word" }));
    await waitFor(() => expect(generateReport).toHaveBeenCalledWith("inspection-1", expect.any(Function)));
    window.location.hash = "#/inspections/inspection-2/review";
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(await screen.findByText("第二条巡检保持显示")).toBeVisible();

    await act(async () => {
      if (outcome === "resolve") {
        completion.resolve({
          graph: {
            ...firstGraph,
            inspection: { ...firstGraph.inspection, status: "generated" },
          },
          blob: new Blob(["route-docx"]),
          filename: "route.docx",
        });
      } else {
        completion.reject(new Error("第一条巡检复核失败"));
      }
      await completion.promise.catch(() => undefined);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(screen.getByText("第二条巡检保持显示")).toBeVisible();
    expect(screen.queryByText(firstGraph.inspection.title)).not.toBeInTheDocument();
    expect(screen.queryByText("Word已生成，可分享或下载。")).not.toBeInTheDocument();
    expect(screen.queryByText("第一条巡检复核失败")).not.toBeInTheDocument();
  },
);

test("stops a queued save batch after failure and blocks review completion", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-save-queue-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await repository.saveGraph({ inspection: makeInspection({ templateVersion: 3 }), groups: [makePhotoGroup()], photos: [makePhoto()] });
  const dependencies = createAppDependencies(database);
  const first = deferred<void>();
  const original = dependencies.inspectionRepository.updateReviewSettings.bind(
    dependencies.inspectionRepository,
  );
  const save = vi.spyOn(dependencies.inspectionRepository, "updateReviewSettings")
    .mockImplementationOnce(() => first.promise)
    .mockImplementation((...args) => original(...args));
  mockSuccessfulGeneration(dependencies, database);
  const generateReport = vi.spyOn(dependencies.reportGenerator, "generateReport");
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });

  const rows = await screen.findByRole("combobox", { name: "每行照片数" });
  await user.selectOptions(rows, "2");
  await user.selectOptions(rows, "3");
  expect(save).toHaveBeenCalledTimes(1);

  first.reject(new Error("较早保存失败"));
  expect(await screen.findByRole("alert")).toHaveTextContent("较早保存失败");
  await new Promise((resolve) => window.setTimeout(resolve, 0));
  expect(save).toHaveBeenCalledTimes(1);
  expect((await repository.getGraph("inspection-1"))?.inspection.photosPerRowOverride).toBeNull();
  expect(rows).toHaveValue("3");
  await user.click(screen.getByRole("button", { name: "生成Word" }));
  expect(generateReport).not.toHaveBeenCalled();
  expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("draft");
});

test("does not apply a failed save recovery read after navigating to another inspection", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-failed-save-route-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await repository.saveGraph({ inspection: makeInspection(), groups: [makePhotoGroup()], photos: [makePhoto()] });
  const secondBase = makeInspection();
  const secondInspection = makeInspection({
    id: "inspection-2",
    title: "Second inspection remains visible",
    photosPerRowOverride: 2,
    entries: [{
      ...secondBase.entries[0],
      id: "entry-second",
      inspectionId: "inspection-2",
      groupIds: ["group-second"],
    }],
  });
  await repository.saveGraph({
    inspection: secondInspection,
    groups: [makePhotoGroup({
      id: "group-second",
      inspectionId: "inspection-2",
      entryId: "entry-second",
      photoIds: ["photo-second"],
    })],
    photos: [makePhoto(undefined, {
      id: "photo-second",
      inspectionId: "inspection-2",
      groupId: "group-second",
    })],
  });
  const dependencies = createAppDependencies(database);
  const recoveryRead = deferred<InspectionGraph | null>();
  const originalGetGraph = dependencies.inspectionRepository.getGraph.bind(dependencies.inspectionRepository);
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });

  const rows = await screen.findByRole("combobox", { name: "每行照片数" });
  vi.spyOn(dependencies.inspectionRepository, "getGraph")
    .mockImplementation((inspectionId) => inspectionId === "inspection-1" ? recoveryRead.promise : originalGetGraph(inspectionId));
  vi.spyOn(dependencies.inspectionRepository, "updateReviewSettings")
    .mockRejectedValueOnce(new Error("Save failed before recovery"));
  await user.selectOptions(rows, "2");
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Save failed before recovery"));

  window.location.hash = "#/inspections/inspection-2/review";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(await screen.findByText("Second inspection remains visible")).toBeVisible();

  await act(async () => {
    recoveryRead.resolve(await originalGetGraph("inspection-1"));
  });

  expect(screen.getByText("Second inspection remains visible")).toBeVisible();
  expect(screen.getByRole("combobox", { name: "每行照片数" })).toHaveValue("2");
});

test("starts a fresh save batch when editing after a failed recovery read is pending", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-failed-save-retry-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await repository.saveGraph({ inspection: makeInspection(), groups: [makePhotoGroup()], photos: [makePhoto()] });
  const staleGraph = await repository.getGraph("inspection-1");
  const dependencies = createAppDependencies(database);
  mockSuccessfulGeneration(dependencies, database);
  const generateReport = vi.mocked(dependencies.reportGenerator.generateReport);
  const recoveryRead = deferred<InspectionGraph | null>();
  const originalGetGraph = dependencies.inspectionRepository.getGraph.bind(dependencies.inspectionRepository);
  const originalSave = dependencies.inspectionRepository.updateReviewSettings.bind(dependencies.inspectionRepository);
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });

  const rows = await screen.findByRole("combobox", { name: "每行照片数" });
  const getGraph = vi.spyOn(dependencies.inspectionRepository, "getGraph")
    .mockImplementationOnce(() => recoveryRead.promise)
    .mockImplementation(originalGetGraph);
  const save = vi.spyOn(dependencies.inspectionRepository, "updateReviewSettings")
    .mockRejectedValueOnce(new Error("First save failed"))
    .mockImplementation((...args) => originalSave(...args));

  await user.selectOptions(rows, "2");
  expect(await screen.findByRole("alert")).toHaveTextContent("First save failed");
  await waitFor(() => expect(getGraph).toHaveBeenCalledOnce());

  await user.selectOptions(screen.getByRole("combobox", { name: "每行照片数" }), "3");
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  await waitFor(async () => {
    expect((await repository.getGraph("inspection-1"))?.inspection.photosPerRowOverride).toBe(3);
  });

  await act(async () => {
    recoveryRead.resolve(staleGraph);
    await recoveryRead.promise;
  });

  expect(screen.getByRole("combobox", { name: "每行照片数" })).toHaveValue("3");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "生成Word" }));
  await waitFor(() => expect(generateReport).toHaveBeenCalledOnce());
});

test("does not expose an old generated report when generation commits before a queued edit saves", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-generation-before-save-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await repository.saveGraph({
    inspection: makeInspection({ status: "reviewed" }),
    groups: [makePhotoGroup({
      category: "assessment",
      awardAssessment: { type: "assessment", people: "张三", amount: 50 },
    })],
    photos: [makePhoto()],
  });
  const dependencies = createAppDependencies(database);
  const generationCommit = deferred<void>();
  const editSave = deferred<void>();
  const originalGetGraph = dependencies.inspectionRepository.getGraph.bind(dependencies.inspectionRepository);
  const originalUpdate = dependencies.inspectionRepository.updatePhotoGroup.bind(dependencies.inspectionRepository);
  const generatedBlob = new Blob(["stale-generated-docx"]);
  const generate = vi.spyOn(dependencies.reportGenerator, "generateReport")
    .mockImplementation(async (inspectionId) => {
      await generationCommit.promise;
      await database.inspections.update(inspectionId, { status: "generated" });
      const graph = await originalGetGraph(inspectionId);
      if (!graph) throw new Error("test inspection missing");
      return { graph, blob: generatedBlob, filename: "stale.docx" };
    });
  const update = vi.spyOn(dependencies.inspectionRepository, "updatePhotoGroup")
    .mockImplementationOnce(async (group) => {
      await editSave.promise;
      await originalUpdate(group);
    });
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });

  await user.click(await screen.findByRole("tab", { name: "考核问题 1张" }));
  await user.click(screen.getByRole("button", { name: "生成Word" }));
  await waitFor(() => expect(generate).toHaveBeenCalledOnce());
  await user.clear(screen.getByRole("textbox", { name: "考核人员" }));
  await waitFor(() => expect(update).toHaveBeenCalledOnce());

  await act(async () => {
    generationCommit.resolve();
    await generate.mock.results[0].value;
  });
  expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("generated");

  await act(async () => {
    editSave.resolve();
  });
  await waitFor(async () => {
    const graph = await repository.getGraph("inspection-1");
    expect(graph?.inspection.status).toBe("draft");
    expect(graph?.groups[0].awardAssessment?.people).toBe("");
  });
  expect(screen.queryByRole("button", { name: "分享Word" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "下载Word" })).not.toBeInTheDocument();
  expect(screen.queryByText("Word已生成，可分享或下载。" )).not.toBeInTheDocument();
});

test("does not expose a stale generation result after an edit has already saved", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-save-before-generation-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await repository.saveGraph({
    inspection: makeInspection({ status: "reviewed" }),
    groups: [makePhotoGroup({
      category: "assessment",
      awardAssessment: { type: "assessment", people: "张三", amount: 50 },
    })],
    photos: [makePhoto()],
  });
  const dependencies = createAppDependencies(database);
  const completion = deferred<Awaited<ReturnType<typeof dependencies.reportGenerator.generateReport>>>();
  const generate = vi.spyOn(dependencies.reportGenerator, "generateReport")
    .mockImplementation(() => completion.promise);
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });

  await user.click(await screen.findByRole("tab", { name: "考核问题 1张" }));
  await user.click(screen.getByRole("button", { name: "生成Word" }));
  await waitFor(() => expect(generate).toHaveBeenCalledOnce());
  await user.clear(screen.getByRole("textbox", { name: "考核人员" }));
  await waitFor(async () => {
    const graph = await repository.getGraph("inspection-1");
    expect(graph?.inspection.status).toBe("draft");
    expect(graph?.groups[0].awardAssessment?.people).toBe("");
  });

  await act(async () => {
    completion.resolve({
      graph: {
        inspection: makeInspection({ status: "generated" }),
        groups: [makePhotoGroup({
          category: "assessment",
          awardAssessment: { type: "assessment", people: "张三", amount: 50 },
        })],
        photos: [makePhoto()],
        template: makeTemplate(),
      },
      blob: new Blob(["stale-generated-docx"]),
      filename: "stale.docx",
    });
    await completion.promise;
  });

  expect(screen.queryByRole("button", { name: "分享Word" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "下载Word" })).not.toBeInTheDocument();
  expect(screen.queryByText("Word已生成，可分享或下载。" )).not.toBeInTheDocument();
  expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("draft");
});

test.each([
  ["shared", "Word已分享，可继续分享或下载。"],
  ["cancelled", "已取消分享，Word仍可分享或下载。"],
  ["unavailable", "当前设备无法分享文件，请点击下载Word。"],
] as const)("does not write a pending %s share result after changing routes", async (result, message) => {
  const user = userEvent.setup();
  const database = createTestDb(`review-share-route-${result}-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await repository.saveGraph({ inspection: makeInspection(), groups: [makePhotoGroup()], photos: [makePhoto()] });
  const secondBase = makeInspection();
  const secondInspection = makeInspection({
    id: "inspection-2",
    title: "Second inspection after share",
    entries: [{
      ...secondBase.entries[0],
      id: "entry-second",
      inspectionId: "inspection-2",
      groupIds: ["group-second"],
    }],
  });
  await repository.saveGraph({
    inspection: secondInspection,
    groups: [makePhotoGroup({
      id: "group-second",
      inspectionId: "inspection-2",
      entryId: "entry-second",
      photoIds: ["photo-second"],
    })],
    photos: [makePhoto(undefined, {
      id: "photo-second",
      inspectionId: "inspection-2",
      groupId: "group-second",
    })],
  });
  const dependencies = createAppDependencies(database);
  mockSuccessfulGeneration(dependencies, database);
  const share = deferred<"shared" | "cancelled" | "unavailable">();
  vi.spyOn(dependencies.reportGenerator, "shareOrDownloadReport").mockImplementation(() => share.promise);
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });

  await user.click(await screen.findByRole("button", { name: "生成Word" }));
  await screen.findByRole("button", { name: "分享Word" });
  await user.click(screen.getByRole("button", { name: "分享Word" }));
  window.location.hash = "#/inspections/inspection-2/review";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(await screen.findByText("Second inspection after share")).toBeVisible();

  await act(async () => {
    share.resolve(result);
    await share.promise;
  });

  expect(screen.getByText("Second inspection after share")).toBeVisible();
  expect(screen.queryByText(message)).not.toBeInTheDocument();
});

test("clears the reviewed success message on the next edit", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-message-clear-${Date.now()}`);
  await new InspectionRepository(database).saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup()],
    photos: [makePhoto()],
  });
  const dependencies = createAppDependencies(database);
  mockSuccessfulGeneration(dependencies, database);
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });

  await user.click(await screen.findByRole("button", { name: "生成Word" }));
  expect(await screen.findByText("Word已生成，可分享或下载。")).toBeVisible();
  await user.selectOptions(screen.getByRole("combobox", { name: "每行照片数" }), "2");

  expect(screen.queryByText("Word已生成，可分享或下载。")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "下载Word" })).not.toBeInTheDocument();
});

test("binds template versions to the active inspection across same-component route changes", async () => {
  const database = createTestDb(`review-route-template-${Date.now()}`);
  const templates = new TemplateRepository(database);
  await templates.save(makeTemplate());
  await templates.save(makeTemplate({ version: 2, name: "上一条巡检模板" }));
  await templates.save(makeTemplate({
    id: "template-other",
    name: "第二条巡检使用的名称很长但不能撑破手机复核设置区域的模板",
  }));
  const repository = new InspectionRepository(database);
  await repository.saveGraph({
    inspection: makeInspection({ templateVersion: 3 }),
    groups: [makePhotoGroup()],
    photos: [makePhoto()],
  });
  const secondBase = makeInspection();
  const secondInspection = makeInspection({
    id: "inspection-2",
    title: "第二条巡检",
    templateId: "template-other",
    entries: [{
      ...secondBase.entries[0],
      id: "entry-2",
      inspectionId: "inspection-2",
      groupIds: ["group-second"],
    }],
  });
  await repository.saveGraph({
    inspection: secondInspection,
    groups: [makePhotoGroup({
      id: "group-second",
      inspectionId: "inspection-2",
      entryId: "entry-2",
      photoIds: ["photo-second"],
    })],
    photos: [makePhoto(undefined, {
      id: "photo-second",
      inspectionId: "inspection-2",
      groupId: "group-second",
    })],
  });
  const dependencies = createAppDependencies(database);
  const secondVersions = deferred<ReturnType<typeof makeTemplate>[]>();
  const originalList = dependencies.templateRepository.listVersions.bind(dependencies.templateRepository);
  vi.spyOn(dependencies.templateRepository, "listVersions").mockImplementation((templateId) =>
    templateId === "template-other" ? secondVersions.promise : originalList(templateId),
  );
  const settingsSave = vi.spyOn(dependencies.inspectionRepository, "updateReviewSettings");
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });

  expect(await screen.findByRole("option", { name: "上一条巡检模板 v2" })).toBeVisible();
  window.location.hash = "#/inspections/inspection-2/review";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(await screen.findByText("第二条巡检")).toBeVisible();
  expect(screen.queryByRole("option", { name: "上一条巡检模板 v2" })).not.toBeInTheDocument();
  expect(settingsSave).not.toHaveBeenCalled();

  secondVersions.resolve([await templates.get("template-other", 1) as ReturnType<typeof makeTemplate>]);
  const longOption = await screen.findByRole("option", {
    name: "第二条巡检使用的名称很长但不能撑破手机复核设置区域的模板 v1",
  });
  const selector = longOption.closest("select")!;
  expect(selector).toHaveClass("review-template-select");
  expect(selector.closest("label")).toHaveClass("review-template-field");
});

test("shows packaging progress and marks generated only after retaining the successful Blob", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-generate-success-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await new TemplateRepository(database).save(makeTemplate());
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup()],
    photos: [makePhoto()],
  });
  const dependencies = createAppDependencies(database);
  const packaging = deferred<void>();
  const generatedBlob = new Blob(["generated-docx"], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const generate = vi.spyOn(dependencies.reportGenerator, "generateReport")
    .mockImplementation(async (inspectionId, onProgress) => {
      onProgress({ completedImages: 1, totalImages: 1, phase: "images" });
      await packaging.promise;
      await database.inspections.update(inspectionId, { status: "generated" });
      const graph = await dependencies.inspectionRepository.getGraph(inspectionId);
      if (!graph) throw new Error("test inspection missing");
      return {
        graph,
        blob: generatedBlob,
        filename: "向塘钢轨焊接整修车间7月28日7S巡检通报.docx",
      };
    });
  const share = vi.spyOn(dependencies.reportGenerator, "shareOrDownloadReport")
    .mockResolvedValue("cancelled");
  const download = vi.spyOn(dependencies.reportGenerator, "downloadReport")
    .mockImplementation(() => undefined);
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });

  await user.click(await screen.findByRole("button", { name: "生成Word" }));

  expect(await screen.findByText("正在处理照片 1/1")).toBeVisible();
  expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("draft");

  packaging.resolve();
  expect(await screen.findByText("Word已生成，可分享或下载。")).toBeVisible();
  expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("generated");
  expect(generate).toHaveBeenCalledOnce();
  expect(share).not.toHaveBeenCalled();

  await user.click(screen.getByRole("button", { name: "分享Word" }));
  expect(share).toHaveBeenCalledWith(
    generatedBlob,
    "向塘钢轨焊接整修车间7月28日7S巡检通报.docx",
  );
  expect(await screen.findByText("已取消分享，Word仍可分享或下载。")).toBeVisible();
  expect(screen.getByRole("button", { name: "分享Word" })).toBeVisible();
  expect(screen.getByRole("button", { name: "下载Word" })).toBeVisible();

  await user.click(screen.getByRole("button", { name: "下载Word" }));
  expect(download).toHaveBeenCalledWith(
    generatedBlob,
    "向塘钢轨焊接整修车间7月28日7S巡检通报.docx",
  );
});

test("keeps status unchanged after generation failure and supports retry", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-generate-retry-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await new TemplateRepository(database).save(makeTemplate());
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup()],
    photos: [makePhoto()],
  });
  const dependencies = createAppDependencies(database);
  const generatedBlob = new Blob(["retry-docx"], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const generate = vi.spyOn(dependencies.reportGenerator, "generateReport")
    .mockRejectedValueOnce(new Error("打包中断"))
    .mockImplementationOnce(async (inspectionId) => {
      await database.inspections.update(inspectionId, { status: "generated" });
      const graph = await dependencies.inspectionRepository.getGraph(inspectionId);
      if (!graph) throw new Error("test inspection missing");
      return {
        graph,
        blob: generatedBlob,
        filename: "向塘钢轨焊接整修车间7月28日7S巡检通报.docx",
      };
    });
  vi.spyOn(dependencies.reportGenerator, "shareOrDownloadReport").mockResolvedValue("shared");
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });

  await user.click(await screen.findByRole("button", { name: "生成Word" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Word生成失败，请重试。 打包中断");
  expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("draft");
  const retry = screen.getByRole("button", { name: "生成Word" });
  expect(retry).toBeEnabled();

  await user.click(retry);
  expect(await screen.findByText("Word已生成，可分享或下载。")).toBeVisible();
  expect(generate).toHaveBeenCalledTimes(2);
  expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("generated");
});

test("defers a requested update until report generation succeeds", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-update-success-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await new TemplateRepository(database).save(makeTemplate());
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup()],
    photos: [makePhoto()],
  });
  const dependencies = createAppDependencies(database);
  const completion = deferred<Awaited<ReturnType<typeof dependencies.reportGenerator.generateReport>>>();
  vi.spyOn(dependencies.reportGenerator, "generateReport").mockReturnValue(completion.promise);
  const updateServiceWorker = vi.fn().mockResolvedValue(undefined);
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });
  render(<PwaUpdatePrompt needRefresh updateServiceWorker={updateServiceWorker} />);

  await user.click(await screen.findByRole("button", { name: "生成Word" }));
  await waitFor(() => expect(dependencies.reportGenerator.generateReport).toHaveBeenCalledOnce());
  await user.click(screen.getByRole("button", { name: "立即更新" }));
  expect(updateServiceWorker).not.toHaveBeenCalled();

  const graph = await repository.getGraph("inspection-1");
  if (!graph) throw new Error("test inspection missing");
  await act(async () => completion.resolve({
    graph,
    blob: new Blob(["generated-docx"]),
    filename: "向塘钢轨焊接整修车间7月28日7S巡检通报.docx",
  }));
  expect(await screen.findByText("Word已生成，可分享或下载。")).toBeVisible();
  await waitFor(() => expect(updateServiceWorker).toHaveBeenCalledOnce());
});

test("keeps a requested update deferred after leaving a still-running report generation", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-update-route-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await new TemplateRepository(database).save(makeTemplate());
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup()],
    photos: [makePhoto()],
  });
  const dependencies = createAppDependencies(database);
  const completion = deferred<Awaited<ReturnType<typeof dependencies.reportGenerator.generateReport>>>();
  vi.spyOn(dependencies.reportGenerator, "generateReport").mockReturnValue(completion.promise);
  const updateServiceWorker = vi.fn().mockResolvedValue(undefined);
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });
  render(<PwaUpdatePrompt needRefresh updateServiceWorker={updateServiceWorker} />);

  await user.click(await screen.findByRole("button", { name: "生成Word" }));
  await waitFor(() => expect(dependencies.reportGenerator.generateReport).toHaveBeenCalledOnce());
  await user.click(screen.getByRole("button", { name: "立即更新" }));

  window.location.hash = "#/history";
  window.dispatchEvent(new HashChangeEvent("hashchange"));
  expect(await screen.findByRole("heading", { name: "巡检历史" })).toBeVisible();
  expect(updateServiceWorker).not.toHaveBeenCalled();

  const graph = await repository.getGraph("inspection-1");
  if (!graph) throw new Error("test inspection missing");
  await act(async () => completion.resolve({
    graph,
    blob: new Blob(["generated-docx"]),
    filename: "向塘钢轨焊接整修车间7月28日7S巡检通报.docx",
  }));
  await waitFor(() => expect(updateServiceWorker).toHaveBeenCalledOnce());
});

test("releases a deferred update after report generation fails", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-update-failure-${Date.now()}`);
  const repository = new InspectionRepository(database);
  await new TemplateRepository(database).save(makeTemplate());
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup()],
    photos: [makePhoto()],
  });
  const dependencies = createAppDependencies(database);
  const completion = deferred<Awaited<ReturnType<typeof dependencies.reportGenerator.generateReport>>>();
  vi.spyOn(dependencies.reportGenerator, "generateReport").mockReturnValue(completion.promise);
  const updateServiceWorker = vi.fn().mockResolvedValue(undefined);
  renderWithRouter({
    database,
    initialPath: "/inspections/inspection-1/review",
    appProps: { dependencies },
  });
  render(<PwaUpdatePrompt needRefresh updateServiceWorker={updateServiceWorker} />);

  await user.click(await screen.findByRole("button", { name: "生成Word" }));
  await waitFor(() => expect(dependencies.reportGenerator.generateReport).toHaveBeenCalledOnce());
  await user.click(screen.getByRole("button", { name: "立即更新" }));
  expect(updateServiceWorker).not.toHaveBeenCalled();

  await act(async () => completion.reject(new Error("打包中断")));
  expect(await screen.findByRole("alert")).toHaveTextContent("Word生成失败，请重试。 打包中断");
  await waitFor(() => expect(updateServiceWorker).toHaveBeenCalledOnce());
  expect(screen.getByRole("button", { name: "生成Word" })).toBeEnabled();
});

test("opens title sorting and editing dialogs for completed route names", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`review-route-dialogs-${Date.now()}`);
  const repository = new InspectionRepository(database);
  const base = makeInspection();
  const warehouseEntry = {
    ...base.entries[0],
    id: "entry-warehouse",
    itemId: "item-warehouse",
    order: 1,
    groupIds: ["group-warehouse"],
    itemSnapshot: {
      ...base.entries[0].itemSnapshot,
      id: "item-warehouse",
      routeName: "仓库外围院子",
      part: "仓库外围院子",
    },
  };
  const weldingEntry = {
    ...base.entries[0],
    id: "entry-welding",
    itemId: "item-welding",
    order: 0,
    groupIds: ["group-welding"],
    itemSnapshot: {
      ...base.entries[0].itemSnapshot,
      id: "item-welding",
      routeName: "焊机间",
      part: "焊机间",
    },
  };
  const officeEntry = {
    ...base.entries[0],
    id: "entry-office",
    itemId: "item-office",
    order: 2,
    groupIds: ["group-office"],
    itemSnapshot: {
      ...base.entries[0].itemSnapshot,
      id: "item-office",
      routeName: "装整工班办公室",
      part: "装整工班办公室",
    },
  };
  await repository.saveGraph({
    inspection: { ...base, entries: [weldingEntry, warehouseEntry, officeEntry] },
    groups: [
      makePhotoGroup({ id: "group-welding", entryId: weldingEntry.id, photoIds: ["photo-welding"] }),
      makePhotoGroup({ id: "group-warehouse", entryId: warehouseEntry.id, photoIds: ["photo-warehouse"], order: 1 }),
      makePhotoGroup({ id: "group-office", entryId: officeEntry.id, photoIds: [], order: 2 }),
    ],
    photos: [
      makePhoto(undefined, { id: "photo-welding", groupId: "group-welding" }),
      makePhoto(undefined, { id: "photo-warehouse", groupId: "group-warehouse" }),
    ],
  });

  renderWithRouter({ database, initialPath: "/inspections/inspection-1/review" });

  await user.click(await screen.findByRole("button", { name: "排序" }));
  expect(screen.getByRole("dialog", { name: "项点排序" })).toBeVisible();
  expect(screen.getByRole("region", { name: "好的方面" })).toBeVisible();
  expect(screen.getByRole("region", { name: "提醒问题" })).toBeVisible();
  expect(screen.getByRole("region", { name: "考核问题" })).toBeVisible();
  expect(screen.getAllByRole("button", { name: /拖动.*项点/ })).toHaveLength(3);

  await user.click(screen.getByRole("button", { name: "取消" }));
  await user.click(screen.getByRole("button", { name: "编辑 仓库外围院子" }));
  expect(screen.getByRole("dialog", { name: "编辑 仓库外围院子" })).toBeVisible();
  expect(screen.getByRole("button", { name: /检查内容/ })).toBeVisible();
  expect(screen.getByLabelText("相册文件")).toBeVisible();
});
