// @vitest-environment node

import { afterEach, describe, expect, test, vi } from "vitest";
import { createAppDependencies, initializeApp } from "../app/dependencies";
import { createInspection } from "../domain/inspection";
import { validateReportReadiness } from "../domain/reportValidation";
import type { InspectionGraph, InspectionRouteTemplate, PhotoGroup } from "../domain/models";
import { inspectionRouteTemplateSchema } from "../domain/schemas";
import { generateDocx } from "../features/reports/generateDocx";
import { buildReportModel } from "../features/reports/reportModel";
import {
  makeChecklistItem,
  makeInspection,
  makePhoto,
  makePhotoGroup,
  makeTemplate,
} from "../test/fixtures";
import { createTestDb, type SevenSDb } from "./database";
import { InspectionRepository } from "./inspectionRepository";
import { ItemRepository } from "./itemRepository";
import { RouteTemplateRepository } from "./routeTemplateRepository";
import { TemplateRepository } from "./templateRepository";

const databases: SevenSDb[] = [];

function readBlobBytes(blob: Blob): Promise<Uint8Array> {
  return blob.arrayBuffer().then((bytes) => new Uint8Array(bytes));
}

async function readBlobText(blob: Blob): Promise<string> {
  return new TextDecoder().decode(await readBlobBytes(blob));
}

function testDb(name: string): SevenSDb {
  const db = createTestDb(name);
  databases.push(db);
  return db;
}

