import JSZip from "jszip";
import { describe, expect, test, vi } from "vitest";
import { SevenSDb, createTestDb, type InspectionRecord } from "./database";
import { InspectionRepository } from "./inspectionRepository";
import {
  createBackup,
  inspectBackup,
  restoreBackup,
  storageCapacityState,
} from "./backupRepository";
import type { InspectionGraph, InspectionRouteTemplate } from "../domain/models";
import { makeChecklistItem, makeInspection, makePhoto, makePhotoGroup, makeTemplate } from "../test/fixtures";

const MiB = 1024 * 1024;

interface ManifestForTest {
  schemaVersion: number;
  rowCounts: Record<string, number>;
  files: Record<string, { sha256: string }>;
}

interface TestZipEntryLocation {
  centralHeaderOffset: number;
  compressedSize: number;
  localHeaderOffset: number;
  dataOffset: number;
}

interface StreamableZipEntry {
  internalStream(type: string): JSZip.JSZipStreamHelper<unknown>;
}

class RangeTrackingBlob extends Blob {
  readonly sliceRanges: Array<[number, number]> = [];

  override slice(start?: number, end?: number, contentType?: string): Blob {
    const normalizedStart = start ?? 0;
    const normalizedEnd = end ?? this.size;
    this.sliceRanges.push([normalizedStart, normalizedEnd]);
    return super.slice(start, end, contentType);
  }
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readBlobBytes(blob: Blob): Promise<number[]> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer().then((value) => Array.from(new Uint8Array(value)));
  }
  if (typeof Response === "function") {
    return new Response(blob).arrayBuffer().then((value) => Array.from(new Uint8Array(value)));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(Array.from(new Uint8Array(reader.result as ArrayBuffer)));
    reader.onerror = () => reject(reader.error ?? new Error("test blob read failed"));
    reader.readAsArrayBuffer(blob);
  });
}

async function rewriteZip(
  source: Blob,
  mutate: (zip: JSZip) => Promise<void> | void,
): Promise<Blob> {
  const zip = await JSZip.loadAsync(await source.arrayBuffer());
  await mutate(zip);
  return zip.generateAsync({ type: "blob", mimeType: "application/zip" });
}

function endOfCentralOffset(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.byteLength - 22; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) !== 0x06054b50) continue;
    if (offset + 22 + view.getUint16(offset + 20, true) === bytes.byteLength) return offset;
  }
  throw new Error("test ZIP EOCD missing");
}

function testZipEntryLocation(bytes: Uint8Array, path: string): TestZipEntryLocation {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = endOfCentralOffset(bytes);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  let offset = view.getUint32(eocdOffset + 16, true);
  const centralEnd = offset + centralSize;
  const decoder = new TextDecoder();
  while (offset < centralEnd) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("test central header invalid");
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    if (name === path) {
      const localHeaderOffset = view.getUint32(offset + 42, true);
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
        throw new Error("test local header invalid");
      }
      const localNameLength = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
      return {
        centralHeaderOffset: offset,
        compressedSize: view.getUint32(offset + 20, true),
        localHeaderOffset,
        dataOffset: localHeaderOffset + 30 + localNameLength + localExtraLength,
      };
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  throw new Error(`test ZIP entry missing: ${path}`);
}

async function forgeUncompressedSize(source: Blob, path: string, declaredSize: number): Promise<Blob> {
  const bytes = new Uint8Array(await source.arrayBuffer());
  const location = testZipEntryLocation(bytes, path);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  view.setUint32(location.localHeaderOffset + 22, declaredSize, true);
  view.setUint32(location.centralHeaderOffset + 24, declaredSize, true);
  return new Blob([bytes], { type: "application/zip" });
}

async function forgeEocdEntryCount(source: Blob, declaredCount: number): Promise<Blob> {
  const bytes = new Uint8Array(await source.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = endOfCentralOffset(bytes);
  view.setUint16(offset + 8, declaredCount, true);
  view.setUint16(offset + 10, declaredCount, true);
  return new Blob([bytes], { type: "application/zip" });
}

async function mutateZipBytes(source: Blob, mutate: (bytes: Uint8Array, eocdOffset: number) => void): Promise<Blob> {
  const bytes = new Uint8Array(await source.arrayBuffer());
  mutate(bytes, endOfCentralOffset(bytes));
  return new Blob([bytes], { type: "application/zip" });
}

async function corruptCompressedPayload(source: Blob, path: string): Promise<Blob> {
  const sourceZip = await JSZip.loadAsync(await source.arrayBuffer());
  const deflated = await sourceZip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  const bytes = new Uint8Array(await deflated.arrayBuffer());
  const location = testZipEntryLocation(bytes, path);
  bytes[location.dataOffset + Math.floor(location.compressedSize / 2)] ^= 0xff;
  return new Blob([bytes], { type: "application/zip" });
}

async function rewriteJsonAndHash(zip: JSZip, path: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value);
  zip.file(path, serialized);
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("manifest missing in test backup");
  const manifest = JSON.parse(await manifestFile.async("string")) as ManifestForTest;
  manifest.files[path].sha256 = await sha256(serialized);
  zip.file("manifest.json", JSON.stringify(manifest));
}

async function rewriteManifest(zip: JSZip, mutate: (manifest: ManifestForTest) => void): Promise<void> {
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("manifest missing in test backup");
  const manifest = JSON.parse(await manifestFile.async("string")) as ManifestForTest;
  mutate(manifest);
  zip.file("manifest.json", JSON.stringify(manifest));
}

async function setBackupSchemaVersion(zip: JSZip, version: 1 | 2 | 3): Promise<void> {
  await rewriteManifest(zip, (manifest) => {
    manifest.schemaVersion = version;
    if (version === 1) {
      delete manifest.rowCounts.routeTemplates;
      delete manifest.files["data/route-templates.json"];
    }
  });
  if (version === 1) zip.remove("data/route-templates.json");
}

async function schema1Backup(source: Blob): Promise<Blob> {
  return rewriteZip(source, async (zip) => {
    const entriesFile = zip.file("data/entries.json");
    if (!entriesFile) throw new Error("entries missing in test backup");
    const entries = JSON.parse(await entriesFile.async("string")) as Array<Record<string, unknown>>;
    for (const entry of entries) delete entry.checkSelections;
    await rewriteJsonAndHash(zip, "data/entries.json", entries);
    const manifestFile = zip.file("manifest.json");
    if (!manifestFile) throw new Error("manifest missing in test backup");
    const manifest = JSON.parse(await manifestFile.async("string")) as ManifestForTest;
    manifest.schemaVersion = 1;
    delete manifest.rowCounts.routeTemplates;
    delete manifest.files["data/route-templates.json"];
    zip.remove("data/route-templates.json");
    zip.file("manifest.json", JSON.stringify(manifest));
  });
}

async function schema2BackupWithoutCheckSelections(source: Blob): Promise<Blob> {
  return rewriteZip(source, async (zip) => {
    const file = zip.file("data/entries.json");
    if (!file) throw new Error("entries missing in test backup");
    const entries = JSON.parse(await file.async("string")) as Array<Record<string, unknown>>;
    for (const entry of entries) delete entry.checkSelections;
    await rewriteJsonAndHash(zip, "data/entries.json", entries);
    await rewriteManifest(zip, (manifest) => {
      manifest.schemaVersion = 2;
    });
  });
}

