import { photoCategorySchema, reportTemplateSchema } from "./schemas";
import type {
  AwardAssessment,
  InspectionGraph,
  PhotoGroup,
  ReportValidationError,
} from "./models";
import { isPositiveSafeInteger } from "./inspection";

function error(
  groupId: string | null,
  field: string,
  code: string,
  message: string,
): ReportValidationError {
  return { groupId, field, code, message };
}

function hasCompleteDetails(value: AwardAssessment | null): boolean {
  return Boolean(value && value.people.trim() && isPositiveSafeInteger(value.amount));
}

function validateGroup(group: PhotoGroup): ReportValidationError[] {
  const errors: ReportValidationError[] = [];
  const category = photoCategorySchema.safeParse(group.category);

  if (!category.success) {
    errors.push(error(group.id, "category", "INVALID_CATEGORY", "照片组分类无效。"));
  }

  if (!group.description.trim()) {
    errors.push(error(group.id, "description", "EMPTY_DESCRIPTION", "照片组说明不能为空。"));
  }

  if (group.category === "assessment") {
    if (group.awardAssessment?.type === "reward") {
      errors.push(error(group.id, "awardAssessment", "CATEGORY_AWARD_INCOMPATIBLE", "考核问题不能填写奖励信息。"));
    } else if (group.awardAssessment?.type !== "assessment" || !hasCompleteDetails(group.awardAssessment)) {
      errors.push(error(group.id, "awardAssessment", "ASSESSMENT_DETAILS_REQUIRED", "考核必须填写责任人员和正数金额。"));
    }
  } else if (group.category === "good" && group.awardAssessment) {
    if (group.awardAssessment.type !== "reward") {
      errors.push(error(group.id, "awardAssessment", "CATEGORY_AWARD_INCOMPATIBLE", "好的方面只能填写奖励信息。"));
    } else if (!hasCompleteDetails(group.awardAssessment)) {
      errors.push(error(group.id, "awardAssessment", "REWARD_DETAILS_INCOMPLETE", "奖励必须填写人员和正数金额。"));
    }
  } else if ((group.category === "general" || group.category === "reminder") && group.awardAssessment) {
    errors.push(error(group.id, "awardAssessment", "CATEGORY_AWARD_INCOMPATIBLE", "一般表现和提醒事项不能填写奖考信息。"));
  }

  return errors;
}

