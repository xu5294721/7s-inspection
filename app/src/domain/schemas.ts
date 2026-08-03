import { z } from "zod";
import { DEFAULT_ROUTE_TEMPLATE_NAME } from "./routeNames";

export const photoCategorySchema = z.enum(["good", "general", "reminder", "assessment"]);
const reviewRouteOrderByCategorySchema = z.object({
  good: z.array(z.string().trim().min(1)).optional(),
  general: z.array(z.string().trim().min(1)).optional(),
  reminder: z.array(z.string().trim().min(1)).optional(),
  assessment: z.array(z.string().trim().min(1)).optional(),
});
export const inspectionStatusSchema = z.enum(["draft", "reviewed", "generated"]);
export const photoLayoutModeSchema = z.enum(["adaptive", "fixed"]);
const photosPerRowSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);
export const inspectionCheckCategorySchema = z.enum(["environment", "placement", "equipment", "safety"]);
export const inspectionCheckSelectionSchema = z.object({
  category: inspectionCheckCategorySchema,
  value: z.string(),
  isCustom: z.boolean(),
});
export const sevenSCategorySchema = z.enum(["整理", "整顿", "清扫", "清洁", "素养", "安全", "节约", ""]);

export const checklistItemSchema = z.object({
  id: z.string().min(1),
  routeOrder: z.number().int().nonnegative(),
  routeName: z.string(),
  area: z.string(),
  device: z.string(),
  part: z.string(),
  standard: z.string(),
  team: z.string(),
  sevenSCategory: sevenSCategorySchema,
  goodText: z.string(),
  generalText: z.string().optional(),
  reminderText: z.string(),
  assessmentText: z.string(),
  quickPhrases: z.array(z.string()),
  enabled: z.boolean(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const inspectionRouteTemplateSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().trim().min(1),
    itemIds: z.array(z.string().min(1)).min(1),
    isDefault: z.boolean(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .superRefine((value, context) => {
    if (new Set(value.itemIds).size !== value.itemIds.length) {
      context.addIssue({
        code: "custom",
        path: ["itemIds"],
        message: "模板项目不能重复。",
      });
    }
    if (value.isDefault && value.name !== DEFAULT_ROUTE_TEMPLATE_NAME) {
      context.addIssue({
        code: "custom",
        path: ["name"],
        message: `默认模板名称必须为“${DEFAULT_ROUTE_TEMPLATE_NAME}”。`,
      });
    }
  });

export const itemSnapshotSchema = checklistItemSchema.omit({
  enabled: true,
  createdAt: true,
  updatedAt: true,
});

export const inspectionEntrySchema = z.object({
  id: z.string().min(1),
  inspectionId: z.string().min(1),
  itemId: z.string().min(1),
  itemSnapshot: itemSnapshotSchema,
  checkSelections: z.array(inspectionCheckSelectionSchema).default([]),
  groupIds: z.array(z.string().min(1)),
  order: z.number().int().nonnegative(),
});

export const inspectionRecordSchema = z.object({
  id: z.string().min(1),
  inspectionDate: z.string().min(1),
  title: z.string().min(1),
  templateId: z.string().min(1),
  templateVersion: z.number().int().positive(),
  photoLayoutModeOverride: photoLayoutModeSchema.nullable().default(null),
  photosPerRowOverride: photosPerRowSchema.nullable(),
  reviewRouteOrder: z.array(z.string().trim().min(1)).optional(),
  reviewRouteOrderByCategory: reviewRouteOrderByCategorySchema.optional(),
  status: inspectionStatusSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  deletedAt: z.union([z.string().min(1), z.null()]),
}).superRefine((inspection, context) => {
  if (
    inspection.reviewRouteOrder &&
    new Set(inspection.reviewRouteOrder).size !== inspection.reviewRouteOrder.length
  ) {
    context.addIssue({
      code: "custom",
      path: ["reviewRouteOrder"],
      message: "巡检项点排序不能重复。",
    });
  }
  for (const [category, routeNames] of Object.entries(inspection.reviewRouteOrderByCategory ?? {})) {
    if (routeNames && new Set(routeNames).size !== routeNames.length) {
      context.addIssue({
        code: "custom",
        path: ["reviewRouteOrderByCategory", category],
        message: "分类项点排序不能重复。",
      });
    }
  }
});

const awardAssessmentSchema = z.object({
  type: z.enum(["reward", "assessment"]),
  people: z.string(),
  amount: z.number().int().nonnegative(),
});

export const photoGroupSchema = z.object({
  id: z.string().min(1),
  inspectionId: z.string().min(1),
  entryId: z.string().min(1),
  category: photoCategorySchema,
  description: z.string(),
  descriptionManuallyEdited: z.boolean().optional(),
  awardAssessment: z.union([awardAssessmentSchema, z.null()]),
  photoIds: z.array(z.string().min(1)),
  order: z.number().int().nonnegative(),
});

export const photoMetadataSchema = z.object({
  id: z.string().min(1),
  inspectionId: z.string().min(1),
  groupId: z.string().min(1),
  capturedAt: z.string().min(1),
  order: z.number().int().nonnegative(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  highQuality: z.boolean(),
  annotationJson: z.union([z.string(), z.null()]),
  imageMimeType: z.string(),
  thumbnailMimeType: z.string(),
});

export const settingsRecordSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  updatedAt: z.string().min(1),
});

const reportSectionSchema = z.object({
  category: photoCategorySchema,
  title: z.string().trim().min(1, "章节标题不能为空。"),
  order: z.number().int().nonnegative(),
});

export const reportTemplateSchema = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    name: z.string().trim().min(1),
    titlePattern: z.string().trim().min(1),
    openingText: z.string(),
    generalHeading: z.string().trim().optional(),
    requirements: z.array(z.string()),
    situationHeading: z.string().trim().optional(),
    closingText: z.string(),
    organizationName: z.string().trim().min(1),
    bodyFont: z.string().trim().min(1),
    headingFont: z.string().trim().min(1),
    titleFont: z.string().trim().min(1),
    bodyFontSizePt: z.number().positive(),
    titleFontSizePt: z.number().positive(),
    lineSpacing: z.number().positive(),
    firstLineIndentChars: z.number().finite().nonnegative().default(2),
    marginMm: z.object({
      top: z.number().nonnegative(),
      right: z.number().nonnegative(),
      bottom: z.number().nonnegative(),
      left: z.number().nonnegative(),
    }),
    photoLayoutMode: photoLayoutModeSchema.default("fixed"),
    photosPerRow: photosPerRowSchema,
    sections: z.array(reportSectionSchema),
    photoGapPt: z.number().nonnegative(),
    signatureDatePattern: z.string().trim().min(1),
  })
  .superRefine((template, context) => {
    const categories = new Set(template.sections.map((section) => section.category));
    const orders = new Set(template.sections.map((section) => section.order));

    const isLegacyThreeCategoryTemplate =
      template.sections.length === 3 &&
      categories.size === 3 &&
      (["good", "reminder", "assessment"] as const).every((category) => categories.has(category));
    const isFourCategoryTemplate =
      template.sections.length === 4 &&
      categories.size === 4 &&
      (["good", "general", "reminder", "assessment"] as const).every((category) => categories.has(category));

    if (!isLegacyThreeCategoryTemplate && !isFourCategoryTemplate) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "模板必须包含旧三类章节或完整四类照片章节。",
      });
    }

    if (orders.size !== template.sections.length) {
      context.addIssue({
        code: "custom",
        path: ["sections"],
        message: "模板章节排序不能重复。",
      });
    }
  });
