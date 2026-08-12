import { SevenSDb } from "../db/database";
import {
  BackupRepository,
  type BackupPreview,
  type BackupReminderState,
  type PersistentStorageStatus,
  type RestoreMode,
  type RestoreResult,
} from "../db/backupRepository";
import {
  InspectionRepository,
  type EvaluationGroupAppendResult,
  type InspectionCheckSelectionUpdateResult,
  type PhotoAppendResult,
  type TemporaryEntryAppendResult,
} from "../db/inspectionRepository";
import { ItemRepository } from "../db/itemRepository";
import { RouteTemplateRepository } from "../db/routeTemplateRepository";
import { TemplateRepository } from "../db/templateRepository";
import { InspectionCheckTemplateRepository } from "../db/inspectionCheckTemplateRepository";
import type {
  ChecklistItem,
  Inspection,
  InspectionGraph,
  InspectionCheckSelection,
  InspectionRouteTemplate,
  PhotoAsset,
  PhotoCategory,
  PhotoLayoutMode,
  PhotoGroup,
  PhotosPerRow,
  ReportSection,
  ReportTemplate,
  InspectionCheckTemplate,
} from "../domain/models";
import type { ReportProgress } from "../features/reports/generateDocx";
import type { GeneratedReport } from "../features/reports/reportGenerationService";
import { downloadReport, shareOrDownloadReport, type ReportOutputResult } from "../features/reports/reportOutput";
import { createBrowserUuid } from "../lib/ids";
import { ensureRouteCatalog } from "./routeCatalogMigration";

export interface ItemRepositoryPort {
  listEnabled(): Promise<ChecklistItem[]>;
  listAll(): Promise<ChecklistItem[]>;
  get(id: string): Promise<ChecklistItem | undefined>;
  put(item: ChecklistItem): Promise<void>;
  bulkPut(items: ChecklistItem[]): Promise<void>;
  disable(id: string, updatedAt?: string): Promise<void>;
  seedIfEmpty(items: ChecklistItem[]): Promise<boolean>;
}

export interface InspectionRepositoryPort {
  saveGraph(graph: InspectionGraph): Promise<void>;
  addTemporaryEntry(
    inspectionId: string,
    name: string,
    entryId: string,
    itemId: string,
    updatedAt?: string,
  ): Promise<TemporaryEntryAppendResult>;
  updateEntryCheckSelections(
    inspectionId: string,
    entryId: string,
    selections: readonly InspectionCheckSelection[],
    updatedAt?: string,
  ): Promise<InspectionCheckSelectionUpdateResult>;
  removeEntryFromInspection(
    inspectionId: string,
    entryId: string,
    updatedAt?: string,
  ): Promise<void>;
  getGraph(id: string): Promise<InspectionGraph | null>;
  listGraphs(deleted: boolean): Promise<InspectionGraph[]>;
  moveToTrash(id: string, deletedAt: string): Promise<void>;
  restore(id: string): Promise<void>;
  purgeInspection(id: string): Promise<void>;
  addPhotoToGoodGroup(
    entryId: string,
    photo: PhotoAsset,
    newGroupId: string,
  ): Promise<PhotoAppendResult>;
  addEvaluationGroup(
    entryId: string,
    category: PhotoCategory,
    groupId: string,
    updatedAt?: string,
  ): Promise<EvaluationGroupAppendResult>;
  replacePhoto(photo: PhotoAsset): Promise<void>;
  deletePhoto(photoId: string): Promise<void>;
  updatePhotoGroup(group: PhotoGroup): Promise<void>;
  splitPhoto(photoId: string, createdGroup: PhotoGroup): Promise<void>;
  updatePhotoAnnotation(photoId: string, annotationJson: string | null): Promise<void>;
  reorderGroups(inspectionId: string, orderedGroupIds: string[]): Promise<void>;
  moveGroupToCategory(inspectionId: string, groupId: string, category: import("../domain/models").PhotoCategory, orderedGroupIds: string[]): Promise<void>;
  reorderPhotos(groupId: string, orderedPhotoIds: string[]): Promise<void>;
  markReviewedIfReady(id: string): Promise<InspectionGraph>;
  setInspectionStatus(id: string, status: import("../domain/models").InspectionStatus): Promise<void>;
  updateReviewSettings(
    id: string,
    templateId: string,
    templateVersion: number,
    photoLayoutModeOverride: PhotoLayoutMode | null,
    photosPerRowOverride: PhotosPerRow | null,
  ): Promise<void>;
  updateReviewRouteOrder(id: string, routeNames: string[]): Promise<Inspection>;
  updateReviewRouteOrderByCategory(
    id: string,
    routeOrderByCategory: import("../domain/models").ReviewRouteOrderByCategory,
  ): Promise<Inspection>;
}

