import { expect, test } from "vitest";
import { createInspection } from "./inspection";
import type { InspectionEntry } from "./models";
import {
  resolveReviewRouteOrder,
  resolveReviewRouteOrderForCategory,
  sortRouteNamesForReview,
  sortRouteNamesForReviewByCategory,
} from "./reviewRouteOrder";
import { inspectionRecordSchema } from "./schemas";
import { makeChecklistItem, makeInspection, makePhoto, makePhotoGroup } from "../test/fixtures";

function entryFor(routeName: string, order: number): InspectionEntry {
  const inspection = makeInspection();
  const entry = inspection.entries[0]!;

  return {
    ...entry,
    id: `entry-${order}`,
    itemId: `item-${order}`,
    itemSnapshot: {
      ...entry.itemSnapshot,
      id: `item-${order}`,
      routeName,
    },
    groupIds: [],
    order,
  };
}

test("new inspections initialize a deduplicated full route-title order", () => {
  const inspection = createInspection([
    makeChecklistItem({ id: "item-a", routeName: "卷扬机间" }),
    makeChecklistItem({ id: "item-b", routeName: "仓库外围院子" }),
    makeChecklistItem({ id: "item-c", routeName: "卷扬机间" }),
  ], "inspection-route-order", "2026-07-30");

  expect(inspection.reviewRouteOrder).toEqual(["卷扬机间", "仓库外围院子"]);
});

test("keeps an explicit route order and appends newly seen titles once", () => {
  const inspection = makeInspection({
    reviewRouteOrder: ["仓库外围院子", "卷扬机间"],
    entries: [
      entryFor("卷扬机间", 0),
      entryFor("装整工班办公室", 1),
      entryFor("仓库外围院子", 2),
    ],
  });

  expect(resolveReviewRouteOrder(inspection)).toEqual([
    "仓库外围院子",
    "卷扬机间",
    "装整工班办公室",
  ]);
});

test("uses entry order for a legacy inspection without reviewRouteOrder", () => {
  const legacy = makeInspection({
    entries: [entryFor("乙项点", 1), entryFor("甲项点", 0)],
  });
  delete (legacy as { reviewRouteOrder?: string[] }).reviewRouteOrder;

  expect(resolveReviewRouteOrder(legacy)).toEqual(["甲项点", "乙项点"]);
});

test("lists only route titles that have photos in resolved order", () => {
  const inspection = makeInspection({
    reviewRouteOrder: ["仓库外围院子", "卷扬机间", "装整工班办公室"],
    entries: [entryFor("卷扬机间", 0), entryFor("装整工班办公室", 1), entryFor("仓库外围院子", 2)],
  });
  const groups = [
    makePhotoGroup({ id: "group-a", entryId: "entry-0", photoIds: ["photo-a"] }),
    makePhotoGroup({ id: "group-b", entryId: "entry-2", photoIds: ["photo-b"] }),
  ];

  expect(sortRouteNamesForReview({
    inspection,
    groups,
    photos: [
      makePhoto(undefined, { id: "photo-a", groupId: "group-a" }),
      makePhoto(undefined, { id: "photo-b", groupId: "group-b" }),
    ],
  })).toEqual(["仓库外围院子", "卷扬机间"]);
});

test("resolves an independent route-title order for each photo category", () => {
  const inspection = makeInspection({
    reviewRouteOrder: ["卷扬机间", "仓库外围院子", "装整工班办公室"],
    reviewRouteOrderByCategory: {
      good: ["仓库外围院子", "卷扬机间"],
      reminder: ["卷扬机间"],
    },
    entries: [
      entryFor("卷扬机间", 0),
      entryFor("仓库外围院子", 1),
      entryFor("装整工班办公室", 2),
    ],
  });

  expect(resolveReviewRouteOrderForCategory(inspection, "good", ["卷扬机间", "仓库外围院子"]))
    .toEqual(["仓库外围院子", "卷扬机间"]);
  expect(resolveReviewRouteOrderForCategory(inspection, "reminder", ["仓库外围院子", "卷扬机间"]))
    .toEqual(["卷扬机间", "仓库外围院子"]);
  expect(resolveReviewRouteOrderForCategory(inspection, "assessment", ["仓库外围院子", "卷扬机间"]))
    .toEqual(["卷扬机间", "仓库外围院子"]);
});

test("sorts general photo routes independently", () => {
  const inspection = makeInspection({
    reviewRouteOrder: ["route-a", "route-b"],
    reviewRouteOrderByCategory: { general: ["route-b", "route-a"] },
    entries: [entryFor("route-a", 0), entryFor("route-b", 1)],
  });

  expect(sortRouteNamesForReviewByCategory({
    inspection,
    groups: [
      makePhotoGroup({ id: "general-a", entryId: "entry-0", category: "general", photoIds: ["photo-a"] }),
      makePhotoGroup({ id: "general-b", entryId: "entry-1", category: "general", photoIds: ["photo-b"] }),
    ],
    photos: [
      makePhoto(undefined, { id: "photo-a", groupId: "general-a" }),
      makePhoto(undefined, { id: "photo-b", groupId: "general-b" }),
    ],
  }).general).toEqual(["route-b", "route-a"]);
});

test("inspection records accept legacy missing order but reject duplicate saved titles", () => {
  const { entries: _entries, ...record } = makeInspection();

  expect(inspectionRecordSchema.safeParse(record).success).toBe(true);
  expect(inspectionRecordSchema.safeParse({
    ...record,
    reviewRouteOrder: ["卷扬机间", "卷扬机间"],
  }).success).toBe(false);
});