function makeRouteTemplate(
  overrides: Partial<InspectionRouteTemplate> = {},
): InspectionRouteTemplate {
  return {
    id: "route-template-default",
    name: "默认模板",
    itemIds: ["item-1"],
    isDefault: true,
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}

async function rewriteRouteTemplates(
  zip: JSZip,
  routeTemplates: InspectionRouteTemplate[],
): Promise<void> {
  await rewriteJsonAndHash(zip, "data/route-templates.json", routeTemplates);
  await rewriteManifest(zip, (manifest) => {
    manifest.rowCounts.routeTemplates = routeTemplates.length;
  });
}

async function seedLocalDefault(
  db: SevenSDb,
  itemId = "item-1",
): Promise<void> {
  if (!await db.checklistItems.get(itemId)) {
    await db.checklistItems.put(makeChecklistItem({ id: itemId, routeName: `本地默认路线-${itemId}` }));
  }
  await db.routeTemplates.put(makeRouteTemplate({ itemIds: [itemId] }));
}

function graphFor(
  id: string,
  entryId = `${id}-entry`,
  status: InspectionRecord["status"] = "draft",
): InspectionGraph {
  const inspection = makeInspection({
    id,
    title: `${id} 7S巡检通报`,
    status,
    entries: [{
      ...makeInspection().entries[0],
      id: entryId,
      inspectionId: id,
      groupIds: [],
    }],
  });
  return { inspection, groups: [], photos: [], template: makeTemplate() };
}

function photoGraphFor(
  id: string,
  entryId: string,
  groupId: string,
  photoId: string,
): InspectionGraph {
  const inspection = makeInspection({
    id,
    title: `${id} 7S巡检通报`,
    entries: [{
      ...makeInspection().entries[0],
      id: entryId,
      inspectionId: id,
      groupIds: [groupId],
    }],
  });
  return {
    inspection,
    groups: [makePhotoGroup({ id: groupId, inspectionId: id, entryId, photoIds: [photoId] })],
    photos: [makePhoto(undefined, { id: photoId, inspectionId: id, groupId })],
    template: makeTemplate(),
  };
}

async function seedCompleteDatabase(db: SevenSDb): Promise<void> {
  await db.checklistItems.put(makeChecklistItem());
  await db.templates.put(makeTemplate());
  await db.routeTemplates.put(makeRouteTemplate());
  await new InspectionRepository(db).saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup()],
    photos: [makePhoto(new Blob([new Uint8Array([0, 1, 2, 253, 254, 255])], { type: "image/jpeg" }), {
      thumbnailBlob: new Blob([new Uint8Array([9, 8, 7, 6])], { type: "image/jpeg" }),
    })],
    template: makeTemplate(),
  });
  await db.settings.put({
    key: "backup-test-setting",
    value: { enabled: true, labels: ["甲", "乙"] },
    updatedAt: "2026-07-29T00:00:00.000Z",
  });
}