export interface TemplateRepositoryPort {
  listVersions(id: string): Promise<ReportTemplate[]>;
  getLatest(id: string): Promise<ReportTemplate | undefined>;
  save(template: ReportTemplate): Promise<void>;
  seedIfMissing(template: ReportTemplate): Promise<boolean>;
}

export interface InspectionCheckTemplateRepositoryPort {
  get(): Promise<InspectionCheckTemplate>;
  save(template: InspectionCheckTemplate): Promise<void>;
  updateDefinitions(definitions: InspectionCheckTemplate["definitions"], updatedAt: string): Promise<InspectionCheckTemplate>;
}

export interface RouteTemplateRepositoryPort {
  list(): Promise<InspectionRouteTemplate[]>;
  get(id: string): Promise<InspectionRouteTemplate | undefined>;
  save(template: InspectionRouteTemplate): Promise<void>;
  saveWithCustomItems(
    template: InspectionRouteTemplate,
    customItems: ChecklistItem[],
  ): Promise<{ template: InspectionRouteTemplate; items: ChecklistItem[] }>;
  remove(id: string): Promise<void>;
  addCustomItem(
    templateId: string,
    item: ChecklistItem,
  ): Promise<{ item: ChecklistItem; template: InspectionRouteTemplate }>;
}

export interface ReportGeneratorPort {
  generateReport(
    inspectionId: string,
    onProgress: (progress: ReportProgress) => void,
  ): Promise<GeneratedReport>;
  shareOrDownloadReport(blob: Blob, filename: string): Promise<ReportOutputResult>;
  downloadReport(blob: Blob, filename: string): void;
}

export interface BackupRepositoryPort {
  createBackup(): Promise<Blob>;
  createBackupToDownloads(filename: string): Promise<void>;
  inspectBackup(blob: Blob): Promise<BackupPreview>;
  restoreBackup(blob: Blob, mode: RestoreMode): Promise<RestoreResult>;
  requestPersistentStorage(): Promise<PersistentStorageStatus>;
  readStorageEstimate(): Promise<StorageEstimate | null>;
  assertCanPersistNewPhoto(): Promise<void>;
  readBackupReminder(): Promise<BackupReminderState>;
  dismissBackupReminder(milestone: number, updatedAt?: string): Promise<void>;
}

export interface AppDependencies {
  itemRepository: ItemRepositoryPort;
  routeTemplateRepository: RouteTemplateRepositoryPort;
  inspectionRepository: InspectionRepositoryPort;
  templateRepository: TemplateRepositoryPort;
  inspectionCheckTemplateRepository: InspectionCheckTemplateRepositoryPort;
  backupRepository: BackupRepositoryPort;
  reportGenerator: ReportGeneratorPort;
  createInspectionId(): string;
  now(): Date;
  initializeRouteCatalog(): Promise<void>;
}

interface DependencyOptions {
  createInspectionId?: () => string;
  now?: () => Date;
}

const DEFAULT_REPORT_TEMPLATE_ID = "template-default";
const FOUR_CATEGORY_ORDER = ["good", "general", "reminder", "assessment"] as const satisfies readonly PhotoCategory[];
const DEFAULT_PHOTO_SECTION_TITLES: Record<PhotoCategory, string> = {
  good: "好的方面",
  general: "一般表现",
  reminder: "提醒问题",
  assessment: "考核问题",
};

function isFourCategoryTemplate(template: ReportTemplate | undefined): boolean {
  if (!template || template.sections.length !== FOUR_CATEGORY_ORDER.length) return false;
  const categories = new Set(template.sections.map((section) => section.category));
  return FOUR_CATEGORY_ORDER.every((category) => categories.has(category));
}

function migrateToFourCategoryTemplate(template: ReportTemplate): ReportTemplate {
  const existingSections = new Map(template.sections.map((section) => [section.category, section]));
  const sections: ReportSection[] = FOUR_CATEGORY_ORDER.map((category, order) => ({
    category,
    title: existingSections.get(category)?.title ?? DEFAULT_PHOTO_SECTION_TITLES[category],
    order,
  }));
  return {
    ...template,
    version: template.version + 1,
    sections,
  };
}

const defaultReportTemplate: ReportTemplate = {
  id: "template-default",
  version: 1,
  name: "默认模板",
  titlePattern: "{date}7S巡检通报",
  openingText: "现将巡检情况通报如下。",
  requirements: ["请责任工班按要求整改。"],
  closingText: "请各工班举一反三，持续抓好现场7S管理。",
  organizationName: "向塘钢轨焊接整修车间",
  bodyFont: "仿宋",
  headingFont: "黑体",
  titleFont: "方正小标宋简体",
  bodyFontSizePt: 12,
  titleFontSizePt: 18,
  lineSpacing: 1.5,
  firstLineIndentChars: 2,
  marginMm: { top: 20, right: 20, bottom: 20, left: 20 },
  photoLayoutMode: "fixed",
  photosPerRow: 3,
  sections: [
    { category: "good", title: "好的方面", order: 0 },
    { category: "reminder", title: "提醒事项", order: 1 },
    { category: "assessment", title: "考核问题", order: 2 },
  ],
  photoGapPt: 6,
  signatureDatePattern: "YYYY年M月D日",
};

