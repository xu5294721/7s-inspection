import { toInspectionTimestamp } from "../lib/dates";
import type {
  ChecklistItem,
  Inspection,
  InspectionEntry,
  ItemSnapshot,
  PhotoCategory,
  PhotoGroup,
} from "./models";

export type AnnotationShape =
  | {
      type: "ellipse";
      x: number;
      y: number;
      width: number;
      height: number;
      color: "#d12f2f";
    }
  | { type: "arrow"; points: number[]; color: "#d12f2f" }
  | { type: "text"; x: number; y: number; text: string; color: "#d12f2f" };

function isNormalized(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function requireNormalized(value: unknown): asserts value is number {
  if (!isNormalized(value)) {
    throw new Error("标注坐标必须在0到1之间");
  }
}

function parseAnnotationShape(value: unknown): AnnotationShape {
  if (!value || typeof value !== "object") {
    throw new Error("标注数据格式无效");
  }
  const shape = value as Record<string, unknown>;
  if (shape.color !== "#d12f2f") {
    throw new Error("标注颜色无效");
  }
  if (shape.type === "ellipse") {
    requireNormalized(shape.x);
    requireNormalized(shape.y);
    requireNormalized(shape.width);
    requireNormalized(shape.height);
    if (shape.x + shape.width > 1 || shape.y + shape.height > 1) {
      throw new Error("椭圆标注不能超出照片边界");
    }
    return {
      type: "ellipse",
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
      color: shape.color,
    };
  }
  if (shape.type === "arrow") {
    if (!Array.isArray(shape.points) || shape.points.length !== 4) {
      throw new Error("箭头标注必须包含起点和终点");
    }
    shape.points.forEach(requireNormalized);
    return { type: "arrow", points: [...shape.points], color: shape.color };
  }
  if (shape.type === "text") {
    requireNormalized(shape.x);
    requireNormalized(shape.y);
    if (typeof shape.text !== "string" || !shape.text.trim()) {
      throw new Error("文字标注不能为空");
    }
    return { type: "text", x: shape.x, y: shape.y, text: shape.text, color: shape.color };
  }
  throw new Error("标注类型无效");
}

export function parseAnnotationJson(annotationJson: string | null): AnnotationShape[] {
  if (!annotationJson) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(annotationJson);
  } catch {
    throw new Error("标注数据不是有效JSON");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("标注数据必须是数组");
  }
  return parsed.map(parseAnnotationShape);
}

export function serializeAnnotationShapes(shapes: AnnotationShape[]): string | null {
  if (shapes.length === 0) return null;
  const normalized = shapes.map(parseAnnotationShape);
  return JSON.stringify(normalized);
}

export function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function snapshotItem(item: ChecklistItem): ItemSnapshot {
  const { enabled: _enabled, createdAt: _createdAt, updatedAt: _updatedAt, ...snapshot } = item;

  return {
    ...snapshot,
    quickPhrases: [...snapshot.quickPhrases],
  };
}

export function descriptionForCategory(item: ChecklistItem, category: PhotoCategory): string {
  if (category === "general") {
    return item.generalText?.trim() || defaultGeneralText(item);
  }

  if (category === "reminder") {
    return item.reminderText;
  }

  if (category === "assessment") {
    return item.assessmentText;
  }

  return item.goodText;
}

export function defaultGeneralText(item: Pick<ChecklistItem, "routeName" | "part">): string {
  return `${item.part}7S管理基本落实，但现场标准仍有提升空间。`;
}

export function createInspectionEntry(
  item: ChecklistItem,
  inspectionId: string,
  entryId: string,
  order: number,
): InspectionEntry {
  return {
    id: entryId,
    inspectionId,
    itemId: item.id,
    itemSnapshot: snapshotItem(item),
    checkSelections: [],
    groupIds: [],
    order,
  };
}

export function createInspection(
  items: ChecklistItem[],
  inspectionId: string,
  inspectionDate: string,
): Inspection {
  const timestamp = toInspectionTimestamp(inspectionDate);
  const entries = items.map((item, index) => createInspectionEntry(
    item,
    inspectionId,
    `${inspectionId}-entry-${item.id}`,
    index,
  ));

  return {
    id: inspectionId,
    inspectionDate,
    title: formatInspectionTitle(inspectionDate),
    templateId: "template-default",
    templateVersion: 2,
    photoLayoutModeOverride: null,
    photosPerRowOverride: null,
    reviewRouteOrder: [...new Set(entries.map((entry) => entry.itemSnapshot.routeName))],
    status: "draft",
    entries,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

export function formatInspectionTitle(inspectionDate: string): string {
  const [, month, day] = inspectionDate.split("-").map(Number);
  return `向塘钢轨焊接整修车间${month}月${day}日7S巡检通报`;
}

export function createPhotoGroup(
  item: ChecklistItem,
  inspectionId: string,
  entryId: string,
  photoIds: string[],
  groupId: string,
): PhotoGroup {
  return {
    id: groupId,
    inspectionId,
    entryId,
    category: "good",
    description: item.goodText,
    descriptionManuallyEdited: false,
    awardAssessment: null,
    photoIds: [...photoIds],
    order: 0,
  };
}

export function changePhotoGroupCategory(
  group: PhotoGroup,
  category: PhotoCategory,
  item: ChecklistItem,
): PhotoGroup {
  return {
    ...group,
    category,
    description: descriptionForCategory(item, category),
    descriptionManuallyEdited: false,
    awardAssessment: category === group.category ? group.awardAssessment : null,
    photoIds: [...group.photoIds],
  };
}

export function splitPhotoIntoGroup(
  source: PhotoGroup,
  photoId: string,
  category: PhotoCategory,
  item: ChecklistItem,
  createdGroupId: string,
): { source: PhotoGroup; created: PhotoGroup } {
  if (source.photoIds.length <= 1) {
    throw new Error("单照片组不能拆分，请直接修改分类。");
  }

  if (!source.photoIds.includes(photoId)) {
    throw new Error("待拆分照片不在原照片组中。");
  }

  return {
    source: {
      ...source,
      photoIds: source.photoIds.filter((id) => id !== photoId),
    },
    created: {
      ...source,
      id: createdGroupId,
      category,
      description: descriptionForCategory(item, category),
      descriptionManuallyEdited: false,
      awardAssessment: null,
      photoIds: [photoId],
      order: source.order + 1,
    },
  };
}
