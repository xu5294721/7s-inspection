import Dexie, { type Table } from "dexie";
import type {
  ChecklistItem,
  Inspection,
  InspectionEntry,
  InspectionRouteTemplate,
  PhotoAsset,
  PhotoGroup,
  ReportTemplate,
  ReportTemplateKey,
} from "../domain/models";

export type InspectionRecord = Omit<Inspection, "entries">;

export interface SettingsRecord {
  key: string;
  value: unknown;
  updatedAt: string;
}

export class SevenSDb extends Dexie {
  checklistItems!: Table<ChecklistItem, string>;
  inspections!: Table<InspectionRecord, string>;
  entries!: Table<InspectionEntry, string>;
  photoGroups!: Table<PhotoGroup, string>;
  photos!: Table<PhotoAsset, string>;
  templates!: Table<ReportTemplate, ReportTemplateKey>;
  routeTemplates!: Table<InspectionRouteTemplate, string>;
  settings!: Table<SettingsRecord, string>;

  constructor(name = "seven-s") {
    super(name);
    this.version(1).stores({
      checklistItems: "id, routeOrder, routeName, area, device, enabled, updatedAt",
      inspections: "id, inspectionDate, status, updatedAt, deletedAt",
      entries: "id, inspectionId, itemId, [inspectionId+order]",
      photoGroups: "id, inspectionId, entryId, category, [inspectionId+order]",
      photos: "id, inspectionId, groupId, [groupId+order], capturedAt",
      templates: "[id+version], id, version, name",
      settings: "key",
    });
    this.version(2).stores({
      checklistItems: "id, routeOrder, routeName, area, device, enabled, updatedAt",
      inspections: "id, inspectionDate, status, updatedAt, deletedAt",
      entries: "id, inspectionId, itemId, [inspectionId+order]",
      photoGroups: "id, inspectionId, entryId, category, [inspectionId+order]",
      photos: "id, inspectionId, groupId, [groupId+order], capturedAt",
      templates: "[id+version], id, version, name",
      routeTemplates: "id, &name, isDefault, updatedAt",
      settings: "key",
    });
  }
}

export function createTestDb(name: string): SevenSDb {
  return new SevenSDb(`seven-s-test-${name}`);
}
