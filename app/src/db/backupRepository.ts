import JSZip from "jszip";
import { z } from "zod";
import type {
  ChecklistItem,
  InspectionEntry,
  InspectionRouteTemplate,
  PhotoAsset,
  PhotoGroup,
  ReportTemplate,
} from "../domain/models";
import {
  checklistItemSchema,
  inspectionEntrySchema,
  inspectionRecordSchema,
  inspectionRouteTemplateSchema,
  photoGroupSchema,
  photoMetadataSchema,
  reportTemplateSchema,
  settingsRecordSchema,
} from "../domain/schemas";
import { normalizeInspectionCheckSelections } from "../domain/inspectionCheckContents";
import { DEFAULT_ROUTE_TEMPLATE_NAME, findDuplicateEnabledRouteName, normalizeRouteName } from "../domain/routeNames";
import { ensureRouteCatalog } from "../app/routeCatalogMigration";
import { isPrefixedBrowserUuid } from "../lib/ids";
import type { InspectionRecord, SettingsRecord, SevenSDb } from "./database";
import {
  BoundedZipReadError,
  createZipExtractionBudget,
  extractZipEntryBounded,
  type ZipExtractionBudget,
} from "./boundedZipReader";
import {
  parseZipCentralDirectory,
  ZipCentralDirectoryError,
  type ZipCentralDirectoryMetadata,
  type ZipEntryMetadata,
} from "./zipCentralDirectory";

const schemaVersion = 3 as const;
const backupMimeType = "application/zip";
const reminderSettingKey = "backupReminderDismissedMilestone";
const MiB = 1024 * 1024;
const CLASSIC_ZIP_CENTRAL_HEADER_BYTES = 46;

// Android Chrome can hold the selected ZIP, extracted bytes, and IndexedDB
// clones concurrently. These limits retain the 100-photo workflow while
// bounding those overlapping mobile-memory allocations.
export const MAX_BACKUP_COMPRESSED_BYTES = 256 * MiB;
export const MAX_BACKUP_ENTRY_COUNT = 4_096;
export const MAX_BACKUP_CENTRAL_DIRECTORY_BYTES = 4 * MiB;
export const MAX_BACKUP_JSON_BYTES = 16 * MiB;
export const MAX_BACKUP_PHOTO_BYTES = 32 * MiB;
export const MAX_BACKUP_UNCOMPRESSED_BYTES = 512 * MiB;
export const MAX_BACKUP_COMPRESSION_RATIO = 200;
const schema1DataPaths = {
  checklistItems: "data/checklist-items.json",
  templates: "data/templates.json",
  inspections: "data/inspections.json",
  entries: "data/entries.json",
  photoGroups: "data/photo-groups.json",
  photos: "data/photos.json",
  settings: "data/settings.json",
} as const;
const dataPaths = {
  ...schema1DataPaths,
  routeTemplates: "data/route-templates.json",
} as const;

export type BackupTableName = keyof typeof dataPaths;
export type RestoreMode = "replace" | "merge";
export type PersistentStorageStatus = "granted" | "denied" | "unsupported";

export interface BackupCounts extends Record<BackupTableName, number> {}

export interface BackupPreview {
  schemaVersion: 1 | 2 | 3;
  createdAt: string;
  counts: BackupCounts;
  mergeRouteTemplates: { added: number; skipped: number };
}

export interface RestoreResult {
  mode: RestoreMode;
  importedInspectionCount: number;
  skippedInspectionCount: number;
  skippedInspectionIds: string[];
  skippedRouteTemplateCount: number;
  importedCounts: BackupCounts;
}

export interface StorageCapacityState {
  usage: number | null;
  quota: number | null;
  available: number | null;
  percentage: number | null;
  warning: boolean;
  photoWriteBlocked: boolean;
}

export interface BackupReminderState {
  generatedCount: number;
  milestone: number;
  dismissedMilestone: number;
  visible: boolean;
}

interface PhotoMetadata extends Omit<PhotoAsset, "imageBlob" | "thumbnailBlob"> {
  imageMimeType: string;
  thumbnailMimeType: string;
}

interface ParsedBackup {
  preview: BackupPreview;
  checklistItems: ChecklistItem[];
  templates: ReportTemplate[];
  routeTemplates: InspectionRouteTemplate[];
  inspections: InspectionRecord[];
  entries: InspectionEntry[];
  photoGroups: PhotoGroup[];
  photos: PhotoAsset[];
  settings: SettingsRecord[];
}

interface ManifestV1 {
  schemaVersion: 1;
  createdAt: string;
  rowCounts: Record<keyof typeof schema1DataPaths, number>;
  files: Record<string, { sha256: string }>;
}

interface ManifestV2 {
  schemaVersion: 2;
  createdAt: string;
  rowCounts: BackupCounts;
  files: Record<string, { sha256: string }>;
}

interface ManifestV3 {
  schemaVersion: 3;
  createdAt: string;
  rowCounts: BackupCounts;
  files: Record<string, { sha256: string }>;
}

type Manifest = ManifestV1 | ManifestV2 | ManifestV3;

const schema1CountsSchema = z.object({
  checklistItems: z.number().int().nonnegative(),
  templates: z.number().int().nonnegative(),
  inspections: z.number().int().nonnegative(),
  entries: z.number().int().nonnegative(),
  photoGroups: z.number().int().nonnegative(),
  photos: z.number().int().nonnegative(),
  settings: z.number().int().nonnegative(),
});

const countsSchema = schema1CountsSchema.extend({
  routeTemplates: z.number().int().nonnegative(),
});

const manifestFilesSchema = z.record(z.string(), z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}));

const manifestV1Schema = z.object({
  schemaVersion: z.literal(1),
  createdAt: z.string().datetime(),
  rowCounts: schema1CountsSchema,
  files: manifestFilesSchema,
});

const manifestV2Schema = z.object({
  schemaVersion: z.literal(2),
  createdAt: z.string().datetime(),
  rowCounts: countsSchema,
  files: manifestFilesSchema,
});

const manifestV3Schema = z.object({
  schemaVersion: z.literal(schemaVersion),
  createdAt: z.string().datetime(),
  rowCounts: countsSchema,
  files: manifestFilesSchema,
});

export class BackupValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupValidationError";
  }
}

export class StorageCapacityError extends Error {
  constructor() {
    super("存储空间使用率已达到95%，无法保存新照片。请先备份或删除数据后重试。");
    this.name = "StorageCapacityError";
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]));
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function sortById<T extends { id: string }>(rows: T[]): T[] {
  return rows.sort((left, right) => left.id.localeCompare(right.id));
}

