import {
  changePhotoGroupCategory,
  createInspection,
  createInspectionEntry,
  createPhotoGroup,
  descriptionForCategory,
  isPositiveSafeInteger,
  parseAnnotationJson,
  serializeAnnotationShapes,
  splitPhotoIntoGroup,
} from "./inspection";
import type { ChecklistItem } from "./models";
import { createId } from "../lib/ids";
import { toInspectionTimestamp } from "../lib/dates";
import { makeChecklistItem } from "../test/fixtures";

const item: ChecklistItem = {
  id: "item-1",
  routeOrder: 1,
  routeName: "焊机间",
  area: "二线焊机",
  device: "焊机",
  part: "油缸",
  standard: "油缸表面无积灰、油污",
  team: "焊接工班",
  sevenSCategory: "清扫",
  goodText: "油缸表面清理较干净。",
  generalText: "油缸7S管理基本落实，但现场标准仍有提升空间。",
  reminderText: "油缸表面积灰、油污清理不到位，本次予以提醒。",
  assessmentText: "油缸表面积灰、油污未清理。",
  quickPhrases: ["积灰未清理", "油污未清理"],
  enabled: true,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
};

test("new photo groups default to good", () => {
  const group = createPhotoGroup(item, "inspection-1", "entry-1", ["photo-1"], "group-1");

  expect(group.category).toBe("good");
  expect(group.description).toBe(item.goodText);
  expect(group.awardAssessment).toBeNull();
});

test("uses independent general-performance text and a legacy fallback", () => {
  const item = makeChecklistItem({
    generalText: "油缸表面基本清洁，但标准化保养仍有提升空间。",
  });

  expect(descriptionForCategory(item, "general")).toBe(
    "油缸表面基本清洁，但标准化保养仍有提升空间。",
  );
  expect(descriptionForCategory({ ...item, generalText: undefined }, "general")).toBe(
    "油缸7S管理基本落实，但现场标准仍有提升空间。",
  );
});

test("changing to general clears reward or assessment data and uses general text", () => {
  const source = {
    ...createPhotoGroup(item, "inspection-1", "entry-1", ["photo-1"], "group-1"),
    category: "good" as const,
    awardAssessment: { type: "reward" as const, people: "张三", amount: 50 },
  };

  const result = changePhotoGroupCategory(source, "general", item);

  expect(result.category).toBe("general");
  expect(result.description).toBe(item.generalText);
  expect(result.awardAssessment).toBeNull();
});

test("split photo creates a separate immutable group", () => {
  const source = createPhotoGroup(
    item,
    "inspection-1",
    "entry-1",
    ["photo-1", "photo-2"],
    "group-1",
  );
  const result = splitPhotoIntoGroup(source, "photo-1", "reminder", item, "group-2");

  expect(source.photoIds).toEqual(["photo-1", "photo-2"]);
  expect(result.source.photoIds).toEqual(["photo-2"]);
  expect(result.created.photoIds).toEqual(["photo-1"]);
  expect(result.created.category).toBe("reminder");
  expect(result.created.description).toBe(item.reminderText);
});

test("single photo group changes category without splitting", () => {
  const source = createPhotoGroup(item, "inspection-1", "entry-1", ["photo-1"], "group-1");
  const result = changePhotoGroupCategory(source, "assessment", item);

  expect(result).not.toBe(source);
  expect(source.category).toBe("good");
  expect(result.category).toBe("assessment");
  expect(result.description).toBe(item.assessmentText);
  expect(result.awardAssessment).toBeNull();
  expect(() => splitPhotoIntoGroup(source, "photo-1", "reminder", item, "group-2")).toThrow(
    "单照片组不能拆分",
  );
});