function temporaryId(kind: "entry" | "item", sequence: number): string {
  return `temporary-${kind}-00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

afterEach(async () => {
  await Promise.all(
    databases.splice(0).map(async (db) => {
      db.close();
      await db.delete();
    }),
  );
});

function makeTwoGroupGraph(): InspectionGraph {
  const inspection = makeInspection({
    entries: [
      {
        ...makeInspection().entries[0],
        groupIds: ["group-1", "group-2"],
      },
    ],
  });
  const groups = [
    makePhotoGroup({ photoIds: ["photo-1", "photo-2"], order: 0 }),
    makePhotoGroup({
      id: "group-2",
      category: "reminder",
      description: "现场物品定置不到位，本次予以提醒。",
      photoIds: ["photo-3"],
      order: 1,
    }),
  ];
  const photos = [
    makePhoto(new Blob(["one"], { type: "image/jpeg" })),
    makePhoto(new Blob(["two"], { type: "image/jpeg" }), { id: "photo-2", order: 1 }),
    makePhoto(new Blob(["three"], { type: "image/jpeg" }), {
      id: "photo-3",
      groupId: "group-2",
      order: 0,
    }),
  ];

  return { inspection, groups, photos };
}

async function persistAsGenerated(
  repository: InspectionRepository,
  graph: InspectionGraph,
): Promise<void> {
  await repository.saveGraph(graph);
  const packagedSnapshot = await repository.getReadyGraphForGeneration(graph.inspection.id);
  await repository.markGeneratedAfterPackaging(
    graph.inspection.id,
    packagedSnapshot,
    await packageSnapshot(packagedSnapshot),
  );
}

function packageSnapshot(graph: InspectionGraph): Promise<Blob> {
  if (!graph.template) throw new Error("test graph template missing");
  return generateDocx(buildReportModel(graph, graph.template), () => undefined, {
    renderAnnotation: async (source) => source,
  });
}

describe("InspectionRepository", () => {
  test("persists a complete route-title order and updates the inspection timestamp", async () => {
    const db = testDb("review-route-order-round-trip");
    const repository = new InspectionRepository(db);
    const inspection = makeInspection({
      entries: [
        { ...makeInspection().entries[0]!, groupIds: [] },
        {
          ...makeInspection().entries[0]!,
          id: "entry-2",
          itemId: "item-2",
          itemSnapshot: {
            ...makeInspection().entries[0]!.itemSnapshot,
            id: "item-2",
            routeName: "仓库外围院子",
          },
          groupIds: [],
          order: 1,
        },
      ],
    });
    await repository.saveGraph({ inspection, groups: [], photos: [] });

    const updated = await repository.updateReviewRouteOrder("inspection-1", ["仓库外围院子", "焊机间"]);

    expect(updated.reviewRouteOrder).toEqual(["仓库外围院子", "焊机间"]);
    expect(updated.updatedAt).not.toBe(inspection.updatedAt);
    expect((await repository.getGraph("inspection-1"))?.inspection.reviewRouteOrder)
      .toEqual(["仓库外围院子", "焊机间"]);
  });

  test("persists separate route-title orders for the three review categories", async () => {
    const db = testDb("review-route-order-by-category-round-trip");
    const repository = new InspectionRepository(db);
    const inspection = makeInspection({
      entries: [
        { ...makeInspection().entries[0]!, groupIds: [] },
        {
          ...makeInspection().entries[0]!,
          id: "entry-2",
          itemId: "item-2",
          itemSnapshot: {
            ...makeInspection().entries[0]!.itemSnapshot,
            id: "item-2",
            routeName: "仓库外围院子",
          },
          groupIds: [],
          order: 1,
        },
      ],
    });
    await repository.saveGraph({ inspection, groups: [], photos: [] });

    const updated = await repository.updateReviewRouteOrderByCategory("inspection-1", {
      good: ["仓库外围院子", "焊机间"],
      reminder: ["焊机间"],
      assessment: [],
    });

    expect(updated.reviewRouteOrderByCategory).toEqual({
      good: ["仓库外围院子", "焊机间"],
      reminder: ["焊机间"],
      assessment: [],
    });
    expect((await repository.getGraph("inspection-1"))?.inspection.reviewRouteOrderByCategory)
      .toEqual(updated.reviewRouteOrderByCategory);
    await expect(repository.updateReviewRouteOrderByCategory("inspection-1", {
      good: ["焊机间", "焊机间"],
    })).rejects.toThrow("分类项点排序不能重复。");
  });

  test("rejects duplicate, incomplete, and unknown route-title order values", async () => {
    const db = testDb("review-route-order-validation");
    const repository = new InspectionRepository(db);
    const inspection = makeInspection({
      entries: [
        { ...makeInspection().entries[0]!, groupIds: [] },
        {
          ...makeInspection().entries[0]!,
          id: "entry-2",
          itemId: "item-2",
          itemSnapshot: {
            ...makeInspection().entries[0]!.itemSnapshot,
            id: "item-2",
            routeName: "仓库外围院子",
          },
          groupIds: [],
          order: 1,
        },
      ],
    });
    await repository.saveGraph({ inspection, groups: [], photos: [] });

    await expect(repository.updateReviewRouteOrder("inspection-1", ["焊机间", "焊机间"]))
      .rejects.toThrow("巡检项点排序不能重复。");
    await expect(repository.updateReviewRouteOrder("inspection-1", ["焊机间"]))
      .rejects.toThrow("巡检项点排序必须包含当前巡检的全部项点。");
    await expect(repository.updateReviewRouteOrder("inspection-1", ["焊机间", "未知项点"]))
      .rejects.toThrow("巡检项点排序包含未知项点。");
  });

  test("round trips ordered graph data and blob bytes", async () => {
    const db = testDb("round-trip");
    const repository = new InspectionRepository(db);
    const base = makeInspection();
    const secondEntry = {
      ...base.entries[0],
      id: "entry-2",
      itemId: "item-2",
      itemSnapshot: { ...base.entries[0].itemSnapshot, id: "item-2", part: "控制柜" },
      groupIds: ["group-2"],
      order: 1,
    };
    const inspection = makeInspection({ entries: [secondEntry, base.entries[0]] });
    const group1 = makePhotoGroup({ order: 0 });
    const group2 = makePhotoGroup({
      id: "group-2",
      entryId: "entry-2",
      photoIds: ["photo-2"],
      order: 1,
    });
    const photo1 = makePhoto(new Blob([new Uint8Array([0, 1, 2, 255])], { type: "image/jpeg" }));
    const photo2 = makePhoto(new Blob(["second"], { type: "image/jpeg" }), {
      id: "photo-2",
      groupId: "group-2",
    });

    await repository.saveGraph({
      inspection,
      groups: [group2, group1],
      photos: [photo2, photo1],
    });
    const restored = await repository.getGraph(inspection.id);

    expect(restored?.inspection.entries.map((entry) => entry.id)).toEqual(["entry-1", "entry-2"]);
    expect(restored?.groups.map((group) => group.id)).toEqual(["group-1", "group-2"]);
    expect(restored?.photos.map((photo) => photo.id)).toEqual(["photo-1", "photo-2"]);
    expect(await readBlobBytes(restored!.photos[0].imageBlob)).toEqual(new Uint8Array([0, 1, 2, 255]));
    expect(await readBlobText(restored!.photos[0].thumbnailBlob)).toBe("thumb");
    expect(restored?.photos[0].imageBlob.type).toBe("image/jpeg");
  });

  test("returns null for an unknown inspection", async () => {
    const repository = new InspectionRepository(testDb("unknown"));

    await expect(repository.getGraph("missing")).resolves.toBeNull();
  });

  test("stores normalized check selections on only the target entry", async () => {
    const db = testDb("check-selections-update");
    const repository = new InspectionRepository(db);
    const graph = makeTwoGroupGraph();
    const secondEntry = {
      ...graph.inspection.entries[0],
      id: "entry-2",
      itemId: "item-2",
      itemSnapshot: { ...graph.inspection.entries[0].itemSnapshot, id: "item-2" },
      groupIds: [],
      order: 1,
    };
    await repository.saveGraph({
      ...graph,
      inspection: { ...graph.inspection, entries: [...graph.inspection.entries, secondEntry] },
    });
    await db.inspections.update("inspection-1", { status: "reviewed" });
    await db.checklistItems.add(makeRouteItem());
    await db.routeTemplates.add(makeRouteTemplate({ itemIds: ["core-route-01"] }));
    const before = {
      otherEntry: await db.entries.get("entry-2"),
      groups: await db.photoGroups.toArray(),
      photos: await db.photos.toArray(),
      items: await db.checklistItems.toArray(),
      templates: await db.routeTemplates.toArray(),
    };

    const result = await repository.updateEntryCheckSelections(
      "inspection-1",
      "entry-1",
      [
        { category: "safety", value: "\u5b89\u5168\u901a\u9053\u7545\u901a", isCustom: false },
        { category: "environment", value: "  \u672c\u6b21\u5df2\u6e05\u626b  ", isCustom: true },
      ],
      "2026-07-30T13:00:00.000Z",
    );

    expect(result).toEqual({
      entry: expect.objectContaining({
        id: "entry-1",
        groupIds: ["group-1", "group-2"],
        checkSelections: [
          { category: "environment", value: "\u672c\u6b21\u5df2\u6e05\u626b", isCustom: true },
          { category: "safety", value: "\u5b89\u5168\u901a\u9053\u7545\u901a", isCustom: false },
        ],
      }),
      updatedAt: "2026-07-30T13:00:00.000Z",
    });
    expect(await db.entries.get("entry-2")).toEqual(before.otherEntry);
    expect(await db.photoGroups.toArray()).toEqual(before.groups);
    expect(await db.photos.toArray()).toEqual(before.photos);
    expect(await db.checklistItems.toArray()).toEqual(before.items);
    expect(await db.routeTemplates.toArray()).toEqual(before.templates);
    expect(await db.inspections.get("inspection-1")).toMatchObject({
      status: "draft",
      updatedAt: "2026-07-30T13:00:00.000Z",
    });
  });

  test("rejects invalid, missing, deleted, and cross-inspection selection updates without changing entries", async () => {
    const db = testDb("check-selections-validation");
    const repository = new InspectionRepository(db);
    await repository.saveGraph(makeTwoGroupGraph());
    const other = makeInspection({
      id: "inspection-2",
      entries: [{
        ...makeInspection().entries[0],
        id: "entry-other",
        inspectionId: "inspection-2",
        groupIds: [],
      }],
    });
    await repository.saveGraph({ inspection: other, groups: [], photos: [] });
    const before = await db.entries.get("entry-1");
    const selections = [{ category: "environment" as const, value: "\u5e72\u51c0\u6574\u6d01", isCustom: false }];

    await expect(repository.updateEntryCheckSelections("missing", "entry-1", selections))
      .rejects.toThrow("\u5de1\u68c0\u8bb0\u5f55\u4e0d\u5b58\u5728\u6216\u5df2\u5220\u9664");
    await expect(repository.updateEntryCheckSelections("inspection-1", "missing", selections))
      .rejects.toThrow("\u5de1\u68c0\u6761\u76ee missing \u4e0d\u5b58\u5728");
    await expect(repository.updateEntryCheckSelections("inspection-1", "entry-other", selections))
      .rejects.toThrow("\u4e0d\u5c5e\u4e8e\u5f53\u524d\u5de1\u68c0\u8bb0\u5f55");
    await expect(repository.updateEntryCheckSelections("inspection-1", "entry-1", [
      { category: "environment", value: "\u65e0\u6548", isCustom: false },
    ])).rejects.toThrow("\u56fa\u5b9a\u68c0\u67e5\u5185\u5bb9\u65e0\u6548");
    expect(await db.entries.get("entry-1")).toEqual(before);

    await repository.moveToTrash("inspection-1", "2026-07-30T13:05:00.000Z");
    const deletedBefore = await db.entries.get("entry-1");
    await expect(repository.updateEntryCheckSelections("inspection-1", "entry-1", selections))
      .rejects.toThrow("\u5de1\u68c0\u8bb0\u5f55\u4e0d\u5b58\u5728\u6216\u5df2\u5220\u9664");
    expect(await db.entries.get("entry-1")).toEqual(deletedBefore);
  });

  test("rolls back a selection update when the inspection update affects no record", async () => {
    const db = testDb("check-selections-rollback");
    const repository = new InspectionRepository(db);
    await repository.saveGraph(makeTwoGroupGraph());
    const before = await db.entries.get("entry-1");
    vi.spyOn(db.inspections, "update").mockResolvedValueOnce(0);

    await expect(repository.updateEntryCheckSelections("inspection-1", "entry-1", [
      { category: "environment", value: "\u5e72\u51c0\u6574\u6d01", isCustom: false },
    ])).rejects.toThrow("\u66f4\u65b0\u5931\u8d25");

    expect(await db.entries.get("entry-1")).toEqual(before);
  });

  test("keeps concurrent selection and photo updates on the same entry", async () => {
    const db = testDb("check-selections-concurrent-photo");
    const repository = new InspectionRepository(db);
    const inspection = makeInspection({
      entries: makeInspection().entries.map((entry) => ({ ...entry, groupIds: [] })),
    });
    await repository.saveGraph({ inspection, groups: [], photos: [] });

    await Promise.all([
      repository.updateEntryCheckSelections("inspection-1", "entry-1", [
        { category: "safety", value: "\u5b89\u5168\u901a\u9053\u7545\u901a", isCustom: false },
      ]),
      repository.addPhotoToGoodGroup(
        "entry-1",
        makePhoto(undefined, { id: "photo-concurrent-selection", groupId: "group-concurrent-selection" }),
        "group-concurrent-selection",
      ),
    ]);

    const graph = await repository.getGraph("inspection-1");
    expect(graph?.inspection.entries[0]).toMatchObject({
      checkSelections: [{ category: "safety", value: "\u5b89\u5168\u901a\u9053\u7545\u901a", isCustom: false }],
      groupIds: ["group-concurrent-selection"],
    });
    expect(graph?.groups).toMatchObject([{ id: "group-concurrent-selection", photoIds: ["photo-concurrent-selection"] }]);
    expect(graph?.photos).toMatchObject([{ id: "photo-concurrent-selection", groupId: "group-concurrent-selection" }]);
  });

  test("normalizes a raw legacy IndexedDB entry without check selections", async () => {
    const db = testDb("check-selections-legacy-read");
    const repository = new InspectionRepository(db);
    const inspection = makeInspection({
      entries: makeInspection().entries.map((entry) => ({ ...entry, groupIds: [] })),
    });
    await repository.saveGraph({ inspection, groups: [], photos: [] });
    const entry = await db.entries.get("entry-1");
    if (!entry) throw new Error("entry fixture missing");
    await db.entries.put({ ...entry, checkSelections: undefined } as unknown as typeof entry);

    await expect(repository.getGraph("inspection-1")).resolves.toMatchObject({
      inspection: { entries: [{ id: "entry-1", checkSelections: [] }] },
    });
  });

  test("normalizes a legacy report template when reading an inspection graph without rewriting it", async () => {
    const db = testDb("inspection-template-legacy-read");
    const repository = new InspectionRepository(db);
    const legacyTemplate = { ...makeTemplate(), firstLineIndentChars: 0 };
    delete (legacyTemplate as { firstLineIndentChars?: number }).firstLineIndentChars;
    await db.templates.add(legacyTemplate);
    await repository.saveGraph({
      inspection: makeInspection({ entries: [] }),
      groups: [],
      photos: [],
    });

    await expect(repository.getGraph("inspection-1")).resolves.toMatchObject({
      template: { firstLineIndentChars: 2 },
    });
    expect(
      (await db.templates.get(["template-default", 1]) as { firstLineIndentChars?: number })
        .firstLineIndentChars,
    ).toBeUndefined();
  });

  test("atomically appends a normalized temporary entry without changing related data", async () => {
    const db = testDb("temporary-entry-append");
    const repository = new InspectionRepository(db);
    const original = makeTwoGroupGraph();
    await repository.saveGraph({
      ...original,
      inspection: { ...original.inspection, status: "generated" },
    }).catch(async () => {
      await repository.saveGraph(original);
      await db.inspections.update(original.inspection.id, { status: "generated" });
    });
    await db.checklistItems.add(makeRouteItem());
    await db.routeTemplates.add(makeRouteTemplate({ itemIds: ["core-route-01"] }));
    const before = {
      entries: await db.entries.toArray(),
      groups: await db.photoGroups.toArray(),
      photos: await db.photos.toArray(),
      items: await db.checklistItems.toArray(),
      templates: await db.routeTemplates.toArray(),
    };

    const result = await repository.addTemporaryEntry(
      "inspection-1",
      "  临时配电间  ",
      temporaryId("entry", 1),
      temporaryId("item", 1),
      "2026-07-30T10:00:00.000Z",
    );
    const restored = await repository.getGraph("inspection-1");

    expect(result).toEqual({
      entry: {
        id: temporaryId("entry", 1),
        inspectionId: "inspection-1",
        itemId: temporaryId("item", 1),
        itemSnapshot: {
          id: temporaryId("item", 1),
          routeOrder: 1,
          routeName: "临时配电间",
          area: "临时配电间",
          device: "",
          part: "临时配电间",
          standard: "检查临时配电间7S管理落实情况",
          team: "相关责任工班",
          sevenSCategory: "",
          goodText: "临时配电间7S管理落实较好。",
          reminderText: "临时配电间存在7S管理不到位问题，本次予以提醒。",
          assessmentText: "临时配电间存在7S管理不到位问题。",
          quickPhrases: [],
        },
        checkSelections: [],
        groupIds: [],
        order: 1,
      },
      updatedAt: "2026-07-30T10:00:00.000Z",
    });
    expect(restored?.inspection.status).toBe("draft");
    expect(restored?.inspection.updatedAt).toBe("2026-07-30T10:00:00.000Z");
    expect(restored?.inspection.entries.slice(0, -1)).toEqual(before.entries);
    expect(restored?.groups).toEqual(before.groups);
    expect(restored?.photos).toEqual(before.photos);
    expect(await db.checklistItems.toArray()).toEqual(before.items);
    expect(await db.routeTemplates.toArray()).toEqual(before.templates);
  });

  test("appends a temporary title to a saved review route order and keeps the graph saveable", async () => {
    const db = testDb("temporary-entry-review-route-order");
    const repository = new InspectionRepository(db);
    const inspection = makeInspection({
      reviewRouteOrder: ["焊机间"],
      entries: makeInspection().entries.map((entry) => ({ ...entry, groupIds: [] })),
    });
    await repository.saveGraph({ inspection, groups: [], photos: [] });

    const result = await repository.addTemporaryEntry(
      "inspection-1",
      " 临时配电间 ",
      temporaryId("entry", 30),
      temporaryId("item", 30),
      "2026-07-30T13:00:00.000Z",
    );
    const restored = await repository.getGraph("inspection-1");

    expect(result.entry.itemSnapshot.routeName).toBe("临时配电间");
    expect(restored?.inspection.reviewRouteOrder).toEqual(["焊机间", "临时配电间"]);
    expect(restored?.inspection.reviewRouteOrder?.filter((name) => name === "临时配电间"))
      .toHaveLength(1);
    if (!restored) throw new Error("inspection graph missing");
    await expect(repository.saveGraph({
      inspection: restored.inspection,
      groups: restored.groups,
      photos: restored.photos,
    })).resolves.toBeUndefined();
  });

  test("rejects empty, duplicate, missing, and deleted temporary entry targets", async () => {
    const db = testDb("temporary-entry-validation");
    const repository = new InspectionRepository(db);
    const inspection = makeInspection();
    await repository.saveGraph({
      inspection: {
        ...inspection,
        entries: inspection.entries.map((entry) => ({ ...entry, groupIds: [] })),
      },
      groups: [],
      photos: [],
    });

    await expect(repository.addTemporaryEntry(
      "inspection-1", "   ", temporaryId("entry", 2), temporaryId("item", 2),
    )).rejects.toThrow("检查项名称不能为空");
    await expect(repository.addTemporaryEntry(
      "inspection-1", " 焊机间 ", temporaryId("entry", 3), temporaryId("item", 3),
    )).rejects.toThrow("当前巡检中已存在同名检查项");
    await expect(repository.addTemporaryEntry(
      "missing", "临时项", temporaryId("entry", 4), temporaryId("item", 4),
    )).rejects.toThrow("巡检记录不存在或已删除");
    await repository.moveToTrash("inspection-1", "2026-07-30T11:00:00.000Z");
    await expect(repository.addTemporaryEntry(
      "inspection-1", "临时项", temporaryId("entry", 5), temporaryId("item", 5),
    )).rejects.toThrow("巡检记录不存在或已删除");

    expect(await db.entries.count()).toBe(1);
  });

  test("requires temporary entry and item ID prefixes", async () => {
    const db = testDb("temporary-entry-id-prefixes");
    const repository = new InspectionRepository(db);
    const inspection = makeInspection();
    await repository.saveGraph({
      inspection: {
        ...inspection,
        entries: inspection.entries.map((entry) => ({ ...entry, groupIds: [] })),
      },
      groups: [],
      photos: [],
    });

    await expect(repository.addTemporaryEntry(
      "inspection-1", "临时项", "entry-invalid", temporaryId("item", 6),
    )).rejects.toThrow("临时检查项条目 ID 无效");
    await expect(repository.addTemporaryEntry(
      "inspection-1", "临时项", temporaryId("entry", 6), "item-invalid",
    )).rejects.toThrow("临时检查项快照 ID 无效");
    await expect(repository.addTemporaryEntry(
      "inspection-1", "临时项", "temporary-entry-", temporaryId("item", 7),
    )).rejects.toThrow("临时检查项条目 ID 无效");
    expect(await db.entries.count()).toBe(1);
  });

  test("rejects a duplicate temporary snapshot ID within one inspection", async () => {
    const db = testDb("temporary-entry-duplicate-item-id");
    const repository = new InspectionRepository(db);
    const inspection = makeInspection();
    await repository.saveGraph({
      inspection: {
        ...inspection,
        entries: inspection.entries.map((entry) => ({ ...entry, groupIds: [] })),
      },
      groups: [],
      photos: [],
    });
    const itemId = temporaryId("item", 8);
    await repository.addTemporaryEntry(
      "inspection-1", "临时甲", temporaryId("entry", 8), itemId,
    );

    await expect(repository.addTemporaryEntry(
      "inspection-1", "临时乙", temporaryId("entry", 9), itemId,
    )).rejects.toThrow("当前巡检中已存在相同快照 ID");
    expect((await repository.getGraph("inspection-1"))?.inspection.entries).toHaveLength(2);
  });

  test("rolls back the inserted entry when the inspection update fails", async () => {
    const db = testDb("temporary-entry-rollback");
    const repository = new InspectionRepository(db);
    const inspection = makeInspection();
    await repository.saveGraph({
      inspection: {
        ...inspection,
        entries: inspection.entries.map((entry) => ({ ...entry, groupIds: [] })),
      },
      groups: [],
      photos: [],
    });
    const before = await db.inspections.get("inspection-1");
    vi.spyOn(db.inspections, "update").mockRejectedValueOnce(new Error("模拟巡检更新失败"));

    await expect(repository.addTemporaryEntry(
      "inspection-1",
      "临时项",
      temporaryId("entry", 10),
      temporaryId("item", 10),
      "2026-07-30T12:00:00.000Z",
    )).rejects.toThrow("模拟巡检更新失败");

    expect(await db.inspections.get("inspection-1")).toEqual(before);
    expect(await db.entries.count()).toBe(1);
  });

  test("serializes concurrent temporary entries with unique trailing orders", async () => {
    const db = testDb("temporary-entry-concurrent-orders");
    const repository = new InspectionRepository(db);
    const inspection = makeInspection();
    await repository.saveGraph({
      inspection: {
        ...inspection,
        entries: inspection.entries.map((entry) => ({ ...entry, groupIds: [] })),
      },
      groups: [],
      photos: [],
    });

    const results = await Promise.all([
      repository.addTemporaryEntry(
        "inspection-1", "临时甲", temporaryId("entry", 11), temporaryId("item", 11),
      ),
      repository.addTemporaryEntry(
        "inspection-1", "临时乙", temporaryId("entry", 12), temporaryId("item", 12),
      ),
    ]);

    expect(results.map((result) => result.entry.order).sort((a, b) => a - b)).toEqual([1, 2]);
    expect((await repository.getGraph("inspection-1"))?.inspection.entries.map((entry) => entry.id))
      .toEqual(["entry-1", temporaryId("entry", 11), temporaryId("entry", 12)]);
  });

  test("allows exactly one of two concurrent normalized-equal temporary names", async () => {
    const db = testDb("temporary-entry-concurrent-duplicate");
    const repository = new InspectionRepository(db);
    const inspection = makeInspection();
    await repository.saveGraph({
      inspection: {
        ...inspection,
        entries: inspection.entries.map((entry) => ({ ...entry, groupIds: [] })),
      },
      groups: [],
      photos: [],
    });

    const results = await Promise.allSettled([
      repository.addTemporaryEntry(
        "inspection-1", "临时配电间", temporaryId("entry", 13), temporaryId("item", 13),
      ),
      repository.addTemporaryEntry(
        "inspection-1", " 临时配电间 ", temporaryId("entry", 14), temporaryId("item", 14),
      ),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await repository.getGraph("inspection-1"))?.inspection.entries).toHaveLength(2);
  });

  test("preserves both writes when a temporary append overlaps a photo append", async () => {
    const db = testDb("temporary-entry-photo-concurrency");
    const repository = new InspectionRepository(db);
    const inspection = makeInspection();
    await repository.saveGraph({
      inspection: {
        ...inspection,
        entries: inspection.entries.map((entry) => ({ ...entry, groupIds: [] })),
      },
      groups: [],
      photos: [],
    });

    await Promise.all([
      repository.addTemporaryEntry(
        "inspection-1", "临时配电间", temporaryId("entry", 15), temporaryId("item", 15),
      ),
      repository.addPhotoToGoodGroup(
        "entry-1",
        makePhoto(undefined, { id: "photo-concurrent", groupId: "group-concurrent" }),
        "group-concurrent",
      ),
    ]);
    const restored = await repository.getGraph("inspection-1");

    expect(restored?.inspection.entries.map((entry) => entry.id)).toEqual([
      "entry-1",
      temporaryId("entry", 15),
    ]);
    expect(restored?.groups.map((group) => group.id)).toEqual(["group-concurrent"]);
    expect(restored?.photos.map((photo) => photo.id)).toEqual(["photo-concurrent"]);
  });

  test("retains both photos appended concurrently to the same entry", async () => {
    const db = testDb("concurrent-photo-appends");
    const repository = new InspectionRepository(db);
    const inspection = makeInspection();
    await repository.saveGraph({
      inspection: {
        ...inspection,
        entries: inspection.entries.map((entry) => ({ ...entry, groupIds: [] })),
      },
      groups: [],
      photos: [],
    });

    await Promise.all([
      repository.addPhotoToGoodGroup(
        "entry-1",
        makePhoto(undefined, { id: "photo-concurrent-a", groupId: "group-concurrent-a" }),
        "group-concurrent-a",
      ),
      repository.addPhotoToGoodGroup(
        "entry-1",
        makePhoto(undefined, { id: "photo-concurrent-b", groupId: "group-concurrent-b" }),
        "group-concurrent-b",
      ),
    ]);
    const restored = await repository.getGraph("inspection-1");

    expect(restored?.groups).toHaveLength(1);
    expect(restored?.groups[0].photoIds).toEqual(["photo-concurrent-a", "photo-concurrent-b"]);
    expect(restored?.photos.map((photo) => photo.id)).toEqual([
      "photo-concurrent-a",
      "photo-concurrent-b",
    ]);
  });

  test("rolls back a photo append when its new group ID belongs to another inspection", async () => {
    const db = testDb("photo-group-cross-inspection-conflict");
    const repository = new InspectionRepository(db);
    const first = makeInspection();
    await repository.saveGraph({
      inspection: {
        ...first,
        entries: first.entries.map((entry) => ({ ...entry, groupIds: [] })),
      },
      groups: [],
      photos: [],
    });
    const secondBase = makeInspection();
    const secondEntry = {
      ...secondBase.entries[0],
      id: "entry-other",
      inspectionId: "inspection-other",
      groupIds: ["group-cross-inspection"],
    };
    await repository.saveGraph({
      inspection: {
        ...secondBase,
        id: "inspection-other",
        entries: [secondEntry],
      },
      groups: [makePhotoGroup({
        id: "group-cross-inspection",
        inspectionId: "inspection-other",
        entryId: secondEntry.id,
        photoIds: ["photo-other"],
      })],
      photos: [makePhoto(undefined, {
        id: "photo-other",
        inspectionId: "inspection-other",
        groupId: "group-cross-inspection",
      })],
    });
    const otherBefore = await repository.getGraph("inspection-other");

    await expect(repository.addPhotoToGoodGroup(
      "entry-1",
      makePhoto(undefined, {
        id: "photo-conflicting-group",
        groupId: "group-cross-inspection",
      }),
      "group-cross-inspection",
    )).rejects.toBeDefined();

    expect(await repository.getGraph("inspection-other")).toEqual(otherBefore);
    expect((await repository.getGraph("inspection-1"))?.photos).toEqual([]);
  });

  test("saves an incomplete draft without report readiness validation", async () => {
    const repository = new InspectionRepository(testDb("draft"));
    const emptyGroup = makePhotoGroup({ description: "", photoIds: [] });

    await repository.saveGraph({ inspection: makeInspection(), groups: [emptyGroup], photos: [] });

    expect((await repository.getGraph("inspection-1"))?.groups).toEqual([emptyGroup]);
  });

  test("soft delete and restore only update the inspection row", async () => {
    const db = testDb("trash");
    const repository = new InspectionRepository(db);
    await repository.saveGraph({
      inspection: makeInspection(),
      groups: [makePhotoGroup()],
      photos: [makePhoto()],
    });
    const dependentsBefore = {
      entries: await db.entries.toArray(),
      groups: await db.photoGroups.toArray(),
      photos: await db.photos.toArray(),
    };

    await repository.moveToTrash("inspection-1", "2026-07-28T10:00:00.000Z");
    expect((await repository.getGraph("inspection-1"))?.inspection.deletedAt).toBe(
      "2026-07-28T10:00:00.000Z",
    );
    await repository.restore("inspection-1");

    expect((await repository.getGraph("inspection-1"))?.inspection.deletedAt).toBeNull();
    expect(await db.entries.toArray()).toEqual(dependentsBefore.entries);
    expect(await db.photoGroups.toArray()).toEqual(dependentsBefore.groups);
    expect(await db.photos.toArray()).toEqual(dependentsBefore.photos);
  });

  test("save graph removes stale dependent rows", async () => {
    const db = testDb("stale-cleanup");
    const repository = new InspectionRepository(db);
    const base = makeTwoGroupGraph();
    const secondEntry = {
      ...base.inspection.entries[0],
      id: "entry-2",
      itemId: "item-2",
      itemSnapshot: { ...base.inspection.entries[0].itemSnapshot, id: "item-2" },
      groupIds: ["group-2"],
      order: 1,
    };
    const initial: InspectionGraph = {
      ...base,
      inspection: {
        ...base.inspection,
        entries: [{ ...base.inspection.entries[0], groupIds: ["group-1"] }, secondEntry],
      },
      groups: [base.groups[0], { ...base.groups[1], entryId: "entry-2" }],
    };
    await repository.saveGraph(initial);
    const reducedInspection = {
      ...initial.inspection,
      entries: [{ ...initial.inspection.entries[0], groupIds: ["group-1"] }],
    };
    const reducedGroup = { ...initial.groups[0], photoIds: ["photo-1"] };

    await repository.saveGraph({
      inspection: reducedInspection,
      groups: [reducedGroup],
      photos: [initial.photos[0]],
    });

    expect((await repository.getGraph("inspection-1"))?.groups.map((group) => group.id)).toEqual([
      "group-1",
    ]);
    expect(await db.photoGroups.get("group-2")).toBeUndefined();
    expect(await db.photos.get("photo-2")).toBeUndefined();
    expect(await db.photos.get("photo-3")).toBeUndefined();
    expect(await db.entries.get("entry-2")).toBeUndefined();
  });

  test("save graph rolls back every table when a write fails", async () => {
    const db = testDb("rollback");
    const repository = new InspectionRepository(db);
    const original = makeTwoGroupGraph();
    await repository.saveGraph(original);
    const invalidPhoto = {
      ...original.photos[0],
      imageBlob: (() => "not cloneable") as unknown as Blob,
    };

    await expect(
      repository.saveGraph({
        inspection: { ...original.inspection, title: "不应保留的标题" },
        groups: original.groups,
        photos: [invalidPhoto, ...original.photos.slice(1)],
      }),
    ).rejects.toBeDefined();

    const restored = await repository.getGraph("inspection-1");
    expect(restored?.inspection.title).toBe(original.inspection.title);
    expect(await readBlobText(restored!.photos[0].imageBlob)).toBe("one");
    expect(restored?.groups).toEqual(original.groups);
  });

  test("moves a photo and updates both groups, the asset, and entry references", async () => {
    const repository = new InspectionRepository(testDb("move-photo"));
    await repository.saveGraph(makeTwoGroupGraph());

    await repository.movePhoto("photo-2", "group-2");

    const restored = await repository.getGraph("inspection-1");
    expect(restored?.groups[0].photoIds).toEqual(["photo-1"]);
    expect(restored?.groups[1].photoIds).toEqual(["photo-3", "photo-2"]);
    expect(restored?.photos.find((photo) => photo.id === "photo-2")).toMatchObject({
      groupId: "group-2",
      order: 1,
    });
    expect(restored?.inspection.entries[0].groupIds).toEqual(["group-1", "group-2"]);
  });

  test("appending a photo demotes generated content to reviewed using the complete graph", async () => {
    const db = testDb("append-photo-status");
    const repository = new InspectionRepository(db);
    await new TemplateRepository(db).save(makeTemplate());
    const graph = makeTwoGroupGraph();
    await persistAsGenerated(repository, graph);

    await repository.addPhotoToGoodGroup(
      "entry-1",
      makePhoto(undefined, { id: "photo-4" }),
      "unused-group",
    );

    expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("reviewed");
  });

  test("moving a photo demotes generated content to reviewed using the complete graph", async () => {
    const db = testDb("move-photo-status");
    const repository = new InspectionRepository(db);
    await new TemplateRepository(db).save(makeTemplate());
    const graph = makeTwoGroupGraph();
    await persistAsGenerated(repository, graph);

    await repository.movePhoto("photo-2", "group-2");

    expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("reviewed");
  });

  test("splitting an incomplete assessment demotes reviewed content to draft", async () => {
    const db = testDb("split-photo-status");
    const repository = new InspectionRepository(db);
    await new TemplateRepository(db).save(makeTemplate());
    const graph = makeTwoGroupGraph();
    await repository.saveGraph({
      ...graph,
      inspection: { ...graph.inspection, status: "reviewed" },
    });

    await repository.splitPhoto("photo-2", makePhotoGroup({
      id: "group-incomplete-assessment",
      category: "assessment",
      description: graph.inspection.entries[0].itemSnapshot.assessmentText,
      awardAssessment: null,
      photoIds: ["photo-2"],
      order: 1,
    }));

    expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("draft");
  });

  test("deleting a photo demotes generated content to reviewed using the complete graph", async () => {
    const db = testDb("delete-photo-status");
    const repository = new InspectionRepository(db);
    await new TemplateRepository(db).save(makeTemplate());
    const graph = makeTwoGroupGraph();
    await persistAsGenerated(repository, graph);

    await repository.deletePhoto("photo-3");

    const restored = await repository.getGraph("inspection-1");
    expect(restored?.groups.map((group) => group.id)).toEqual(["group-1"]);
    expect(restored?.inspection.status).toBe("reviewed");
  });

  test("replacing a photo demotes generated content to reviewed", async () => {
    const db = testDb("replace-photo-status");
    const repository = new InspectionRepository(db);
    await new TemplateRepository(db).save(makeTemplate());
    const graph = makeTwoGroupGraph();
    await persistAsGenerated(repository, graph);

    await repository.replacePhoto({
      ...graph.photos[0],
      imageBlob: new Blob(["replacement"], { type: "image/jpeg" }),
    });

    expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("reviewed");
  });

  test("updating a photo annotation demotes generated content to reviewed", async () => {
    const db = testDb("annotation-status");
    const repository = new InspectionRepository(db);
    await new TemplateRepository(db).save(makeTemplate());
    const graph = makeTwoGroupGraph();
    await persistAsGenerated(repository, graph);

    await repository.updatePhotoAnnotation("photo-1", JSON.stringify([{
      type: "text",
      x: 0.2,
      y: 0.3,
      text: "重点",
      color: "#d12f2f",
    }]));

    expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("reviewed");
  });

  test("draft photo mutation skips full persisted photo graph reconstruction", async () => {
    const db = testDb("draft-status-fast-path");
    const repository = new InspectionRepository(db);
    await repository.saveGraph(makeTwoGroupGraph());
    const photoScan = vi.spyOn(db.photos, "where");

    await repository.updatePhotoAnnotation("photo-1", JSON.stringify([{
      type: "text",
      x: 0.2,
      y: 0.3,
      text: "重点",
      color: "#d12f2f",
    }]));

    expect(photoScan).not.toHaveBeenCalled();
    expect((await db.inspections.get("inspection-1"))?.status).toBe("draft");
  });

  test("reorders every target photo after moving into an inconsistently ordered group", async () => {
    const repository = new InspectionRepository(testDb("move-photo-reorder-target"));
    const graph = makeTwoGroupGraph();
    const targetGroup = {
      ...graph.groups[1],
      photoIds: ["photo-3", "photo-4"],
    };
    const targetPhoto = makePhoto(new Blob(["four"], { type: "image/jpeg" }), {
      id: "photo-4",
      groupId: "group-2",
      order: 1,
    });

    await repository.saveGraph({
      ...graph,
      groups: [graph.groups[0], targetGroup],
      photos: [
        graph.photos[0],
        graph.photos[1],
        { ...graph.photos[2], order: 5 },
        targetPhoto,
      ],
    });

    await repository.movePhoto("photo-2", "group-2");

    const restored = await repository.getGraph("inspection-1");
    const restoredTargetGroup = restored?.groups.find((group) => group.id === "group-2");
    const restoredTargetPhotos = restored?.photos.filter((photo) => photo.groupId === "group-2");
    expect(restoredTargetGroup?.photoIds).toEqual(["photo-3", "photo-4", "photo-2"]);
    expect(restoredTargetPhotos?.map((photo) => photo.id)).toEqual(
      restoredTargetGroup?.photoIds,
    );
    expect(restoredTargetPhotos?.map((photo) => photo.order)).toEqual([0, 1, 2]);
  });

  test("persists consecutive group order and entry references", async () => {
    const db = testDb("review-group-order");
    const repository = new InspectionRepository(db);
    const graph = makeTwoGroupGraph();
    const group3 = makePhotoGroup({ id: "group-3", category: "assessment", description: "考核问题", awardAssessment: { type: "assessment", people: "甲", amount: 30 }, photoIds: ["photo-4"], order: 2 });
    await repository.saveGraph({
      inspection: { ...graph.inspection, entries: [{ ...graph.inspection.entries[0], groupIds: ["group-1", "group-2", "group-3"] }] },
      groups: [...graph.groups, group3],
      photos: [...graph.photos, makePhoto(undefined, { id: "photo-4", groupId: "group-3" })],
    });

    await repository.reorderGroups("inspection-1", ["group-3", "group-1", "group-2"]);

    const restored = await new InspectionRepository(db).getGraph("inspection-1");
    expect(restored?.groups.map((group) => group.id)).toEqual(["group-3", "group-1", "group-2"]);
    expect(restored?.groups.map((group) => group.order)).toEqual([0, 1, 2]);
    expect(restored?.inspection.entries[0].groupIds).toEqual(["group-3", "group-1", "group-2"]);
  });

  test("moves a group across categories with cleanup and consecutive global order", async () => {
    const db = testDb("review-cross-category");
    const repository = new InspectionRepository(db);
    const graph = makeTwoGroupGraph();
    await repository.saveGraph({
      ...graph,
      groups: [
        {
          ...graph.groups[0],
          awardAssessment: { type: "reward", people: "甲", amount: 30 },
        },
        graph.groups[1],
      ],
    });

    await repository.moveGroupToCategory(
      "inspection-1",
      "group-1",
      "assessment",
      ["group-2", "group-1"],
    );

    const restored = await new InspectionRepository(db).getGraph("inspection-1");
    expect(restored?.groups.map((group) => [group.id, group.order])).toEqual([
      ["group-2", 0],
      ["group-1", 1],
    ]);
    expect(restored?.groups[1]).toMatchObject({
      category: "assessment",
      description: graph.inspection.entries[0].itemSnapshot.assessmentText,
      awardAssessment: null,
    });
    expect(restored?.inspection.entries[0].groupIds).toEqual(["group-2", "group-1"]);
  });

  test("persists consecutive photo order and group references", async () => {
    const db = testDb("review-photo-order");
    const repository = new InspectionRepository(db);
    await repository.saveGraph(makeTwoGroupGraph());

    await repository.reorderPhotos("group-1", ["photo-2", "photo-1"]);

    const restored = await new InspectionRepository(db).getGraph("inspection-1");
    expect(restored?.groups[0].photoIds).toEqual(["photo-2", "photo-1"]);
    expect(restored?.photos.filter((photo) => photo.groupId === "group-1").map((photo) => [photo.id, photo.order])).toEqual([
      ["photo-2", 0],
      ["photo-1", 1],
    ]);
  });

  test("marks a ready inspection reviewed without marking it generated", async () => {
    const db = testDb("review-status");
    const repository = new InspectionRepository(db);
    await new TemplateRepository(db).save(makeTemplate());
    await repository.saveGraph(makeTwoGroupGraph());

    await repository.markReviewedIfReady("inspection-1");

    expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("reviewed");
  });

  test("refuses generation readiness when the persisted inspection has no photos", async () => {
    const db = testDb("generation-readiness-no-photos");
    const repository = new InspectionRepository(db);
    await new TemplateRepository(db).save(makeTemplate());
    const inspection = makeInspection({
      entries: [{ ...makeInspection().entries[0], groupIds: [] }],
    });
    await repository.saveGraph({ inspection, groups: [], photos: [] });

    await expect(repository.getReadyGraphForGeneration("inspection-1")).rejects.toThrow(
      "报告至少需要一张已归组照片。",
    );
    expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("draft");
  });

  test("atomically refuses reviewed when the persisted graph is incomplete", async () => {
    const db = testDb("review-status-incomplete");
    const repository = new InspectionRepository(db);
    await new TemplateRepository(db).save(makeTemplate());
    const graph = makeTwoGroupGraph();
    await repository.saveGraph({
      ...graph,
      groups: [{
        ...graph.groups[0],
        category: "assessment",
        awardAssessment: null,
      }, graph.groups[1]],
    });

    await expect(repository.markReviewedIfReady("inspection-1")).rejects.toThrow(
      "考核必须填写责任人员和正数金额。",
    );

    expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("draft");
  });

  test("direct reviewed status enforces strict persisted readiness", async () => {
    const db = testDb("direct-reviewed-readiness");
    const repository = new InspectionRepository(db);
    await repository.saveGraph(makeTwoGroupGraph());

    await expect(repository.setInspectionStatus("inspection-1", "reviewed")).rejects.toThrow(
      "巡检引用的报告模板版本不存在。",
    );

    expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("draft");
  });

  test("does not allow Task 8 to mark an inspection generated", async () => {
    const repository = new InspectionRepository(testDb("review-no-generate"));
    await repository.saveGraph(makeTwoGroupGraph());

    await expect(repository.setInspectionStatus("inspection-1", "generated")).rejects.toThrow(
      "生成状态只能在DOCX成功后设置。",
    );
  });

  test("does not allow saveGraph to bypass the packaged generated transition", async () => {
    const repository = new InspectionRepository(testDb("save-graph-no-generate"));
    const graph = makeTwoGroupGraph();

    await expect(repository.saveGraph({
      ...graph,
      inspection: { ...graph.inspection, status: "generated" },
    })).rejects.toThrow("生成状态只能在DOCX成功后设置。");
  });

  test("marks generated only through the successfully packaged persisted snapshot", async () => {
    const db = testDb("packaged-generate");
    const repository = new InspectionRepository(db);
    await new TemplateRepository(db).save(makeTemplate());
    await repository.saveGraph(makeTwoGroupGraph());

    const packagedSnapshot = await repository.getReadyGraphForGeneration("inspection-1");

    expect(packagedSnapshot.inspection.status).toBe("draft");
    expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("draft");
    await repository.markGeneratedAfterPackaging(
      "inspection-1",
      packagedSnapshot,
      await packageSnapshot(packagedSnapshot),
    );
    expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("generated");
    await expect(repository.setInspectionStatus("inspection-1", "generated")).rejects.toThrow(
      "生成状态只能在DOCX成功后设置。",
    );
  });

  test("refuses generated status without a valid nonempty DOCX package", async () => {
    const db = testDb("invalid-docx-package");
    const repository = new InspectionRepository(db);
    await new TemplateRepository(db).save(makeTemplate());
    await repository.saveGraph(makeTwoGroupGraph());
    const packagedSnapshot = await repository.getReadyGraphForGeneration("inspection-1");

    await expect(repository.markGeneratedAfterPackaging(
      "inspection-1",
      packagedSnapshot,
      new Blob([], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }),
    )).rejects.toThrow("DOCX打包结果无效。");
    expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("draft");
  });

  test("validates a real DOCX without materializing the full package ArrayBuffer", async () => {
    class NoFullReadBlob extends Blob {
      override arrayBuffer(): Promise<ArrayBuffer> {
        throw new Error("full package read forbidden");
      }
    }
    const db = testDb("bounded-docx-validation");
    const repository = new InspectionRepository(db);
    await new TemplateRepository(db).save(makeTemplate());
    await repository.saveGraph(makeTwoGroupGraph());
    const packagedSnapshot = await repository.getReadyGraphForGeneration("inspection-1");
    const realPackage = await packageSnapshot(packagedSnapshot);
    const guardedPackage = new NoFullReadBlob([realPackage], { type: realPackage.type });

    await repository.markGeneratedAfterPackaging(
      "inspection-1",
      packagedSnapshot,
      guardedPackage,
    );

    expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("generated");
  });

  test("refuses generated when the persisted report changed during packaging", async () => {
    const db = testDb("packaged-stale");
    const repository = new InspectionRepository(db);
    await new TemplateRepository(db).save(makeTemplate());
    const graph = makeTwoGroupGraph();
    await repository.saveGraph(graph);
    const packagedSnapshot = await repository.getReadyGraphForGeneration("inspection-1");
    await repository.updatePhotoGroup({
      ...graph.groups[0],
      description: "打包期间修改后的说明。",
    });

    await expect(
      repository.markGeneratedAfterPackaging(
        "inspection-1",
        packagedSnapshot,
        await packageSnapshot(packagedSnapshot),
      ),
    ).rejects.toThrow("打包期间巡检内容已发生变化，请重新生成。");
    expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("draft");
  });

  test.each([
    ["image bytes", async (repository: InspectionRepository, _db: SevenSDb, graph: InspectionGraph) => {
      await repository.replacePhoto({
        ...graph.photos[0],
        imageBlob: new Blob(["eno"], { type: "image/jpeg" }),
      });
    }],
    ["annotation JSON", async (repository: InspectionRepository) => {
      await repository.updatePhotoAnnotation("photo-1", JSON.stringify([{
        type: "text",
        x: 0.2,
        y: 0.3,
        text: "重点",
        color: "#d12f2f",
      }]));
    }],
    ["template version", async (repository: InspectionRepository, db: SevenSDb) => {
      await new TemplateRepository(db).save(makeTemplate({ version: 2, name: "新版本模板" }));
      await repository.updateReviewSettings("inspection-1", "template-default", 2, null);
    }],
  ] as const)("refuses generated when stale %s changed during packaging", async (_case, mutate) => {
    const db = testDb(`packaged-stale-${_case}`);
    const repository = new InspectionRepository(db);
    await new TemplateRepository(db).save(makeTemplate());
    const graph = makeTwoGroupGraph();
    await repository.saveGraph(graph);
    const packagedSnapshot = await repository.getReadyGraphForGeneration("inspection-1");
    const packageBlob = await packageSnapshot(packagedSnapshot);

    await mutate(repository, db, graph);

    await expect(repository.markGeneratedAfterPackaging(
      "inspection-1",
      packagedSnapshot,
      packageBlob,
    )).rejects.toThrow("打包期间巡检内容已发生变化，请重新生成。");
    expect((await repository.getGraph("inspection-1"))?.inspection.status).not.toBe("generated");
  });

  test("editing an incomplete generated assessment returns it to draft", async () => {
    const db = testDb("generated-edit-draft");
    const repository = new InspectionRepository(db);
    await new TemplateRepository(db).save(makeTemplate());
    const graph = makeTwoGroupGraph();
    await persistAsGenerated(repository, graph);

    await repository.updatePhotoGroup({
      ...graph.groups[0],
      category: "assessment",
      awardAssessment: null,
    });

    expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("draft");
  });

  test("editing an incomplete reviewed assessment returns it to draft using the full graph", async () => {
    const db = testDb("reviewed-edit-draft");
    const repository = new InspectionRepository(db);
    await new TemplateRepository(db).save(makeTemplate());
    const graph = makeTwoGroupGraph();
    await repository.saveGraph({ ...graph, inspection: { ...graph.inspection, status: "reviewed" } });

    await repository.updatePhotoGroup({
      ...graph.groups[0],
      category: "assessment",
      awardAssessment: null,
    });

    expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("draft");
  });

  test("evaluation updates cannot modify group order", async () => {
    const repository = new InspectionRepository(testDb("evaluation-order"));
    const graph = makeTwoGroupGraph();
    await repository.saveGraph(graph);

    await expect(repository.updatePhotoGroup({
      ...graph.groups[0],
      order: 1,
      awardAssessment: { type: "reward", people: "甲", amount: 20 },
    })).rejects.toThrow("照片组顺序不能通过评价更新修改。");

    expect((await repository.getGraph("inspection-1"))?.groups.map((group) => group.order)).toEqual([0, 1]);
  });

  test("review settings require an existing immutable template version", async () => {
    const db = testDb("review-settings-template");
    const repository = new InspectionRepository(db);
    await repository.saveGraph(makeTwoGroupGraph());

    await expect(repository.updateReviewSettings(
      "inspection-1",
      "template-missing",
      9,
      2,
    )).rejects.toThrow("模板 template-missing 版本 9 不存在。");

    expect((await repository.getGraph("inspection-1"))?.inspection).toMatchObject({
      templateId: "template-default",
      templateVersion: 1,
      photosPerRowOverride: null,
    });
  });

  test("moving a reviewed group to incomplete assessment recomputes status from the full graph", async () => {
    const db = testDb("reviewed-move-draft");
    const repository = new InspectionRepository(db);
    await new TemplateRepository(db).save(makeTemplate());
    const graph = makeTwoGroupGraph();
    await repository.saveGraph({ ...graph, inspection: { ...graph.inspection, status: "reviewed" } });

    await repository.moveGroupToCategory(
      "inspection-1",
      "group-1",
      "assessment",
      ["group-1", "group-2"],
    );

    expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("draft");
  });

  test("persists incomplete assessment draft values while report readiness stays strict", async () => {
    const repository = new InspectionRepository(testDb("assessment-draft-values"));
    const graph = makeTwoGroupGraph();
    await repository.saveGraph(graph);
    const draft = {
      ...graph.groups[0],
      category: "assessment" as const,
      awardAssessment: { type: "assessment" as const, people: "", amount: 0 },
    };

    await repository.updatePhotoGroup(draft);

    const restored = await repository.getGraph("inspection-1");
    expect(restored?.groups[0]).toEqual(draft);
    expect(validateReportReadiness(restored!).map((error) => error.code)).toContain(
      "ASSESSMENT_DETAILS_REQUIRED",
    );
  });

  test("moving the last source photo removes the empty group and its entry reference", async () => {
    const repository = new InspectionRepository(testDb("move-last-photo"));
    const base = makeInspection();
    const secondEntry = {
      ...base.entries[0],
      id: "entry-2",
      itemId: "item-2",
      itemSnapshot: { ...base.entries[0].itemSnapshot, id: "item-2" },
      groupIds: ["group-2"],
      order: 1,
    };
    await repository.saveGraph({
      inspection: makeInspection({ entries: [base.entries[0], secondEntry] }),
      groups: [
        makePhotoGroup(),
        makePhotoGroup({ id: "group-2", entryId: "entry-2", photoIds: ["photo-2"], order: 1 }),
      ],
      photos: [
        makePhoto(),
        makePhoto(new Blob(["two"]), { id: "photo-2", groupId: "group-2" }),
      ],
    });

    await repository.movePhoto("photo-1", "group-2");

    const restored = await repository.getGraph("inspection-1");
    expect(restored?.groups.map((group) => group.id)).toEqual(["group-2"]);
    expect(restored?.groups[0].photoIds).toEqual(["photo-2", "photo-1"]);
    expect(restored?.inspection.entries[0].groupIds).toEqual([]);
    expect(restored?.inspection.entries[1].groupIds).toEqual(["group-2"]);
    expect(restored?.photos.find((photo) => photo.id === "photo-1")).toMatchObject({
      groupId: "group-2",
      order: 1,
    });
  });

  test("splits a photo into a new group atomically", async () => {
    const repository = new InspectionRepository(testDb("split-photo"));
    const graph = makeTwoGroupGraph();
    await repository.saveGraph(graph);
    const created: PhotoGroup = makePhotoGroup({
      id: "group-3",
      category: "assessment",
      description: "油缸表面积灰、油泥未清理。",
      awardAssessment: { type: "assessment", people: "责任人", amount: 20 },
      photoIds: ["photo-2"],
      order: 2,
    });

    await repository.splitPhoto("photo-2", created);

    const restored = await repository.getGraph("inspection-1");
    expect(restored?.groups.find((group) => group.id === "group-1")?.photoIds).toEqual([
      "photo-1",
    ]);
    expect(restored?.groups.find((group) => group.id === "group-3")).toEqual({
      ...created,
      order: 1,
    });
    expect(restored?.photos.find((photo) => photo.id === "photo-2")?.groupId).toBe("group-3");
    expect(restored?.inspection.entries[0].groupIds).toEqual(["group-1", "group-3", "group-2"]);
  });

  test("reorders every group to match entry references after splitting the first of three groups", async () => {
    const db = testDb("split-three-group-order");
    const repository = new InspectionRepository(db);
    const inspection = makeInspection({
      entries: [{
        ...makeInspection().entries[0],
        groupIds: ["group-1", "group-2", "group-3"],
      }],
    });
    await repository.saveGraph({
      inspection,
      groups: [
        makePhotoGroup({ id: "group-1", photoIds: ["photo-1", "photo-2"], order: 0 }),
        makePhotoGroup({ id: "group-2", photoIds: ["photo-3"], order: 1 }),
        makePhotoGroup({ id: "group-3", photoIds: ["photo-4"], order: 2 }),
      ],
      photos: [
        makePhoto(undefined, { id: "photo-1", groupId: "group-1", order: 0 }),
        makePhoto(undefined, { id: "photo-2", groupId: "group-1", order: 1 }),
        makePhoto(undefined, { id: "photo-3", groupId: "group-2", order: 0 }),
        makePhoto(undefined, { id: "photo-4", groupId: "group-3", order: 0 }),
      ],
    });
    const created = makePhotoGroup({
      id: "z-created-group",
      category: "reminder",
      description: inspection.entries[0].itemSnapshot.reminderText,
      photoIds: ["photo-1"],
      order: 1,
    });

    await repository.splitPhoto("photo-1", created);

    const restored = await new InspectionRepository(db).getGraph("inspection-1");
    const expectedIds = ["group-1", "z-created-group", "group-2", "group-3"];
    expect(restored?.inspection.entries[0].groupIds).toEqual(expectedIds);
    expect(restored?.groups.map((group) => group.id)).toEqual(expectedIds);
    expect(restored?.groups.map((group) => group.order)).toEqual([0, 1, 2, 3]);
    expect((await db.photoGroups.bulkGet(expectedIds)).map((group) => group?.order)).toEqual([
      0, 1, 2, 3,
    ]);
  });

  test("rolls back a split when creating the target group fails", async () => {
    const repository = new InspectionRepository(testDb("split-rollback"));
    const original = makeTwoGroupGraph();
    await repository.saveGraph(original);
    const duplicateTarget = makePhotoGroup({
      id: "group-2",
      photoIds: ["photo-2"],
      order: 2,
    });

    await expect(repository.splitPhoto("photo-2", duplicateTarget)).rejects.toBeDefined();

    const restored = await repository.getGraph("inspection-1");
    expect(restored?.groups).toEqual(original.groups);
    expect(restored?.inspection.entries).toEqual(original.inspection.entries);
    expect(restored?.photos.find((photo) => photo.id === "photo-2")).toMatchObject({
      groupId: "group-1",
      order: 1,
    });
  });

  test("deleting the last photo removes its group and entry reference", async () => {
    const db = testDb("delete-photo");
    const repository = new InspectionRepository(db);
    await repository.saveGraph({
      inspection: makeInspection(),
      groups: [makePhotoGroup()],
      photos: [makePhoto()],
    });

    await repository.deletePhoto("photo-1");

    const restored = await repository.getGraph("inspection-1");
    expect(restored?.photos).toEqual([]);
    expect(restored?.groups).toEqual([]);
    expect(restored?.inspection.entries[0].groupIds).toEqual([]);
    expect(await db.photos.get("photo-1")).toBeUndefined();
  });

  test("rejects purging an active inspection and keeps its complete graph", async () => {
    const db = testDb("purge");
    const repository = new InspectionRepository(db);
    await repository.saveGraph(makeTwoGroupGraph());

    await expect(repository.purgeInspection("inspection-1")).rejects.toThrow();

    expect((await repository.getGraph("inspection-1"))?.groups).toHaveLength(2);
    expect(await db.entries.where("inspectionId").equals("inspection-1").count()).toBeGreaterThan(0);
    expect(await db.photoGroups.where("inspectionId").equals("inspection-1").count()).toBe(2);
    expect(await db.photos.where("inspectionId").equals("inspection-1").count()).toBeGreaterThan(0);
  });

  test("purges the complete trashed inspection graph", async () => {
    const db = testDb("purge-trashed");
    const repository = new InspectionRepository(db);
    await repository.saveGraph(makeTwoGroupGraph());
    await repository.moveToTrash("inspection-1", "2026-07-29T09:00:00.000Z");

    await repository.purgeInspection("inspection-1");

    await expect(repository.getGraph("inspection-1")).resolves.toBeNull();
    expect(await db.entries.where("inspectionId").equals("inspection-1").count()).toBe(0);
    expect(await db.photoGroups.where("inspectionId").equals("inspection-1").count()).toBe(0);
    expect(await db.photos.where("inspectionId").equals("inspection-1").count()).toBe(0);
  });

  test("rejects structurally inconsistent graphs without replacing stored data", async () => {
    const repository = new InspectionRepository(testDb("structure"));
    await repository.saveGraph({
      inspection: makeInspection(),
      groups: [makePhotoGroup()],
      photos: [makePhoto()],
    });

    await expect(
      repository.saveGraph({
        inspection: makeInspection({ title: "不应保留的标题" }),
        groups: [makePhotoGroup()],
        photos: [makePhoto(undefined, { groupId: "missing-group" })],
      }),
    ).rejects.toThrow("照片 photo-1");

    expect((await repository.getGraph("inspection-1"))?.inspection.title).toBe(
      makeInspection().title,
    );
  });

  test("rejects an entry whose item snapshot id does not match item id", async () => {
    const repository = new InspectionRepository(testDb("snapshot-id"));
    const inspection = makeInspection();
    inspection.entries = [
      {
        ...inspection.entries[0],
        itemSnapshot: { ...inspection.entries[0].itemSnapshot, id: "item-other" },
      },
    ];

    await expect(
      repository.saveGraph({ inspection, groups: [makePhotoGroup()], photos: [makePhoto()] }),
    ).rejects.toThrow("项点快照 ID");
  });
});

describe("ItemRepository", () => {
  test("lists enabled items and supports get, put, bulk put, and disable", async () => {
    const repository = new ItemRepository(testDb("items"));
    const second = makeChecklistItem({ id: "item-2", routeOrder: 2, routeName: "轨道车间" });
    await repository.put(makeChecklistItem());
    await repository.bulkPut([second, makeChecklistItem({ id: "item-3", routeOrder: 3, routeName: "停用区域", enabled: false })]);

    expect((await repository.listEnabled()).map((item) => item.id)).toEqual(["item-1", "item-2"]);
    expect(await repository.get("item-2")).toEqual(second);
    await repository.disable("item-2", "2026-07-28T11:00:00.000Z");

    expect(await repository.get("item-2")).toMatchObject({
      enabled: false,
      updatedAt: "2026-07-28T11:00:00.000Z",
    });
  });

  test("inspection item snapshots stay immutable after item edits", async () => {
    const db = testDb("item-snapshot");
    const itemRepository = new ItemRepository(db);
    const inspectionRepository = new InspectionRepository(db);
    const item = makeChecklistItem();
    const inspection = createInspection([item], "inspection-1", "2026-07-28");
    await itemRepository.put(item);
    await inspectionRepository.saveGraph({ inspection, groups: [], photos: [] });

    await itemRepository.put({
      ...item,
      part: "已修改部位",
      quickPhrases: ["已修改短语"],
      updatedAt: "2026-07-28T12:00:00.000Z",
    });

    const restored = await inspectionRepository.getGraph("inspection-1");
    expect(restored?.inspection.entries[0].itemSnapshot.part).toBe("油缸");
    expect(restored?.inspection.entries[0].itemSnapshot.quickPhrases).toEqual([
      "积灰未清理",
      "油泥未清理",
    ]);
  });

  test("rejects normalized enabled-name conflicts across put, bulkPut, and seedIfEmpty", async () => {
    const putDb = testDb("item-name-put");
    const putRepository = new ItemRepository(putDb);
    await putRepository.put(makeChecklistItem({ routeName: "焊机间" }));
    await expect(putRepository.put(
      makeChecklistItem({ id: "item-2", routeName: " 焊机间 " }),
    )).rejects.toThrow("检查项目名称已存在");

    const bulkDb = testDb("item-name-bulk");
    const bulkRepository = new ItemRepository(bulkDb);
    await expect(bulkRepository.bulkPut([
      makeChecklistItem({ routeName: "区域A" }),
      makeChecklistItem({ id: "item-2", routeName: " 区域A " }),
    ])).rejects.toThrow("检查项目名称已存在");
    expect(await bulkDb.checklistItems.count()).toBe(0);

    const seedDb = testDb("item-name-seed");
    const seedRepository = new ItemRepository(seedDb);
    await expect(seedRepository.seedIfEmpty([
      makeChecklistItem({ routeName: "区域B" }),
      makeChecklistItem({ id: "item-2", routeName: "区域B" }),
    ])).rejects.toThrow("检查项目名称已存在");
    expect(await seedDb.checklistItems.count()).toBe(0);

    await bulkRepository.bulkPut([
      makeChecklistItem({ routeName: "区域C", enabled: false }),
      makeChecklistItem({ id: "item-2", routeName: " 区域C ", enabled: false }),
    ]);
    expect(await bulkDb.checklistItems.count()).toBe(2);
  });
});

describe("TemplateRepository", () => {
  test("normalizes a legacy template read from IndexedDB without updating its stored version", async () => {
    const db = testDb("template-legacy-read");
    const repository = new TemplateRepository(db);
    const legacyTemplate = { ...makeTemplate(), firstLineIndentChars: 0 };
    delete (legacyTemplate as { firstLineIndentChars?: number }).firstLineIndentChars;
    await db.templates.add(legacyTemplate);

    await expect(repository.get("template-default", 1)).resolves.toMatchObject({
      firstLineIndentChars: 2,
    });
    expect(
      (await db.templates.get(["template-default", 1]) as { firstLineIndentChars?: number })
        .firstLineIndentChars,
    ).toBeUndefined();
  });

  test("stores versions under a compound key and rejects duplicate versions", async () => {
    const repository = new TemplateRepository(testDb("template-versions"));
    const version1 = makeTemplate();
    const version2 = makeTemplate({ version: 2, name: "默认模板 v2", openingText: "新版开头。" });

    await repository.save(version1);
    await repository.save(version2);

    expect(await repository.get("template-default", 1)).toEqual(version1);
    expect(await repository.get("template-default", 2)).toEqual(version2);
    expect((await repository.listVersions("template-default")).map((template) => template.version)).toEqual([
      2,
      1,
    ]);
    expect(await repository.getLatest("template-default")).toEqual(version2);
    await expect(repository.save(makeTemplate({ name: "不得覆盖旧版本" }))).rejects.toThrow(
      "模板 template-default 版本 1 已存在。",
    );
    expect(await repository.get("template-default", 1)).toEqual(version1);
  });

  test("an old inspection resolves its original template version", async () => {
    const db = testDb("inspection-template");
    const templates = new TemplateRepository(db);
    const inspections = new InspectionRepository(db);
    const version1 = makeTemplate();
    const version2 = makeTemplate({ version: 2, name: "默认模板 v2" });
    await templates.save(version1);
    await inspections.saveGraph({
      inspection: makeInspection({ entries: [] }),
      groups: [],
      photos: [],
    });
    await templates.save(version2);

    const restored = await inspections.getGraph("inspection-1");

    expect(restored?.inspection.templateVersion).toBe(1);
    expect(restored?.template).toEqual(version1);
    expect(await templates.getLatest("template-default")).toEqual(version2);
  });

  test("normal app initialization seeds the immutable default template idempotently", async () => {
    const db = testDb("default-template-seed");
    const dependencies = createAppDependencies(db);

    await initializeApp(dependencies);
    await initializeApp(dependencies);

    expect(await new TemplateRepository(db).get("template-default", 1)).toEqual(makeTemplate());
    expect(await db.templates.count()).toBe(2);
  });
});

function makeRouteTemplate(
  overrides: Partial<InspectionRouteTemplate> = {},
): InspectionRouteTemplate {
  return {
    id: "route-template-default",
    name: "默认模板",
    itemIds: ["core-route-01", "core-route-02"],
    isDefault: true,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides,
  };
}

function makeRouteItem(overrides: Partial<ReturnType<typeof makeChecklistItem>> = {}) {
  return makeChecklistItem({
    id: "core-route-01",
    routeName: "焊机间",
    ...overrides,
  });
}

describe("RouteTemplateRepository", () => {
  test("validates trimmed template names and nonempty deduplicated item ids", () => {
    expect(inspectionRouteTemplateSchema.safeParse(makeRouteTemplate()).success).toBe(true);
    expect(
      inspectionRouteTemplateSchema.safeParse(makeRouteTemplate({ name: "   " })).success,
    ).toBe(false);
    expect(
      inspectionRouteTemplateSchema.safeParse(makeRouteTemplate({ itemIds: [] })).success,
    ).toBe(false);
    expect(
      inspectionRouteTemplateSchema.safeParse(
        makeRouteTemplate({ itemIds: ["core-route-01", "core-route-01"] }),
      ).success,
    ).toBe(false);
    expect(
      inspectionRouteTemplateSchema.safeParse(
        makeRouteTemplate({ name: "其他名称", isDefault: true }),
      ).success,
    ).toBe(false);
  });

  test("saves trimmed unique templates and lists the default first by name", async () => {
    const db = testDb("route-template-list");
    const repository = new RouteTemplateRepository(db);
    await db.checklistItems.bulkAdd([
      makeRouteItem(),
      makeRouteItem({ id: "core-route-02", routeName: "轨道车" }),
      makeRouteItem({ id: "core-route-03", routeName: "办公区" }),
    ]);

    await repository.save(makeRouteTemplate({ name: " 默认模板 " }));
    await repository.save(
      makeRouteTemplate({
        id: "route-template-alpha",
        name: "甲模板",
        itemIds: ["core-route-03"],
        isDefault: false,
      }),
    );
    await repository.save(
      makeRouteTemplate({
        id: "route-template-beta",
        name: "乙模板",
        itemIds: ["core-route-02"],
        isDefault: false,
      }),
    );

    expect((await repository.get("route-template-default"))?.name).toBe("默认模板");
    expect((await repository.list()).map((template) => template.id)).toEqual([
      "route-template-default",
      "route-template-alpha",
      "route-template-beta",
    ]);
    await expect(
      repository.save(
        makeRouteTemplate({
          id: "route-template-duplicate",
          name: "默认模板",
          itemIds: ["core-route-03"],
          isDefault: false,
        }),
      ),
    ).rejects.toThrow(/模板名称已存在|默认模板名称仅供默认模板使用/);
  });

  test("rejects invalid item references and a second default template", async () => {
    const db = testDb("route-template-validation");
    const repository = new RouteTemplateRepository(db);
    await db.checklistItems.bulkAdd([
      makeRouteItem(),
      makeRouteItem({ id: "core-route-02", routeName: "轨道车", enabled: false }),
      makeRouteItem({ id: "core-route-03", routeName: "办公区" }),
    ]);
    await repository.save(makeRouteTemplate({ itemIds: ["core-route-01"] }));

    await expect(
      repository.save(
        makeRouteTemplate({
          id: "route-template-missing",
          name: "缺少项目",
          itemIds: ["missing"],
          isDefault: false,
        }),
      ),
    ).rejects.toThrow("检查项目 missing 不存在或已停用");
    await repository.save(
      makeRouteTemplate({
        id: "route-template-disabled",
        name: "停用项目",
        itemIds: ["core-route-02"],
        isDefault: false,
      }),
    );
    expect((await repository.get("route-template-disabled"))?.itemIds).toEqual(["core-route-02"]);
    await expect(
      repository.save(
        makeRouteTemplate({
          id: "route-template-second-default",
          name: "第二默认模板",
          itemIds: ["core-route-03"],
          isDefault: true,
        }),
      ),
    ).rejects.toBeDefined();
  });

  test("keeps an existing default template protected from demotion", async () => {
    const db = testDb("route-template-default-demotion");
    const repository = new RouteTemplateRepository(db);
    await db.checklistItems.add(makeRouteItem());
    const defaultTemplate = makeRouteTemplate({ itemIds: ["core-route-01"] });
    await repository.save(defaultTemplate);

    await expect(
      repository.save({ ...defaultTemplate, isDefault: false }),
    ).rejects.toThrow("默认模板不能取消默认状态");

    expect((await repository.get(defaultTemplate.id))?.isDefault).toBe(true);
    await expect(repository.remove(defaultTemplate.id)).rejects.toThrow("默认模板不能删除");
  });

  test("rejects a default template whose name is not exactly 默认模板", async () => {
    const db = testDb("route-template-default-name");
    const repository = new RouteTemplateRepository(db);
    await db.checklistItems.add(makeRouteItem());

    await expect(repository.save(makeRouteTemplate({ name: "已改名默认模板" }))).rejects.toBeDefined();
    expect(await db.routeTemplates.count()).toBe(0);
  });

  test("rejects enabled template items with duplicate normalized route names", async () => {
    const db = testDb("route-template-duplicate-route-name");
    const repository = new RouteTemplateRepository(db);
    await db.checklistItems.bulkAdd([
      makeRouteItem(),
      makeRouteItem({ id: "core-route-02", routeName: " 焊机间 " }),
    ]);

    await expect(
      repository.save(makeRouteTemplate()),
    ).rejects.toThrow("检查项目名称 焊机间 重复");
  });

  test("updates a custom template and refuses to delete the default", async () => {
    const db = testDb("route-template-crud");
    const repository = new RouteTemplateRepository(db);
    await db.checklistItems.bulkAdd([
      makeRouteItem(),
      makeRouteItem({ id: "core-route-02", routeName: "轨道车" }),
    ]);
    const defaultTemplate = makeRouteTemplate();
    const customTemplate = makeRouteTemplate({
      id: "route-template-custom",
      name: "自建模板",
      itemIds: ["core-route-01"],
      isDefault: false,
    });
    await repository.save(defaultTemplate);
    await repository.save(customTemplate);

    await repository.save({ ...customTemplate, name: "已修改模板", itemIds: ["core-route-02"] });
    expect(await repository.get(customTemplate.id)).toMatchObject({
      name: "已修改模板",
      itemIds: ["core-route-02"],
    });
    await expect(repository.remove(defaultTemplate.id)).rejects.toThrow("默认模板不能删除");
    await repository.remove(customTemplate.id);
    await expect(repository.get(customTemplate.id)).resolves.toBeUndefined();
  });

  test("saves a new template and its custom items in one transaction", async () => {
    const db = testDb("route-template-save-with-custom-items");
    const repository = new RouteTemplateRepository(db);
    await db.checklistItems.add(makeRouteItem());
    const template = makeRouteTemplate({
      id: "route-template-new",
      name: "新建模板",
      itemIds: ["core-route-01", "custom-route-new"],
      isDefault: false,
    });
    const customItem = makeRouteItem({
      id: "custom-route-new",
      routeName: "新增区域",
      routeOrder: 0,
    });

    const result = await repository.saveWithCustomItems(template, [customItem]);

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: "custom-route-new", routeName: "新增区域", routeOrder: 2 });
    expect(result.template.itemIds).toEqual(["core-route-01", "custom-route-new"]);
    expect(await db.checklistItems.get("custom-route-new")).toEqual(result.items[0]);
    expect(await repository.get(template.id)).toEqual(result.template);
  });

  test("adds a unique custom item and updates the template atomically", async () => {
    const db = testDb("route-template-custom-item");
    const repository = new RouteTemplateRepository(db);
    await db.checklistItems.add(makeRouteItem());
    await repository.save(makeRouteTemplate({ itemIds: ["core-route-01"] }));
    const customItem = makeRouteItem({
      id: "custom-route-01",
      routeName: " 自定义区域 ",
      routeOrder: 2,
    });

    await repository.addCustomItem("route-template-default", customItem);

    expect((await db.checklistItems.get(customItem.id))?.routeName).toBe("自定义区域");
    expect((await repository.get("route-template-default"))?.itemIds).toEqual([
      "core-route-01",
      "custom-route-01",
    ]);
    await expect(
      repository.addCustomItem(
        "route-template-default",
        makeRouteItem({ id: "custom-route-02", routeName: "自定义区域", routeOrder: 3 }),
      ),
    ).rejects.toThrow("检查项目名称已存在");
    await expect(
      repository.addCustomItem(
        "route-template-default",
        makeRouteItem({ id: "custom-route-disabled", routeName: "停用区域", enabled: false }),
      ),
    ).rejects.toThrow("自定义检查项目必须启用");
    expect((await repository.get("route-template-default"))?.itemIds).toEqual([
      "core-route-01",
      "custom-route-01",
    ]);
  });

  test("rolls back both writes when custom item insertion conflicts", async () => {
    const db = testDb("route-template-custom-item-rollback");
    const repository = new RouteTemplateRepository(db);
    await db.checklistItems.add(makeRouteItem());
    await repository.save(makeRouteTemplate({ itemIds: ["core-route-01"] }));

    await expect(
      repository.addCustomItem(
        "route-template-default",
        makeRouteItem({ id: "core-route-01", routeName: "新的区域", routeOrder: 2 }),
      ),
    ).rejects.toBeDefined();

    expect((await repository.get("route-template-default"))?.itemIds).toEqual(["core-route-01"]);
    expect(await db.checklistItems.count()).toBe(1);
  });

  test("returns the persisted custom item and template with a transaction-owned order", async () => {
    const db = testDb("route-template-custom-item-result");
    const repository = new RouteTemplateRepository(db);
    await db.checklistItems.add(makeRouteItem({ routeOrder: 4 }));
    await repository.save(makeRouteTemplate({ itemIds: ["core-route-01"] }));

    const result = await repository.addCustomItem(
      "route-template-default",
      makeRouteItem({
        id: "custom-route-result",
        routeName: " Custom Area ",
        routeOrder: 999,
      }),
    );

    expect(result.item).toMatchObject({
      id: "custom-route-result",
      routeName: "Custom Area",
      routeOrder: 5,
    });
    expect(result.template).toMatchObject({
      id: "route-template-default",
      itemIds: ["core-route-01", "custom-route-result"],
    });
    expect(await db.checklistItems.get("custom-route-result")).toEqual(result.item);
    expect(await repository.get("route-template-default")).toEqual(result.template);
  });

  test("allocates distinct sequential custom-item orders after a disabled high-water mark", async () => {
    const db = testDb("route-template-custom-item-concurrent-order");
    const repository = new RouteTemplateRepository(db);
    await db.checklistItems.bulkAdd([
      makeRouteItem({ routeOrder: 5 }),
      makeRouteItem({
        id: "disabled-high-order-route",
        routeName: "Disabled High Order",
        routeOrder: 99,
        enabled: false,
      }),
    ]);
    await repository.save(makeRouteTemplate({ itemIds: ["core-route-01"] }));

    const [first, second] = await Promise.all([
      repository.addCustomItem(
        "route-template-default",
        makeRouteItem({ id: "custom-route-01", routeName: "Concurrent Area A", routeOrder: 1 }),
      ),
      repository.addCustomItem(
        "route-template-default",
        makeRouteItem({ id: "custom-route-02", routeName: "Concurrent Area B", routeOrder: 1 }),
      ),
    ]);

    expect([first.item.routeOrder, second.item.routeOrder].sort((left, right) => left - right)).toEqual([100, 101]);
    expect((await repository.get("route-template-default"))?.itemIds).toEqual([
      "core-route-01",
      "custom-route-01",
      "custom-route-02",
    ]);
  });
});