function sortTemplates(rows: ReportTemplate[]): ReportTemplate[] {
  return rows.sort((left, right) => left.id.localeCompare(right.id) || left.version - right.version);
}

function sortSettings(rows: SettingsRecord[]): SettingsRecord[] {
  return rows.sort((left, right) => left.key.localeCompare(right.key));
}

async function blobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Response(blob).arrayBuffer();
}

async function sha256(
  value: string | Blob | ArrayBuffer | Uint8Array<ArrayBuffer>,
): Promise<string> {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value).buffer
    : value instanceof Blob
      ? await blobArrayBuffer(value)
      : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function photoPath(id: string, thumbnail = false): string {
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(id) || id === "." || id === "..") {
    throw new BackupValidationError(`备份中的照片 ID ${id} 不能用作安全文件名。`);
  }
  return `photos/${id}${thumbnail ? "-thumb" : ""}.jpg`;
}

function photoPayloadPaths(rows: Array<{ id: string }>): Map<string, { image: string; thumbnail: string }> {
  const pathOwner = new Map<string, string>();
  const result = new Map<string, { image: string; thumbnail: string }>();
  for (const row of rows) {
    const paths = { image: photoPath(row.id), thumbnail: photoPath(row.id, true) };
    for (const path of [paths.image, paths.thumbnail]) {
      const owner = pathOwner.get(path);
      if (owner) {
        throw new BackupValidationError(`照片文件路径冲突：${owner} 与 ${row.id} 共用 ${path}。`);
      }
      pathOwner.set(path, row.id);
    }
    result.set(row.id, paths);
  }
  return result;
}

function countsOf(data: Omit<ParsedBackup, "preview">): BackupCounts {
  return {
    checklistItems: data.checklistItems.length,
    templates: data.templates.length,
    routeTemplates: data.routeTemplates.length,
    inspections: data.inspections.length,
    entries: data.entries.length,
    photoGroups: data.photoGroups.length,
    photos: data.photos.length,
    settings: data.settings.length,
  };
}

function normalizeBackupEntries(entries: InspectionEntry[], context: string): InspectionEntry[] {
  try {
    return entries.map((entry) => ({
      ...entry,
      checkSelections: normalizeInspectionCheckSelections(entry.checkSelections ?? []),
    }));
  } catch {
    throw new BackupValidationError(`${context}中的巡检条目检查内容无效。`);
  }
}

async function readDatabase(db: SevenSDb): Promise<Omit<ParsedBackup, "preview">> {
  return db.transaction("r", db.tables, async () => ({
    checklistItems: sortById(await db.checklistItems.toArray()),
    templates: sortTemplates(await db.templates.toArray()),
    routeTemplates: sortById(await db.routeTemplates.toArray()),
    inspections: sortById(await db.inspections.toArray()),
    entries: normalizeBackupEntries(sortById(await db.entries.toArray()), "本地数据"),
    photoGroups: sortById(await db.photoGroups.toArray()),
    photos: sortById(await db.photos.toArray()),
    settings: sortSettings(await db.settings.toArray()),
  }));
}

function photoMetadataRows(photos: PhotoAsset[]): PhotoMetadata[] {
  return photos.map((photo) => {
    if (!photo.imageBlob || !photo.thumbnailBlob) {
      throw new BackupValidationError(`本地数据中的照片 ${photo.id} 缺少原图或缩略图，无法导出备份。`);
    }
    const { imageBlob, thumbnailBlob, ...metadata } = photo;
    return {
      ...metadata,
      imageMimeType: imageBlob.type || "image/jpeg",
      thumbnailMimeType: thumbnailBlob.type || "image/jpeg",
    };
  });
}

function assertLocalRows<T>(rows: unknown, schema: z.ZodType<T>, label: string): void {
  if (!z.array(schema).safeParse(rows).success) {
    throw new BackupValidationError(`本地数据中的${label}格式无效，无法导出备份。`);
  }
}

function assertLocalSnapshot(
  data: Omit<ParsedBackup, "preview">,
  photoMetadata: PhotoMetadata[],
): Map<string, { image: string; thumbnail: string }> {
  assertExactlyOneDefaultRouteTemplate(data.routeTemplates, "本地路线模板目录");
  assertLocalRows(data.checklistItems, checklistItemSchema, "巡检项点");
  assertLocalRows(data.templates, reportTemplateSchema, "Word模板");
  assertLocalRows(data.routeTemplates, inspectionRouteTemplateSchema, "路线模板");
  assertLocalRows(data.inspections, inspectionRecordSchema, "巡检记录");
  assertLocalRows(data.entries, inspectionEntrySchema, "巡检条目");
  assertLocalRows(data.photoGroups, photoGroupSchema, "照片组");
  assertLocalRows(photoMetadata, photoMetadataSchema, "照片");
  assertLocalRows(data.settings, settingsRecordSchema, "设置");
  const templateKeys = new Set(data.templates.map((template) => `${template.id}\u0000${template.version}`));
  assertInspectionGraphs(data, templateKeys, "本地数据");
  return photoPayloadPaths(photoMetadata);
}

function addUncompressedBytes(total: number, bytes: number): number {
  const next = total + bytes;
  if (next > MAX_BACKUP_UNCOMPRESSED_BYTES) {
    throw new BackupValidationError("备份解压后的总大小不能超过512 MB。");
  }
  return next;
}

function assertExportCentralDirectoryLimit(paths: string[]): void {
  let centralDirectoryBytes = 0;
  for (const path of paths) {
    centralDirectoryBytes += CLASSIC_ZIP_CENTRAL_HEADER_BYTES + new TextEncoder().encode(path).byteLength;
    if (centralDirectoryBytes > MAX_BACKUP_CENTRAL_DIRECTORY_BYTES) {
      throw new BackupValidationError("备份ZIP中央目录不能超过4 MB。");
    }
  }
}

async function readCentralDirectory(blob: Blob): Promise<ZipCentralDirectoryMetadata> {
  try {
    return await parseZipCentralDirectory(blob, {
      maxEntries: MAX_BACKUP_ENTRY_COUNT,
      maxCentralDirectoryBytes: MAX_BACKUP_CENTRAL_DIRECTORY_BYTES,
    });
  } catch (error) {
    if (error instanceof ZipCentralDirectoryError) throw new BackupValidationError(error.message);
    throw new BackupValidationError("无法读取备份ZIP中央目录，请确认文件完整。");
  }
}

