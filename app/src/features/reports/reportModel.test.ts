import { makeInspection, makePhoto, makePhotoGroup, makeTemplate } from "../../test/fixtures";
import { buildReportFilename, buildReportModel } from "./reportModel";

test("builds the required Word filename from the inspection date", () => {
  expect(buildReportFilename("2026-07-28")).toBe(
    "向塘钢轨焊接整修车间7月28日7S巡检通报.docx",
  );
});

test("copies the selected template first-line indentation into the report model", () => {
  const template = makeTemplate({ firstLineIndentChars: 3 });
  const inspection = makeInspection();
  const model = buildReportModel({
    inspection,
    groups: [makePhotoGroup({ photoIds: ["photo-1"] })],
    photos: [makePhoto()],
    template,
  }, template);

  expect(model.firstLineIndentChars).toBe(3);
});

test("keeps only photographed categories and distinguishes cleared from missing headings", () => {
  const template = makeTemplate({ generalHeading: "", situationHeading: "" });
  const inspection = makeInspection();
  const graph = {
    inspection,
    groups: [makePhotoGroup({ photoIds: ["photo-1"] })],
    photos: [makePhoto()],
    template,
  };

  const cleared = buildReportModel(graph, template);
  const legacyTemplate = { ...makeTemplate() };
  delete (legacyTemplate as { generalHeading?: string }).generalHeading;
  delete (legacyTemplate as { situationHeading?: string }).situationHeading;
  const legacy = buildReportModel({ ...graph, template: legacyTemplate }, legacyTemplate);

  expect(cleared.sections.map((section) => section.category)).toEqual(["good"]);
  expect(cleared.generalHeading).toBe("");
  expect(cleared.situationHeading).toBe("");
  expect(legacy.generalHeading).toBe("一、“7S”巡检工作总体要求");
  expect(legacy.situationHeading).toBe("二、本次检查总体情况");
});

test("orders each report category by the saved review route title order", () => {
  const template = makeTemplate();
  const baseInspection = makeInspection();
  const assemblyEntry = {
    ...baseInspection.entries[0],
    id: "entry-assembly",
    itemId: "item-assembly",
    itemSnapshot: { ...baseInspection.entries[0].itemSnapshot, id: "item-assembly", routeName: "Assembly office" },
    groupIds: ["group-assembly-good"],
    order: 0,
  };
  const warehouseEntry = {
    ...baseInspection.entries[0],
    id: "entry-warehouse",
    itemId: "item-warehouse",
    itemSnapshot: { ...baseInspection.entries[0].itemSnapshot, id: "item-warehouse", routeName: "Warehouse yard" },
    groupIds: ["group-warehouse-reminder"],
    order: 1,
  };
  const winchEntry = {
    ...baseInspection.entries[0],
    id: "entry-winch",
    itemId: "item-winch",
    itemSnapshot: { ...baseInspection.entries[0].itemSnapshot, id: "item-winch", routeName: "Winch room" },
    groupIds: ["group-winch-good", "group-winch-assessment"],
    order: 2,
  };
  const groups = [
    makePhotoGroup({ id: "group-assembly-good", entryId: assemblyEntry.id, category: "good", description: "Assembly good", photoIds: ["photo-assembly-good"], order: 3 }),
    makePhotoGroup({ id: "group-warehouse-reminder", entryId: warehouseEntry.id, category: "reminder", description: "Warehouse reminder", photoIds: ["photo-warehouse-reminder"], order: 2 }),
    makePhotoGroup({ id: "group-winch-good", entryId: winchEntry.id, category: "good", description: "Winch good", photoIds: ["photo-winch-good"], order: 1 }),
    makePhotoGroup({ id: "group-winch-assessment", entryId: winchEntry.id, category: "assessment", description: "Winch assessment", photoIds: ["photo-winch-assessment"], order: 0 }),
  ];
  const photos = groups.map((group) => makePhoto(undefined, { id: group.photoIds[0], groupId: group.id }));
  const inspection = {
    ...baseInspection,
    entries: [assemblyEntry, warehouseEntry, winchEntry],
    reviewRouteOrder: ["Winch room", "Warehouse yard", "Assembly office"],
  };

  const ordered = buildReportModel({ inspection, groups, photos, template }, template);
  const legacyInspection = { ...inspection };
  delete (legacyInspection as { reviewRouteOrder?: string[] }).reviewRouteOrder;
  const legacy = buildReportModel({ inspection: legacyInspection, groups, photos, template }, template);

  expect(ordered.sections.find((section) => section.category === "good")?.groups.map((group) => group.text))
    .toEqual(["Winch good", "Assembly good"]);
  expect(ordered.sections.find((section) => section.category === "reminder")?.groups.map((group) => group.text))
    .toEqual(["Warehouse reminder"]);
  expect(ordered.sections.find((section) => section.category === "assessment")?.groups.map((group) => group.text))
    .toEqual(["Winch assessment"]);
  expect(legacy.sections.find((section) => section.category === "good")?.groups.map((group) => group.text))
    .toEqual(["Assembly good", "Winch good"]);
});