export function validateReportReadiness(graph: InspectionGraph): ReportValidationError[] {
  const errors: ReportValidationError[] = [];
  let templateCategories: Set<string> | null = null;

  if (graph.photos.length === 0) {
    errors.push(error(null, "photos", "REPORT_PHOTO_REQUIRED", "报告至少需要一张已归组照片。"));
  }

  const persistedPhotoCounts = new Map<string, number>();
  const photoById = new Map(graph.photos.map((photo) => [photo.id, photo]));
  const groupById = new Map<string, PhotoGroup>();
  const entryById = new Map(graph.inspection.entries.map((entry) => [entry.id, entry]));
  const referenceCount = new Map<string, number>();

  for (const group of graph.groups) {
    if (groupById.has(group.id)) {
      errors.push(error(group.id, "id", "DUPLICATE_GROUP_ID", "照片组 ID 不能重复。"));
    } else {
      groupById.set(group.id, group);
    }
  }

  if (!graph.template) {
    errors.push(error(null, "template", "TEMPLATE_NOT_FOUND", "巡检引用的报告模板版本不存在。"));
  } else if (
    graph.template.id !== graph.inspection.templateId ||
    graph.template.version !== graph.inspection.templateVersion
  ) {
    errors.push(error(null, "template", "TEMPLATE_REFERENCE_MISMATCH", "报告模板版本与巡检记录不一致。"));
  } else if (!reportTemplateSchema.safeParse(graph.template).success) {
    errors.push(error(null, "template", "TEMPLATE_INVALID", "报告模板结构无效。"));
  } else {
    templateCategories = new Set(graph.template.sections.map((section) => section.category));
  }

  for (const photo of graph.photos) {
    const count = (persistedPhotoCounts.get(photo.id) ?? 0) + 1;
    persistedPhotoCounts.set(photo.id, count);
    if (count > 1) {
      errors.push(error(photo.groupId || null, "id", "DUPLICATE_PHOTO_ID", "持久化照片 ID 不能重复。"));
    }
    if (!groupById.has(photo.groupId)) {
      errors.push(error(photo.groupId || null, "groupId", "PHOTO_GROUP_NOT_FOUND", "照片关联的照片组不存在。"));
    }
  }

  for (const entry of graph.inspection.entries) {
    if (entry.inspectionId !== graph.inspection.id) {
      errors.push(
        error(
          null,
          `entries.${entry.id}.inspectionId`,
          "ENTRY_INSPECTION_MISMATCH",
          "巡检项点所属巡检记录不一致。",
        ),
      );
    }

    const referencedGroupIds = new Set<string>();
    for (const groupId of entry.groupIds) {
      if (referencedGroupIds.has(groupId)) {
        errors.push(error(groupId, "groupIds", "DUPLICATE_GROUP_REFERENCE", "巡检项点不能重复引用同一照片组。"));
      } else {
        referencedGroupIds.add(groupId);
      }

      const linkedGroup = groupById.get(groupId);
      if (!linkedGroup) {
        errors.push(error(groupId, "groupIds", "GROUP_NOT_FOUND", "巡检项点引用的照片组不存在。"));
      } else if (linkedGroup.entryId !== entry.id) {
        errors.push(error(groupId, "entryId", "GROUP_ENTRY_MISMATCH", "照片组所属巡检项点不一致。"));
      }
    }
  }

  for (const group of graph.groups) {
    errors.push(...validateGroup(group));

    if (
      templateCategories &&
      !templateCategories.has(group.category)
    ) {
      errors.push(error(
        group.id,
        "template.sections",
        "PHOTO_CATEGORY_NOT_IN_TEMPLATE",
        "评价分类不在当前模板章节中，请切换至最新四分类模板。",
      ));
    }

    if (group.inspectionId !== graph.inspection.id) {
      errors.push(error(group.id, "inspectionId", "GROUP_INSPECTION_MISMATCH", "照片组所属巡检记录不一致。"));
    }

    const entry = entryById.get(group.entryId);
    if (!entry) {
      errors.push(error(group.id, "entryId", "ENTRY_NOT_FOUND", "照片组关联的巡检项点不存在。"));
    } else if (!entry.groupIds.includes(group.id)) {
      errors.push(error(group.id, "entryId", "GROUP_NOT_LINKED_TO_ENTRY", "照片组未关联到对应巡检项点。"));
    }

    for (const photoId of group.photoIds) {
      const count = (referenceCount.get(photoId) ?? 0) + 1;
      referenceCount.set(photoId, count);
      if (count > 1) {
        errors.push(error(group.id, "photoIds", "DUPLICATE_PHOTO_REFERENCE", "照片不能重复归入多个照片组。"));
      }

      const photo = photoById.get(photoId);
      if (!photo) {
        errors.push(error(group.id, "photoIds", "PHOTO_NOT_FOUND", "照片组引用的照片不存在。"));
      } else if (photo.groupId !== group.id) {
        errors.push(error(group.id, "photoIds", "PHOTO_GROUP_MISMATCH", "照片所属照片组与组引用不一致。"));
      } else if (photo.inspectionId !== graph.inspection.id) {
        errors.push(error(group.id, "photoIds", "PHOTO_INSPECTION_MISMATCH", "照片所属巡检记录不一致。"));
      }
    }
  }

  for (const photo of graph.photos) {
    if ((referenceCount.get(photo.id) ?? 0) === 0) {
      errors.push(error(photo.groupId || null, "groupId", "PHOTO_NOT_GROUPED", "照片尚未归入照片组。"));
    }
  }

  return errors;
}