export async function createBackup(db: SevenSDb): Promise<Blob> {
  const data = await readDatabase(db);
  const photoMetadata = photoMetadataRows(data.photos);
  const pathsByPhotoId = assertLocalSnapshot(data, photoMetadata);
  const archivePaths = ["manifest.json", ...Object.values(dataPaths)];
  for (const paths of pathsByPhotoId.values()) archivePaths.push(paths.image, paths.thumbnail);
  if (archivePaths.length > MAX_BACKUP_ENTRY_COUNT) {
    throw new BackupValidationError(`备份ZIP条目数量不能超过${MAX_BACKUP_ENTRY_COUNT}个。`);
  }
  assertExportCentralDirectoryLimit(archivePaths);
  const jsonPayloads: Record<string, string> = {
    [dataPaths.checklistItems]: stableStringify(data.checklistItems),
    [dataPaths.templates]: stableStringify(data.templates),
    [dataPaths.routeTemplates]: stableStringify(data.routeTemplates),
    [dataPaths.inspections]: stableStringify(data.inspections),
    [dataPaths.entries]: stableStringify(data.entries),
    [dataPaths.photoGroups]: stableStringify(data.photoGroups),
    [dataPaths.photos]: stableStringify(photoMetadata),
    [dataPaths.settings]: stableStringify(data.settings),
  };
  const zip = new JSZip();
  const files: ManifestV3["files"] = {};
  let totalUncompressedBytes = 0;

  for (const [path, serialized] of Object.entries(jsonPayloads)) {
    const jsonBytes = new TextEncoder().encode(serialized).byteLength;
    if (jsonBytes > MAX_BACKUP_JSON_BYTES) {
      throw new BackupValidationError(`备份中的单个JSON文件不能超过16 MB：${path}。`);
    }
    totalUncompressedBytes = addUncompressedBytes(totalUncompressedBytes, jsonBytes);
    zip.file(path, serialized, { createFolders: false });
    files[path] = { sha256: await sha256(serialized) };
  }
  for (const photo of data.photos) {
    const paths = pathsByPhotoId.get(photo.id);
    if (!paths) throw new BackupValidationError(`照片 ${photo.id} 的文件路径无效。`);
    const { image: imagePath, thumbnail: thumbnailPath } = paths;
    const imageBytes = await blobArrayBuffer(photo.imageBlob);
    const thumbnailBytes = await blobArrayBuffer(photo.thumbnailBlob);
    if (imageBytes.byteLength > MAX_BACKUP_PHOTO_BYTES || thumbnailBytes.byteLength > MAX_BACKUP_PHOTO_BYTES) {
      throw new BackupValidationError(`备份中的单张照片文件不能超过32 MB：${photo.id}。`);
    }
    totalUncompressedBytes = addUncompressedBytes(totalUncompressedBytes, imageBytes.byteLength);
    totalUncompressedBytes = addUncompressedBytes(totalUncompressedBytes, thumbnailBytes.byteLength);
    zip.file(imagePath, imageBytes, { binary: true, createFolders: false });
    zip.file(thumbnailPath, thumbnailBytes, { binary: true, createFolders: false });
    files[imagePath] = { sha256: await sha256(imageBytes) };
    files[thumbnailPath] = { sha256: await sha256(thumbnailBytes) };
  }

  const manifest: ManifestV3 = {
    schemaVersion,
    createdAt: new Date().toISOString(),
    rowCounts: countsOf(data),
    files: Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))),
  };
  const serializedManifest = stableStringify(manifest);
  const manifestBytes = new TextEncoder().encode(serializedManifest).byteLength;
  if (manifestBytes > MAX_BACKUP_JSON_BYTES) {
    throw new BackupValidationError("备份中的单个JSON文件不能超过16 MB：manifest.json。");
  }
  addUncompressedBytes(totalUncompressedBytes, manifestBytes);
  zip.file("manifest.json", serializedManifest, { createFolders: false });
  const backup = await zip.generateAsync({ type: "blob", mimeType: backupMimeType, compression: "STORE" });
  if (backup.size > MAX_BACKUP_COMPRESSED_BYTES) {
    throw new BackupValidationError("备份ZIP压缩文件不能超过256 MB。");
  }
  await readCentralDirectory(backup);
  return backup;
}

export function downloadBackup(blob: Blob, filename: string): Promise<void> {
  return saveBlobToDownloads(blob, filename);
}

function assertSafeZipPath(entry: ZipEntryMetadata): void {
  const allowedDirectories = new Set(["data/", "photos/"]);
  if (
    entry.name.includes("\\") ||
    entry.name.startsWith("/") ||
    entry.name.split("/").some((part) => part === "." || part === "..") ||
    (entry.isDirectory && !allowedDirectories.has(entry.name))
  ) {
    throw new BackupValidationError("备份文件包含不安全的路径。");
  }
}

function assertDeclaredArchiveResourceLimits(metadata: ZipCentralDirectoryMetadata): void {
  let totalUncompressedBytes = 0;
  for (const entry of metadata.entries) {
    if (entry.isDirectory) continue;
    const compressedBytes = entry.compressedSize;
    const uncompressedBytes = entry.uncompressedSize;
    if (entry.name.endsWith(".json") && uncompressedBytes > MAX_BACKUP_JSON_BYTES) {
      throw new BackupValidationError(`备份中的单个JSON文件不能超过16 MB：${entry.name}。`);
    }
    if (entry.name.startsWith("photos/") && entry.name.endsWith(".jpg") && uncompressedBytes > MAX_BACKUP_PHOTO_BYTES) {
      throw new BackupValidationError(`备份中的单张照片文件不能超过32 MB：${entry.name}。`);
    }
    totalUncompressedBytes += uncompressedBytes;
    if (totalUncompressedBytes > MAX_BACKUP_UNCOMPRESSED_BYTES) {
      throw new BackupValidationError("备份解压后的总大小不能超过512 MB。");
    }
    if (
      uncompressedBytes > 0 &&
      (compressedBytes === 0 || uncompressedBytes / compressedBytes > MAX_BACKUP_COMPRESSION_RATIO)
    ) {
      throw new BackupValidationError(`备份条目的压缩比不能超过${MAX_BACKUP_COMPRESSION_RATIO}倍：${entry.name}。`);
    }
  }
}

async function archiveOperation<T>(operation: () => Promise<T> | T): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof BackupValidationError) throw error;
    if (error instanceof BoundedZipReadError) throw new BackupValidationError(error.message);
    throw new BackupValidationError("备份文件损坏，无法读取其中的数据，请重新选择有效备份。");
  }
}

