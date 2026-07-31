// @vitest-environment node

import { afterEach, expect, test } from "vitest";
import { makeInspection, makePhoto, makePhotoGroup } from "../test/fixtures";
import { createTestDb, type SevenSDb } from "./database";
import { InspectionRepository } from "./inspectionRepository";

const databases: SevenSDb[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (db) => {
    db.close();
    await db.delete();
  }));
});

test("adds each photo to an active good group in one transaction", async () => {
  const db = createTestDb(`photo-add-${Date.now()}`);
  databases.push(db);
  const repository = new InspectionRepository(db);
  const inspection = makeInspection({
    entries: [{ ...makeInspection().entries[0], groupIds: [] }],
  });
  await repository.saveGraph({ inspection, groups: [], photos: [] });
  const first = makePhoto(undefined, { id: "photo-1" });
  const second = makePhoto(undefined, { id: "photo-2" });

  const firstResult = await repository.addPhotoToGoodGroup("entry-1", first, "group-new");
  const secondResult = await repository.addPhotoToGoodGroup("entry-1", second, "group-unused");

  expect(firstResult).toMatchObject({
    entry: { groupIds: ["group-new"] },
    group: { id: "group-new", photoIds: ["photo-1"] },
    photo: { id: "photo-1", groupId: "group-new", order: 0 },
  });
  expect(secondResult).toMatchObject({
    entry: { groupIds: ["group-new"] },
    group: { id: "group-new", photoIds: ["photo-1", "photo-2"] },
    photo: { id: "photo-2", groupId: "group-new", order: 1 },
  });

  const graph = await repository.getGraph("inspection-1");
  expect(graph?.groups).toHaveLength(1);
  expect(graph?.groups[0]).toMatchObject({
    id: "group-new",
    category: "good",
    description: inspection.entries[0].itemSnapshot.goodText,
    photoIds: ["photo-1", "photo-2"],
  });
  expect(graph?.photos.map(({ id, groupId, order }) => ({ id, groupId, order }))).toEqual([
    { id: "photo-1", groupId: "group-new", order: 0 },
    { id: "photo-2", groupId: "group-new", order: 1 },
  ]);
});

test("replaces photo bytes without changing graph references", async () => {
  const db = createTestDb(`photo-replace-${Date.now()}`);
  databases.push(db);
  const repository = new InspectionRepository(db);
  const original = makePhoto(new Blob(["original"], { type: "image/jpeg" }));
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [{
      id: "group-1",
      inspectionId: "inspection-1",
      entryId: "entry-1",
      category: "good",
      description: "现场保持良好。",
      awardAssessment: null,
      photoIds: ["photo-1"],
      order: 0,
    }],
    photos: [original],
  });

  await repository.replacePhoto({
    ...original,
    imageBlob: new Blob(["replacement"], { type: "image/jpeg" }),
    thumbnailBlob: new Blob(["replacement-thumb"], { type: "image/jpeg" }),
    width: 900,
    height: 1200,
  });

  const graph = await repository.getGraph("inspection-1");
  expect(graph?.inspection.entries[0].groupIds).toEqual(["group-1"]);
  expect(graph?.groups[0].photoIds).toEqual(["photo-1"]);
  expect(graph?.photos[0]).toMatchObject({
    id: "photo-1",
    groupId: "group-1",
    order: 0,
    width: 900,
    height: 1200,
  });
});

test("deleting the last photo removes its empty group and entry reference", async () => {
  const db = createTestDb(`photo-delete-${Date.now()}`);
  databases.push(db);
  const repository = new InspectionRepository(db);
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [{
      id: "group-1",
      inspectionId: "inspection-1",
      entryId: "entry-1",
      category: "good",
      description: "现场保持良好。",
      awardAssessment: null,
      photoIds: ["photo-1"],
      order: 0,
    }],
    photos: [makePhoto()],
  });

  await repository.deletePhoto("photo-1");

  const graph = await repository.getGraph("inspection-1");
  expect(graph?.photos).toEqual([]);
  expect(graph?.groups).toEqual([]);
  expect(graph?.inspection.entries[0].groupIds).toEqual([]);
});

test("persists group evaluation and serialized annotations across a database reload", async () => {
  const databaseName = `task-7-reload-${Date.now()}`;
  const db = createTestDb(databaseName);
  databases.push(db);
  const repository = new InspectionRepository(db);
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [{
      id: "group-1",
      inspectionId: "inspection-1",
      entryId: "entry-1",
      category: "good",
      description: "现场保持良好。",
      awardAssessment: null,
      photoIds: ["photo-1"],
      order: 0,
    }],
    photos: [makePhoto()],
  });
  const annotationJson = JSON.stringify([
    { type: "ellipse", x: 0.1, y: 0.2, width: 0.3, height: 0.4, color: "#d12f2f" },
  ]);

  await repository.updatePhotoGroup({
    ...(await db.photoGroups.get("group-1"))!,
    category: "assessment",
    description: "油缸表面油污未清理。",
    awardAssessment: { type: "assessment", people: "李四", amount: 70 },
  });
  await repository.updatePhotoAnnotation("photo-1", annotationJson);
  db.close();

  const reopened = createTestDb(databaseName);
  databases.push(reopened);
  const restored = await new InspectionRepository(reopened).getGraph("inspection-1");
  expect(restored?.groups[0]).toMatchObject({
    category: "assessment",
    description: "油缸表面油污未清理。",
    awardAssessment: { type: "assessment", people: "李四", amount: 70 },
  });
  expect(restored?.photos[0].annotationJson).toBe(annotationJson);
});

test("group evaluation updates cannot change structural photo references", async () => {
  const db = createTestDb(`task-7-group-structure-${Date.now()}`);
  databases.push(db);
  const repository = new InspectionRepository(db);
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup()],
    photos: [makePhoto()],
  });

  await expect(repository.updatePhotoGroup({
    ...makePhotoGroup(),
    photoIds: ["photo-other"],
  })).rejects.toThrow("照片引用不能通过评价更新修改");
  expect((await repository.getGraph("inspection-1"))?.groups[0].photoIds).toEqual(["photo-1"]);
});

test("rejects decimal award amounts at the repository boundary", async () => {
  const db = createTestDb(`task-7-decimal-amount-${Date.now()}`);
  databases.push(db);
  const repository = new InspectionRepository(db);
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup()],
    photos: [makePhoto()],
  });

  await expect(repository.updatePhotoGroup({
    ...makePhotoGroup(),
    awardAssessment: { type: "reward", people: "张三", amount: 1.5 },
  })).rejects.toThrow("金额必须为大于0的安全整数");
  expect((await repository.getGraph("inspection-1"))?.groups[0].awardAssessment).toBeNull();
});

test("rejects invalid categories and incompatible award types at the repository boundary", async () => {
  const db = createTestDb(`task-7-category-award-${Date.now()}`);
  databases.push(db);
  const repository = new InspectionRepository(db);
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup()],
    photos: [makePhoto()],
  });

  await expect(repository.updatePhotoGroup({
    ...makePhotoGroup(),
    category: "other",
  } as unknown as ReturnType<typeof makePhotoGroup>)).rejects.toThrow("照片组分类无效");
  await expect(repository.updatePhotoGroup({
    ...makePhotoGroup(),
    category: "assessment",
    awardAssessment: { type: "reward", people: "张三", amount: 50 },
  })).rejects.toThrow("奖考类型与照片组分类不一致");
});