async function comparableSnapshot(db: SevenSDb) {
  const photos = await db.photos.toArray();
  return {
    checklistItems: (await db.checklistItems.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
    inspections: (await db.inspections.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
    entries: (await db.entries.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
    photoGroups: (await db.photoGroups.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
    photos: await Promise.all(photos.sort((a, b) => a.id.localeCompare(b.id)).map(async (photo) => ({
      ...photo,
      imageBlob: {
        type: photo.imageBlob.type || "image/jpeg",
        bytes: await readBlobBytes(photo.imageBlob),
      },
      thumbnailBlob: {
        type: photo.thumbnailBlob.type || "image/jpeg",
        bytes: await readBlobBytes(photo.thumbnailBlob),
      },
    }))),
    templates: (await db.templates.toArray()).sort((a, b) =>
      a.id.localeCompare(b.id) || a.version - b.version),
    routeTemplates: (await db.routeTemplates.toArray()).sort((a, b) => a.id.localeCompare(b.id)),
    settings: (await db.settings.toArray()).sort((a, b) => a.key.localeCompare(b.key)),
  };
}

async function clearApplicationTables(db: SevenSDb): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
  });
}

test("round trips every row and exact full/thumbnail Blob bytes after clear and reopen", async () => {
  const db = createTestDb(`backup-round-trip-${Date.now()}`);
  await seedCompleteDatabase(db);
  await new InspectionRepository(db).updateEntryCheckSelections("inspection-1", "entry-1", [
    { category: "safety", value: "\u5b89\u5168\u901a\u9053\u7545\u901a", isCustom: false },
    { category: "environment", value: "  \u5df2\u6e05\u626b  ", isCustom: true },
  ]);
  const before = await comparableSnapshot(db);

  const backup = await createBackup(db);
  const preview = await inspectBackup(backup);
  const zip = await JSZip.loadAsync(await backup.arrayBuffer());
  const manifestFile = zip.file("manifest.json");
  if (!manifestFile) throw new Error("manifest missing in test backup");
  const manifest = JSON.parse(await manifestFile.async("string")) as ManifestForTest;
  expect(preview.schemaVersion).toBe(3);
  expect(manifest.schemaVersion).toBe(3);
  expect(manifest.rowCounts.routeTemplates).toBe(1);
  expect(await zip.file("data/route-templates.json")?.async("string")).toContain("默认模板");
  expect(preview.counts).toEqual({
    checklistItems: 1,
    templates: 1,
    routeTemplates: 1,
    inspections: 1,
    entries: 1,
    photoGroups: 1,
    photos: 1,
    settings: 1,
  });

  await clearApplicationTables(db);
  const name = db.name;
  db.close();
  const reopened = new SevenSDb(name);
  await restoreBackup(reopened, backup, "replace");

  expect(await comparableSnapshot(reopened)).toEqual(before);
});

test.each(["replace", "merge"] as const)(
  "preserves normalized check selections through a version 3 %s restore",
  async (mode) => {
    const source = createTestDb(`backup-v3-selections-source-${mode}-${Date.now()}`);
    await seedCompleteDatabase(source);
    await new InspectionRepository(source).updateEntryCheckSelections("inspection-1", "entry-1", [
      { category: "safety", value: "\u5b89\u5168\u901a\u9053\u7545\u901a", isCustom: false },
      { category: "environment", value: "  \u5df2\u6e05\u626b  ", isCustom: true },
    ]);
    const backup = await createBackup(source);
    const target = createTestDb(`backup-v3-selections-target-${mode}-${Date.now()}`);
    if (mode === "merge") {
      await target.checklistItems.put(makeChecklistItem());
      await target.templates.put(makeTemplate());
      await target.routeTemplates.put(makeRouteTemplate());
    }

    await expect(inspectBackup(backup)).resolves.toMatchObject({ schemaVersion: 3 });
    await restoreBackup(target, backup, mode);

    expect((await target.entries.get("entry-1"))?.checkSelections).toEqual([
      { category: "environment", value: "\u5df2\u6e05\u626b", isCustom: true },
    ]);
  },
);

test("writes raw local check selections in normalized fixed category order", async () => {
  const db = createTestDb(`backup-v3-normalized-export-${Date.now()}`);
  await seedCompleteDatabase(db);
  await db.entries.update("entry-1", {
    checkSelections: [
      { category: "safety", value: "\u5b89\u5168\u901a\u9053\u7545\u901a", isCustom: false },
      { category: "environment", value: "  \u5df2\u6e05\u626b  ", isCustom: true },
    ],
  });

  const zip = await JSZip.loadAsync(await (await createBackup(db)).arrayBuffer());
  const file = zip.file("data/entries.json");
  if (!file) throw new Error("entries missing in test backup");

  expect(JSON.parse(await file.async("string"))[0].checkSelections).toEqual([
    { category: "environment", value: "\u5df2\u6e05\u626b", isCustom: true },
  ]);
});

test("defaults missing version 2 check selections to an empty list", async () => {
  const source = createTestDb(`backup-v2-selections-source-${Date.now()}`);
  await seedCompleteDatabase(source);
  const backup = await schema2BackupWithoutCheckSelections(await createBackup(source));
  const target = createTestDb(`backup-v2-selections-target-${Date.now()}`);

  await expect(inspectBackup(backup)).resolves.toMatchObject({ schemaVersion: 2 });
  await restoreBackup(target, backup, "replace");

  expect((await target.entries.get("entry-1"))?.checkSelections).toEqual([]);
});

const invalidCheckSelectionCases = [
  ["duplicate categories", [
    { category: "environment", value: "\u5e72\u51c0\u6574\u6d01", isCustom: false },
    { category: "environment", value: "\u57fa\u672c\u6574\u6d01", isCustom: false },
  ]],
  ["invalid fixed value", [
    { category: "environment", value: "\u4e0d\u5b58\u5728", isCustom: false },
  ]],
  ["empty custom value", [
    { category: "environment", value: "   ", isCustom: true },
  ]],
  ["unknown category", [
    { category: "unknown", value: "\u5e72\u51c0\u6574\u6d01", isCustom: false },
  ]],
] as const;

test.each(
  ([1, 2, 3] as const).flatMap((schemaVersion) =>
    invalidCheckSelectionCases.map(([label, selections]) => [schemaVersion, label, selections] as const),
  ),
)("rejects schema version %i backup entries with %s check selections", async (schemaVersion, _label, checkSelections) => {
  const source = createTestDb(`backup-v${schemaVersion}-invalid-selections-${_label}-${Date.now()}`);
  await seedCompleteDatabase(source);
  const invalid = await rewriteZip(await createBackup(source), async (zip) => {
    const file = zip.file("data/entries.json");
    if (!file) throw new Error("entries missing in test backup");
    const entries = JSON.parse(await file.async("string")) as Array<Record<string, unknown>>;
    entries[0].checkSelections = checkSelections;
    await rewriteJsonAndHash(zip, "data/entries.json", entries);
    await setBackupSchemaVersion(zip, schemaVersion);
  });

  await expect(inspectBackup(invalid)).rejects.toThrow(/\u5907\u4efd|\u68c0\u67e5\u5185\u5bb9/);
});

test.each(["replace", "merge"] as const)(
  "preserves a temporary inspection entry without creating an item-library row in %s mode",
  async (mode) => {
    const source = createTestDb(`backup-temporary-entry-source-${mode}-${Date.now()}`);
    await seedCompleteDatabase(source);
    const repository = new InspectionRepository(source);
    const added = await repository.addTemporaryEntry(
      "inspection-1",
      "临时配电间",
      "temporary-entry-00000000-0000-4000-8000-000000000101",
      "temporary-item-00000000-0000-4000-8000-000000000101",
      "2026-07-30T10:00:00.000Z",
    );

    const backup = await createBackup(source);
    await expect(inspectBackup(backup)).resolves.toMatchObject({ counts: { entries: 2 } });
    const target = createTestDb(`backup-temporary-entry-target-${mode}-${Date.now()}`);
    if (mode === "merge") {
      await target.checklistItems.put(makeChecklistItem());
      await target.routeTemplates.put(makeRouteTemplate());
    }
    await restoreBackup(target, backup, mode);

    expect(await target.entries.get(added.entry.id)).toEqual(added.entry);
    expect(await target.checklistItems.get(added.entry.itemId)).toBeUndefined();
  },
);

test("still rejects missing non-temporary items and mismatched temporary snapshots", async () => {
  const missingItemDb = createTestDb(`backup-missing-normal-item-${Date.now()}`);
  await seedCompleteDatabase(missingItemDb);
  await missingItemDb.entries.update("entry-1", { itemId: "missing-normal-item" });
  await expect(createBackup(missingItemDb)).rejects.toThrow("项点或历史快照不完整");

  const mismatchedDb = createTestDb(`backup-mismatched-temporary-snapshot-${Date.now()}`);
  await seedCompleteDatabase(mismatchedDb);
  const repository = new InspectionRepository(mismatchedDb);
  const added = await repository.addTemporaryEntry(
    "inspection-1",
    "临时配电间",
    "temporary-entry-00000000-0000-4000-8000-000000000102",
    "temporary-item-00000000-0000-4000-8000-000000000102",
  );
  await mismatchedDb.entries.update(added.entry.id, {
    itemSnapshot: {
      ...added.entry.itemSnapshot,
      id: "temporary-item-00000000-0000-4000-8000-000000000103",
    },
  });

  await expect(createBackup(mismatchedDb)).rejects.toThrow("项点或历史快照不完整");
});

test("rejects malformed temporary IDs and duplicate names or snapshot IDs in one inspection", async () => {
  const malformedDb = createTestDb(`backup-malformed-temporary-id-${Date.now()}`);
  await seedCompleteDatabase(malformedDb);
  const original = await malformedDb.entries.get("entry-1");
  if (!original) throw new Error("entry fixture missing");
  await malformedDb.entries.update(original.id, {
    itemId: "temporary-item-not-a-uuid",
    itemSnapshot: { ...original.itemSnapshot, id: "temporary-item-not-a-uuid" },
    groupIds: [],
  });
  await malformedDb.entries.update(original.id, { id: "temporary-entry-not-a-uuid" });
  await malformedDb.photoGroups.clear();
  await malformedDb.photos.clear();
  await expect(createBackup(malformedDb)).rejects.toThrow("项点或历史快照不完整");

  const duplicateDb = createTestDb(`backup-duplicate-temporary-entry-${Date.now()}`);
  await seedCompleteDatabase(duplicateDb);
  const repository = new InspectionRepository(duplicateDb);
  const first = await repository.addTemporaryEntry(
    "inspection-1",
    "临时配电间",
    "temporary-entry-00000000-0000-4000-8000-000000000104",
    "temporary-item-00000000-0000-4000-8000-000000000104",
  );
  await duplicateDb.entries.add({
    ...first.entry,
    id: "temporary-entry-00000000-0000-4000-8000-000000000105",
    itemId: "temporary-item-00000000-0000-4000-8000-000000000105",
    itemSnapshot: {
      ...first.entry.itemSnapshot,
      id: "temporary-item-00000000-0000-4000-8000-000000000105",
      routeName: " 临时配电间 ",
    },
    order: first.entry.order + 1,
  });
  await expect(createBackup(duplicateDb)).rejects.toThrow("检查项目名称重复");

  await duplicateDb.entries.update(
    "temporary-entry-00000000-0000-4000-8000-000000000105",
    {
      itemId: first.entry.itemId,
      itemSnapshot: { ...first.entry.itemSnapshot, routeName: "临时乙" },
    },
  );
  await expect(createBackup(duplicateDb)).rejects.toThrow("快照 ID 重复");
});

test.each(["replace", "merge"] as const)(
  "restores a schema 1 backup in %s mode, seeds the current catalog, and preserves historical graphs",
  async (mode) => {
    const source = createTestDb(`backup-v1-${mode}-source-${Date.now()}`);
    await seedCompleteDatabase(source);
    const historicalEntries = await source.entries.toArray();
    const backup = await schema1Backup(await createBackup(source));
    const preview = await inspectBackup(backup);
    const target = createTestDb(`backup-v1-${mode}-target-${Date.now()}`);

    expect(preview.schemaVersion).toBe(1);
    expect(preview.counts.routeTemplates).toBe(0);

    const result = await restoreBackup(target, backup, mode);

    expect(result.importedCounts.routeTemplates).toBe(0);
    expect(result.skippedRouteTemplateCount).toBe(0);
    expect(await target.routeTemplates.get("route-template-default")).toMatchObject({
      name: "默认模板",
      isDefault: true,
      itemIds: expect.any(Array),
    });
    expect((await target.routeTemplates.get("route-template-default"))?.itemIds).toHaveLength(39);
    expect(await target.entries.toArray()).toEqual(historicalEntries);
  },
);

test("keeps a schema 1 replace atomic when current catalog seeding fails", async () => {
  const source = createTestDb(`backup-v1-atomic-source-${Date.now()}`);
  await seedCompleteDatabase(source);
  const backup = await schema1Backup(await createBackup(source));
  const target = createTestDb(`backup-v1-atomic-target-${Date.now()}`);
  await target.settings.put({ key: "sentinel", value: "keep", updatedAt: "2026-07-29T00:00:00.000Z" });
  const before = await comparableSnapshot(target);
  vi.spyOn(target.routeTemplates, "add").mockRejectedValueOnce(new Error("模拟目录写入失败"));

  await expect(restoreBackup(target, backup, "replace")).rejects.toThrow("模拟目录写入失败");

  expect(await comparableSnapshot(target)).toEqual(before);
});

test("repairs malformed local defaults transactionally during a schema 1 merge restore", async () => {
  const source = createTestDb(`backup-v1-malformed-source-${Date.now()}`);
  await seedCompleteDatabase(source);
  const backup = await schema1Backup(await createBackup(source));
  const target = createTestDb(`backup-v1-malformed-target-${Date.now()}`);
  await target.routeTemplates.bulkAdd([
    makeRouteTemplate({ itemIds: [], isDefault: false }),
    makeRouteTemplate({ id: "a-extra-default", name: " 重名 ", itemIds: [], isDefault: true }),
    makeRouteTemplate({ id: "z-extra-default", name: "重名", itemIds: [], isDefault: true }),
  ]);

  await restoreBackup(target, backup, "merge");

  const templates = await target.routeTemplates.toArray();
  expect(templates.filter((template) => template.isDefault)).toEqual([
    expect.objectContaining({ id: "a-extra-default" }),
  ]);
  expect(await target.routeTemplates.get("a-extra-default")).toMatchObject({
    itemIds: Array.from({ length: 39 }, (_, index) => `core-route-${String(index + 1).padStart(2, "0")}`),
  });
  expect(new Set(templates.map((template) => template.name.trim())).size).toBe(templates.length);
  expect(await target.inspections.get("inspection-1")).toBeDefined();
});

test("schema 1 merge creates canonical without losing a non-default named 默认模板", async () => {
  const source = createTestDb(`backup-v1-name-source-${Date.now()}`);
  await seedCompleteDatabase(source);
  const backup = await schema1Backup(await createBackup(source));
  const target = createTestDb(`backup-v1-name-target-${Date.now()}`);
  const existing = makeRouteTemplate({ id: "custom-default-name", itemIds: [], isDefault: false });
  await target.routeTemplates.add(existing);

  await restoreBackup(target, backup, "merge");

  expect(await target.routeTemplates.get("custom-default-name")).toMatchObject({
    name: "默认模板（2）",
    isDefault: false,
  });
  expect(await target.routeTemplates.get("route-template-default")).toMatchObject({
    name: "默认模板",
    isDefault: true,
    itemIds: expect.any(Array),
  });
});

test("rolls back a schema 1 merge when malformed local default repair fails", async () => {
  const source = createTestDb(`backup-v1-repair-rollback-source-${Date.now()}`);
  await seedCompleteDatabase(source);
  const backup = await schema1Backup(await createBackup(source));
  const target = createTestDb(`backup-v1-repair-rollback-target-${Date.now()}`);
  await target.routeTemplates.bulkAdd([
    makeRouteTemplate({ itemIds: [], isDefault: false }),
    makeRouteTemplate({ id: "extra-default", name: "额外默认", itemIds: [], isDefault: true }),
  ]);
  await target.settings.put({ key: "sentinel", value: "keep", updatedAt: "2026-07-29T00:00:00.000Z" });
  const before = await comparableSnapshot(target);
  vi.spyOn(target.routeTemplates, "bulkAdd").mockRejectedValueOnce(new Error("模拟v1目录修复失败"));

  await expect(restoreBackup(target, backup, "merge")).rejects.toThrow("模拟v1目录修复失败");

  expect(await comparableSnapshot(target)).toEqual(before);
});

test("reports all supported backup versions when rejecting an unknown version", async () => {
  const db = createTestDb(`backup-unknown-version-${Date.now()}`);
  await seedCompleteDatabase(db);
  const invalid = await rewriteZip(await createBackup(db), async (zip) => {
    await rewriteManifest(zip, (manifest) => {
      manifest.schemaVersion = 99;
    });
  });

  await expect(inspectBackup(invalid)).rejects.toThrow("\u7248\u672c1\u3001\u7248\u672c2\u548c\u7248\u672c3");
});

test("extracts every manifest, JSON, full-photo and thumbnail payload exactly once", async () => {
  const db = createTestDb(`backup-single-extraction-${Date.now()}`);
  await seedCompleteDatabase(db);
  const backup = await createBackup(db);
  const bytes = new Uint8Array(await backup.arrayBuffer());
  const tracked = new RangeTrackingBlob([bytes], { type: "application/zip" });
  const paths = [
    "manifest.json",
    "data/checklist-items.json",
    "data/templates.json",
    "data/route-templates.json",
    "data/inspections.json",
    "data/entries.json",
    "data/photo-groups.json",
    "data/photos.json",
    "data/settings.json",
    "photos/photo-1.jpg",
    "photos/photo-1-thumb.jpg",
  ];

  await inspectBackup(tracked);

  for (const path of paths) {
    const location = testZipEntryLocation(bytes, path);
    const dataEnd = location.dataOffset + location.compressedSize;
    expect(
      tracked.sliceRanges.filter(([start, end]) => start === location.dataOffset && end === dataEnd),
      path,
    ).toHaveLength(1);
  }
});

describe("refuses invalid backups without mutating existing data", () => {
  test.each([
    ["损坏的清单", async (backup: Blob) => rewriteZip(backup, (zip) => {
      zip.remove("manifest.json");
    })],
    ["哈希不匹配", async (backup: Blob) => rewriteZip(backup, (zip) => {
      zip.file("data/settings.json", "[]");
    })],
    ["未知ZIP路径", async (backup: Blob) => rewriteZip(backup, (zip) => {
      zip.folder("unexpected");
    })],
    ["运行时行结构", async (backup: Blob) => rewriteZip(backup, async (zip) => {
      const file = zip.file("data/checklist-items.json");
      if (!file) throw new Error("items missing in test backup");
      const items = JSON.parse(await file.async("string")) as Array<Record<string, unknown>>;
      items[0].routeOrder = -1;
      await rewriteJsonAndHash(zip, "data/checklist-items.json", items);
    })],
    ["清单行数", async (backup: Blob) => rewriteZip(backup, async (zip) => {
      await rewriteManifest(zip, (manifest) => {
        manifest.rowCounts.settings += 1;
      });
    })],
    ["重复主键", async (backup: Blob) => rewriteZip(backup, async (zip) => {
      const file = zip.file("data/entries.json");
      if (!file) throw new Error("entries missing in test backup");
      const entries = JSON.parse(await file.async("string")) as Array<Record<string, unknown>>;
      entries.push({ ...entries[0] });
      await rewriteJsonAndHash(zip, "data/entries.json", entries);
      await rewriteManifest(zip, (manifest) => {
        manifest.rowCounts.entries = entries.length;
      });
    })],
    ["缺少缩略图", async (backup: Blob) => rewriteZip(backup, (zip) => {
      zip.remove("photos/photo-1-thumb.jpg");
    })],
    ["多余照片文件", async (backup: Blob) => rewriteZip(backup, (zip) => {
      zip.file("photos/extra.jpg", "extra");
    })],
    ["未知载荷文件", async (backup: Blob) => rewriteZip(backup, (zip) => {
      zip.file("unknown.bin", "unknown");
    })],
    ["路径穿越", async (backup: Blob) => rewriteZip(backup, (zip) => {
      zip.file("../escape.bin", "escape");
    })],
    ["绝对路径", async (backup: Blob) => rewriteZip(backup, (zip) => {
      zip.file("/escape.bin", "escape");
    })],
    ["反斜杠路径", async (backup: Blob) => rewriteZip(backup, (zip) => {
      zip.file("photos\\escape.jpg", "escape");
    })],
    ["不兼容版本", async (backup: Blob) => rewriteZip(backup, async (zip) => {
      const file = zip.file("manifest.json");
      if (!file) throw new Error("manifest missing in test backup");
      const manifest = JSON.parse(await file.async("string")) as ManifestForTest;
      manifest.schemaVersion = 99;
      zip.file("manifest.json", JSON.stringify(manifest));
    })],
    ["断裂的巡检图", async (backup: Blob) => rewriteZip(backup, async (zip) => {
      const file = zip.file("data/entries.json");
      if (!file) throw new Error("entries missing in test backup");
      const entries = JSON.parse(await file.async("string")) as Array<Record<string, unknown>>;
      entries[0].inspectionId = "missing-inspection";
      await rewriteJsonAndHash(zip, "data/entries.json", entries);
    })],
  ])("rejects %s", async (_label, corrupt) => {
    const source = createTestDb(`backup-invalid-source-${_label}-${Date.now()}`);
    await seedCompleteDatabase(source);
    const invalid = await corrupt(await createBackup(source));
    const target = createTestDb(`backup-invalid-target-${_label}-${Date.now()}`);
    await target.settings.put({ key: "sentinel", value: "keep", updatedAt: "2026-07-29T00:00:00.000Z" });
    const before = await comparableSnapshot(target);

    await expect(restoreBackup(target, invalid, "replace")).rejects.toThrow(
      /备份|清单|版本|校验|巡检|格式|数量|主键|照片|路径|安全/,
    );

    expect(await comparableSnapshot(target)).toEqual(before);
  });
});

test("rejects invalid schema 2 route-template rows without mutating existing data", async () => {
  const source = createTestDb(`backup-invalid-route-template-source-${Date.now()}`);
  await seedCompleteDatabase(source);
  const invalid = await rewriteZip(await createBackup(source), async (zip) => {
    const path = "data/route-templates.json";
    const serialized = JSON.stringify([{ ...makeRouteTemplate(), itemIds: [] }]);
    zip.file(path, serialized);
    const manifestFile = zip.file("manifest.json");
    if (!manifestFile) throw new Error("manifest missing in test backup");
    const manifest = JSON.parse(await manifestFile.async("string")) as ManifestForTest;
    manifest.schemaVersion = 2;
    manifest.rowCounts.routeTemplates = 1;
    manifest.files[path] = { sha256: await sha256(serialized) };
    zip.file("manifest.json", JSON.stringify(manifest));
  });
  const target = createTestDb(`backup-invalid-route-template-target-${Date.now()}`);
  await target.settings.put({ key: "sentinel", value: "keep", updatedAt: "2026-07-29T00:00:00.000Z" });
  const before = await comparableSnapshot(target);

  await expect(restoreBackup(target, invalid, "replace")).rejects.toThrow(/route-templates.*格式/);

  expect(await comparableSnapshot(target)).toEqual(before);
});

test.each(["zero", "multiple"] as const)(
  "rejects a schema 2 replace with %s default route templates before mutation",
  async (defaultCase) => {
    const source = createTestDb(`backup-default-count-source-${defaultCase}-${Date.now()}`);
    await seedCompleteDatabase(source);
    const invalid = await rewriteZip(await createBackup(source), async (zip) => {
      const file = zip.file("data/route-templates.json");
      if (!file) throw new Error("route templates missing in test backup");
      const routeTemplates = JSON.parse(await file.async("string")) as InspectionRouteTemplate[];
      const changed = defaultCase === "zero"
        ? routeTemplates.map((template) => ({ ...template, isDefault: false }))
        : [
          ...routeTemplates,
          makeRouteTemplate({ id: "route-extra-default", name: "额外默认模板" }),
        ];
      await rewriteRouteTemplates(zip, changed);
    });
    const target = createTestDb(`backup-default-count-target-${defaultCase}-${Date.now()}`);
    await target.settings.put({ key: "sentinel", value: "keep", updatedAt: "2026-07-29T00:00:00.000Z" });
    const before = await comparableSnapshot(target);

    await expect(restoreBackup(target, invalid, "replace")).rejects.toThrow(/默认.*路线模板|路线模板.*默认|route-templates.*格式/);

    expect(await comparableSnapshot(target)).toEqual(before);
  },
);

test.each(["zero", "multiple"] as const)(
  "rejects local v2 export with %s default route templates",
  async (defaultCase) => {
    const database = createTestDb(`backup-export-default-count-${defaultCase}-${Date.now()}`);
    await database.checklistItems.put(makeChecklistItem());
    if (defaultCase === "multiple") {
      await database.routeTemplates.bulkAdd([
        makeRouteTemplate(),
        makeRouteTemplate({ id: "second-default", name: "错误默认名" }),
      ]);
    }

    await expect(createBackup(database)).rejects.toThrow(/必须且只能包含一个默认路线模板/);
  },
);

test.each(["zero", "multiple"] as const)(
  "rejects v2 inspection with %s default route templates",
  async (defaultCase) => {
    const source = createTestDb(`backup-inspect-default-count-${defaultCase}-${Date.now()}`);
    await seedCompleteDatabase(source);
    const invalid = await rewriteZip(await createBackup(source), async (zip) => {
      const templates = defaultCase === "zero"
        ? [makeRouteTemplate({ id: "custom-only", name: "自定义模板", isDefault: false })]
        : [makeRouteTemplate(), makeRouteTemplate({ id: "second-default" })];
      await rewriteRouteTemplates(zip, templates);
    });

    await expect(inspectBackup(invalid)).rejects.toThrow(/必须且只能包含一个默认路线模板/);
  },
);

test.each(["replace", "merge"] as const)(
  "rejects a v2 %s restore whose archive has no default route template",
  async (mode) => {
    const source = createTestDb(`backup-restore-default-count-${mode}-source-${Date.now()}`);
    await seedCompleteDatabase(source);
    const invalid = await rewriteZip(await createBackup(source), async (zip) => {
      await rewriteRouteTemplates(zip, [
        makeRouteTemplate({ id: "custom-only", name: "自定义模板", isDefault: false }),
      ]);
    });
    const target = createTestDb(`backup-restore-default-count-${mode}-target-${Date.now()}`);
    if (mode === "merge") await seedLocalDefault(target, "local-default-item");
    const before = await comparableSnapshot(target);

    await expect(restoreBackup(target, invalid, mode)).rejects.toThrow(/必须且只能包含一个默认路线模板/);
    expect(await comparableSnapshot(target)).toEqual(before);
  },
);

test.each([
  ["missing item", [], ["missing-item"]],
  [
    "duplicate normalized route names",
    [makeChecklistItem(), makeChecklistItem({ id: "item-2", routeName: " 焊机间 " })],
    ["item-1", "item-2"],
  ],
] as const)("rejects export when a route template has a %s", async (_case, items, itemIds) => {
  const db = createTestDb(`backup-export-route-catalog-${_case}-${Date.now()}`);
  if (items.length > 0) await db.checklistItems.bulkAdd([...items]);
  await db.routeTemplates.put(makeRouteTemplate({ itemIds: [...itemIds] }));

  await expect(createBackup(db)).rejects.toThrow(/路线模板|检查项目名称/);
});

test.each([
  ["missing item", async (zip: JSZip) => {
    await rewriteRouteTemplates(zip, [makeRouteTemplate({ itemIds: ["missing-item"] })]);
  }],
  ["duplicate normalized route names", async (zip: JSZip) => {
    const file = zip.file("data/checklist-items.json");
    if (!file) throw new Error("checklist items missing in test backup");
    const items = JSON.parse(await file.async("string")) as Array<ReturnType<typeof makeChecklistItem>>;
    items.push({ ...items[0], id: "item-2", routeName: ` ${items[0].routeName} ` });
    await rewriteJsonAndHash(zip, "data/checklist-items.json", items);
    await rewriteManifest(zip, (manifest) => {
      manifest.rowCounts.checklistItems = items.length;
    });
    await rewriteRouteTemplates(zip, [makeRouteTemplate({ itemIds: ["item-1", "item-2"] })]);
  }],
] as const)("rejects a schema 2 archive whose route template has a %s", async (_case, mutate) => {
  const source = createTestDb(`backup-parse-route-catalog-source-${_case}-${Date.now()}`);
  await seedCompleteDatabase(source);
  const invalid = await rewriteZip(await createBackup(source), mutate);
  const target = createTestDb(`backup-parse-route-catalog-target-${_case}-${Date.now()}`);
  await target.settings.put({ key: "sentinel", value: "keep", updatedAt: "2026-07-29T00:00:00.000Z" });
  const before = await comparableSnapshot(target);

  await expect(restoreBackup(target, invalid, "replace")).rejects.toThrow(/路线模板|检查项目名称/);

  expect(await comparableSnapshot(target)).toEqual(before);
});

test("preserves a disabled route reference through export, inspect, replace, and merge", async () => {
  const source = createTestDb(`backup-disabled-route-source-${Date.now()}`);
  await source.checklistItems.put(makeChecklistItem({ enabled: false }));
  await source.routeTemplates.put(makeRouteTemplate());

  const backup = await createBackup(source);
  await expect(inspectBackup(backup)).resolves.toMatchObject({ counts: { routeTemplates: 1 } });

  const replaceTarget = createTestDb(`backup-disabled-route-replace-${Date.now()}`);
  await restoreBackup(replaceTarget, backup, "replace");
  expect(await replaceTarget.routeTemplates.get("route-template-default")).toMatchObject({
    itemIds: ["item-1"],
  });
  expect(await replaceTarget.checklistItems.get("item-1")).toMatchObject({ enabled: false });

  const mergeTarget = createTestDb(`backup-disabled-route-merge-${Date.now()}`);
  await seedLocalDefault(mergeTarget, "local-default-item");
  await expect(restoreBackup(mergeTarget, backup, "merge")).resolves.toMatchObject({
    importedCounts: { routeTemplates: 1 },
  });
});

test("rejects duplicate enabled route names even when only one duplicate is referenced by a template", async () => {
  const source = createTestDb(`backup-global-duplicate-source-${Date.now()}`);
  await source.checklistItems.bulkAdd([
    makeChecklistItem({ routeName: "重复区域" }),
    makeChecklistItem({ id: "item-2", routeName: " 重复区域 ", routeOrder: 2 }),
  ]);
  await source.routeTemplates.put(makeRouteTemplate({ itemIds: ["item-1"] }));

  await expect(createBackup(source)).rejects.toThrow(/检查项目名称|路线/);
});

test("rejects a schema 2 default route template with a noncanonical name", async () => {
  const source = createTestDb(`backup-default-name-source-${Date.now()}`);
  await seedCompleteDatabase(source);
  const invalid = await rewriteZip(await createBackup(source), async (zip) => {
    await rewriteRouteTemplates(zip, [makeRouteTemplate({ name: "错误默认名" })]);
  });

  await expect(inspectBackup(invalid)).rejects.toThrow(/route-templates.*格式|默认模板/);
});

describe("preflights Android archive resource limits before extracting entries", () => {
  test("rejects an oversized JSON entry from central-directory metadata", async () => {
    const zip = new JSZip();
    zip.file("data/oversized.json", new Uint8Array(16 * MiB + 1));
    const archive = await zip.generateAsync({ type: "blob", compression: "STORE" });

    await expect(inspectBackup(archive)).rejects.toThrow(/JSON.*16 MB/);
  });

  test("rejects excessive ZIP entry count before looking for a manifest", async () => {
    const zip = new JSZip();
    for (let index = 0; index < 4_097; index += 1) {
      zip.file(`entry-${index}`, "");
    }
    const archive = await zip.generateAsync({ type: "blob", compression: "STORE" });

    await expect(inspectBackup(archive)).rejects.toThrow(/条目数量.*4096/);
  });

  test("rejects a highly compressed payload by central-directory compression ratio", async () => {
    const zip = new JSZip();
    zip.file("data/ratio.json", "0".repeat(MiB));
    const archive = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });

    await expect(inspectBackup(archive)).rejects.toThrow(/压缩比.*200/);
  });

  test("rejects a forged 8 MiB DEFLATE payload before JSZip can emit all actual bytes", async () => {
    const zip = new JSZip();
    const actualBytes = 8 * MiB;
    zip.file("manifest.json", "{}" + " ".repeat(actualBytes - 2));
    const archive = await zip.generateAsync({
      type: "blob",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
    const forged = await forgeUncompressedSize(archive, "manifest.json", 1);
    const originalLoadAsync = JSZip.loadAsync.bind(JSZip);
    let emittedBytes = 0;
    const load = vi.spyOn(JSZip, "loadAsync").mockImplementation(async (data, options) => {
      const loaded = await originalLoadAsync(data, options);
      const entry = loaded.file("manifest.json") as (JSZip.JSZipObject & StreamableZipEntry) | null;
      if (!entry) throw new Error("instrumented manifest missing");
      const originalInternalStream = entry.internalStream.bind(entry);
      vi.spyOn(entry, "internalStream").mockImplementation((type) => {
        const helper = originalInternalStream(type);
        helper.on("data", (chunk) => {
          if (typeof chunk === "string") emittedBytes += chunk.length;
          else if (chunk instanceof Uint8Array) emittedBytes += chunk.byteLength;
        });
        return helper;
      });
      return loaded;
    });

    try {
      let rejection: unknown;
      try {
        await inspectBackup(forged);
      } catch (caught) {
        rejection = caught;
      }
      expect(emittedBytes).toBeLessThan(actualBytes);
      expect(rejection).toMatchObject({
        name: "BackupValidationError",
        message: expect.stringMatching(/实际解压|压缩比/),
      });
    } finally {
      load.mockRestore();
    }
  });

  test("walks actual central entries instead of trusting a forged EOCD count before JSZip load", async () => {
    const zip = new JSZip();
    for (let index = 0; index < 4_097; index += 1) zip.file(`entry-${index}`, "");
    const archive = await zip.generateAsync({ type: "blob", compression: "STORE" });
    const forged = await forgeEocdEntryCount(archive, 1);
    const load = vi.spyOn(JSZip, "loadAsync");

    try {
      await expect(inspectBackup(forged)).rejects.toThrow(/实际条目数量.*4096|条目数量.*4096/);
      expect(load).not.toHaveBeenCalled();
    } finally {
      load.mockRestore();
    }
  });

  test.each([
    ["multi-disk", (bytes: Uint8Array, eocdOffset: number) => {
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(eocdOffset + 4, 1, true);
    }, /分卷/],
    ["ZIP64", (bytes: Uint8Array, eocdOffset: number) => {
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint16(eocdOffset + 10, 0xffff, true);
    }, /ZIP64/],
    ["malformed central header", (bytes: Uint8Array, eocdOffset: number) => {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      bytes[view.getUint32(eocdOffset + 16, true)] = 0;
    }, /中央目录.*结构|中央目录.*损坏/],
  ] as const)("rejects %s before JSZip load", async (_case, mutate, expected) => {
    const zip = new JSZip();
    zip.file("manifest.json", "{}");
    const archive = await zip.generateAsync({ type: "blob", compression: "STORE" });
    const malformed = await mutateZipBytes(archive, mutate);
    const load = vi.spyOn(JSZip, "loadAsync");

    try {
      await expect(inspectBackup(malformed)).rejects.toThrow(expected);
      expect(load).not.toHaveBeenCalled();
    } finally {
      load.mockRestore();
    }
  });

  test("rejects an oversized central directory before JSZip load", async () => {
    const zip = new JSZip();
    for (let index = 0; index < 65; index += 1) {
      zip.file(`entry-${index}`, "", { comment: "x".repeat(65_535) });
    }
    const archive = await zip.generateAsync({ type: "blob", compression: "STORE" });
    const load = vi.spyOn(JSZip, "loadAsync");

    try {
      await expect(inspectBackup(archive)).rejects.toThrow(/中央目录.*4 MB/);
      expect(load).not.toHaveBeenCalled();
    } finally {
      load.mockRestore();
    }
  });
});

test("normalizes a real corrupted compressed payload and leaves replace and merge targets unchanged", async () => {
  const source = createTestDb(`backup-compressed-corrupt-source-${Date.now()}`);
  await seedCompleteDatabase(source);
  const corrupt = await corruptCompressedPayload(await createBackup(source), "data/settings.json");
  const stableMessage = "备份文件损坏，无法读取其中的数据，请重新选择有效备份。";

  for (const mode of ["replace", "merge"] as const) {
    const target = createTestDb(`backup-compressed-corrupt-${mode}-${Date.now()}`);
    await target.settings.put({ key: "sentinel", value: mode, updatedAt: "2026-07-29T00:00:00.000Z" });
    const before = await comparableSnapshot(target);

    await expect(restoreBackup(target, corrupt, mode)).rejects.toMatchObject({
      name: "BackupValidationError",
      message: stableMessage,
    });
    expect(await comparableSnapshot(target)).toEqual(before);
  }
});

describe("validates the local snapshot before generating a backup", () => {
  test("rejects a broken local inspection graph", async () => {
    const db = createTestDb(`backup-export-broken-graph-${Date.now()}`);
    await seedCompleteDatabase(db);
    await db.entries.update("entry-1", { inspectionId: "missing-inspection" });

    await expect(createBackup(db)).rejects.toMatchObject({
      name: "BackupValidationError",
      message: expect.stringMatching(/本地数据.*巡检条目|巡检条目.*巡检记录/),
    });
  });

  test("rejects invalid local row data through the restore runtime schemas", async () => {
    const db = createTestDb(`backup-export-invalid-row-${Date.now()}`);
    await db.checklistItems.put(makeChecklistItem({ routeOrder: -1 }));
    await seedLocalDefault(db);

    await expect(createBackup(db)).rejects.toMatchObject({
      name: "BackupValidationError",
      message: expect.stringMatching(/本地数据.*格式无效/),
    });
  });

  test("rejects full/thumbnail path namespace collisions before writing ZIP entries", async () => {
    const db = createTestDb(`backup-export-photo-path-${Date.now()}`);
    await db.checklistItems.put(makeChecklistItem());
    await seedLocalDefault(db);
    await db.templates.put(makeTemplate());
    const group = makePhotoGroup({ photoIds: ["x", "x-thumb"] });
    await new InspectionRepository(db).saveGraph({
      inspection: makeInspection(),
      groups: [group],
      photos: [
        makePhoto(undefined, { id: "x", order: 0 }),
        makePhoto(undefined, { id: "x-thumb", order: 1 }),
      ],
      template: makeTemplate(),
    });

    await expect(createBackup(db)).rejects.toThrow(/照片文件路径冲突.*x-thumb/);
  });

  test("rejects an export whose central directory would exceed the restore ceiling before ZIP generation", async () => {
    const db = createTestDb(`backup-export-central-directory-${Date.now()}`);
    const longIdBody = "a".repeat(63_500);
    const photoIds = Array.from(
      { length: 34 },
      (_, index) => `photo-${index.toString().padStart(2, "0")}-${longIdBody}`,
    );
    const inspection = makeInspection({
      entries: [{ ...makeInspection().entries[0], groupIds: ["group-1"] }],
    });
    await db.checklistItems.put(makeChecklistItem());
    await seedLocalDefault(db);
    await db.templates.put(makeTemplate());
    await new InspectionRepository(db).saveGraph({
      inspection,
      groups: [makePhotoGroup({ photoIds })],
      photos: photoIds.map((id, order) => makePhoto(new Blob([], { type: "image/jpeg" }), {
        id,
        order,
        thumbnailBlob: new Blob([], { type: "image/jpeg" }),
      })),
      template: makeTemplate(),
    });
    const generate = vi.spyOn(JSZip.prototype, "generateAsync");

    try {
      await expect(createBackup(db)).rejects.toMatchObject({
        name: "BackupValidationError",
        message: expect.stringMatching(/中央目录.*4 MB/),
      });
      expect(generate).not.toHaveBeenCalled();
    } finally {
      generate.mockRestore();
    }
  });
});

test("detects x and x-thumb path namespace collisions while inspecting incoming metadata", async () => {
  const source = createTestDb(`backup-inspect-photo-path-${Date.now()}`);
  await source.checklistItems.put(makeChecklistItem());
  await seedLocalDefault(source);
  await source.templates.put(makeTemplate());
  await new InspectionRepository(source).saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup({ photoIds: ["x", "y"] })],
    photos: [
      makePhoto(undefined, { id: "x", order: 0 }),
      makePhoto(undefined, { id: "y", order: 1 }),
    ],
    template: makeTemplate(),
  });
  const colliding = await rewriteZip(await createBackup(source), async (zip) => {
    const photosFile = zip.file("data/photos.json");
    const groupsFile = zip.file("data/photo-groups.json");
    if (!photosFile || !groupsFile) throw new Error("photo metadata missing in test backup");
    const photos = JSON.parse(await photosFile.async("string")) as Array<Record<string, unknown>>;
    const groups = JSON.parse(await groupsFile.async("string")) as Array<Record<string, unknown>>;
    photos[1].id = "x-thumb";
    groups[0].photoIds = ["x", "x-thumb"];
    await rewriteJsonAndHash(zip, "data/photos.json", photos);
    await rewriteJsonAndHash(zip, "data/photo-groups.json", groups);
  });

  await expect(inspectBackup(colliding)).rejects.toThrow(/照片文件路径冲突.*x-thumb/);
});

