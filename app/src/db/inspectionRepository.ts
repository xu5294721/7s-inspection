import Dexie, { type Table } from "dexie";
import type {
  ChecklistItem,
  InspectionEntry,
  InspectionCheckSelection,
  Inspection,
  InspectionGraph,
  InspectionStatus,
  PhotoAsset,
  PhotoCategory,
  PhotoLayoutMode,
  PhotoGroup,
  PhotosPerRow,
  ReviewRouteOrderByCategory,
} from "../domain/models";
import type { SevenSDb } from "./database";
import { createInspectionEntry, descriptionForCategory, parseAnnotationJson } from "../domain/inspection";
import { formatInspectionEvaluationDescription, normalizeInspectionCheckSelections } from "../domain/inspectionCheckContents";
import { normalizeRouteName } from "../domain/routeNames";
import { validateReportReadiness } from "../domain/reportValidation";
import { photoCategorySchema, reportTemplateSchema } from "../domain/schemas";
import { isPrefixedBrowserUuid } from "../lib/ids";

export class GraphIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphIntegrityError";
  }
}

export interface PhotoAppendResult {
  entry: InspectionEntry;
  group: PhotoGroup;
  photo: PhotoAsset;
}

export interface EvaluationGroupAppendResult {
  entry: InspectionEntry;
  group: PhotoGroup;
  updatedAt: string;
}

export interface TemporaryEntryAppendResult {
  entry: InspectionEntry;
  updatedAt: string;
}

export interface InspectionCheckSelectionUpdateResult {
  entry: InspectionEntry;
  updatedAt: string;
  group?: PhotoGroup;
}

export interface InspectionEntryRenameResult {
  entry: InspectionEntry;
  updatedAt: string;
  reviewRouteOrder?: string[];
  reviewRouteOrderByCategory?: ReviewRouteOrderByCategory;
}

function compareOrdered(
  left: { id: string; order: number },
  right: { id: string; order: number },
): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}

function readBlobArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  if (typeof Response === "function") return new Response(blob).arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("无法读取照片数据。"));
    reader.readAsArrayBuffer(blob);
  });
}

async function blobSha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await readBlobArrayBuffer(blob));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function reportSnapshotFingerprint(graph: InspectionGraph): Promise<string> {
  const photos = [];
  for (const photo of graph.photos) {
    photos.push({
      id: photo.id,
      inspectionId: photo.inspectionId,
      groupId: photo.groupId,
      capturedAt: photo.capturedAt,
      order: photo.order,
      width: photo.width,
      height: photo.height,
      highQuality: photo.highQuality,
      annotationJson: photo.annotationJson,
      imageType: photo.imageBlob.type,
      imageSize: photo.imageBlob.size,
      imageSha256: await blobSha256(photo.imageBlob),
    });
  }
  return JSON.stringify({
    inspection: {
      id: graph.inspection.id,
      inspectionDate: graph.inspection.inspectionDate,
      title: graph.inspection.title,
      templateId: graph.inspection.templateId,
      templateVersion: graph.inspection.templateVersion,
      photoLayoutModeOverride: graph.inspection.photoLayoutModeOverride,
      photosPerRowOverride: graph.inspection.photosPerRowOverride,
      updatedAt: graph.inspection.updatedAt,
      deletedAt: graph.inspection.deletedAt,
      entries: graph.inspection.entries,
    },
    groups: graph.groups,
    photos,
    template: graph.template ?? null,
  });
}

function findZipSignature(bytes: Uint8Array, signature: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = bytes.byteLength - 4; offset >= 0; offset -= 1) {
    if (view.getUint32(offset, true) === signature) return offset;
  }
  return -1;
}

async function assertValidDocxPackage(packageBlob: Blob): Promise<void> {
  const docxMime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (packageBlob.type !== docxMime || packageBlob.size < 22) {
    throw new GraphIntegrityError("DOCX打包结果无效。");
  }

  try {
    const tailStart = Math.max(0, packageBlob.size - 65_557);
    const tail = new Uint8Array(await readBlobArrayBuffer(packageBlob.slice(tailStart)));
    const endOffset = findZipSignature(tail, 0x06054b50);
    if (endOffset < 0 || endOffset + 22 > tail.byteLength) throw new Error("missing EOCD");
    const endView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    const entryCount = endView.getUint16(endOffset + 10, true);
    const centralSize = endView.getUint32(endOffset + 12, true);
    const centralOffset = endView.getUint32(endOffset + 16, true);
    const endAbsoluteOffset = tailStart + endOffset;
    if (
      endView.getUint16(endOffset + 4, true) !== 0 ||
      endView.getUint16(endOffset + 6, true) !== 0 ||
      entryCount === 0xffff ||
      centralSize === 0xffffffff ||
      centralOffset === 0xffffffff ||
      centralOffset + centralSize > endAbsoluteOffset
    ) {
      throw new Error("unsupported ZIP structure");
    }

    const central = new Uint8Array(await readBlobArrayBuffer(
      packageBlob.slice(centralOffset, centralOffset + centralSize),
    ));
    const centralView = new DataView(central.buffer, central.byteOffset, central.byteLength);
    const requiredParts = new Set(["[Content_Types].xml", "_rels/.rels", "word/document.xml"]);
    const requiredOffsets = new Map<string, number>();
    const decoder = new TextDecoder();
    let offset = 0;
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > central.byteLength || centralView.getUint32(offset, true) !== 0x02014b50) {
        throw new Error("invalid central record");
      }
      const nameLength = centralView.getUint16(offset + 28, true);
      const extraLength = centralView.getUint16(offset + 30, true);
      const commentLength = centralView.getUint16(offset + 32, true);
      const recordLength = 46 + nameLength + extraLength + commentLength;
      if (offset + recordLength > central.byteLength) throw new Error("truncated central record");
      const name = decoder.decode(central.subarray(offset + 46, offset + 46 + nameLength));
      if (requiredParts.has(name)) requiredOffsets.set(name, centralView.getUint32(offset + 42, true));
      offset += recordLength;
    }
    if (offset !== central.byteLength || requiredOffsets.size !== requiredParts.size) {
      throw new Error("missing DOCX parts");
    }
    for (const localOffset of requiredOffsets.values()) {
      const signature = new Uint8Array(await readBlobArrayBuffer(
        packageBlob.slice(localOffset, localOffset + 4),
      ));
      if (signature.byteLength !== 4 || new DataView(
        signature.buffer,
        signature.byteOffset,
        signature.byteLength,
      ).getUint32(0, true) !== 0x04034b50) {
        throw new Error("invalid local record");
      }
    }
  } catch (error) {
    if (error instanceof GraphIntegrityError) throw error;
    throw new GraphIntegrityError("DOCX打包结果无效。");
  }
}

function requireId(id: string, label: string): void {
  if (!id.trim()) {
    throw new GraphIntegrityError(`${label} ID 不能为空。`);
  }
}