function maxActualEntryBytes(path: string): number {
  return path.startsWith("photos/") ? MAX_BACKUP_PHOTO_BYTES : MAX_BACKUP_JSON_BYTES;
}

async function extractArchiveEntry(
  archive: Blob,
  centralDirectory: ZipCentralDirectoryMetadata,
  path: string,
  budget: ZipExtractionBudget,
): Promise<Uint8Array<ArrayBuffer>> {
  const entry = centralDirectory.entriesByName.get(path);
  if (!entry || entry.isDirectory) {
    throw new BackupValidationError(`备份文件不完整，缺少 ${path}。`);
  }
  return archiveOperation(() => extractZipEntryBounded(archive, entry, budget, {
    maxEntryBytes: maxActualEntryBytes(path),
    maxTotalBytes: MAX_BACKUP_UNCOMPRESSED_BYTES,
    maxCompressionRatio: MAX_BACKUP_COMPRESSION_RATIO,
  }));
}

function parseJsonBytes<T>(
  bytes: Uint8Array<ArrayBuffer>,
  path: string,
  schema: z.ZodType<T>,
): T {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new BackupValidationError(`备份文件 ${path} 不是有效的JSON。`);
  }
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new BackupValidationError(`备份文件 ${path} 的数据格式无效。`);
  }
  return result.data;
}

async function assertPayloadHash(
  bytes: Uint8Array<ArrayBuffer>,
  path: string,
  expected: string,
): Promise<void> {
  if (await archiveOperation(() => sha256(bytes)) !== expected) {
    throw new BackupValidationError(`备份文件 ${path} 校验失败，数据可能已损坏。`);
  }
}

async function readVerifiedJson<T>(
  archive: Blob,
  centralDirectory: ZipCentralDirectoryMetadata,
  budget: ZipExtractionBudget,
  path: string,
  expectedHash: string,
  schema: z.ZodType<T>,
): Promise<T> {
  const bytes = await extractArchiveEntry(archive, centralDirectory, path, budget);
  await assertPayloadHash(bytes, path, expectedHash);
  return parseJsonBytes(bytes, path, schema);
}

function uniqueBy<T>(rows: T[], keyOf: (row: T) => string, label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const row of rows) {
    const key = keyOf(row);
    if (result.has(key)) throw new BackupValidationError(`备份中的${label}主键 ${key} 重复。`);
    result.set(key, row);
  }
  return result;
}

function assertSameReferences(actual: string[], expected: string[], message: string): void {
  if (
    actual.length !== expected.length ||
    actual.some((id, index) => id !== expected[index])
  ) {
    throw new BackupValidationError(message);
  }
}

function assertRouteTemplateItems(
  routeTemplates: InspectionRouteTemplate[],
  itemIds: Map<string, ChecklistItem>,
  context: string,
): void {
  for (const routeTemplate of routeTemplates) {
    const routeNames = new Set<string>();
    for (const itemId of routeTemplate.itemIds) {
      const item = itemIds.get(itemId);
      if (!item) {
        throw new BackupValidationError(`${context}中的路线模板 ${routeTemplate.name} 引用的项点 ${itemId} 不存在。`);
      }
      if (!item.enabled) continue;
      const routeName = normalizeRouteName(item.routeName);
      if (routeNames.has(routeName)) {
        throw new BackupValidationError(`${context}中的路线模板 ${routeTemplate.name} 存在重复的检查项目名称 ${routeName}。`);
      }
      routeNames.add(routeName);
    }
  }
}

function assertInspectionGraphs(
  data: Omit<ParsedBackup, "preview">,
  availableTemplateKeys: Set<string>,
  context = "备份",
): void {
  const itemIds = uniqueBy(data.checklistItems, (item) => item.id, "项点");
  const inspections = uniqueBy(data.inspections, (inspection) => inspection.id, "巡检记录");
  const entries = uniqueBy(data.entries, (entry) => entry.id, "巡检条目");
  const groups = uniqueBy(data.photoGroups, (group) => group.id, "照片组");
  const photos = uniqueBy(data.photos, (photo) => photo.id, "照片");
  uniqueBy(data.templates, (template) => `${template.id}\u0000${template.version}`, "模板");
  uniqueBy(data.routeTemplates, (template) => template.id, "路线模板");
  uniqueBy(data.routeTemplates, (template) => template.name, "路线模板名称");
  uniqueBy(data.settings, (setting) => setting.key, "设置");
  const duplicateEnabledName = findDuplicateEnabledRouteName(data.checklistItems);
  if (duplicateEnabledName !== undefined) {
    throw new BackupValidationError(`${context}中的启用检查项目名称 ${duplicateEnabledName} 重复。`);
  }
  assertRouteTemplateItems(data.routeTemplates, itemIds, context);
  const entryNamesByInspection = new Map<string, Map<string, boolean>>();
  const entryItemIdsByInspection = new Map<string, Map<string, boolean>>();

  for (const inspection of data.inspections) {
    const templateKey = `${inspection.templateId}\u0000${inspection.templateVersion}`;
    if (!availableTemplateKeys.has(templateKey)) {
      throw new BackupValidationError(`巡检记录 ${inspection.id} 引用的模板版本不存在。`);
    }
  }

  for (const entry of data.entries) {
    if (!inspections.has(entry.inspectionId)) {
      throw new BackupValidationError(`巡检条目 ${entry.id} 引用的巡检记录不存在。`);
    }
    const isTemporaryEntry = isPrefixedBrowserUuid(entry.id, "temporary-entry") &&
      isPrefixedBrowserUuid(entry.itemId, "temporary-item");
    if (entry.itemSnapshot.id !== entry.itemId || (!isTemporaryEntry && !itemIds.has(entry.itemId))) {
      throw new BackupValidationError(`巡检条目 ${entry.id} 的项点或历史快照不完整。`);
    }
    const names = entryNamesByInspection.get(entry.inspectionId) ?? new Map<string, boolean>();
    const normalizedName = normalizeRouteName(entry.itemSnapshot.routeName);
    const existingNameIsTemporary = names.get(normalizedName);
    if (existingNameIsTemporary !== undefined && (existingNameIsTemporary || isTemporaryEntry)) {
      throw new BackupValidationError(`巡检记录 ${entry.inspectionId} 的检查项目名称重复。`);
    }
    if (existingNameIsTemporary === undefined) names.set(normalizedName, isTemporaryEntry);
    entryNamesByInspection.set(entry.inspectionId, names);

    const snapshotIds = entryItemIdsByInspection.get(entry.inspectionId) ?? new Map<string, boolean>();
    const existingItemIsTemporary = snapshotIds.get(entry.itemId);
    if (existingItemIsTemporary !== undefined && (existingItemIsTemporary || isTemporaryEntry)) {
      throw new BackupValidationError(`巡检记录 ${entry.inspectionId} 的快照 ID 重复。`);
    }
    if (existingItemIsTemporary === undefined) snapshotIds.set(entry.itemId, isTemporaryEntry);
    entryItemIdsByInspection.set(entry.inspectionId, snapshotIds);
    const ownedGroups = data.photoGroups
      .filter((group) => group.entryId === entry.id)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    if (ownedGroups.some((group) => group.inspectionId !== entry.inspectionId)) {
      throw new BackupValidationError(`巡检条目 ${entry.id} 的照片组归属不一致。`);
    }
    assertSameReferences(
      entry.groupIds,
      ownedGroups.map((group) => group.id),
      `巡检条目 ${entry.id} 的照片组引用不完整或顺序不一致。`,
    );
  }

  for (const group of data.photoGroups) {
    const entry = entries.get(group.entryId);
    if (!entry || entry.inspectionId !== group.inspectionId || !inspections.has(group.inspectionId)) {
      throw new BackupValidationError(`照片组 ${group.id} 的巡检条目引用无效。`);
    }
    const ownedPhotos = data.photos
      .filter((photo) => photo.groupId === group.id)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    if (ownedPhotos.some((photo) => photo.inspectionId !== group.inspectionId)) {
      throw new BackupValidationError(`照片组 ${group.id} 的照片归属不一致。`);
    }
    assertSameReferences(
      group.photoIds,
      ownedPhotos.map((photo) => photo.id),
      `照片组 ${group.id} 的照片引用不完整或顺序不一致。`,
    );
  }

  for (const photo of data.photos) {
    const group = groups.get(photo.groupId);
    if (!group || group.inspectionId !== photo.inspectionId || !inspections.has(photo.inspectionId)) {
      throw new BackupValidationError(`照片 ${photo.id} 的照片组引用无效。`);
    }
  }

  if (photos.size !== data.photoGroups.reduce((total, group) => total + group.photoIds.length, 0)) {
    throw new BackupValidationError("备份中的照片引用不是一一对应关系。");
  }
}