test("rolls back the whole replace transaction when an insertion fails", async () => {
  const source = createTestDb(`backup-rollback-source-${Date.now()}`);
  await seedCompleteDatabase(source);
  const backup = await createBackup(source);
  const target = createTestDb(`backup-rollback-target-${Date.now()}`);
  await target.settings.put({ key: "sentinel", value: "keep", updatedAt: "2026-07-29T00:00:00.000Z" });
  const before = await comparableSnapshot(target);
  vi.spyOn(target.entries, "bulkAdd").mockRejectedValueOnce(new Error("模拟写入失败"));

  await expect(restoreBackup(target, backup, "replace")).rejects.toThrow("模拟写入失败");

  expect(await comparableSnapshot(target)).toEqual(before);
});

test("merge skips existing and colliding inspection graphs while importing accepted graphs atomically", async () => {
  const source = createTestDb(`backup-merge-source-${Date.now()}`);
  await source.checklistItems.bulkAdd([
    makeChecklistItem(),
    makeChecklistItem({ id: "source-route-default", routeName: "传入默认路线", routeOrder: 2 }),
  ]);
  await seedLocalDefault(source, "source-route-default");
  await source.templates.put(makeTemplate());
  const sourceRepository = new InspectionRepository(source);
  await sourceRepository.saveGraph(graphFor("existing-inspection", "source-existing-entry"));
  await sourceRepository.saveGraph(graphFor("colliding-inspection", "local-collision-entry"));
  await sourceRepository.saveGraph(graphFor("accepted-inspection"));
  const backup = await createBackup(source);

  const target = createTestDb(`backup-merge-target-${Date.now()}`);
  await target.checklistItems.put(makeChecklistItem({ standard: "保留本地项点内容" }));
  await seedLocalDefault(target);
  await target.templates.put(makeTemplate());
  const targetRepository = new InspectionRepository(target);
  await targetRepository.saveGraph(graphFor("existing-inspection", "local-existing-entry"));
  await targetRepository.saveGraph(graphFor("local-owner", "local-collision-entry"));

  const result = await restoreBackup(target, backup, "merge");

  expect(result).toMatchObject({
    importedInspectionCount: 1,
    skippedInspectionCount: 2,
    skippedInspectionIds: ["colliding-inspection", "existing-inspection"],
  });
  expect(await target.inspections.get("accepted-inspection")).toBeDefined();
  expect(await target.inspections.get("colliding-inspection")).toBeUndefined();
  expect((await target.checklistItems.get("item-1"))?.standard).toBe("保留本地项点内容");
});