const formalReportTemplate: ReportTemplate = {
  id: "template-default",
  version: 2,
  name: "正式巡检通报模板",
  titlePattern: "向塘钢轨焊接整修车间M月D日“7S”巡检通报",
  openingText: "为进一步规范车间现场作业秩序，强化安全生产基础管理、环境卫生管理，提高设备保养质量。持续深化整理、整顿、清扫、清洁、素养、安全、节约7S管理落地成效，切实消除焊轨作业现场安全隐患、提升生产作业标准化水平，车间管理人员定期对生产线各岗位进行“7S”巡检，主要检查车间全区域、各生产班组、关键作业工位、设备机房环境卫生、各岗位物品定制摆放、主要设备日常保养等情况。现将本次巡检发现的问题通报如下：",
  generalHeading: "一、“7S”巡检工作总体要求",
  requirements: [
    "原则上每周二、周四下午检查上一班次“7S”工作质量，如有变化另行通知。",
    "当班人员负责本岗位的设备保养擦拭工作。",
    "设备内部空间不得留存抹布、扫把等异物。",
    "周二、周四白班各岗位应对本岗位作业区域拖地清洁。",
    "“7S”执行较好的给予30-70元奖励；执行不到位的给予30-70元考核。",
    "除锈机、精磨机内部应清扫；其它设备内部擦拭。所有设备表面均应擦拭。",
    "设备周边地面环境卫生应保持干净整洁无杂物。",
    "各岗要按迎检标准对设备进行擦拭保养、周边环境（窗台、扶手、栏杆、安全通道等进行擦拭，地面地沟要拖地，岗位周边消防器材要擦拭）。",
    "各岗位设备下班后必须关机断电、开关插座需处于关闭状态、门窗需关好等。",
    "生产线停产期间，工班长也要合理安排岗位卫生清洁保养工作。",
  ],
  situationHeading: "二、本次检查总体情况",
  closingText: "请各工班严格落实现场“7S”管理的各项要求，班前班后做好设备擦拭保养，保持工作场所干净整洁、物品定置摆放到位，持续提升现场标准化管理水平。",
  organizationName: "向塘钢轨焊接整修车间",
  bodyFont: "宋体",
  headingFont: "黑体",
  titleFont: "方正小标宋简体",
  bodyFontSizePt: defaultReportTemplate.bodyFontSizePt,
  titleFontSizePt: defaultReportTemplate.titleFontSizePt,
  lineSpacing: defaultReportTemplate.lineSpacing,
  firstLineIndentChars: 2,
  marginMm: { top: 20, right: 22, bottom: 20, left: 22 },
  photoLayoutMode: "fixed",
  photosPerRow: 3,
  sections: [
    { category: "good", title: "好的方面", order: 0 },
    { category: "reminder", title: "提醒问题", order: 1 },
    { category: "assessment", title: "考核问题", order: 2 },
  ],
  photoGapPt: defaultReportTemplate.photoGapPt,
  signatureDatePattern: defaultReportTemplate.signatureDatePattern,
};

const fourCategoryFormalReportTemplate: ReportTemplate = {
  ...formalReportTemplate,
  version: 3,
  sections: [
    { category: "good", title: "好的方面", order: 0 },
    { category: "general", title: "一般表现", order: 1 },
    { category: "reminder", title: "提醒问题", order: 2 },
    { category: "assessment", title: "考核问题", order: 3 },
  ],
};