async function localTemplateKeys(db?: SevenSDb): Promise<Set<string>> {
  if (!db) return new Set();
  return new Set((await db.templates.toArray()).map((template) => `${template.id}\u0000${template.version}`));
}

async function parseBackup(blob: Blob, localDb?: SevenSDb): Promise<ParsedBackup> {
  if (blob.size > MAX_BACKUP_COMPRESSED_BYTES) {
    throw new BackupValidationError("备份ZIP压缩文件不能超过256 MB。");
  }
  const centralDirectory = await readCentralDirectory(blob);
  assertDeclaredArchiveResourceLimits(centralDirectory);
  for (const entry of centralDirectory.entries) assertSafeZipPath(entry);
  const extractionBudget = createZipExtractionBudget();
  let manifest: Manifest;
  try {
    const manifestBytes = await extractArchiveEntry(blob, centralDirectory, "manifest.json", extractionBudget);
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)) as unknown;
    const version = raw && typeof raw === "object" && "schemaVersion" in raw
      ? raw.schemaVersion
      : undefined;
    if (version !== 1 && version !== 2 && version !== 3) {
      if (version !== undefined) {
        throw new BackupValidationError("备份版本不兼容，当前应用仅支持版本1、版本2和版本3。");
      }
      throw new BackupValidationError("备份清单格式无效。");
    }
    const parsed = version === 1
      ? manifestV1Schema.safeParse(raw)
      : version === 2
        ? manifestV2Schema.safeParse(raw)
        : manifestV3Schema.safeParse(raw);
    if (!parsed.success) {
      throw new BackupValidationError("备份清单格式无效。");
    }
    manifest = parsed.data;
  } catch (error) {
    if (error instanceof BackupValidationError) throw error;
    throw new BackupValidationError("备份清单损坏或缺失。");
  }

  const requiredDataPaths = new Set<string>(Object.values(
    manifest.schemaVersion === 1 ? schema1DataPaths : dataPaths,
  ));
  const manifestPaths = new Set(Object.keys(manifest.files));
  for (const path of requiredDataPaths) {
    if (!manifestPaths.has(path)) throw new BackupValidationError(`备份清单缺少 ${path} 的校验值。`);
  }
  if ([...manifestPaths].some((path) => !requiredDataPaths.has(path) && !path.startsWith("photos/"))) {
    throw new BackupValidationError("备份清单包含未知载荷路径。");
  }
  const actualPayloadPaths = centralDirectory.entries
    .filter((entry) => !entry.isDirectory && entry.name !== "manifest.json")
    .map((entry) => entry.name);
  if (
    actualPayloadPaths.length !== manifestPaths.size ||
    actualPayloadPaths.some((path) => !manifestPaths.has(path))
  ) {
    throw new BackupValidationError("备份ZIP路径与清单不一致。");
  }

  const checklistItems = await readVerifiedJson(
    blob,
    centralDirectory,
    extractionBudget,
    dataPaths.checklistItems,
    manifest.files[dataPaths.checklistItems].sha256,
    z.array(checklistItemSchema),
  );
  const templates = await readVerifiedJson(
    blob,
    centralDirectory,
    extractionBudget,
    dataPaths.templates,
    manifest.files[dataPaths.templates].sha256,
    z.array(reportTemplateSchema),
  );
  const routeTemplates = manifest.schemaVersion === 1
    ? []
    : await readVerifiedJson(
      blob,
      centralDirectory,
      extractionBudget,
      dataPaths.routeTemplates,
      manifest.files[dataPaths.routeTemplates].sha256,
      z.array(inspectionRouteTemplateSchema),
    );
  const inspections = await readVerifiedJson(
    blob,
    centralDirectory,
    extractionBudget,
    dataPaths.inspections,
    manifest.files[dataPaths.inspections].sha256,
    z.array(inspectionRecordSchema),
  );
  const structuralEntries = await readVerifiedJson(
    blob,
    centralDirectory,
    extractionBudget,
    dataPaths.entries,
    manifest.files[dataPaths.entries].sha256,
    z.array(inspectionEntrySchema),
  );
  const entries = normalizeBackupEntries(structuralEntries, "备份");
  const photoGroups = await readVerifiedJson(
    blob,
    centralDirectory,
    extractionBudget,
    dataPaths.photoGroups,
    manifest.files[dataPaths.photoGroups].sha256,
    z.array(photoGroupSchema),
  );
  const photoMetadata = await readVerifiedJson(
    blob,
    centralDirectory,
    extractionBudget,
    dataPaths.photos,
    manifest.files[dataPaths.photos].sha256,
    z.array(photoMetadataSchema),
  );
  const settings = await readVerifiedJson(
    blob,
    centralDirectory,
    extractionBudget,
    dataPaths.settings,
    manifest.files[dataPaths.settings].sha256,
    z.array(settingsRecordSchema),
  );
  const pathsByPhotoId = photoPayloadPaths(photoMetadata);
  const expectedPhotoPaths = new Set<string>();
  for (const metadata of photoMetadata) {
    const paths = pathsByPhotoId.get(metadata.id);
    if (!paths) throw new BackupValidationError(`照片 ${metadata.id} 的文件路径无效。`);
    const { image: imagePath, thumbnail: thumbnailPath } = paths;
    expectedPhotoPaths.add(imagePath);
    expectedPhotoPaths.add(thumbnailPath);
    if (!manifestPaths.has(imagePath) || !manifestPaths.has(thumbnailPath)) {
      throw new BackupValidationError(`照片 ${metadata.id} 缺少原图或缩略图。`);
    }
  }
  const actualPhotoPaths = [...manifestPaths].filter((path) => path.startsWith("photos/"));
  if (
    actualPhotoPaths.length !== expectedPhotoPaths.size ||
    actualPhotoPaths.some((path) => !expectedPhotoPaths.has(path))
  ) {
    throw new BackupValidationError("备份中的照片文件与照片记录不一致。每张照片必须包含一份原图和缩略图。");
  }

  const photos: PhotoAsset[] = [];
  for (const metadata of photoMetadata) {
    const paths = pathsByPhotoId.get(metadata.id);
    if (!paths) throw new BackupValidationError(`照片 ${metadata.id} 的文件路径无效。`);
    const imageBytes = await extractArchiveEntry(blob, centralDirectory, paths.image, extractionBudget);
    await assertPayloadHash(imageBytes, paths.image, manifest.files[paths.image].sha256);
    const thumbnailBytes = await extractArchiveEntry(blob, centralDirectory, paths.thumbnail, extractionBudget);
    await assertPayloadHash(thumbnailBytes, paths.thumbnail, manifest.files[paths.thumbnail].sha256);
    const { imageMimeType, thumbnailMimeType, ...photo } = metadata;
    photos.push(await archiveOperation(() => ({
      ...photo,
      imageBlob: new Blob([imageBytes], { type: imageMimeType }),
      thumbnailBlob: new Blob([thumbnailBytes], { type: thumbnailMimeType }),
    })));
  }

  const data = {
    checklistItems,
    templates,
    routeTemplates,
    inspections,
    entries,
    photoGroups,
    photos,
    settings,
  };
  const actualCounts = countsOf(data);
  const declaredCounts: BackupCounts = manifest.schemaVersion === 1
    ? { ...manifest.rowCounts, routeTemplates: 0 }
    : manifest.rowCounts;
  for (const key of Object.keys(dataPaths) as BackupTableName[]) {
    if (declaredCounts[key] !== actualCounts[key]) {
      throw new BackupValidationError(`备份清单中的 ${key} 数量与数据不一致。`);
    }
  }
  const templateKeys = new Set(templates.map((template) => `${template.id}\u0000${template.version}`));
  for (const key of await localTemplateKeys(localDb)) templateKeys.add(key);
  if (manifest.schemaVersion !== 1) {
    assertExactlyOneDefaultRouteTemplate(routeTemplates, "备份");
  }
  assertInspectionGraphs(data, templateKeys);
  const mergeRouteTemplates = localDb
    ? routeTemplatesForMerge(await localDb.routeTemplates.toArray(), routeTemplates)
    : { imported: routeTemplates, skipped: 0 };

  return {
    ...data,
    preview: {
      schemaVersion: manifest.schemaVersion,
      createdAt: manifest.createdAt,
      counts: actualCounts,
      mergeRouteTemplates: {
        added: mergeRouteTemplates.imported.length,
        skipped: mergeRouteTemplates.skipped,
      },
    },
  };
}