test.each([
  ["group", "shared-group", "source-photo", "shared-group", "local-photo"],
  ["photo", "source-group", "shared-photo", "local-group", "shared-photo"],
] as const)("merge skips a complete graph on dependent %s ID collision", async (
  _kind,
  sourceGroupId,
  sourcePhotoId,
  localGroupId,
  localPhotoId,
) => {
  const source = createTestDb(`backup-merge-${_kind}-source-${Date.now()}`);
  await source.checklistItems.put(makeChecklistItem());
  await seedLocalDefault(source);
  await source.templates.put(makeTemplate());
  await new InspectionRepository(source).saveGraph(
    photoGraphFor("incoming-inspection", "incoming-entry", sourceGroupId, sourcePhotoId),
  );
  const backup = await createBackup(source);

  const target = createTestDb(`backup-merge-${_kind}-target-${Date.now()}`);
  await target.checklistItems.put(makeChecklistItem());
  await seedLocalDefault(target);
  await target.templates.put(makeTemplate());
  await new InspectionRepository(target).saveGraph(
    photoGraphFor("local-inspection", "local-entry", localGroupId, localPhotoId),
  );

  const result = await restoreBackup(target, backup, "merge");

  expect(result).toMatchObject({
    importedInspectionCount: 0,
    skippedInspectionCount: 1,
    skippedInspectionIds: ["incoming-inspection"],
  });
  expect(await target.inspections.get("incoming-inspection")).toBeUndefined();
  expect(await target.inspections.get("local-inspection")).toBeDefined();
});