export function createAppDependencies(
  database: SevenSDb,
  options: DependencyOptions = {},
): AppDependencies {
  const repository = new InspectionRepository(database);
  const inspectionRepository: InspectionRepositoryPort = {
    saveGraph: (graph) => repository.saveGraph(graph),
    addTemporaryEntry: (inspectionId, name, entryId, itemId, updatedAt) =>
      repository.addTemporaryEntry(inspectionId, name, entryId, itemId, updatedAt),
    updateEntryCheckSelections: (inspectionId, entryId, selections, updatedAt) =>
      repository.updateEntryCheckSelections(inspectionId, entryId, selections, updatedAt),
    removeEntryFromInspection: (inspectionId, entryId, updatedAt) =>
      repository.removeEntryFromInspection(inspectionId, entryId, updatedAt),
    getGraph: (id) => repository.getGraph(id),
    listGraphs: (deleted) => repository.listGraphs(deleted),
    moveToTrash: (id, deletedAt) => repository.moveToTrash(id, deletedAt),
    restore: (id) => repository.restore(id),
    purgeInspection: (id) => repository.purgeInspection(id),
    addPhotoToGoodGroup: (entryId, photo, newGroupId) => repository.addPhotoToGoodGroup(entryId, photo, newGroupId),
    addEvaluationGroup: (entryId, category, groupId, updatedAt) =>
      repository.addEvaluationGroup(entryId, category, groupId, updatedAt),
    replacePhoto: (photo) => repository.replacePhoto(photo),
    deletePhoto: (photoId) => repository.deletePhoto(photoId),
    updatePhotoGroup: (group) => repository.updatePhotoGroup(group),
    splitPhoto: (photoId, createdGroup) => repository.splitPhoto(photoId, createdGroup),
    updatePhotoAnnotation: (photoId, annotationJson) => repository.updatePhotoAnnotation(photoId, annotationJson),
    reorderGroups: (inspectionId, orderedGroupIds) => repository.reorderGroups(inspectionId, orderedGroupIds),
    moveGroupToCategory: (inspectionId, groupId, category, orderedGroupIds) =>
      repository.moveGroupToCategory(inspectionId, groupId, category, orderedGroupIds),
    reorderPhotos: (groupId, orderedPhotoIds) => repository.reorderPhotos(groupId, orderedPhotoIds),
    markReviewedIfReady: (id) => repository.markReviewedIfReady(id),
    setInspectionStatus: (id, status) => repository.setInspectionStatus(id, status),
    updateReviewSettings: (id, templateId, templateVersion, photoLayoutModeOverride, photosPerRowOverride) =>
      repository.updateReviewSettings(
        id,
        templateId,
        templateVersion,
        photoLayoutModeOverride,
        photosPerRowOverride,
      ),
    updateReviewRouteOrder: (id, routeNames) => repository.updateReviewRouteOrder(id, routeNames),
    updateReviewRouteOrderByCategory: (id, routeOrderByCategory) =>
      repository.updateReviewRouteOrderByCategory(id, routeOrderByCategory),
  };
  return {
    itemRepository: new ItemRepository(database),
    routeTemplateRepository: new RouteTemplateRepository(database),
    inspectionRepository,
    templateRepository: new TemplateRepository(database),
    inspectionCheckTemplateRepository: new InspectionCheckTemplateRepository(database),
    backupRepository: new BackupRepository(database),
    reportGenerator: {
      generateReport: async (inspectionId, onProgress) => {
        const [{ generateDocx }, { buildReportFilename, buildReportModel }, { generateInspectionReport }] = await Promise.all([
          import("../features/reports/generateDocx"),
          import("../features/reports/reportModel"),
          import("../features/reports/reportGenerationService"),
        ]);
        return generateInspectionReport(
          repository,
          { buildReportModel, generateDocx, buildReportFilename },
          inspectionId,
          onProgress,
        );
      },
      shareOrDownloadReport,
      downloadReport,
    },
    createInspectionId: options.createInspectionId ?? createBrowserUuid,
    now: options.now ?? (() => new Date()),
    initializeRouteCatalog: async () => {
      await ensureRouteCatalog(database);
    },
  };
}

export async function initializeApp(dependencies: AppDependencies): Promise<void> {
  await Promise.all([
    dependencies.initializeRouteCatalog(),
    dependencies.templateRepository.seedIfMissing(defaultReportTemplate),
    dependencies.templateRepository.seedIfMissing(formalReportTemplate),
    dependencies.templateRepository.seedIfMissing(fourCategoryFormalReportTemplate),
  ]);

  const templates = await dependencies.templateRepository.listVersions(DEFAULT_REPORT_TEMPLATE_ID);
  const latestTemplate = templates[0];
  if (!latestTemplate) return;

  const fourCategoryTemplate = isFourCategoryTemplate(latestTemplate)
    ? latestTemplate
    : migrateToFourCategoryTemplate(latestTemplate);
  if (fourCategoryTemplate !== latestTemplate) {
    await dependencies.templateRepository.seedIfMissing(fourCategoryTemplate);
  }

  const activeInspections = await dependencies.inspectionRepository.listGraphs(false);
  const currentTemplate = fourCategoryTemplate === latestTemplate
    ? latestTemplate
    : (await dependencies.templateRepository.getLatest(DEFAULT_REPORT_TEMPLATE_ID)) ?? fourCategoryTemplate;
  await Promise.all(activeInspections
    .filter((graph) =>
      graph.inspection.status !== "generated" &&
      graph.inspection.templateId === currentTemplate.id &&
      !isFourCategoryTemplate(graph.template),
    )
    .map((graph) => dependencies.inspectionRepository.updateReviewSettings(
      graph.inspection.id,
      currentTemplate.id,
      currentTemplate.version,
      graph.inspection.photoLayoutModeOverride,
      graph.inspection.photosPerRowOverride,
    )));
}
