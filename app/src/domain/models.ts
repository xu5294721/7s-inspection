export type PhotoCategory = "good" | "general" | "reminder" | "assessment";

export type ReviewRouteOrderByCategory = Partial<Record<PhotoCategory, string[]>>;

export type InspectionStatus = "draft" | "reviewed" | "generated";

export type PhotoLayoutMode = "adaptive" | "fixed";

export type PhotosPerRow = 1 | 2 | 3 | 4;

export type InspectionCheckCategory = string;

export interface InspectionCheckSelection {
  category: InspectionCheckCategory;
  categoryLabel?: string;
  value: string;
  isCustom: boolean;
}

export interface InspectionCheckTemplateDefinition {
  category: InspectionCheckCategory;
  label: string;
  options: readonly string[];
  defaultValue?: string;
}

export interface InspectionCheckTemplate {
  id: string;
  name: string;
  definitions: InspectionCheckTemplateDefinition[];
  itemOverrides: Record<string, InspectionCheckTemplateDefinition[]>;
  updatedAt: string;
}

export type SevenSCategory = "??" | "??" | "??" | "??" | "??" | "??" | "??" | "";

export interface ChecklistItem {
  id: string;
  routeOrder: number;
  routeName: string;
  area: string;
  device: string;
  part: string;
  standard: string;
  team: string;
  sevenSCategory: SevenSCategory;
  goodText: string;
  generalText?: string;
  reminderText: string;
  assessmentText: string;
  quickPhrases: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InspectionRouteTemplate {
  id: string;
  name: string;
  itemIds: string[];
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AwardAssessment {
  type: "reward" | "assessment";
  people: string;
  amount: number;
}

export interface PhotoAsset {
  id: string;
  inspectionId: string;
  groupId: string;
  capturedAt: string;
  order: number;
  imageBlob: Blob;
  thumbnailBlob: Blob;
  width: number;
  height: number;
  highQuality: boolean;
  annotationJson: string | null;
}

export interface PhotoGroup {
  id: string;
  inspectionId: string;
  entryId: string;
  category: PhotoCategory;
  description: string;
  descriptionManuallyEdited?: boolean;
  awardAssessment: AwardAssessment | null;
  photoIds: string[];
  order: number;
}

export interface ItemSnapshot extends Omit<ChecklistItem, "enabled" | "createdAt" | "updatedAt"> {}

export interface InspectionEntry {
  id: string;
  inspectionId: string;
  itemId: string;
  itemSnapshot: ItemSnapshot;
  checkSelections: InspectionCheckSelection[];
  groupIds: string[];
  order: number;
}

export interface Inspection {
  id: string;
  inspectionDate: string;
  title: string;
  templateId: string;
  templateVersion: number;
  photoLayoutModeOverride: PhotoLayoutMode | null;
  photosPerRowOverride: PhotosPerRow | null;
  reviewRouteOrder?: string[];
  reviewRouteOrderByCategory?: ReviewRouteOrderByCategory;
  status: InspectionStatus;
  entries: InspectionEntry[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ReportSection {
  category: PhotoCategory;
  title: string;
  order: number;
}

export type ReportTemplateKey = readonly [id: string, version: number];

export interface ReportTemplate {
  readonly id: string;
  readonly version: number;
  name: string;
  titlePattern: string;
  openingText: string;
  generalHeading?: string;
  requirements: string[];
  situationHeading?: string;
  closingText: string;
  organizationName: string;
  bodyFont: string;
  headingFont: string;
  titleFont: string;
  bodyFontSizePt: number;
  titleFontSizePt: number;
  lineSpacing: number;
  firstLineIndentChars: number;
  marginMm: { top: number; right: number; bottom: number; left: number };
  photoLayoutMode: PhotoLayoutMode;
  photosPerRow: PhotosPerRow;
  sections: ReportSection[];
  photoGapPt: number;
  signatureDatePattern: string;
}

export interface InspectionGraph {
  inspection: Inspection;
  groups: PhotoGroup[];
  photos: PhotoAsset[];
  template?: ReportTemplate;
}

export interface ReportValidationError {
  groupId: string | null;
  field: string;
  code: string;
  message: string;
}