test.each(["zero", "multiple"] as const)(
  "rejects schema 2 merge when the local catalog has %s defaults",
  async (defaultCase) => {
    const source = createTestDb(`backup-merge-local-default-source-${defaultCase}-${Date.now()}`);
    await source.checklistItems.put(makeChecklistItem());
    await source.routeTemplates.put(makeRouteTemplate());
    const backup = await createBackup(source);
    const target = createTestDb(`backup-merge-local-default-target-${defaultCase}-${Date.now()}`);
    await target.checklistItems.put(makeChecklistItem());
    if (defaultCase === "multiple") {
      await target.routeTemplates.bulkAdd([
        makeRouteTemplate(),
        makeRouteTemplate({ id: "local-extra-default", name: "本地额外默认" }),
      ]);
    }
    const before = await comparableSnapshot(target);

    await expect(restoreBackup(target, backup, "merge")).rejects.toThrow(/本地.*默认.*路线模板|本地.*路线模板.*默认/);

    expect(await comparableSnapshot(target)).toEqual(before);
  },
);

test("merge keeps the local default and imports an incoming default as a renamed non-default", async () => {
  const source = createTestDb(`backup-merge-demote-default-source-${Date.now()}`);
  await source.checklistItems.put(makeChecklistItem());
  await source.routeTemplates.put(makeRouteTemplate({
    id: "incoming-default",
    name: "默认模板",
  }));
  const backup = await createBackup(source);
  const target = createTestDb(`backup-merge-demote-default-target-${Date.now()}`);
  await target.checklistItems.put(makeChecklistItem());
  await seedLocalDefault(target);

  const result = await restoreBackup(target, backup, "merge");

  expect(result.importedCounts.routeTemplates).toBe(1);
  expect(await target.routeTemplates.get("route-template-default")).toMatchObject({ isDefault: true });
  expect(await target.routeTemplates.get("imported-incoming-default-1")).toMatchObject({
    name: "默认模板（导入）",
    isDefault: false,
  });
  expect((await target.routeTemplates.toArray()).filter((template) => template.isDefault)).toHaveLength(1);
});