function requireUniqueIds<T extends { id: string }>(rows: T[], label: string): Map<string, T> {
  const byId = new Map<string, T>();
  for (const row of rows) {
    requireId(row.id, label);
    if (byId.has(row.id)) {
      throw new GraphIntegrityError(`${label} ${row.id} 重复。`);
    }
    byId.set(row.id, row);
  }
  return byId;
}

function requireUniqueReferences(ids: string[], label: string): void {
  if (new Set(ids).size !== ids.length) {
    throw new GraphIntegrityError(`${label} 中存在重复引用。`);
  }
}

function assertGroupEvaluation(group: PhotoGroup): void {
  if (!["good", "general", "reminder", "assessment"].includes(group.category)) {
    throw new GraphIntegrityError("照片组分类无效。");
  }
  const award = group.awardAssessment;
  if (!award) return;
  const expectedType = group.category === "good"
    ? "reward"
    : group.category === "assessment"
      ? "assessment"
      : null;
  if (!expectedType || award.type !== expectedType) {
    throw new GraphIntegrityError("奖考类型与照片组分类不一致。");
  }
  if (!Number.isSafeInteger(award.amount) || award.amount < 0) {
    throw new GraphIntegrityError("金额必须为大于0的安全整数。");
  }
}

function uniqueRouteNames(entries: InspectionEntry[]): string[] {
  const routeNames: string[] = [];
  const seen = new Set<string>();
  for (const entry of [...entries].sort(compareOrdered)) {
    const routeName = entry.itemSnapshot.routeName;
    if (!seen.has(routeName)) {
      seen.add(routeName);
      routeNames.push(routeName);
    }
  }
  return routeNames;
}

function assertCompleteReviewRouteOrder(entries: InspectionEntry[], routeNames: string[]): void {
  if (new Set(routeNames).size !== routeNames.length) {
    throw new GraphIntegrityError("巡检项点排序不能重复。");
  }

  const inspectionRouteNames = uniqueRouteNames(entries);
  const inspectionRouteNameSet = new Set(inspectionRouteNames);
  if (routeNames.some((routeName) => !inspectionRouteNameSet.has(routeName))) {
    throw new GraphIntegrityError("巡检项点排序包含未知项点。");
  }
  if (routeNames.length !== inspectionRouteNames.length) {
    throw new GraphIntegrityError("巡检项点排序必须包含当前巡检的全部项点。");
  }
}

function assertReviewRouteOrderByCategory(
  entries: InspectionEntry[],
  routeOrderByCategory: ReviewRouteOrderByCategory,
): void {
  const inspectionRouteNames = new Set(uniqueRouteNames(entries));
  for (const routeNames of Object.values(routeOrderByCategory)) {
    if (!routeNames) continue;
    if (new Set(routeNames).size !== routeNames.length) {
      throw new GraphIntegrityError("分类项点排序不能重复。");
    }
    if (routeNames.some((routeName) => !inspectionRouteNames.has(routeName))) {
      throw new GraphIntegrityError("分类项点排序包含未知项点。");
    }
  }
}

function assertGraphIntegrity(graph: InspectionGraph): void {
  const { inspection, groups, photos } = graph;
  requireId(inspection.id, "巡检记录");
  const entriesById = requireUniqueIds(inspection.entries, "巡检条目");
  const groupsById = requireUniqueIds(groups, "照片组");
  const photosById = requireUniqueIds(photos, "照片");
  const photoReferenceCount = new Map<string, number>();

  if (
    graph.template &&
    (graph.template.id !== inspection.templateId || graph.template.version !== inspection.templateVersion)
  ) {
    throw new GraphIntegrityError("巡检记录引用的模板版本与图中模板不一致。");
  }
  if (inspection.reviewRouteOrder) {
    assertCompleteReviewRouteOrder(inspection.entries, inspection.reviewRouteOrder);
  }
  if (inspection.reviewRouteOrderByCategory) {
    assertReviewRouteOrderByCategory(inspection.entries, inspection.reviewRouteOrderByCategory);
  }

  for (const entry of inspection.entries) {
    if (entry.inspectionId !== inspection.id) {
      throw new GraphIntegrityError(`巡检条目 ${entry.id} 的巡检记录 ID 不一致。`);
    }
    if (entry.itemSnapshot.id !== entry.itemId) {
      throw new GraphIntegrityError(`巡检条目 ${entry.id} 的项点快照 ID 与 itemId 不一致。`);
    }
    requireUniqueReferences(entry.groupIds, `巡检条目 ${entry.id} 的照片组引用`);
    for (const groupId of entry.groupIds) {
      const group = groupsById.get(groupId);
      if (!group || group.entryId !== entry.id) {
        throw new GraphIntegrityError(`巡检条目 ${entry.id} 引用的照片组 ${groupId} 不一致。`);
      }
    }
  }

  for (const group of groups) {
    assertGroupEvaluation(group);
    if (group.inspectionId !== inspection.id) {
      throw new GraphIntegrityError(`照片组 ${group.id} 的巡检记录 ID 不一致。`);
    }
    const entry = entriesById.get(group.entryId);
    if (!entry || !entry.groupIds.includes(group.id)) {
      throw new GraphIntegrityError(`照片组 ${group.id} 未由所属巡检条目引用。`);
    }
    requireUniqueReferences(group.photoIds, `照片组 ${group.id} 的照片引用`);
    for (const photoId of group.photoIds) {
      const photo = photosById.get(photoId);
      if (!photo || photo.groupId !== group.id) {
        throw new GraphIntegrityError(`照片组 ${group.id} 引用的照片 ${photoId} 不一致。`);
      }
      photoReferenceCount.set(photoId, (photoReferenceCount.get(photoId) ?? 0) + 1);
    }
  }

  for (const photo of photos) {
    if (photo.inspectionId !== inspection.id) {
      throw new GraphIntegrityError(`照片 ${photo.id} 的巡检记录 ID 不一致。`);
    }
    if (!groupsById.has(photo.groupId)) {
      throw new GraphIntegrityError(`照片 ${photo.id} 关联的照片组 ${photo.groupId} 不存在。`);
    }
    if (photoReferenceCount.get(photo.id) !== 1) {
      throw new GraphIntegrityError(`照片 ${photo.id} 必须且只能由一个照片组引用。`);
    }
  }
}

async function assertRowsOwnedByInspection<T extends { id: string; inspectionId: string }>(
  table: Table<T, string>,
  rows: T[],
  inspectionId: string,
  label: string,
): Promise<void> {
  const existing = await table.bulkGet(rows.map((row) => row.id));
  for (const row of existing) {
    if (row && row.inspectionId !== inspectionId) {
      throw new GraphIntegrityError(`${label} ${row.id} 已属于其他巡检记录。`);
    }
  }
}

async function deleteStaleRows<T extends { id: string; inspectionId: string }>(
  table: Table<T, string>,
  inspectionId: string,
  currentIds: Set<string>,
): Promise<void> {
  const storedIds = await table.where("inspectionId").equals(inspectionId).primaryKeys();
  const staleIds = storedIds.filter((id) => !currentIds.has(id));
  if (staleIds.length > 0) {
    await table.bulkDelete(staleIds);
  }
}