test("uses each category's independent route-title order in the matching Word section", () => {
  const template = makeTemplate();
  const base = makeInspection();
  const winch = {
    ...base.entries[0],
    id: "entry-winch",
    itemId: "item-winch",
    order: 0,
    groupIds: ["good-winch", "reminder-winch"],
    itemSnapshot: { ...base.entries[0].itemSnapshot, id: "item-winch", routeName: "卷扬机间" },
  };
  const warehouse = {
    ...base.entries[0],
    id: "entry-warehouse",
    itemId: "item-warehouse",
    order: 1,
    groupIds: ["good-warehouse", "reminder-warehouse"],
    itemSnapshot: { ...base.entries[0].itemSnapshot, id: "item-warehouse", routeName: "仓库外围院子" },
  };
  const model = buildReportModel({
    inspection: {
      ...base,
      entries: [winch, warehouse],
      reviewRouteOrder: ["卷扬机间", "仓库外围院子"],
      reviewRouteOrderByCategory: {
        good: ["仓库外围院子", "卷扬机间"],
        reminder: ["卷扬机间", "仓库外围院子"],
      },
    },
    groups: [
      makePhotoGroup({ id: "good-winch", entryId: winch.id, description: "卷扬机间好", photoIds: ["photo-good-winch"] }),
      makePhotoGroup({ id: "good-warehouse", entryId: warehouse.id, description: "仓库好", photoIds: ["photo-good-warehouse"], order: 1 }),
      makePhotoGroup({ id: "reminder-winch", entryId: winch.id, category: "reminder", description: "卷扬机间提醒", photoIds: ["photo-reminder-winch"], order: 2 }),
      makePhotoGroup({ id: "reminder-warehouse", entryId: warehouse.id, category: "reminder", description: "仓库提醒", photoIds: ["photo-reminder-warehouse"], order: 3 }),
    ],
    photos: [
      makePhoto(undefined, { id: "photo-good-winch", groupId: "good-winch" }),
      makePhoto(undefined, { id: "photo-good-warehouse", groupId: "good-warehouse" }),
      makePhoto(undefined, { id: "photo-reminder-winch", groupId: "reminder-winch" }),
      makePhoto(undefined, { id: "photo-reminder-warehouse", groupId: "reminder-warehouse" }),
    ],
    template,
  }, template);

  expect(model.sections.find((section) => section.category === "good")?.groups.map((group) => group.text))
    .toEqual(["仓库好", "卷扬机间好"]);
  expect(model.sections.find((section) => section.category === "reminder")?.groups.map((group) => group.text))
    .toEqual(["卷扬机间提醒", "仓库提醒"]);
});

test("refuses to build a report model without a persisted photo", () => {
  const template = makeTemplate();
  const inspection = makeInspection({
    entries: [{ ...makeInspection().entries[0], groupIds: [] }],
  });

  expect(() => buildReportModel({
    inspection,
    groups: [],
    photos: [],
    template,
  }, template)).toThrow("报告至少需要一张已归组照片。");
});

test("uses selected check text verbatim across photo categories and omits annex rows", () => {
  const template = makeTemplate();
  const inspection = makeInspection();
  const entry = {
    ...inspection.entries[0],
    id: "entry-selected",
    itemId: "item-selected",
    itemSnapshot: {
      ...inspection.entries[0].itemSnapshot,
      id: "item-selected",
      routeName: "卷扬机间",
    },
    checkSelections: [
      { category: "environment" as const, value: "干净整洁", isCustom: false },
      { category: "placement" as const, value: "规范有序", isCustom: false },
      { category: "safety" as const, value: "消防器材缺失", isCustom: true },
    ],
    groupIds: ["group-good", "group-reminder", "group-assessment"],
  };
  const groups = [
    makePhotoGroup({
      id: "group-good",
      entryId: entry.id,
      category: "good",
      description: "卷扬机间7S管理落实较好。",
      awardAssessment: { type: "reward", people: "张三", amount: 50 },
      photoIds: ["photo-good"],
    }),
    makePhotoGroup({
      id: "group-reminder",
      entryId: entry.id,
      category: "reminder",
      description: "卷扬机间本次予以提醒。",
      photoIds: ["photo-reminder"],
    }),
    makePhotoGroup({
      id: "group-assessment",
      entryId: entry.id,
      category: "assessment",
      description: "卷扬机间存在7S管理不到位问题。",
      awardAssessment: { type: "assessment", people: "李四", amount: 70 },
      photoIds: ["photo-assessment"],
    }),
  ];
  const model = buildReportModel({
    inspection: { ...inspection, entries: [entry] },
    groups,
    photos: [
      makePhoto(undefined, { id: "photo-good", groupId: "group-good" }),
      makePhoto(undefined, { id: "photo-reminder", groupId: "group-reminder" }),
      makePhoto(undefined, { id: "photo-assessment", groupId: "group-assessment" }),
    ],
    template,
  }, template);

  const baseText = "卷扬机间：环境卫生干净整洁，物品定置规范有序，安全防护消防器材缺失。";
  expect(model.sections.map((section) => section.groups.map((group) => group.text))).toEqual([
    [`${baseText}（奖励：张三，50元）`],
    [baseText],
    [`${baseText}（考核：李四，70元）`],
  ]);
  expect(model).not.toHaveProperty("annexRows");
});