test.each([
  ["business content", { standard: "本地不同检查标准" }],
  ["enabled state", { enabled: false }],
] as const)("merge rejects a referenced checklist item with conflicting %s before mutation", async (_case, overrides) => {
  const defaultItem = makeChecklistItem({ id: "local-default-item", routeName: "本地默认路线" });
  const source = createTestDb(`backup-merge-item-conflict-source-${_case}-${Date.now()}`);
  await source.checklistItems.bulkAdd([defaultItem, makeChecklistItem()]);
  await source.routeTemplates.bulkAdd([
    makeRouteTemplate({ itemIds: [defaultItem.id] }),
    makeRouteTemplate({ id: "incoming-custom", name: "传入自定义模板", itemIds: ["item-1"], isDefault: false }),
  ]);
  const backup = await createBackup(source);
  const target = createTestDb(`backup-merge-item-conflict-target-${_case}-${Date.now()}`);
  await target.checklistItems.bulkAdd([defaultItem, makeChecklistItem(overrides)]);
  await target.routeTemplates.put(makeRouteTemplate({ itemIds: [defaultItem.id] }));
  const before = await comparableSnapshot(target);

  await expect(restoreBackup(target, backup, "merge")).rejects.toThrow(/项点.*冲突|检查项目.*冲突/);

  expect(await comparableSnapshot(target)).toEqual(before);
});

test("merge accepts a referenced local checklist item with equal semantic content and different timestamps", async () => {
  const defaultItem = makeChecklistItem({ id: "local-default-item", routeName: "本地默认路线" });
  const source = createTestDb(`backup-merge-item-equal-source-${Date.now()}`);
  await source.checklistItems.bulkAdd([defaultItem, makeChecklistItem()]);
  await source.routeTemplates.bulkAdd([
    makeRouteTemplate({ itemIds: [defaultItem.id] }),
    makeRouteTemplate({ id: "incoming-custom", name: "传入自定义模板", itemIds: ["item-1"], isDefault: false }),
  ]);
  const backup = await createBackup(source);
  const target = createTestDb(`backup-merge-item-equal-target-${Date.now()}`);
  await target.checklistItems.bulkAdd([
    { ...defaultItem, updatedAt: "2026-07-29T01:00:00.000Z" },
    makeChecklistItem({ createdAt: "2026-07-29T01:00:00.000Z", updatedAt: "2026-07-29T02:00:00.000Z" }),
  ]);
  await target.routeTemplates.put(makeRouteTemplate({ itemIds: [defaultItem.id] }));

  await restoreBackup(target, backup, "merge");

  expect(await target.routeTemplates.get("incoming-custom")).toMatchObject({ itemIds: ["item-1"] });
});