test("inspection snapshots selected items immutably", () => {
  const inspection = createInspection([item], "inspection-1", "2026-07-28");
  item.part = "已修改部位";
  item.quickPhrases[0] = "已修改短语";

  expect(inspection.entries).toHaveLength(1);
  expect(inspection.entries[0]?.checkSelections).toEqual([]);
  expect(inspection.entries[0]?.itemSnapshot.part).toBe("油缸");
  expect(inspection.entries[0]?.itemSnapshot.quickPhrases[0]).toBe("积灰未清理");
  expect(inspection.entries[0]?.itemSnapshot).not.toHaveProperty("enabled");
});

test("creates an inspection entry with supplied identity, order, and an immutable snapshot", () => {
  const source = {
    ...item,
    part: "控制柜",
    quickPhrases: ["柜内积灰"],
  };

  const entry = createInspectionEntry(
    source,
    "inspection-temporary",
    "temporary-entry-fixed",
    7,
  );
  expect(entry.checkSelections).toEqual([]);
  source.part = "已修改部位";
  source.quickPhrases[0] = "已修改短语";

  expect(entry).toEqual({
    id: "temporary-entry-fixed",
    inspectionId: "inspection-temporary",
    itemId: "item-1",
    itemSnapshot: {
      id: "item-1",
      routeOrder: 1,
      routeName: "焊机间",
      area: "二线焊机",
      device: "焊机",
      part: "控制柜",
      standard: "油缸表面无积灰、油污",
      team: "焊接工班",
      sevenSCategory: "清扫",
      goodText: "油缸表面清理较干净。",
      generalText: "油缸7S管理基本落实，但现场标准仍有提升空间。",
      reminderText: "油缸表面积灰、油污清理不到位，本次予以提醒。",
      assessmentText: "油缸表面积灰、油污未清理。",
      quickPhrases: ["柜内积灰"],
    },
    groupIds: [],
    checkSelections: [],
    order: 7,
  });
});

test("id and timestamp helpers are deterministic with supplied input", () => {
  expect(createId("inspection", "fixed-uuid")).toBe("inspection-fixed-uuid");
  expect(toInspectionTimestamp("2026-07-28")).toBe("2026-07-28T00:00:00.000Z");
});

test("accepts only positive safe integer amounts", () => {
  expect(isPositiveSafeInteger(1)).toBe(true);
  expect(isPositiveSafeInteger(70)).toBe(true);
  expect(isPositiveSafeInteger(0)).toBe(false);
  expect(isPositiveSafeInteger(-1)).toBe(false);
  expect(isPositiveSafeInteger(1.5)).toBe(false);
  expect(isPositiveSafeInteger(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
});

test("round-trips normalized annotation JSON", () => {
  const shapes = [
    { type: "ellipse" as const, x: 0.1, y: 0.2, width: 0.3, height: 0.4, color: "#d12f2f" as const },
    { type: "arrow" as const, points: [0, 0, 1, 1], color: "#d12f2f" as const },
    { type: "text" as const, x: 0.5, y: 0.5, text: "清理", color: "#d12f2f" as const },
  ];

  expect(parseAnnotationJson(serializeAnnotationShapes(shapes))).toEqual(shapes);
  expect(() => parseAnnotationJson('[{"type":"text","x":2,"y":0,"text":"x","color":"#d12f2f"}]'))
    .toThrow("标注坐标必须在0到1之间");
});

test("rejects ellipses that extend beyond the normalized image boundary", () => {
  expect(() => parseAnnotationJson(JSON.stringify([{
    type: "ellipse",
    x: 0.8,
    y: 0.7,
    width: 0.3,
    height: 0.4,
    color: "#d12f2f",
  }]))).toThrow("椭圆标注不能超出照片边界");
});

test("requires arrows to contain exactly one start and one end point", () => {
  expect(() => parseAnnotationJson(JSON.stringify([{
    type: "arrow",
    points: [0, 0, 0.5, 0.5, 1, 1],
    color: "#d12f2f",
  }]))).toThrow("箭头标注必须包含起点和终点");
});
