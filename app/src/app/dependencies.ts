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
  good: "????",
  general: "????",
  reminder: "????",
  assessment: "????",
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
  name: "????",
  titlePattern: "{date}7S????",
  openingText: "???????????",
  requirements: ["???????????"],
  closingText: "???????????????7S???",
  organizationName: "??????????",
  bodyFont: "??",
  headingFont: "??",
  titleFont: "???????",
  bodyFontSizePt: 12,
  titleFontSizePt: 18,
  lineSpacing: 1.5,
  firstLineIndentChars: 2,
  marginMm: { top: 20, right: 20, bottom: 20, left: 20 },
  photoLayoutMode: "fixed",
  photosPerRow: 3,
  sections: [
    { category: "good", title: "????", order: 0 },
    { category: "reminder", title: "????", order: 1 },
    { category: "assessment", title: "????", order: 2 },
  ],
  photoGapPt: 6,
  signatureDatePattern: "YYYY?M?D?",
};

const formalReportTemplate: ReportTemplate = {
  id: "template-default",
  version: 2,
  name: "????????",
  titlePattern: "??????????M?D??7S?????",
  openingText: "??????????????????????????????????????????????????????????????????7S????????????????????????????????????????????????????7S??????????????????????????????????????????????????????????????????????????",
  generalHeading: "???7S?????????",
  requirements: [
    "??????????????????7S???????????????",
    "???????????????????",
    "???????????????????",
    "????????????????????????",
    "?7S????????30-70????????????30-70????",
    "?????????????????????????????????",
    "?????????????????????",
    "???????????????????????????????????????????????????????????????",
    "??????????????????????????????????",
    "????????????????????????????",
  ],
  situationHeading: "??????????",
  closingText: "???????????7S????????????????????????????????????????????????????????",
  organizationName: "??????????",
  bodyFont: "??",
  headingFont: "??",
  titleFont: "???????",
  bodyFontSizePt: defaultReportTemplate.bodyFontSizePt,
  titleFontSizePt: defaultReportTemplate.titleFontSizePt,
  lineSpacing: defaultReportTemplate.lineSpacing,
  firstLineIndentChars: 2,
  marginMm: { top: 20, right: 22, bottom: 20, left: 22 },
  photoLayoutMode: "fixed",
  photosPerRow: 3,
  sections: [
    { category: "good", title: "????", order: 0 },
    { category: "reminder", title: "????", order: 1 },
    { category: "assessment", title: "????", order: 2 },
  ],
  photoGapPt: defaultReportTemplate.photoGapPt,
  signatureDatePattern: defaultReportTemplate.signatureDatePattern,
};

const fourCategoryFormalReportTemplate: ReportTemplate = {
  ...formalReportTemplate,
  version: 3,
  sections: [
    { category: "good", title: "????", order: 0 },
    { category: "general", title: "????", order: 1 },
    { category: "reminder", title: "????", order: 2 },
    { category: "assessment", title: "????", order: 3 },
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