test("merge reserves every incoming original route-template ID and normalized name before allocating conflicts", async () => {
  const source = createTestDb(`backup-route-reservation-source-${Date.now()}`);
  await source.checklistItems.put(makeChecklistItem());
  await source.routeTemplates.bulkAdd([
    makeRouteTemplate(),
    makeRouteTemplate({ id: "a", name: "冲突名称", isDefault: false }),
    makeRouteTemplate({ id: "imported-a-1", name: "冲突名称（导入）", isDefault: false }),
  ]);
  const backup = await createBackup(source);
  const target = createTestDb(`backup-route-reservation-target-${Date.now()}`);
  await target.checklistItems.put(makeChecklistItem());
  await target.routeTemplates.bulkAdd([
    makeRouteTemplate(),
    makeRouteTemplate({ id: "a", name: "本地A模板", isDefault: false }),
  ]);

  await restoreBackup(target, backup, "merge");

  expect(await target.routeTemplates.get("imported-a-1")).toMatchObject({ name: "冲突名称（导入）" });
  expect(await target.routeTemplates.get("imported-a-2")).toMatchObject({ name: "冲突名称（导入2）" });
});

test("merge skips identical route-template content and imports ID or name conflicts under unique names", async () => {
  const source = createTestDb(`backup-route-merge-source-${Date.now()}`);
  await source.checklistItems.bulkAdd([
    makeChecklistItem(),
    makeChecklistItem({ id: "item-2", routeOrder: 2, routeName: "第二路线" }),
  ]);
  await source.routeTemplates.bulkAdd([
    makeRouteTemplate(),
    makeRouteTemplate({
      id: "route-id-conflict",
      name: "ID冲突模板",
      itemIds: ["item-2"],
      isDefault: false,
    }),
    makeRouteTemplate({
      id: "incoming-name-conflict",
      name: "重名模板",
      itemIds: ["item-2"],
      isDefault: false,
    }),
  ]);
  const backup = await createBackup(source);

  const target = createTestDb(`backup-route-merge-target-${Date.now()}`);
  await target.checklistItems.put(makeChecklistItem());
  await target.routeTemplates.bulkAdd([
    makeRouteTemplate({ updatedAt: "2026-07-29T00:00:00.000Z" }),
    makeRouteTemplate({
      id: "route-id-conflict",
      name: "本地ID模板",
      isDefault: false,
    }),
    makeRouteTemplate({ id: "local-name-conflict", name: "重名模板", isDefault: false }),
    makeRouteTemplate({ id: "imported-incoming-name-conflict-1", name: "占用ID", isDefault: false }),
    makeRouteTemplate({ id: "occupied-import-name", name: "重名模板（导入）", isDefault: false }),
  ]);

  const beforePreview = await comparableSnapshot(target);
  const preview = await inspectBackup(backup, target) as Awaited<ReturnType<typeof inspectBackup>> & {
    mergeRouteTemplates?: { added: number; skipped: number };
  };
  expect(preview.mergeRouteTemplates).toEqual({ added: 2, skipped: 1 });
  expect(await comparableSnapshot(target)).toEqual(beforePreview);

  const result = await restoreBackup(target, backup, "merge");

  expect(result.importedCounts.routeTemplates).toBe(2);
  expect(result.skippedRouteTemplateCount).toBe(1);
  expect(await target.routeTemplates.get("route-id-conflict")).toMatchObject({
    name: "本地ID模板",
    itemIds: ["item-1"],
  });
  expect(await target.routeTemplates.get("imported-route-id-conflict-1")).toMatchObject({
    name: "ID冲突模板（导入）",
    itemIds: ["item-2"],
  });
  expect(await target.routeTemplates.get("imported-incoming-name-conflict-2")).toMatchObject({
    name: "重名模板（导入2）",
    itemIds: ["item-2"],
  });
});

test("rolls back accepted graphs, items, templates, and settings on a late merge write failure", async () => {
  const source = createTestDb(`backup-merge-late-source-${Date.now()}`);
  await seedCompleteDatabase(source);
  const backup = await createBackup(source);
  const target = createTestDb(`backup-merge-late-target-${Date.now()}`);
  await target.checklistItems.put(makeChecklistItem());
  await seedLocalDefault(target);
  await target.settings.put({ key: "sentinel", value: "keep", updatedAt: "2026-07-29T00:00:00.000Z" });
  const before = await comparableSnapshot(target);
  vi.spyOn(target.settings, "bulkAdd").mockRejectedValueOnce(new Error("模拟合并末段写入失败"));

  await expect(restoreBackup(target, backup, "merge")).rejects.toThrow("模拟合并末段写入失败");

  expect(await comparableSnapshot(target)).toEqual(before);
});

test("rejects an immutable template conflict before any merge mutation", async () => {
  const source = createTestDb(`backup-template-source-${Date.now()}`);
  await seedLocalDefault(source);
  await source.templates.put(makeTemplate({ titlePattern: "传入模板" }));
  await source.settings.put({ key: "incoming", value: true, updatedAt: "2026-07-29T00:00:00.000Z" });
  const backup = await createBackup(source);
  const target = createTestDb(`backup-template-target-${Date.now()}`);
  await target.checklistItems.put(makeChecklistItem());
  await seedLocalDefault(target);
  await target.templates.put(makeTemplate({ titlePattern: "本地模板" }));
  await target.settings.put({ key: "local", value: true, updatedAt: "2026-07-29T00:00:00.000Z" });
  const before = await comparableSnapshot(target);

  await expect(restoreBackup(target, backup, "merge")).rejects.toThrow(/不可变|模板|冲突/);

  expect(await comparableSnapshot(target)).toEqual(before);
});

test("merge treats a legacy local template as equal to the normalized backup template", async () => {
  const source = createTestDb(`backup-template-legacy-source-${Date.now()}`);
  await seedLocalDefault(source);
  await source.templates.put(makeTemplate());
  const backup = await createBackup(source);

  const target = createTestDb(`backup-template-legacy-target-${Date.now()}`);
  await seedLocalDefault(target);
  const legacyTemplate = { ...makeTemplate(), firstLineIndentChars: 0 };
  delete (legacyTemplate as { firstLineIndentChars?: number }).firstLineIndentChars;
  await target.templates.put(legacyTemplate);

  await expect(restoreBackup(target, backup, "merge")).resolves.toMatchObject({ mode: "merge" });
  expect(
    (await target.templates.get(["template-default", 1]) as { firstLineIndentChars?: number })
      .firstLineIndentChars,
  ).toBeUndefined();
});

test("replace restores settings and merge keeps local setting values while adding missing keys", async () => {
  const source = createTestDb(`backup-settings-source-${Date.now()}`);
  await source.checklistItems.put(makeChecklistItem());
  await source.routeTemplates.put(makeRouteTemplate());
  await source.settings.bulkAdd([
    { key: "shared", value: "incoming", updatedAt: "2026-07-29T01:00:00.000Z" },
    { key: "incoming-only", value: 2, updatedAt: "2026-07-29T01:00:00.000Z" },
  ]);
  const backup = await createBackup(source);
  const replaceTarget = createTestDb(`backup-settings-replace-${Date.now()}`);
  await replaceTarget.settings.put({ key: "old", value: true, updatedAt: "2026-07-29T00:00:00.000Z" });
  await restoreBackup(replaceTarget, backup, "replace");
  expect(await replaceTarget.settings.toArray()).toEqual(await source.settings.toArray());

  const mergeTarget = createTestDb(`backup-settings-merge-${Date.now()}`);
  await mergeTarget.checklistItems.put(makeChecklistItem());
  await seedLocalDefault(mergeTarget);
  await mergeTarget.settings.put({ key: "shared", value: "local", updatedAt: "2026-07-29T02:00:00.000Z" });
  await restoreBackup(mergeTarget, backup, "merge");
  expect((await mergeTarget.settings.get("shared"))?.value).toBe("local");
  expect((await mergeTarget.settings.get("incoming-only"))?.value).toBe(2);
});

test.each([
  [79, 100, false, false],
  [80, 100, true, false],
  [94, 100, true, false],
  [95, 100, true, true],
  [undefined, undefined, false, false],
  [50, 0, false, false],
] as const)(
  "storage capacity usage=%s quota=%s gives warning=%s blocked=%s",
  (usage, quota, warning, photoWriteBlocked) => {
    expect(storageCapacityState({ usage, quota })).toMatchObject({ warning, photoWriteBlocked });
  },
);