async function requireRow<T>(row: T | undefined, message: string): Promise<T> {
  if (!row) {
    throw new GraphIntegrityError(message);
  }
  return row;
}

async function readGraphFromDb(db: SevenSDb, id: string): Promise<InspectionGraph | null> {
  const inspection = await db.inspections.get(id);
  if (!inspection) return null;

  const entries = (await db.entries.where("inspectionId").equals(id).toArray())
    .sort(compareOrdered)
    .map((entry) => ({
      ...entry,
      checkSelections: normalizeInspectionCheckSelections(entry.checkSelections ?? []),
    }));
  const groups = (await db.photoGroups.where("inspectionId").equals(id).toArray()).sort(compareOrdered);
  const groupRank = new Map(groups.map((group, index) => [group.id, index]));
  const photos = (await db.photos.where("inspectionId").equals(id).toArray()).sort(
    (left, right) =>
      (groupRank.get(left.groupId) ?? Number.MAX_SAFE_INTEGER) -
        (groupRank.get(right.groupId) ?? Number.MAX_SAFE_INTEGER) ||
      compareOrdered(left, right),
  );
  const storedTemplate = await db.templates.get([inspection.templateId, inspection.templateVersion]);
  const parsedTemplate = storedTemplate ? reportTemplateSchema.safeParse(storedTemplate) : null;
  const template = parsedTemplate?.success ? parsedTemplate.data : storedTemplate;

  return {
    inspection: {
      ...inspection,
      photoLayoutModeOverride: inspection.photoLayoutModeOverride ?? null,
      entries,
    },
    groups,
    photos,
    ...(template ? { template } : {}),
  };
}

async function recomputeCompletedReviewStatus(db: SevenSDb, id: string): Promise<void> {
  const storedInspection = await db.inspections.get(id);
  if (!storedInspection) throw new GraphIntegrityError(`巡检记录 ${id} 不存在。`);
  if (storedInspection.status === "draft") return;

  const graph = await readGraphFromDb(db, id);
  if (!graph) throw new GraphIntegrityError(`巡检记录 ${id} 不存在。`);

  const status: InspectionStatus = validateReportReadiness(graph).length ? "draft" : "reviewed";
  const inspection = {
    ...graph.inspection,
    status,
    updatedAt: new Date().toISOString(),
  };
  const { entries: _entries, ...inspectionRecord } = inspection;
  await db.inspections.put(inspectionRecord);
}

export class InspectionRepository {
  private readonly db: SevenSDb;

  constructor(db: SevenSDb) {
    this.db = db;
  }