export async function inspectBackup(blob: Blob, localDb?: SevenSDb): Promise<BackupPreview> {
  return (await parseBackup(blob, localDb)).preview;
}

async function addRows<T>(rows: T[], add: (rows: T[]) => Promise<unknown>): Promise<void> {
  if (rows.length > 0) await add(rows);
}

function assertExactlyOneDefaultRouteTemplate(
  routeTemplates: InspectionRouteTemplate[],
  context: string,
): InspectionRouteTemplate {
  const defaults = routeTemplates.filter((template) => template.isDefault);
  if (defaults.length !== 1) {
    throw new BackupValidationError(`${context}必须且只能包含一个默认路线模板。`);
  }
  if (defaults[0].name !== DEFAULT_ROUTE_TEMPLATE_NAME) {
    throw new BackupValidationError(`${context}中的默认路线模板名称必须为“${DEFAULT_ROUTE_TEMPLATE_NAME}”。`);
  }
  return defaults[0];
}

function semanticChecklistItemContent(item: ChecklistItem): string {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...content } = item;
  return stableStringify(content);
}

function assertImportedRouteTemplateItemsCompatible(
  localItems: ChecklistItem[],
  archiveItems: ChecklistItem[],
  routeTemplates: InspectionRouteTemplate[],
): void {
  const localById = new Map(localItems.map((item) => [item.id, item]));
  const archiveById = new Map(archiveItems.map((item) => [item.id, item]));
  const referencedIds = new Set(routeTemplates.flatMap((template) => template.itemIds));
  for (const itemId of referencedIds) {
    const local = localById.get(itemId);
    const archived = archiveById.get(itemId);
    if (local && archived && semanticChecklistItemContent(local) !== semanticChecklistItemContent(archived)) {
      throw new BackupValidationError(`路线模板引用的项点 ${itemId} 与本地项点内容冲突，合并已取消。`);
    }
  }
}

function assertMergedEnabledRouteNamesCompatible(
  localItems: ChecklistItem[],
  archiveItems: ChecklistItem[],
): void {
  const localIds = new Set(localItems.map((item) => item.id));
  const duplicate = findDuplicateEnabledRouteName([
    ...localItems,
    ...archiveItems.filter((item) => !localIds.has(item.id)),
  ]);
  if (duplicate !== undefined) {
    throw new BackupValidationError(`合并后的启用检查项目名称 ${duplicate} 将发生重复，合并已取消。`);
  }
}

