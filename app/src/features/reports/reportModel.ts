import type {
  InspectionGraph,
  PhotoAsset,
  PhotoCategory,
  PhotoLayoutMode,
  PhotosPerRow,
  ReportTemplate,
} from "../../domain/models";
import { formatInspectionEvaluationDescription } from "../../domain/inspectionCheckContents";
import { resolveReviewRouteOrderForCategory } from "../../domain/reviewRouteOrder";

function inspectionMonthDay(date: string): { month: number; day: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error("巡检日期格式无效。");
  return { month: Number(match[2]), day: Number(match[3]) };
}

export function buildReportFilename(date: string): string {
  const { month, day } = inspectionMonthDay(date);
  return `向塘钢轨焊接整修车间${month}月${day}日7S巡检通报.docx`;
}

export interface ReportPhoto {
  id: string;
  imageBlob: Blob;
  width: number;
  height: number;
  annotationJson: string | null;
}

export interface ReportGroup {
  id: string;
  number: number;
  text: string;
  photos: ReportPhoto[];
}

export interface ReportSectionModel {
  category: PhotoCategory;
  title: string;
  groups: ReportGroup[];
}

export interface ReportModel {
  inspectionId: string;
  inspectionDate: string;
  inspectionUpdatedAt: string;
  title: string;
  openingText: string;
  generalHeading: string;
  requirements: string[];
  situationHeading: string;
  sections: ReportSectionModel[];
  closingText: string;
  organizationName: string;
  signatureDate: string;
  bodyFont: string;
  headingFont: string;
  titleFont: string;
  bodyFontSizePt: number;
  firstLineIndentChars: number;
  titleFontSizePt: number;
  lineSpacing: number;
  marginMm: { top: number; right: number; bottom: number; left: number };
  photoLayoutMode: PhotoLayoutMode;
  photosPerRow: PhotosPerRow;
  photoGapPt: number;
}

function formatDatePattern(pattern: string, date: string): string {
  const [year] = date.split("-");
  const { month, day } = inspectionMonthDay(date);
  return pattern
    .replaceAll("{date}", `${month}月${day}日`)
    .replaceAll("YYYY", year)
    .replaceAll("M", String(month))
    .replaceAll("D", String(day));
}

function evaluationSuffix(category: PhotoCategory, award: InspectionGraph["groups"][number]["awardAssessment"]): string {
  if (category === "good" && award?.type === "reward") {
    return `（奖励：${award.people}，${award.amount}元）`;
  }
  if (category === "assessment" && award?.type === "assessment") {
    return `（考核：${award.people}，${award.amount}元）`;
  }
  return "";
}

function toReportPhoto(photo: PhotoAsset): ReportPhoto {
  return {
    id: photo.id,
    imageBlob: photo.imageBlob,
    width: photo.width,
    height: photo.height,
    annotationJson: photo.annotationJson,
  };
}

export function buildReportModel(graph: InspectionGraph, template: ReportTemplate): ReportModel {
  if (graph.photos.length === 0) {
    throw new Error("报告至少需要一张已归组照片。");
  }

  if (
    template.id !== graph.inspection.templateId ||
    template.version !== graph.inspection.templateVersion
  ) {
    throw new Error("报告模板版本与巡检记录不一致。");
  }

  const entryById = new Map(graph.inspection.entries.map((entry) => [entry.id, entry]));
  const photoById = new Map(graph.photos.map((photo) => [photo.id, photo]));
  const orderedTemplateSections = [...template.sections].sort((left, right) =>
    left.order - right.order || left.category.localeCompare(right.category));
  const photographedGroups = graph.groups.filter((group) => group.photoIds.length > 0);
  const sections = orderedTemplateSections.map(({ category, title }): ReportSectionModel => {
    const categoryGroups = photographedGroups.filter((group) => group.category === category);
    const categoryRouteNames = categoryGroups.flatMap((group) => {
      const entry = entryById.get(group.entryId);
      return entry ? [entry.itemSnapshot.routeName] : [];
    });
    const routeRank = new Map(
      resolveReviewRouteOrderForCategory(graph.inspection, category, categoryRouteNames)
        .map((routeName, index) => [routeName, index]),
    );
    const groups = categoryGroups
      .sort((left, right) => {
        const leftEntry = entryById.get(left.entryId);
        const rightEntry = entryById.get(right.entryId);
        const leftRouteRank = leftEntry
          ? routeRank.get(leftEntry.itemSnapshot.routeName) ?? Number.MAX_SAFE_INTEGER
          : Number.MAX_SAFE_INTEGER;
        const rightRouteRank = rightEntry
          ? routeRank.get(rightEntry.itemSnapshot.routeName) ?? Number.MAX_SAFE_INTEGER
          : Number.MAX_SAFE_INTEGER;
        return leftRouteRank - rightRouteRank || left.order - right.order || left.id.localeCompare(right.id);
      })
      .map((group, index): ReportGroup => {
        const entry = entryById.get(group.entryId);
        if (!entry) throw new Error(`照片组 ${group.id} 关联的巡检项点不存在。`);
        const selectedDescription = formatInspectionEvaluationDescription(
          entry.itemSnapshot.routeName,
          entry.checkSelections ?? [],
        );
        const baseText = group.descriptionManuallyEdited
          ? group.description
          : selectedDescription || group.description;
        return {
          id: group.id,
          number: index + 1,
          text: `${baseText}${evaluationSuffix(category, group.awardAssessment)}`,
          photos: group.photoIds.map((photoId) => {
            const photo = photoById.get(photoId);
            if (!photo) throw new Error(`照片 ${photoId} 不存在。`);
            return toReportPhoto(photo);
          }),
        };
    });
    return { category, title, groups };
  }).filter((section) => section.groups.length > 0);

  return {
    inspectionId: graph.inspection.id,
    inspectionDate: graph.inspection.inspectionDate,
    inspectionUpdatedAt: graph.inspection.updatedAt,
    title: formatDatePattern(template.titlePattern, graph.inspection.inspectionDate),
    openingText: template.openingText,
    generalHeading: template.generalHeading ?? "一、“7S”巡检工作总体要求",
    requirements: [...template.requirements],
    situationHeading: template.situationHeading ?? "二、本次检查总体情况",
    sections,
    closingText: template.closingText,
    organizationName: template.organizationName,
    signatureDate: formatDatePattern(template.signatureDatePattern, graph.inspection.inspectionDate),
    bodyFont: template.bodyFont,
    headingFont: template.headingFont,
    titleFont: template.titleFont,
    bodyFontSizePt: template.bodyFontSizePt,
    firstLineIndentChars: template.firstLineIndentChars,
    titleFontSizePt: template.titleFontSizePt,
    lineSpacing: template.lineSpacing,
    marginMm: { ...template.marginMm },
    photoLayoutMode: graph.inspection.photoLayoutModeOverride ?? template.photoLayoutMode ?? "fixed",
    photosPerRow: graph.inspection.photosPerRowOverride ?? template.photosPerRow,
    photoGapPt: template.photoGapPt,
  };
}