test("uses a manually edited evaluation description instead of selected check text", () => {
  const template = makeTemplate();
  const inspection = makeInspection();
  const entry = {
    ...inspection.entries[0],
    checkSelections: [{ category: "environment" as const, value: "干净整洁", isCustom: false }],
  };
  const manualDescription = "卷扬机间：环境卫生干净整洁，补充：地沟已清理。";
  const model = buildReportModel({
    inspection: { ...inspection, entries: [entry] },
    groups: [makePhotoGroup({
      description: manualDescription,
      descriptionManuallyEdited: true,
      photoIds: ["photo-1"],
    })],
    photos: [makePhoto()],
    template,
  }, template);

  expect(model.sections[0]?.groups[0]?.text).toBe(manualDescription);
});

test("falls back to group descriptions for old inspections with empty or missing selections", () => {
  const template = makeTemplate();
  const inspection = makeInspection();
  const emptyEntry = {
    ...inspection.entries[0],
    id: "entry-empty",
    groupIds: ["group-empty"],
    checkSelections: [],
  };
  const missingEntry = {
    ...inspection.entries[0],
    id: "entry-missing",
    groupIds: ["group-missing"],
  };
  delete (missingEntry as { checkSelections?: unknown }).checkSelections;
  const model = buildReportModel({
    inspection: { ...inspection, entries: [emptyEntry, missingEntry] },
    groups: [
      makePhotoGroup({
        id: "group-empty",
        entryId: emptyEntry.id,
        description: "旧巡检空选项说明。",
        photoIds: ["photo-empty"],
      }),
      makePhotoGroup({
        id: "group-missing",
        entryId: missingEntry.id,
        description: "旧巡检缺失选项说明。",
        photoIds: ["photo-missing"],
      }),
    ],
    photos: [
      makePhoto(undefined, { id: "photo-empty", groupId: "group-empty" }),
      makePhoto(undefined, { id: "photo-missing", groupId: "group-missing" }),
    ],
    template,
  }, template);

  expect(model.sections[0].groups.map((group) => group.text)).toEqual([
    "旧巡检空选项说明。",
    "旧巡检缺失选项说明。",
  ]);
});

test("does not expose annex rows", () => {
  const template = makeTemplate();
  const inspection = makeInspection();
  const model = buildReportModel({
    inspection,
    groups: [makePhotoGroup({ photoIds: ["photo-1"] })],
    photos: [makePhoto()],
    template,
  }, template);

  expect(model).not.toHaveProperty("annexRows");
});

test("excludes entries without photos from report body sections", () => {
  const template = makeTemplate();
  const inspection = makeInspection();
  const photographedEntry = {
    ...inspection.entries[0],
    id: "entry-photographed",
    groupIds: ["group-photographed"],
  };
  const noPhotoEntry = {
    ...inspection.entries[0],
    id: "entry-no-photo",
    groupIds: ["group-no-photo"],
  };
  const model = buildReportModel({
    inspection: { ...inspection, entries: [photographedEntry, noPhotoEntry] },
    groups: [
      makePhotoGroup({
        id: "group-photographed",
        entryId: photographedEntry.id,
        description: "有照片项。",
        photoIds: ["photo-photographed"],
      }),
      makePhotoGroup({
        id: "group-no-photo",
        entryId: noPhotoEntry.id,
        description: "无照片项。",
        photoIds: [],
      }),
    ],
    photos: [makePhoto(undefined, { id: "photo-photographed", groupId: "group-photographed" })],
    template,
  }, template);

  expect(model.sections.flatMap((section) => section.groups.map((group) => group.text))).toEqual(["有照片项。"]);
});

test("rejects a photographed group that references a missing inspection entry", () => {
  const template = makeTemplate();
  const inspection = makeInspection({
    entries: [{ ...makeInspection().entries[0], groupIds: [] }],
  });

  expect(() => buildReportModel({
    inspection,
    groups: [makePhotoGroup({ entryId: "missing-entry", photoIds: ["photo-1"] })],
    photos: [makePhoto(undefined, { id: "photo-1" })],
    template,
  }, template)).toThrow("关联的巡检项点不存在。");
});