async function replaceDatabase(db: SevenSDb, data: ParsedBackup): Promise<RestoreResult> {
  return db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) await table.clear();
    await addRows(data.checklistItems, (rows) => db.checklistItems.bulkAdd(rows));
    await addRows(data.templates, (rows) => db.templates.bulkAdd(rows));
    await addRows(data.routeTemplates, (rows) => db.routeTemplates.bulkAdd(rows));
    await addRows(data.inspections, (rows) => db.inspections.bulkAdd(rows));
    await addRows(data.entries, (rows) => db.entries.bulkAdd(rows));
    await addRows(data.photoGroups, (rows) => db.photoGroups.bulkAdd(rows));
    await addRows(data.photos, (rows) => db.photos.bulkAdd(rows));
    await addRows(data.settings, (rows) => db.settings.bulkAdd(rows));
    if (data.preview.schemaVersion === 1) await ensureRouteCatalog(db);

    return {
      mode: "replace",
      importedInspectionCount: data.inspections.length,
      skippedInspectionCount: 0,
      skippedInspectionIds: [],
      skippedRouteTemplateCount: 0,
      importedCounts: data.preview.counts,
    };
  });
}

function immutableTemplateEqual(left: ReportTemplate, right: ReportTemplate): boolean {
  return stableStringify(left) === stableStringify(right);
}

function normalizedRouteTemplateContent(template: InspectionRouteTemplate): string {
  return stableStringify({
    name: template.name.trim(),
    itemIds: template.itemIds,
    isDefault: template.isDefault,
  });
}

function allocateImportedRouteTemplateId(originalId: string, occupiedIds: Set<string>): string {
  let counter = 1;
  while (occupiedIds.has(`imported-${originalId}-${counter}`)) counter += 1;
  return `imported-${originalId}-${counter}`;
}

function allocateImportedRouteTemplateName(originalName: string, occupiedNames: Set<string>): string {
  let counter = 1;
  let candidate = `${originalName}（导入）`;
  while (occupiedNames.has(candidate)) {
    counter += 1;
    candidate = `${originalName}（导入${counter}）`;
  }
  return candidate;
}

function routeTemplatesForMerge(
  localTemplates: InspectionRouteTemplate[],
  incomingTemplates: InspectionRouteTemplate[],
): { imported: InspectionRouteTemplate[]; skipped: number } {
  const byId = new Map(localTemplates.map((template) => [template.id, template]));
  const occupiedIds = new Set(byId.keys());
  const occupiedNames = new Set(localTemplates.map((template) => template.name.trim()));
  const reservedIds = new Set([...occupiedIds, ...incomingTemplates.map((template) => template.id)]);
  const reservedNames = new Set([
    ...occupiedNames,
    ...incomingTemplates.map((template) => template.name.trim()),
  ]);
  const imported: InspectionRouteTemplate[] = [];
  let skipped = 0;

  for (const template of [...incomingTemplates].sort((left, right) => left.id.localeCompare(right.id))) {
    const localById = byId.get(template.id);
    if (
      localById &&
      normalizedRouteTemplateContent(localById) === normalizedRouteTemplateContent(template)
    ) {
      skipped += 1;
      continue;
    }

    const normalizedName = template.name.trim();
    const hasConflict = localById !== undefined || occupiedNames.has(normalizedName);
    const importableTemplate = template.isDefault ? { ...template, isDefault: false } : template;
    const candidate = hasConflict
      ? {
        ...importableTemplate,
        id: allocateImportedRouteTemplateId(template.id, reservedIds),
        name: allocateImportedRouteTemplateName(normalizedName, reservedNames),
      }
      : importableTemplate;
    imported.push(candidate);
    byId.set(candidate.id, candidate);
    occupiedIds.add(candidate.id);
    occupiedNames.add(candidate.name.trim());
    reservedIds.add(candidate.id);
    reservedNames.add(candidate.name.trim());
  }

  return { imported, skipped };
}

async function mergeDatabase(db: SevenSDb, data: ParsedBackup): Promise<RestoreResult> {
  return db.transaction("rw", db.tables, async () => {
    if (data.preview.schemaVersion === 1) await ensureRouteCatalog(db);
    const localRouteTemplates = await db.routeTemplates.toArray();
    const localItems = await db.checklistItems.toArray();
    const localDefault = assertExactlyOneDefaultRouteTemplate(localRouteTemplates, "本地路线模板目录");
    assertRouteTemplateItems(
      [localDefault],
      new Map(localItems.map((item) => [item.id, item])),
      "本地数据",
    );
    assertImportedRouteTemplateItemsCompatible(localItems, data.checklistItems, data.routeTemplates);
    assertMergedEnabledRouteNamesCompatible(localItems, data.checklistItems);

    const localTemplates = new Map((await db.templates.toArray())
      .map((template) => [
        `${template.id}\u0000${template.version}`,
        reportTemplateSchema.parse(template),
      ]));
    for (const template of data.templates) {
      const key = `${template.id}\u0000${template.version}`;
      const local = localTemplates.get(key);
      if (local && !immutableTemplateEqual(local, template)) {
        throw new BackupValidationError(`模板 ${template.id} 版本 ${template.version} 存在不可变版本冲突，合并已取消。`);
      }
    }
    for (const inspection of data.inspections) {
      const key = `${inspection.templateId}\u0000${inspection.templateVersion}`;
      if (!localTemplates.has(key) && !data.templates.some((template) =>
        template.id === inspection.templateId && template.version === inspection.templateVersion)) {
        throw new BackupValidationError(`巡检记录 ${inspection.id} 引用的模板版本不存在，合并已取消。`);
      }
    }

    const existingInspectionIds = new Set(await db.inspections.toCollection().primaryKeys());
    const existingEntryIds = new Set(await db.entries.toCollection().primaryKeys());
    const existingGroupIds = new Set(await db.photoGroups.toCollection().primaryKeys());
    const existingPhotoIds = new Set(await db.photos.toCollection().primaryKeys());
    const acceptedInspections: InspectionRecord[] = [];
    const acceptedEntries: InspectionEntry[] = [];
    const acceptedGroups: PhotoGroup[] = [];
    const acceptedPhotos: PhotoAsset[] = [];
    const skippedInspectionIds: string[] = [];

    for (const inspection of [...data.inspections].sort((left, right) => left.id.localeCompare(right.id))) {
      const entries = data.entries.filter((entry) => entry.inspectionId === inspection.id);
      const groups = data.photoGroups.filter((group) => group.inspectionId === inspection.id);
      const photos = data.photos.filter((photo) => photo.inspectionId === inspection.id);
      const hasCollision = existingInspectionIds.has(inspection.id) ||
        entries.some((entry) => existingEntryIds.has(entry.id)) ||
        groups.some((group) => existingGroupIds.has(group.id)) ||
        photos.some((photo) => existingPhotoIds.has(photo.id));
      if (hasCollision) {
        skippedInspectionIds.push(inspection.id);
        continue;
      }
      acceptedInspections.push(inspection);
      acceptedEntries.push(...entries);
      acceptedGroups.push(...groups);
      acceptedPhotos.push(...photos);
    }

    const localItemIds = new Set(localItems.map((item) => item.id));
    const localSettingKeys = new Set(await db.settings.toCollection().primaryKeys());
    const routeTemplateMerge = routeTemplatesForMerge(
      localRouteTemplates,
      data.routeTemplates,
    );
    const missingItems = data.checklistItems.filter((item) => !localItemIds.has(item.id));
    const missingTemplates = data.templates.filter((template) =>
      !localTemplates.has(`${template.id}\u0000${template.version}`));
    const missingSettings = data.settings.filter((setting) => !localSettingKeys.has(setting.key));

    await addRows(missingItems, (rows) => db.checklistItems.bulkAdd(rows));
    await addRows(missingTemplates, (rows) => db.templates.bulkAdd(rows));
    await addRows(routeTemplateMerge.imported, (rows) => db.routeTemplates.bulkAdd(rows));
    await addRows(acceptedInspections, (rows) => db.inspections.bulkAdd(rows));
    await addRows(acceptedEntries, (rows) => db.entries.bulkAdd(rows));
    await addRows(acceptedGroups, (rows) => db.photoGroups.bulkAdd(rows));
    await addRows(acceptedPhotos, (rows) => db.photos.bulkAdd(rows));
    await addRows(missingSettings, (rows) => db.settings.bulkAdd(rows));

    return {
      mode: "merge",
      importedInspectionCount: acceptedInspections.length,
      skippedInspectionCount: skippedInspectionIds.length,
      skippedInspectionIds,
      skippedRouteTemplateCount: routeTemplateMerge.skipped,
      importedCounts: {
        checklistItems: missingItems.length,
        templates: missingTemplates.length,
        routeTemplates: routeTemplateMerge.imported.length,
        inspections: acceptedInspections.length,
        entries: acceptedEntries.length,
        photoGroups: acceptedGroups.length,
        photos: acceptedPhotos.length,
        settings: missingSettings.length,
      },
    };
  });
}