  async saveGraph(graph: InspectionGraph): Promise<void> {
    if (graph.inspection.status === "generated") {
      throw new GraphIntegrityError("生成状态只能在DOCX成功后设置。");
    }
    assertGraphIntegrity(graph);
    const { entries, ...inspectionRecord } = graph.inspection;

    await this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      this.db.photoGroups,
      this.db.photos,
      async () => {
        await assertRowsOwnedByInspection(this.db.entries, entries, graph.inspection.id, "巡检条目");
        await assertRowsOwnedByInspection(this.db.photoGroups, graph.groups, graph.inspection.id, "照片组");
        await assertRowsOwnedByInspection(this.db.photos, graph.photos, graph.inspection.id, "照片");

        await this.db.inspections.put(inspectionRecord);
        await this.db.entries.bulkPut(entries);
        await this.db.photoGroups.bulkPut(graph.groups);
        await this.db.photos.bulkPut(graph.photos);

        await deleteStaleRows(
          this.db.entries,
          graph.inspection.id,
          new Set(entries.map((entry) => entry.id)),
        );
        await deleteStaleRows(
          this.db.photoGroups,
          graph.inspection.id,
          new Set(graph.groups.map((group) => group.id)),
        );
        await deleteStaleRows(
          this.db.photos,
          graph.inspection.id,
          new Set(graph.photos.map((photo) => photo.id)),
        );
      },
    );
  }

  async getGraph(id: string): Promise<InspectionGraph | null> {
    return this.db.transaction(
      "r",
      this.db.inspections,
      this.db.entries,
      this.db.photoGroups,
      this.db.photos,
      this.db.templates,
      () => readGraphFromDb(this.db, id),
    );
  }

  async renameInspectionEntry(
    inspectionId: string,
    entryId: string,
    name: string,
    updatedAt = new Date().toISOString(),
  ): Promise<InspectionEntryRenameResult> {
    return this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      async () => {
        const inspection = await this.db.inspections.get(inspectionId);
        if (!inspection || inspection.deletedAt !== null) {
          throw new GraphIntegrityError("巡检记录不存在或已删除。");
        }
        const entry = await requireRow(
          await this.db.entries.get(entryId),
          `巡检条目 ${entryId} 不存在。`,
        );
        if (entry.inspectionId !== inspectionId) {
          throw new GraphIntegrityError(`巡检条目 ${entryId} 不属于当前巡检记录。`);
        }

        const normalizedName = normalizeRouteName(name);
        if (!normalizedName) {
          throw new GraphIntegrityError("检查项名称不能为空");
        }
        const entries = await this.db.entries.where("inspectionId").equals(inspectionId).toArray();
        if (entries.some((current) =>
          current.id !== entryId && normalizeRouteName(current.itemSnapshot.routeName) === normalizedName)) {
          throw new GraphIntegrityError("当前巡检中已存在同名检查项");
        }

        const reviewRouteOrder = inspection.reviewRouteOrder?.map((routeName) =>
          routeName === entry.itemSnapshot.routeName ? normalizedName : routeName,
        );
        const reviewRouteOrderByCategory = inspection.reviewRouteOrderByCategory
          ? Object.fromEntries(
            Object.entries(inspection.reviewRouteOrderByCategory).map(([category, routeNames]) => [
              category,
              routeNames?.map((routeName) =>
                routeName === entry.itemSnapshot.routeName ? normalizedName : routeName,
              ),
            ]),
          ) as ReviewRouteOrderByCategory
          : undefined;
        const renamedEntry: InspectionEntry = {
          ...entry,
          itemSnapshot: {
            ...entry.itemSnapshot,
            routeName: normalizedName,
          },
        };

        await this.db.entries.put(renamedEntry);
        const updated = await this.db.inspections.update(inspectionId, {
          status: "draft",
          updatedAt,
          ...(reviewRouteOrder === undefined ? {} : { reviewRouteOrder }),
          ...(reviewRouteOrderByCategory === undefined ? {} : { reviewRouteOrderByCategory }),
        });
        if (updated !== 1) {
          throw new GraphIntegrityError(`巡检记录 ${inspectionId} 更新失败。`);
        }
        return {
          entry: renamedEntry,
          updatedAt,
          ...(reviewRouteOrder === undefined ? {} : { reviewRouteOrder }),
          ...(reviewRouteOrderByCategory === undefined ? {} : { reviewRouteOrderByCategory }),
        };
      },
    );
  }

  async updateReviewRouteOrder(
    inspectionId: string,
    routeNames: string[],
  ): Promise<Inspection> {
    return this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      async () => {
        const inspection = await this.db.inspections.get(inspectionId);
        if (!inspection || inspection.deletedAt !== null) {
          throw new GraphIntegrityError("巡检记录不存在或已删除。");
        }
        const entries = await this.db.entries.where("inspectionId").equals(inspectionId).toArray();
        assertCompleteReviewRouteOrder(entries, routeNames);

        const updatedAt = new Date().toISOString();
        const updated = await this.db.inspections.update(inspectionId, {
          reviewRouteOrder: [...routeNames],
          updatedAt,
        });
        if (updated !== 1) {
          throw new GraphIntegrityError(`巡检记录 ${inspectionId} 更新失败。`);
        }
        return {
          ...inspection,
          reviewRouteOrder: [...routeNames],
          updatedAt,
          entries: [...entries].sort(compareOrdered),
        };
      },
    );
  }

  async updateReviewRouteOrderByCategory(
    inspectionId: string,
    routeOrderByCategory: ReviewRouteOrderByCategory,
  ): Promise<Inspection> {
    return this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      async () => {
        const inspection = await this.db.inspections.get(inspectionId);
        if (!inspection || inspection.deletedAt !== null) {
          throw new GraphIntegrityError("巡检记录不存在或已删除。");
        }
        const entries = await this.db.entries.where("inspectionId").equals(inspectionId).toArray();
        assertReviewRouteOrderByCategory(entries, routeOrderByCategory);

        const updatedAt = new Date().toISOString();
        const savedOrder: ReviewRouteOrderByCategory = Object.fromEntries(
          Object.entries(routeOrderByCategory).map(([category, routeNames]) => [
            category,
            routeNames ? [...routeNames] : undefined,
          ]),
        );
        const updated = await this.db.inspections.update(inspectionId, {
          reviewRouteOrderByCategory: savedOrder,
          updatedAt,
        });
        if (updated !== 1) {
          throw new GraphIntegrityError(`巡检记录 ${inspectionId} 更新失败。`);
        }
        return {
          ...inspection,
          reviewRouteOrderByCategory: savedOrder,
          updatedAt,
          entries: [...entries].sort(compareOrdered),
        };
      },
    );
  }

  async updateEntryCheckSelections(
    inspectionId: string,
    entryId: string,
    selections: readonly InspectionCheckSelection[],
    updatedAt = new Date().toISOString(),
  ): Promise<InspectionCheckSelectionUpdateResult> {
    return this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      this.db.photoGroups,
      this.db.settings,
      async () => {
        const inspection = await this.db.inspections.get(inspectionId);
        if (!inspection || inspection.deletedAt !== null) {
          throw new GraphIntegrityError("巡检记录不存在或已删除。");
        }
        const entry = await requireRow(
          await this.db.entries.get(entryId),
          `巡检条目 ${entryId} 不存在。`,
        );
        if (entry.inspectionId !== inspectionId) {
          throw new GraphIntegrityError(`巡检条目 ${entryId} 不属于当前巡检记录。`);
        }

        const templateRow = await this.db.settings.get("inspection-check-template");
        const configuredDefinitions = ((templateRow?.value as { definitions?: Array<{ category: InspectionCheckSelection["category"] ; label?: string; options?: readonly string[] }> } | undefined)?.definitions ?? [])
          .map((definition) => ({ category: definition.category, label: definition.label ?? definition.category, options: definition.options ?? [] }));
        const configuredOptions = new Map(
          configuredDefinitions
            .map((definition) => [definition.category, definition.options] as const),
        );
        const normalizedSelections = normalizeInspectionCheckSelections(selections, configuredOptions, configuredDefinitions);

        let storedEntry: InspectionEntry = {
          ...entry,
          checkSelections: normalizedSelections,
        };
        let createdGroup: PhotoGroup | undefined;
        await this.db.entries.put(storedEntry);
        if (normalizedSelections.length > 0 && storedEntry.groupIds.length === 0) {
          const group: PhotoGroup = {
            id: `photo-free-${storedEntry.id}`,
            inspectionId: inspection.id,
            entryId: storedEntry.id,
            category: "good",
            description: formatInspectionEvaluationDescription(storedEntry.itemSnapshot.routeName, normalizedSelections, configuredOptions, configuredDefinitions),
            descriptionManuallyEdited: false,
            awardAssessment: null,
            photoIds: [],
            order: 0,
          };
          await this.db.photoGroups.add(group);
          createdGroup = group;
          storedEntry = { ...storedEntry, groupIds: [group.id] };
          await this.db.entries.put(storedEntry);
        }
        const updated = await this.db.inspections.update(inspectionId, { status: "draft", updatedAt });
        if (updated !== 1) {
          throw new GraphIntegrityError(`巡检记录 ${inspectionId} 更新失败。`);
        }
        return { entry: storedEntry, updatedAt, ...(createdGroup ? { group: createdGroup } : {}) };
      },
    );
  }

  async removeEntryFromInspection(
    inspectionId: string,
    entryId: string,
    updatedAt = new Date().toISOString(),
  ): Promise<void> {
    await this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      this.db.photoGroups,
      this.db.photos,
      async () => {
        const inspection = await this.db.inspections.get(inspectionId);
        if (!inspection || inspection.deletedAt !== null) {
          throw new GraphIntegrityError("巡检记录不存在或已删除。");
        }
        const entry = await requireRow(
          await this.db.entries.get(entryId),
          `巡检条目 ${entryId} 不存在。`,
        );
        if (entry.inspectionId !== inspectionId) {
          throw new GraphIntegrityError(`巡检条目 ${entryId} 不属于当前巡检记录。`);
        }

        const matchedGroups = (await this.db.photoGroups.where("inspectionId").equals(inspectionId).toArray())
          .filter((group) => group.entryId === entryId);
        const matchedGroupIds = new Set(matchedGroups.map((group) => group.id));
        const matchedPhotoIds = (await this.db.photos.where("inspectionId").equals(inspectionId).toArray())
          .filter((photo) => matchedGroupIds.has(photo.groupId))
          .map((photo) => photo.id);

        if (matchedPhotoIds.length > 0) {
          await this.db.photos.bulkDelete(matchedPhotoIds);
        }
        if (matchedGroupIds.size > 0) {
          await this.db.photoGroups.bulkDelete([...matchedGroupIds]);
        }
        await this.db.entries.put({
          ...entry,
          groupIds: [],
          checkSelections: [],
        });
        const updated = await this.db.inspections.update(inspectionId, {
          status: "draft",
          updatedAt,
        });
        if (updated !== 1) {
          throw new GraphIntegrityError(`巡检记录 ${inspectionId} 更新失败。`);
        }
      },
    );
  }

  async addTemporaryEntry(
    inspectionId: string,
    name: string,
    entryId: string,
    itemId: string,
    updatedAt = new Date().toISOString(),
  ): Promise<TemporaryEntryAppendResult> {
    if (!isPrefixedBrowserUuid(entryId, "temporary-entry")) {
      throw new GraphIntegrityError("临时检查项条目 ID 无效。");
    }
    if (!isPrefixedBrowserUuid(itemId, "temporary-item")) {
      throw new GraphIntegrityError("临时检查项快照 ID 无效。");
    }
    return this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      async () => {
        const inspection = await this.db.inspections.get(inspectionId);
        if (!inspection || inspection.deletedAt !== null) {
          throw new GraphIntegrityError("巡检记录不存在或已删除。");
        }

        const normalizedName = normalizeRouteName(name);
        if (!normalizedName) {
          throw new GraphIntegrityError("检查项名称不能为空。");
        }

        const entries = await this.db.entries.where("inspectionId").equals(inspectionId).toArray();
        if (entries.some((entry) =>
          normalizeRouteName(entry.itemSnapshot.routeName) === normalizedName)) {
          throw new GraphIntegrityError("当前巡检中已存在同名检查项");
        }
        if (entries.some((entry) => entry.itemId === itemId)) {
          throw new GraphIntegrityError("当前巡检中已存在相同快照 ID。");
        }

        const order = entries.reduce((maximum, entry) => Math.max(maximum, entry.order), -1) + 1;
        const item: ChecklistItem = {
          id: itemId,
          routeOrder: order,
          routeName: normalizedName,
          area: normalizedName,
          device: "",
          part: normalizedName,
          standard: `检查${normalizedName}7S管理落实情况`,
          team: "相关责任工班",
          sevenSCategory: "",
          goodText: `${normalizedName}7S管理落实较好。`,
          reminderText: `${normalizedName}存在7S管理不到位问题，本次予以提醒。`,
          assessmentText: `${normalizedName}存在7S管理不到位问题。`,
          quickPhrases: [],
          enabled: true,
          createdAt: updatedAt,
          updatedAt,
        };
        const entry = createInspectionEntry(item, inspectionId, entryId, order);
        const reviewRouteOrder = inspection.reviewRouteOrder === undefined
          ? undefined
          : inspection.reviewRouteOrder.includes(normalizedName)
            ? [...inspection.reviewRouteOrder]
            : [...inspection.reviewRouteOrder, normalizedName];

        await this.db.entries.add(entry);
        await this.db.inspections.update(inspectionId, {
          status: "draft",
          updatedAt,
          ...(reviewRouteOrder === undefined ? {} : { reviewRouteOrder }),
        });
        return { entry, updatedAt };
      },
    );
  }

  async listGraphs(deleted: boolean): Promise<InspectionGraph[]> {
    return this.db.transaction(
      "r",
      this.db.inspections,
      this.db.entries,
      this.db.photoGroups,
      this.db.photos,
      this.db.templates,
      async () => {
        const inspections = await this.db.inspections
          .filter((inspection) => deleted ? inspection.deletedAt !== null : inspection.deletedAt === null)
          .toArray();
        const graphs = await Promise.all(inspections.map((inspection) => readGraphFromDb(this.db, inspection.id)));
        return graphs.filter((graph): graph is InspectionGraph => graph !== null)
          .sort((left, right) => right.inspection.inspectionDate.localeCompare(left.inspection.inspectionDate) || right.inspection.updatedAt.localeCompare(left.inspection.updatedAt));
      },
    );
  }

  async getReadyGraphForGeneration(id: string): Promise<InspectionGraph> {
    return this.db.transaction(
      "r",
      this.db.inspections,
      this.db.entries,
      this.db.photoGroups,
      this.db.photos,
      this.db.templates,
      async () => {
        const graph = await readGraphFromDb(this.db, id);
        if (!graph) throw new GraphIntegrityError(`巡检记录 ${id} 不存在。`);
        const errors = validateReportReadiness(graph);
        if (errors.length > 0) throw new GraphIntegrityError(errors[0].message);
        return graph;
      },
    );
  }

  async markGeneratedAfterPackaging(
    id: string,
    packagedSnapshot: InspectionGraph,
    packageBlob: Blob,
  ): Promise<InspectionGraph> {
    if (packagedSnapshot.inspection.id !== id) {
      throw new GraphIntegrityError("打包快照与巡检记录不一致。");
    }
    await assertValidDocxPackage(packageBlob);
    const packagedFingerprint = await reportSnapshotFingerprint(packagedSnapshot);
    return this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      this.db.photoGroups,
      this.db.photos,
      this.db.templates,
      async () => {
        const graph = await readGraphFromDb(this.db, id);
        if (!graph) throw new GraphIntegrityError(`巡检记录 ${id} 不存在。`);
        const errors = validateReportReadiness(graph);
        if (errors.length > 0) throw new GraphIntegrityError(errors[0].message);
        const currentFingerprint = await Dexie.waitFor(reportSnapshotFingerprint(graph));
        if (currentFingerprint !== packagedFingerprint) {
          throw new GraphIntegrityError("打包期间巡检内容已发生变化，请重新生成。");
        }
        const inspection = {
          ...graph.inspection,
          status: "generated" as const,
          updatedAt: new Date().toISOString(),
        };
        const { entries: _entries, ...inspectionRecord } = inspection;
        await this.db.inspections.put(inspectionRecord);
        return { ...graph, inspection };
      },
    );
  }

  async addPhotoToGoodGroup(
    entryId: string,
    photo: PhotoAsset,
    newGroupId: string,
  ): Promise<PhotoAppendResult> {
    return this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      this.db.photoGroups,
      this.db.photos,
      this.db.templates,
      async () => {
      const entry = await requireRow(
        await this.db.entries.get(entryId),
        `巡检条目 ${entryId} 不存在。`,
      );
      if (photo.inspectionId !== entry.inspectionId) {
        throw new GraphIntegrityError(`照片 ${photo.id} 的巡检记录 ID 不一致。`);
      }
      if (await this.db.photos.get(photo.id)) {
        throw new GraphIntegrityError(`照片 ${photo.id} 已存在。`);
      }

      const groups = await this.db.photoGroups.bulkGet(entry.groupIds);
      // Preserve an evaluation selected before the first photo is imported.
      const emptyEvaluationGroup = groups.findLast((group) => group && group.photoIds.length === 0);
      const activeGoodGroup = groups.findLast((group) => group?.category === "good");
      const activeGroup = emptyEvaluationGroup ?? activeGoodGroup;
      const group: PhotoGroup = activeGroup ?? {
        id: newGroupId,
        inspectionId: entry.inspectionId,
        entryId: entry.id,
        category: "good",
        description: entry.itemSnapshot.goodText,
        descriptionManuallyEdited: false,
        awardAssessment: null,
        photoIds: [],
        order: entry.groupIds.length,
      };
      if (!group.id.trim()) {
        throw new GraphIntegrityError("照片组 ID 不能为空。");
      }
      const storedPhoto: PhotoAsset = {
        ...photo,
        groupId: group.id,
        order: group.photoIds.length,
      };
      const storedGroup = { ...group, photoIds: [...group.photoIds, photo.id] };
      const storedEntry = activeGroup
        ? entry
        : { ...entry, groupIds: [...entry.groupIds, group.id] };
      await this.db.photos.add(storedPhoto);
      if (activeGroup) {
        await this.db.photoGroups.put(storedGroup);
      } else {
        await this.db.photoGroups.add(storedGroup);
      }
      if (!activeGroup) {
        await this.db.entries.put(storedEntry);
      }
      await recomputeCompletedReviewStatus(this.db, entry.inspectionId);
      return { entry: storedEntry, group: storedGroup, photo: storedPhoto };
    });
  }

  async addEvaluationGroup(
    entryId: string,
    category: PhotoCategory,
    groupId: string,
    updatedAt = new Date().toISOString(),
  ): Promise<EvaluationGroupAppendResult> {
    const parsedCategory = photoCategorySchema.safeParse(category);
    if (!parsedCategory.success) throw new GraphIntegrityError("照片组分类无效。");
    requireId(groupId, "照片组");

    return this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      this.db.photoGroups,
      async () => {
        const entry = await requireRow(
          await this.db.entries.get(entryId),
          `巡检条目 ${entryId} 不存在。`,
        );
        const inspection = await requireRow(
          await this.db.inspections.get(entry.inspectionId),
          `巡检记录 ${entry.inspectionId} 不存在。`,
        );
        if (inspection.deletedAt !== null) {
          throw new GraphIntegrityError("巡检记录已删除。");
        }
        if (await this.db.photoGroups.get(groupId)) {
          throw new GraphIntegrityError(`照片组 ${groupId} 已存在。`);
        }

        const group: PhotoGroup = {
          id: groupId,
          inspectionId: inspection.id,
          entryId: entry.id,
          category,
          description: descriptionForCategory(entry.itemSnapshot as ChecklistItem, category),
          descriptionManuallyEdited: false,
          awardAssessment: null,
          photoIds: [],
          order: entry.groupIds.length,
        };
        const storedEntry = { ...entry, groupIds: [...entry.groupIds, group.id] };
        await this.db.photoGroups.add(group);
        await this.db.entries.put(storedEntry);
        const updated = await this.db.inspections.update(inspection.id, {
          status: "draft",
          updatedAt,
        });
        if (updated !== 1) {
          throw new GraphIntegrityError(`巡检记录 ${inspection.id} 更新失败。`);
        }
        return { entry: storedEntry, group, updatedAt };
      },
    );
  }

  async replacePhoto(photo: PhotoAsset): Promise<void> {
    await this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      this.db.photoGroups,
      this.db.photos,
      this.db.templates,
      async () => {
      const existing = await requireRow(
        await this.db.photos.get(photo.id),
        `照片 ${photo.id} 不存在。`,
      );
      if (
        photo.inspectionId !== existing.inspectionId ||
        photo.groupId !== existing.groupId ||
        photo.order !== existing.order
      ) {
        throw new GraphIntegrityError(`照片 ${photo.id} 的归属或顺序不能在替换时改变。`);
      }
      await this.db.photos.put(photo);
      await recomputeCompletedReviewStatus(this.db, photo.inspectionId);
    });
  }

  async updatePhotoGroup(group: PhotoGroup): Promise<void> {
    await this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      this.db.photoGroups,
      this.db.photos,
      this.db.templates,
      async () => {
      const existing = await requireRow(
        await this.db.photoGroups.get(group.id),
        `照片组 ${group.id} 不存在。`,
      );
      if (
        group.inspectionId !== existing.inspectionId ||
        group.entryId !== existing.entryId
      ) {
        throw new GraphIntegrityError(`照片组 ${group.id} 的归属不能通过评价更新修改。`);
      }
      if (
        group.photoIds.length !== existing.photoIds.length ||
        group.photoIds.some((photoId, index) => photoId !== existing.photoIds[index])
      ) {
        throw new GraphIntegrityError("照片引用不能通过评价更新修改。");
      }
      if (group.order !== existing.order) {
        throw new GraphIntegrityError("照片组顺序不能通过评价更新修改。");
      }
      assertGroupEvaluation(group);
      await this.db.photoGroups.put({ ...group, photoIds: [...group.photoIds] });
      await recomputeCompletedReviewStatus(this.db, group.inspectionId);
    });
  }

  async updatePhotoAnnotation(photoId: string, annotationJson: string | null): Promise<void> {
    parseAnnotationJson(annotationJson);
    await this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      this.db.photoGroups,
      this.db.photos,
      this.db.templates,
      async () => {
      const photo = await requireRow(
        await this.db.photos.get(photoId),
        `照片 ${photoId} 不存在。`,
      );
      await this.db.photos.put({ ...photo, annotationJson });
      await recomputeCompletedReviewStatus(this.db, photo.inspectionId);
    });
  }

  async setInspectionStatus(id: string, status: InspectionStatus): Promise<void> {
    if (status === "generated") {
      throw new GraphIntegrityError("生成状态只能在DOCX成功后设置。");
    }
    if (status === "reviewed") {
      await this.markReviewedIfReady(id);
      return;
    }
    await this.db.transaction("rw", this.db.inspections, async () => {
      const updated = await this.db.inspections.update(id, {
        status,
        updatedAt: new Date().toISOString(),
      });
      if (updated === 0) {
        throw new GraphIntegrityError(`巡检记录 ${id} 不存在。`);
      }
    });
  }

  async markReviewedIfReady(id: string): Promise<InspectionGraph> {
    return this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      this.db.photoGroups,
      this.db.photos,
      this.db.templates,
      async () => {
        const graph = await readGraphFromDb(this.db, id);
        if (!graph) throw new GraphIntegrityError(`巡检记录 ${id} 不存在。`);
        const errors = validateReportReadiness(graph);
        if (errors.length > 0) throw new GraphIntegrityError(errors[0].message);
        const inspection = {
          ...graph.inspection,
          status: "reviewed" as const,
          updatedAt: new Date().toISOString(),
        };
        const { entries: _entries, ...inspectionRecord } = inspection;
        await this.db.inspections.put(inspectionRecord);
        return { ...graph, inspection };
      },
    );
  }

  async updateReviewSettings(
    id: string,
    templateId: string,
    templateVersion: number,
    photoLayoutModeOverride: PhotoLayoutMode | null,
    photosPerRowOverride: PhotosPerRow | null,
  ): Promise<void> {
    if (!templateId.trim() || !Number.isSafeInteger(templateVersion) || templateVersion <= 0) {
      throw new GraphIntegrityError("模板版本无效。");
    }
    if (
      photoLayoutModeOverride !== null &&
      photoLayoutModeOverride !== "adaptive" &&
      photoLayoutModeOverride !== "fixed"
    ) {
      throw new GraphIntegrityError("照片排版模式无效。");
    }
    if (
      photosPerRowOverride !== null &&
      photosPerRowOverride !== 1 &&
      photosPerRowOverride !== 2 &&
      photosPerRowOverride !== 3 &&
      photosPerRowOverride !== 4
    ) {
      throw new GraphIntegrityError("每行照片数只能为1到4张。");
    }
    await this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      this.db.photoGroups,
      this.db.photos,
      this.db.templates,
      async () => {
      const inspection = await requireRow(
        await this.db.inspections.get(id),
        `巡检记录 ${id} 不存在。`,
      );
      if (!await this.db.templates.get([templateId, templateVersion])) {
        throw new GraphIntegrityError(`模板 ${templateId} 版本 ${templateVersion} 不存在。`);
      }
      await this.db.inspections.put({
        ...inspection,
        templateId,
        templateVersion,
        photoLayoutModeOverride,
        photosPerRowOverride,
        updatedAt: new Date().toISOString(),
      });
      await recomputeCompletedReviewStatus(this.db, id);
    });
  }

  async reorderGroups(inspectionId: string, orderedGroupIds: string[]): Promise<void> {
    requireUniqueReferences(orderedGroupIds, "照片组排序");
    await this.db.transaction("rw", this.db.inspections, this.db.entries, this.db.photoGroups, this.db.photos, this.db.templates, async () => {
      const storedGroups = await this.db.photoGroups.where("inspectionId").equals(inspectionId).toArray();
      if (storedGroups.length !== orderedGroupIds.length) {
        throw new GraphIntegrityError("照片组排序必须包含当前巡检的全部照片组。");
      }
      const byId = new Map(storedGroups.map((group) => [group.id, group]));
      const reordered = orderedGroupIds.map((id, order) => {
        const group = byId.get(id);
        if (!group) throw new GraphIntegrityError(`照片组 ${id} 不存在。`);
        return { ...group, order };
      });
      const entries = await this.db.entries.where("inspectionId").equals(inspectionId).toArray();
      const rank = new Map(orderedGroupIds.map((id, order) => [id, order]));
      await this.db.photoGroups.bulkPut(reordered);
      await this.db.entries.bulkPut(entries.map((entry) => ({
        ...entry,
        groupIds: [...entry.groupIds].sort(
          (left, right) => (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER),
        ),
      })));
      await recomputeCompletedReviewStatus(this.db, inspectionId);
    });
  }

  async moveGroupToCategory(
    inspectionId: string,
    groupId: string,
    category: PhotoCategory,
    orderedGroupIds: string[],
  ): Promise<void> {
    requireUniqueReferences(orderedGroupIds, "照片组排序");
    await this.db.transaction("rw", this.db.inspections, this.db.entries, this.db.photoGroups, this.db.photos, this.db.templates, async () => {
      const storedGroups = await this.db.photoGroups.where("inspectionId").equals(inspectionId).toArray();
      if (storedGroups.length !== orderedGroupIds.length) {
        throw new GraphIntegrityError("照片组排序必须包含当前巡检的全部照片组。");
      }
      const entries = await this.db.entries.where("inspectionId").equals(inspectionId).toArray();
      const entryById = new Map(entries.map((entry) => [entry.id, entry]));
      const byId = new Map(storedGroups.map((group) => [group.id, group]));
      const reordered = orderedGroupIds.map((id, order) => {
        const group = byId.get(id);
        if (!group) throw new GraphIntegrityError(`照片组 ${id} 不存在。`);
        if (id !== groupId) return { ...group, order };
        const entry = entryById.get(group.entryId);
        if (!entry) throw new GraphIntegrityError(`巡检条目 ${group.entryId} 不存在。`);
        return {
          ...group,
          category,
          description: descriptionForCategory(entry.itemSnapshot as ChecklistItem, category),
          descriptionManuallyEdited: false,
          awardAssessment: null,
          order,
        };
      });
      if (!byId.has(groupId)) throw new GraphIntegrityError(`照片组 ${groupId} 不存在。`);
      const rank = new Map(orderedGroupIds.map((id, order) => [id, order]));
      await this.db.photoGroups.bulkPut(reordered);
      await this.db.entries.bulkPut(entries.map((entry) => ({
        ...entry,
        groupIds: [...entry.groupIds].sort(
          (left, right) => (rank.get(left) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right) ?? Number.MAX_SAFE_INTEGER),
        ),
      })));
      await recomputeCompletedReviewStatus(this.db, inspectionId);
    });
  }

  async reorderPhotos(groupId: string, orderedPhotoIds: string[]): Promise<void> {
    requireUniqueReferences(orderedPhotoIds, "照片排序");
    await this.db.transaction("rw", this.db.inspections, this.db.entries, this.db.photoGroups, this.db.photos, this.db.templates, async () => {
      const group = await requireRow(
        await this.db.photoGroups.get(groupId),
        `照片组 ${groupId} 不存在。`,
      );
      if (
        group.photoIds.length !== orderedPhotoIds.length ||
        orderedPhotoIds.some((id) => !group.photoIds.includes(id))
      ) {
        throw new GraphIntegrityError("照片排序必须包含照片组的全部照片。");
      }
      await this.persistPhotoOrders(orderedPhotoIds);
      await this.db.photoGroups.put({ ...group, photoIds: [...orderedPhotoIds] });
      await recomputeCompletedReviewStatus(this.db, group.inspectionId);
    });
  }

  async moveToTrash(id: string, deletedAt: string): Promise<void> {
    await this.updateDeletedAt(id, deletedAt);
  }

  async restore(id: string): Promise<void> {
    await this.updateDeletedAt(id, null);
  }

  private async updateDeletedAt(id: string, deletedAt: string | null): Promise<void> {
    await this.db.transaction("rw", this.db.inspections, async () => {
      const updated = await this.db.inspections.update(id, { deletedAt });
      if (updated === 0) {
        throw new GraphIntegrityError(`巡检记录 ${id} 不存在。`);
      }
    });
  }

  async movePhoto(photoId: string, targetGroupId: string): Promise<void> {
    await this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      this.db.photoGroups,
      this.db.photos,
      this.db.templates,
      async () => {
      const photo = await requireRow(
        await this.db.photos.get(photoId),
        `照片 ${photoId} 不存在。`,
      );
      if (photo.groupId === targetGroupId) {
        return;
      }

      const source = await requireRow(
        await this.db.photoGroups.get(photo.groupId),
        `照片 ${photoId} 的原照片组不存在。`,
      );
      const target = await requireRow(
        await this.db.photoGroups.get(targetGroupId),
        `目标照片组 ${targetGroupId} 不存在。`,
      );
      if (source.inspectionId !== target.inspectionId || photo.inspectionId !== target.inspectionId) {
        throw new GraphIntegrityError("照片不能移动到其他巡检记录的照片组。");
      }
      if (!source.photoIds.includes(photoId) || target.photoIds.includes(photoId)) {
        throw new GraphIntegrityError(`照片 ${photoId} 的照片组引用不一致。`);
      }

      const sourcePhotoIds = source.photoIds.filter((id) => id !== photoId);
      const targetPhotoIds = [...target.photoIds, photoId];
      const sourceEntry = await requireRow(
        await this.db.entries.get(source.entryId),
        `巡检条目 ${source.entryId} 不存在。`,
      );
      const targetEntry =
        source.entryId === target.entryId
          ? sourceEntry
          : await requireRow(
              await this.db.entries.get(target.entryId),
              `巡检条目 ${target.entryId} 不存在。`,
            );

      if (sourcePhotoIds.length === 0) {
        await this.db.photoGroups.delete(source.id);
      } else {
        await this.db.photoGroups.put({ ...source, photoIds: sourcePhotoIds });
      }
      await this.db.photoGroups.put({ ...target, photoIds: targetPhotoIds });
      await this.db.photos.put({ ...photo, groupId: target.id, order: targetPhotoIds.length - 1 });
      await this.persistPhotoOrders(sourcePhotoIds);
      await this.persistPhotoOrders(targetPhotoIds);

      const sourceGroupIds =
        sourcePhotoIds.length === 0
          ? sourceEntry.groupIds.filter((groupId) => groupId !== source.id)
          : [...sourceEntry.groupIds];
      if (source.entryId === target.entryId) {
        const groupIds = sourceGroupIds.includes(target.id)
          ? sourceGroupIds
          : [...sourceGroupIds, target.id];
        await this.db.entries.put({ ...sourceEntry, groupIds });
      } else {
        await this.db.entries.put({ ...sourceEntry, groupIds: sourceGroupIds });
        await this.db.entries.put({
          ...targetEntry,
          groupIds: targetEntry.groupIds.includes(target.id)
            ? [...targetEntry.groupIds]
            : [...targetEntry.groupIds, target.id],
        });
      }
      await recomputeCompletedReviewStatus(this.db, photo.inspectionId);
    });
  }

  async splitPhoto(photoId: string, createdGroup: PhotoGroup): Promise<void> {
    await this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      this.db.photoGroups,
      this.db.photos,
      this.db.templates,
      async () => {
      const photo = await requireRow(
        await this.db.photos.get(photoId),
        `照片 ${photoId} 不存在。`,
      );
      const source = await requireRow(
        await this.db.photoGroups.get(photo.groupId),
        `照片 ${photoId} 的原照片组不存在。`,
      );
      const entry = await requireRow(
        await this.db.entries.get(source.entryId),
        `巡检条目 ${source.entryId} 不存在。`,
      );
      if (source.photoIds.length <= 1) {
        throw new GraphIntegrityError("单照片组不能拆分，请直接修改分类。");
      }
      if (!source.photoIds.includes(photoId)) {
        throw new GraphIntegrityError(`照片 ${photoId} 不在原照片组中。`);
      }
      if (
        createdGroup.inspectionId !== source.inspectionId ||
        createdGroup.entryId !== source.entryId ||
        createdGroup.photoIds.length !== 1 ||
        createdGroup.photoIds[0] !== photoId
      ) {
        throw new GraphIntegrityError("新照片组与待拆分照片的结构不一致。");
      }

      const sourcePhotoIds = source.photoIds.filter((id) => id !== photoId);
      const sourceIndex = entry.groupIds.indexOf(source.id);
      const groupIds = [...entry.groupIds];
      groupIds.splice(sourceIndex + 1, 0, createdGroup.id);

      if (await this.db.photoGroups.get(createdGroup.id)) {
        throw new GraphIntegrityError(`照片组 ${createdGroup.id} 已存在。`);
      }
      const existingGroups = await this.db.photoGroups.bulkGet(entry.groupIds);
      const existingById = new Map(
        existingGroups.filter((group): group is PhotoGroup => Boolean(group))
          .map((group) => [group.id, group]),
      );
      const reorderedGroups = groupIds.map((groupId, order) => {
        if (groupId === source.id) return { ...source, photoIds: sourcePhotoIds, order };
        if (groupId === createdGroup.id) return { ...createdGroup, order };
        const existing = existingById.get(groupId);
        if (!existing) {
          throw new GraphIntegrityError(`照片组 ${groupId} 不存在。`);
        }
        return { ...existing, order };
      });

      await this.db.photoGroups.bulkPut(reorderedGroups);
      await this.db.photos.put({ ...photo, groupId: createdGroup.id, order: 0 });
      await this.persistPhotoOrders(sourcePhotoIds);
      await this.db.entries.put({ ...entry, groupIds });
      await recomputeCompletedReviewStatus(this.db, photo.inspectionId);
    });
  }

  async deletePhoto(photoId: string): Promise<void> {
    await this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      this.db.photoGroups,
      this.db.photos,
      this.db.templates,
      async () => {
      const photo = await requireRow(
        await this.db.photos.get(photoId),
        `照片 ${photoId} 不存在。`,
      );
      const group = await requireRow(
        await this.db.photoGroups.get(photo.groupId),
        `照片 ${photoId} 的照片组不存在。`,
      );
      if (!group.photoIds.includes(photoId)) {
        throw new GraphIntegrityError(`照片组 ${group.id} 未引用照片 ${photoId}。`);
      }

      const photoIds = group.photoIds.filter((id) => id !== photoId);
      await this.db.photos.delete(photoId);
      if (photoIds.length > 0) {
        await this.db.photoGroups.put({ ...group, photoIds });
        await this.persistPhotoOrders(photoIds);
        await recomputeCompletedReviewStatus(this.db, photo.inspectionId);
        return;
      }

      const entry = await requireRow(
        await this.db.entries.get(group.entryId),
        `巡检条目 ${group.entryId} 不存在。`,
      );
      await this.db.photoGroups.delete(group.id);
      await this.db.entries.put({
        ...entry,
        groupIds: entry.groupIds.filter((groupId) => groupId !== group.id),
      });
      await recomputeCompletedReviewStatus(this.db, photo.inspectionId);
    });
  }

  async purgeInspection(id: string): Promise<void> {
    await this.db.transaction(
      "rw",
      this.db.inspections,
      this.db.entries,
      this.db.photoGroups,
      this.db.photos,
      async () => {
        const inspection = await this.db.inspections.get(id);
        if (!inspection) {
          throw new GraphIntegrityError(`巡检记录 ${id} 不存在。`);
        }
        if (inspection.deletedAt === null) {
          throw new GraphIntegrityError(`巡检记录 ${id} 未移入回收站，不能彻底删除。`);
        }
        await this.db.entries.where("inspectionId").equals(id).delete();
        await this.db.photoGroups.where("inspectionId").equals(id).delete();
        await this.db.photos.where("inspectionId").equals(id).delete();
        await this.db.inspections.delete(id);
      },
    );
  }

  private async persistPhotoOrders(photoIds: string[]): Promise<void> {
    const photos = await this.db.photos.bulkGet(photoIds);
    const reordered: PhotoAsset[] = photos.map((photo, index) => {
      if (!photo) {
        throw new GraphIntegrityError(`照片 ${photoIds[index]} 不存在。`);
      }
      return { ...photo, order: index };
    });
    if (reordered.length > 0) {
      await this.db.photos.bulkPut(reordered);
    }
  }
}