export async function restoreBackup(
  db: SevenSDb,
  blob: Blob,
  mode: RestoreMode,
): Promise<RestoreResult> {
  if (mode !== "replace" && mode !== "merge") {
    throw new BackupValidationError("恢复模式无效，只能选择替换或合并。");
  }
  const parsed = await parseBackup(blob, mode === "merge" ? db : undefined);
  return mode === "replace" ? replaceDatabase(db, parsed) : mergeDatabase(db, parsed);
}

export async function requestPersistentStorage(): Promise<PersistentStorageStatus> {
  if (typeof navigator === "undefined" || typeof navigator.storage?.persist !== "function") {
    return "unsupported";
  }
  try {
    return await navigator.storage.persist() ? "granted" : "denied";
  } catch {
    return "denied";
  }
}

export async function readStorageEstimate(): Promise<StorageEstimate | null> {
  if (typeof navigator === "undefined" || typeof navigator.storage?.estimate !== "function") return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}

export function storageCapacityState(estimate: StorageEstimate | null): StorageCapacityState {
  const usage = estimate?.usage;
  const quota = estimate?.quota;
  if (
    typeof usage !== "number" || !Number.isFinite(usage) || usage < 0 ||
    typeof quota !== "number" || !Number.isFinite(quota) || quota <= 0
  ) {
    return {
      usage: null,
      quota: null,
      available: null,
      percentage: null,
      warning: false,
      photoWriteBlocked: false,
    };
  }
  const percentage = usage / quota * 100;
  return {
    usage,
    quota,
    available: Math.max(0, quota - usage),
    percentage,
    warning: percentage >= 80,
    photoWriteBlocked: percentage >= 95,
  };
}

export async function assertCanPersistNewPhoto(): Promise<void> {
  if (storageCapacityState(await readStorageEstimate()).photoWriteBlocked) {
    throw new StorageCapacityError();
  }
}

export async function readBackupReminder(db: SevenSDb): Promise<BackupReminderState> {
  return db.transaction("r", db.inspections, db.settings, async () => {
    const generatedCount = await db.inspections
      .filter((inspection) => inspection.status === "generated" && inspection.deletedAt === null)
      .count();
    const milestone = Math.floor(generatedCount / 4) * 4;
    const stored = await db.settings.get(reminderSettingKey);
    const dismissedMilestone = typeof stored?.value === "number" && Number.isInteger(stored.value)
      ? stored.value
      : 0;
    return {
      generatedCount,
      milestone,
      dismissedMilestone,
      visible: milestone >= 4 && milestone > dismissedMilestone,
    };
  });
}

export async function dismissBackupReminder(
  db: SevenSDb,
  milestone: number,
  updatedAt = new Date().toISOString(),
): Promise<void> {
  if (!Number.isInteger(milestone) || milestone < 4 || milestone % 4 !== 0) {
    throw new BackupValidationError("备份提醒里程碑无效。");
  }
  await db.settings.put({ key: reminderSettingKey, value: milestone, updatedAt });
}

export class BackupRepository {
  private readonly db: SevenSDb;

  constructor(db: SevenSDb) {
    this.db = db;
  }

  createBackup(): Promise<Blob> {
    return createBackup(this.db);
  }

  inspectBackup(blob: Blob): Promise<BackupPreview> {
    return inspectBackup(blob, this.db);
  }

  restoreBackup(blob: Blob, mode: RestoreMode): Promise<RestoreResult> {
    return restoreBackup(this.db, blob, mode);
  }

  requestPersistentStorage(): Promise<PersistentStorageStatus> {
    return requestPersistentStorage();
  }

  readStorageEstimate(): Promise<StorageEstimate | null> {
    return readStorageEstimate();
  }

  assertCanPersistNewPhoto(): Promise<void> {
    return assertCanPersistNewPhoto();
  }

  readBackupReminder(): Promise<BackupReminderState> {
    return readBackupReminder(this.db);
  }

  dismissBackupReminder(milestone: number, updatedAt?: string): Promise<void> {
    return dismissBackupReminder(this.db, milestone, updatedAt);
  }
}
import { saveBlobToDownloads } from "../platform/nativeFile";
