import {
  AlignmentType,
  Document,
  ImageRun,
  LineRuleType,
  Packer,
  PageOrientation,
  Paragraph,
  Table,
  TableBorders,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  convertMillimetersToTwip,
} from "docx";
import JSZip from "jszip";
import { columnsForPhotoCount } from "../../domain/photoLayout";
import {
  compressDocxPhoto,
  getDocxPhotoBudget,
} from "../../lib/images/compressDocxPhoto";
import { renderAnnotation } from "../../lib/images/renderAnnotation";
import type { ReportGroup, ReportModel, ReportPhoto } from "./reportModel";
import { replaceZipMediaSequentially } from "./sequentialZip";

export type ReportProgressPhase = "images" | "document" | "save";

export interface ReportProgress {
  completedImages: number;
  totalImages: number;
  phase: ReportProgressPhase;
}

export interface DocxGenerationRuntime {
  renderAnnotation(sourceBlob: Blob, annotationJson: string | null): Promise<Blob>;
  compressForDocx?(sourceBlob: Blob, targetBytes: number): Promise<Blob>;
}

const browserGenerationRuntime: DocxGenerationRuntime = {
  renderAnnotation,
  compressForDocx: compressDocxPhoto,
};

interface PreparedPhoto extends ReportPhoto {
  data: ArrayBuffer;
  type: "jpg";
}

interface PhotoPlacement {
  width: number;
  height: number;
}

interface PhotoTableRowLayout {
  placements: Array<PhotoPlacement | null>;
  heightPx: number;
}

interface PhotoTableLayout {
  columns: number;
  columnWidths: number[];
  rows: PhotoTableRowLayout[];
  rowGapTwips: number;
  heightTwips: number;
}

const a4WidthMm = 210;
const a4HeightMm = 297;
const docxPhotoFrameAspectRatio = 3 / 4;
const singlePhotoWidthMm = 90;
const singlePhotoHeightMm = 120;
const adaptiveSingleFrameWidthMm = 135;
const adaptiveSingleFrameHeightMm = 90;
const adaptiveGridFrameWidthMm = 78;
const adaptiveGridFrameHeightMm = 58;
const firstPageSingleFrameWidthMm = 150;
const firstPageSingleFrameMaxHeightMm = 120;
const firstPageTwoFrameMaxHeightMm = 110;
const adaptiveGridMaximumColumns = 2;
const photoBlockSpacingMm = 4;
const photoBlockSafetyMm = 6;
const pxPerMm = 96 / 25.4;
const twipsPerPixel = 15;
const maximumWordTwips = 2_147_483_647n;
const photoBlockSpacingTwips = convertMillimetersToTwip(photoBlockSpacingMm);
const photoBlockSafetyTwips = convertMillimetersToTwip(photoBlockSafetyMm);

function decimalNumeratorAndScale(value: number): { numerator: bigint; scale: bigint } {
  if (!Number.isFinite(value) || value < 0) throw new Error("First-line indentation value must be finite and nonnegative.");
  const [coefficient, exponentText] = value.toString().split(/[eE]/);
  const decimalIndex = coefficient.indexOf(".");
  const fractionalDigits = decimalIndex < 0 ? 0 : coefficient.length - decimalIndex - 1;
  const exponent = Number(exponentText ?? "0");
  const scaleExponent = fractionalDigits - exponent;
  const powerOfTen = 10n ** BigInt(Math.abs(scaleExponent));
  const numerator = BigInt(coefficient.replace(".", ""));
  return scaleExponent >= 0
    ? { numerator, scale: powerOfTen }
    : { numerator: numerator * powerOfTen, scale: 1n };
}

function firstLineIndentTwips(bodyFontSizePt: number, firstLineIndentChars: number): number {
  const bodyFont = decimalNumeratorAndScale(bodyFontSizePt);
  const indent = decimalNumeratorAndScale(firstLineIndentChars);
  const numerator = bodyFont.numerator * indent.numerator * 20n;
  const scale = bodyFont.scale * indent.scale;
  const quotient = numerator / scale;
  const remainder = numerator % scale;
  const rounded = remainder * 2n >= scale ? quotient + 1n : quotient;
  if (rounded > maximumWordTwips) throw new Error("正文首行缩进超出Word支持范围。");
  return Number(rounded);
}

function bodyFontHalfPoints(model: ReportModel): number {
  return Math.round(model.bodyFontSizePt * 2);
}

function textRun(model: ReportModel, text: string, options: { bold?: boolean; heading?: boolean } = {}) {
  return new TextRun({
    text,
    bold: options.bold,
    font: options.heading ? model.headingFont : model.bodyFont,
    size: bodyFontHalfPoints(model),
  });
}

function xmlAttribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  if (!match) return null;
  return match[1]
    .replaceAll("&quot;", "\"")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function resolveRelationshipTarget(target: string): string {
  const parts = ["word", ...target.replaceAll("\\", "/").split("/")];
  const resolved: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

function photoMediaPaths(
  documentXml: string,
  relationshipsXml: string,
  photoIds: string[],
): Map<string, string> {
  const relationshipTargets = new Map<string, string>();
  for (const match of relationshipsXml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)) {
    const tag = match[0];
    const type = xmlAttribute(tag, "Type");
    const id = xmlAttribute(tag, "Id");
    const target = xmlAttribute(tag, "Target");
    if (type?.endsWith("/image") && id && target) {
      relationshipTargets.set(id, resolveRelationshipTarget(target));
    }
  }

  const expected = new Set(photoIds);
  const paths = new Map<string, string>();
  const usedPaths = new Set<string>();
  for (const match of documentXml.matchAll(/<w:drawing\b[\s\S]*?<\/w:drawing>/g)) {
    const drawing = match[0];
    const properties = /<wp:docPr\b[^>]*\/?\s*>/.exec(drawing)?.[0];
    const blip = /<a:blip\b[^>]*\/?\s*>/.exec(drawing)?.[0];
    const photoId = properties && (
      xmlAttribute(properties, "descr") ??
      xmlAttribute(properties, "title") ??
      xmlAttribute(properties, "name")
    );
    const relationshipId = blip && xmlAttribute(blip, "r:embed");
    const mediaPath = relationshipId && relationshipTargets.get(relationshipId);
    if (!photoId || !expected.has(photoId) || !mediaPath || paths.has(photoId) || usedPaths.has(mediaPath)) {
      throw new Error("DOCX照片绘图关系不完整。");
    }
    paths.set(photoId, mediaPath);
    usedPaths.add(mediaPath);
  }
  if (paths.size !== photoIds.length) throw new Error("DOCX照片绘图关系不完整。");
  return paths;
}

function bodyParagraph(
  model: ReportModel,
  text: string,
  options: {
    bold?: boolean;
    heading?: boolean;
    alignment?: (typeof AlignmentType)[keyof typeof AlignmentType];
    keepNext?: boolean;
    pageBreakBefore?: boolean;
    firstLineIndent?: boolean;
    spacingAfterTwips?: number;
  } = {},
): Paragraph {
  return new Paragraph({
    children: [textRun(model, text, options)],
    alignment: options.alignment,
    keepNext: options.keepNext,
    pageBreakBefore: options.pageBreakBefore,
    indent: options.firstLineIndent
      ? { firstLine: firstLineIndentTwips(bodyFontHalfPoints(model) / 2, model.firstLineIndentChars) }
      : undefined,
    spacing: {
      line: Math.round(model.lineSpacing * 240),
      lineRule: LineRuleType.AUTO,
      after: options.spacingAfterTwips ?? 0,
    },
  });
}

function chunks<T>(values: T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    rows.push(values.slice(index, index + size));
  }
  return rows;
}

function adaptiveColumnsForPhotoCount(model: ReportModel, photoCount: number): number {
  if (photoCount <= 1 || model.photosPerRow === 1) return 1;
  return Math.min(adaptiveGridMaximumColumns, model.photosPerRow, photoCount);
}

function adaptiveFrameForPhotoCount(photoCount: number): PhotoPlacement {
  return {
    width: Math.max(1, Math.round((photoCount === 1 ? adaptiveSingleFrameWidthMm : adaptiveGridFrameWidthMm) * pxPerMm)),
    height: Math.max(1, Math.round((photoCount === 1 ? adaptiveSingleFrameHeightMm : adaptiveGridFrameHeightMm) * pxPerMm)),
  };
}

function photoTableLayout(
  model: ReportModel,
  photos: PreparedPhoto[],
  adaptiveFrameOverride?: PhotoPlacement,
): PhotoTableLayout {
  const isSinglePhoto = photos.length === 1;
  const isAdaptive = model.photoLayoutMode === "adaptive";
  const columns = isAdaptive
    ? adaptiveColumnsForPhotoCount(model, photos.length)
    : isSinglePhoto
      ? 1
      : columnsForPhotoCount(model.photoLayoutMode, model.photosPerRow, photos.length);
  const contentWidthMm = a4WidthMm - model.marginMm.left - model.marginMm.right;
  const contentWidthTwips = convertMillimetersToTwip(contentWidthMm);
  const baseCellWidth = Math.floor(contentWidthTwips / columns);
  const remainder = contentWidthTwips - baseCellWidth * columns;
  const columnWidths = Array.from(
    { length: columns },
    (_, index) => baseCellWidth + (index < remainder ? 1 : 0),
  );
  const cellWidthMm = contentWidthMm / columns;
  const imageWidthPx = Math.max(1, Math.floor((cellWidthMm - (model.photoGapPt * 25.4 / 72)) * pxPerMm));
  const fixedImageHeightPx = Math.max(1, imageWidthPx / docxPhotoFrameAspectRatio);
  const adaptiveFrame = isAdaptive ? adaptiveFrameOverride ?? adaptiveFrameForPhotoCount(photos.length) : null;
  const placements = photos.map(() => isAdaptive
    ? { ...adaptiveFrame! }
    : isSinglePhoto
      ? { width: Math.round(singlePhotoWidthMm * pxPerMm), height: Math.round(singlePhotoHeightMm * pxPerMm) }
      : { width: imageWidthPx, height: fixedImageHeightPx });
  const rowGapTwips = Math.round(model.photoGapPt * 20);
  const rows = chunks(placements, columns).map((row) => {
    const rowPlacements = Array.from({ length: columns }, (_, index) => row[index] ?? null);
    return {
      placements: rowPlacements,
      heightPx: rowPlacements.reduce((height, placement) => Math.max(height, placement?.height ?? 0), 0),
    };
  });
  return {
    columns,
    columnWidths,
    rows,
    rowGapTwips,
    heightTwips: rows.reduce((height, row) => height + Math.ceil(row.heightPx * twipsPerPixel) + rowGapTwips, 0),
  };
}

function imageTable(model: ReportModel, photos: PreparedPhoto[], layout = photoTableLayout(model, photos)): Table {
  const horizontalGapTwips = Math.round(model.photoGapPt * 20 / 2);
  const verticalGapTwips = Math.floor(layout.rowGapTwips / 2);
  const photoCell = (
    photo: PreparedPhoto | undefined,
    placement: PhotoPlacement | null | undefined,
    cellWidthTwips: number,
    columnSpan?: number,
  ) => {
    if (!photo || !placement) {
      return new TableCell({
        width: { size: cellWidthTwips, type: WidthType.DXA },
        columnSpan,
        margins: {
          top: verticalGapTwips,
          bottom: layout.rowGapTwips - verticalGapTwips,
          left: horizontalGapTwips,
          right: horizontalGapTwips,
        },
        children: [new Paragraph("")],
      });
    }
    return new TableCell({
      width: { size: cellWidthTwips, type: WidthType.DXA },
      columnSpan,
      verticalAlign: VerticalAlign.CENTER,
      margins: {
        top: verticalGapTwips,
        bottom: layout.rowGapTwips - verticalGapTwips,
        left: horizontalGapTwips,
        right: horizontalGapTwips,
      },
      children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new ImageRun({
          type: photo.type,
          data: photo.data,
          transformation: placement,
          altText: { title: photo.id, description: photo.id, name: photo.id },
        })],
        spacing: { after: 0 },
      })],
    });
  };
  const photoRows = chunks(photos, layout.columns).map((row, rowIndex) => {
    const rowLayout = layout.rows[rowIndex];
    if (row.length === 1 && layout.columns === 2) {
      return new TableRow({
        children: [photoCell(
          row[0],
          rowLayout?.placements[0],
          layout.columnWidths.reduce((total, width) => total + width, 0),
          2,
        )],
        cantSplit: true,
      });
    }
    const cells = Array.from({ length: layout.columns }, (_, index) => {
      const photo = row[index];
      const placement = rowLayout?.placements[index];
      const cellWidthTwips = layout.columnWidths[index];
      return photoCell(photo, placement, cellWidthTwips);
    });
    return new TableRow({ children: cells, cantSplit: true });
  });
  return new Table({
    rows: photoRows,
    width: { size: layout.columnWidths.reduce((total, width) => total + width, 0), type: WidthType.DXA },
    columnWidths: layout.columnWidths,
    layout: TableLayoutType.FIXED,
    borders: TableBorders.NONE,
  });
}

function photoGroupBlockHeightTwips(
  model: ReportModel,
  groupText: string,
  layout: PhotoTableLayout,
): number {
  return paragraphHeightTwips(model, groupText) + photoBlockSpacingTwips + layout.heightTwips + photoBlockSafetyTwips;
}

function firstPageAdaptiveLayout(
  model: ReportModel,
  groupText: string,
  photos: PreparedPhoto[],
  remainingPageTwips: number,
  nextGroupHeightTwips: number | null,
): PhotoTableLayout {
  const normalLayout = photoTableLayout(model, photos);
  const normalGroupHeight = photoGroupBlockHeightTwips(model, groupText, normalLayout);
  if (
    model.photoLayoutMode !== "adaptive" ||
    (photos.length !== 1 && photos.length !== 2) ||
    normalGroupHeight > remainingPageTwips ||
    (nextGroupHeightTwips !== null && normalGroupHeight + nextGroupHeightTwips <= remainingPageTwips)
  ) {
    return normalLayout;
  }
  const availablePhotoTableTwips = remainingPageTwips
    - paragraphHeightTwips(model, groupText)
    - photoBlockSpacingTwips
    - photoBlockSafetyTwips;
  const availableFrameHeightPx = Math.floor(
    (availablePhotoTableTwips - normalLayout.rowGapTwips) / twipsPerPixel,
  );
  const normalFrame = normalLayout.rows[0]?.placements[0];
  if (!normalFrame || availableFrameHeightPx <= normalFrame.height) return normalLayout;
  const maximumHeightMm = photos.length === 1
    ? firstPageSingleFrameMaxHeightMm
    : firstPageTwoFrameMaxHeightMm;
  const contentWidthMm = a4WidthMm - model.marginMm.left - model.marginMm.right;
  const frame = {
    width: photos.length === 1
      ? Math.round(Math.min(firstPageSingleFrameWidthMm, contentWidthMm) * pxPerMm)
      : normalFrame.width,
    height: Math.min(Math.round(maximumHeightMm * pxPerMm), availableFrameHeightPx),
  };
  const expandedLayout = photoTableLayout(model, photos, frame);
  return photoGroupBlockHeightTwips(model, groupText, expandedLayout) <= remainingPageTwips
    ? expandedLayout
    : normalLayout;
}

function photoGroupBlock(
  model: ReportModel,
  groupText: string,
  photos: PreparedPhoto[],
  layout: PhotoTableLayout,
  pageBreakBefore: boolean,
): Table {
  const contentWidthTwips = convertMillimetersToTwip(
    a4WidthMm - model.marginMm.left - model.marginMm.right,
  );
  return new Table({
    rows: [new TableRow({
      cantSplit: true,
      children: [new TableCell({
        width: { size: contentWidthTwips, type: WidthType.DXA },
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        children: [
          bodyParagraph(model, groupText, {
            firstLineIndent: true,
            pageBreakBefore,
            spacingAfterTwips: photoBlockSpacingTwips,
          }),
          imageTable(model, photos, layout),
        ],
      })],
    })],
    width: { size: contentWidthTwips, type: WidthType.DXA },
    columnWidths: [contentWidthTwips],
    layout: TableLayoutType.FIXED,
    borders: TableBorders.NONE,
  });
}

function paragraphHeightTwips(model: ReportModel, text: string, fontSizePt = model.bodyFontSizePt): number {
  const lineTwips = Math.max(1, Math.round(model.lineSpacing * 240));
  const contentWidthMm = Math.max(1, a4WidthMm - model.marginMm.left - model.marginMm.right);
  const averageCharacterWidthMm = Math.max(0.5, fontSizePt * 25.4 / 72);
  const charactersPerLine = Math.max(1, Math.floor(contentWidthMm / averageCharacterWidthMm));
  const lines = Math.max(1, Math.ceil(Array.from(text).length / charactersPerLine));
  return lines * lineTwips;
}

class PageLayoutEstimator {
  private readonly pageHeightTwips: number;
  private remainingTwips: number;
  private hasContent = false;
  private firstPage = true;

  constructor(model: ReportModel) {
    this.pageHeightTwips = Math.max(1, convertMillimetersToTwip(
      a4HeightMm - model.marginMm.top - model.marginMm.bottom,
    ));
    this.remainingTwips = this.pageHeightTwips;
  }

  shouldBreakBefore(heightTwips: number): boolean {
    return this.hasContent && heightTwips <= this.pageHeightTwips && heightTwips > this.remainingTwips;
  }

  remainingPageTwips(): number {
    return this.remainingTwips;
  }

  isOnFirstPage(): boolean {
    return this.firstPage;
  }

  startNewPage(): void {
    if (!this.hasContent) return;
    this.remainingTwips = this.pageHeightTwips;
    this.hasContent = false;
    this.firstPage = false;
  }

  consume(heightTwips: number): void {
    let remainingHeight = Math.max(0, heightTwips);
    while (this.hasContent && remainingHeight > this.remainingTwips) {
      remainingHeight -= this.remainingTwips;
      this.remainingTwips = this.pageHeightTwips;
      this.hasContent = false;
      this.firstPage = false;
    }
    if (remainingHeight >= this.pageHeightTwips) {
      const pageRemainder = remainingHeight % this.pageHeightTwips;
      this.remainingTwips = pageRemainder === 0
        ? this.pageHeightTwips
        : this.pageHeightTwips - pageRemainder;
      this.hasContent = pageRemainder !== 0;
      return;
    }
    this.remainingTwips -= remainingHeight;
    this.hasContent = true;
  }
}

function preparedPhotosForGroup(
  group: ReportGroup,
  preparedById: Map<string, PreparedPhoto>,
): PreparedPhoto[] {
  return group.photos.map((photo) => {
    const prepared = preparedById.get(photo.id);
    if (!prepared) throw new Error(`照片 ${photo.id} 尚未处理。`);
    return prepared;
  });
}

export async function generateDocx(
  model: ReportModel,
  onProgress: (progress: ReportProgress) => void,
  runtime: DocxGenerationRuntime = browserGenerationRuntime,
): Promise<Blob> {
  const reportPhotos = model.sections.flatMap((section) => section.groups.flatMap((group) => group.photos));
  const totalImages = reportPhotos.length;
  const photoBudget = getDocxPhotoBudget(totalImages);
  const compressForDocx = runtime.compressForDocx ?? compressDocxPhoto;
  const preparedById = new Map<string, PreparedPhoto>();
  for (const [index, photo] of reportPhotos.entries()) {
    preparedById.set(photo.id, {
      ...photo,
      data: await new Blob([`docx-photo-placeholder:${index}:${photo.id}`]).arrayBuffer(),
      type: "jpg",
    });
  }
  const children: Array<Paragraph | Table> = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({
        text: model.title,
        bold: true,
        font: model.titleFont,
        size: model.titleFontSizePt * 2,
      })],
      spacing: { line: Math.round(model.lineSpacing * 240), lineRule: LineRuleType.AUTO, after: 0 },
    }),
    bodyParagraph(model, model.openingText, { firstLineIndent: true }),
  ];
  const pagination = new PageLayoutEstimator(model);
  pagination.consume(paragraphHeightTwips(model, model.title, model.titleFontSizePt));
  pagination.consume(paragraphHeightTwips(model, model.openingText));
  if (model.generalHeading.trim()) {
    children.push(bodyParagraph(model, model.generalHeading, { bold: true, heading: true }));
    pagination.consume(paragraphHeightTwips(model, model.generalHeading));
  }
  for (const [index, requirement] of model.requirements.entries()) {
    const text = `${index + 1}. ${requirement}`;
    children.push(bodyParagraph(model, text, { firstLineIndent: true }));
    pagination.consume(paragraphHeightTwips(model, text));
  }
  if (model.situationHeading.trim()) {
    children.push(bodyParagraph(model, model.situationHeading, {
      bold: true,
      heading: true,
      firstLineIndent: true,
    }));
    pagination.consume(paragraphHeightTwips(model, model.situationHeading));
  }

  const orderedGroups = model.sections.flatMap((section) => section.groups);
  const firstPhotoGroupIndex = orderedGroups.findIndex((group) => group.photos.length > 0);
  for (const section of model.sections) {
    const firstGroup = section.groups[0];
    const firstGroupPhotos = firstGroup ? preparedPhotosForGroup(firstGroup, preparedById) : [];
    const firstGroupLayout = firstGroup && firstGroupPhotos.length > 0
      ? photoTableLayout(model, firstGroupPhotos)
      : null;
    const firstGroupHeight = firstGroup
      ? firstGroupLayout
        ? photoGroupBlockHeightTwips(model, `${firstGroup.number}. ${firstGroup.text}`, firstGroupLayout)
        : paragraphHeightTwips(model, `${firstGroup.number}. ${firstGroup.text}`)
      : 0;
    const sectionTitleHeight = section.title.trim()
      ? paragraphHeightTwips(model, section.title)
      : 0;
    const sectionPageBreak = Boolean(
      section.title.trim() &&
      pagination.shouldBreakBefore(sectionTitleHeight + firstGroupHeight),
    );
    if (section.title.trim()) {
      children.push(bodyParagraph(model, section.title, {
        bold: true,
        heading: true,
        firstLineIndent: true,
        keepNext: section.groups.length > 0,
        pageBreakBefore: sectionPageBreak,
      }));
      if (sectionPageBreak) pagination.startNewPage();
      pagination.consume(sectionTitleHeight);
    }
    for (const group of section.groups) {
      const groupText = `${group.number}. ${group.text}`;
      const preparedPhotos = preparedPhotosForGroup(group, preparedById);
      const groupIndex = orderedGroups.indexOf(group);
      const nextGroup = groupIndex >= 0 ? orderedGroups[groupIndex + 1] : undefined;
      const nextGroupText = nextGroup ? `${nextGroup.number}. ${nextGroup.text}` : "";
      const nextGroupPhotos = nextGroup ? preparedPhotosForGroup(nextGroup, preparedById) : [];
      const nextGroupLayout = nextGroupPhotos.length > 0
        ? photoTableLayout(model, nextGroupPhotos)
        : null;
      const nextGroupHeight = nextGroup
        ? nextGroupLayout
          ? photoGroupBlockHeightTwips(model, nextGroupText, nextGroupLayout)
          : paragraphHeightTwips(model, nextGroupText)
        : null;
      const groupLayout = preparedPhotos.length > 0
        ? groupIndex === firstPhotoGroupIndex && pagination.isOnFirstPage()
          ? firstPageAdaptiveLayout(
            model,
            groupText,
            preparedPhotos,
            pagination.remainingPageTwips(),
            nextGroupHeight,
          )
          : photoTableLayout(model, preparedPhotos)
        : null;
      const groupTextHeight = paragraphHeightTwips(model, groupText);
      const groupHeight = groupLayout
        ? photoGroupBlockHeightTwips(model, groupText, groupLayout)
        : groupTextHeight;
      const groupPageBreak = Boolean(
        preparedPhotos.length > 0 && pagination.shouldBreakBefore(groupHeight),
      );
      children.push(groupLayout
        ? photoGroupBlock(model, groupText, preparedPhotos, groupLayout, groupPageBreak)
        : bodyParagraph(model, groupText, { firstLineIndent: true }));
      if (groupPageBreak) pagination.startNewPage();
      pagination.consume(groupHeight);
    }
  }

  children.push(
    bodyParagraph(model, model.closingText, { firstLineIndent: true }),
    bodyParagraph(model, model.organizationName, { alignment: AlignmentType.RIGHT, keepNext: true }),
    bodyParagraph(model, model.signatureDate, { alignment: AlignmentType.RIGHT }),
  );

  const document = new Document({
    sections: [{
      properties: {
        page: {
          size: {
            width: convertMillimetersToTwip(a4WidthMm),
            height: convertMillimetersToTwip(a4HeightMm),
            orientation: PageOrientation.PORTRAIT,
          },
          margin: {
            top: convertMillimetersToTwip(model.marginMm.top),
            right: convertMillimetersToTwip(model.marginMm.right),
            bottom: convertMillimetersToTwip(model.marginMm.bottom),
            left: convertMillimetersToTwip(model.marginMm.left),
          },
        },
      },
      children,
    }],
  });
  const skeletonBlob = await Packer.toBlob(document);
  const skeleton = await skeletonBlob.arrayBuffer();
  const skeletonZip = await JSZip.loadAsync(skeleton);
  const documentXml = await skeletonZip.file("word/document.xml")?.async("string");
  const relationshipsXml = await skeletonZip.file("word/_rels/document.xml.rels")?.async("string");
  if (!documentXml || !relationshipsXml) throw new Error("DOCX照片关系文件缺失。");
  const mediaPathByPhotoId = photoMediaPaths(
    documentXml,
    relationshipsXml,
    reportPhotos.map((photo) => photo.id),
  );
  const replacements = new Map<string, () => Promise<Blob>>();
  for (const photo of reportPhotos) {
    const mediaPath = mediaPathByPhotoId.get(photo.id);
    if (!mediaPath) throw new Error(`照片 ${photo.id} 缺少DOCX媒体关系。`);
    replacements.set(mediaPath, async () => {
      const rendered = await runtime.renderAnnotation(photo.imageBlob, photo.annotationJson);
      if (rendered.type !== "image/jpeg") throw new Error(`照片 ${photo.id} 未渲染为JPEG。`);
      const compressed = await compressForDocx(rendered, photoBudget.targetBytes);
      if (compressed.type !== "image/jpeg") throw new Error(`照片 ${photo.id} 未压缩为JPEG。`);
      return compressed;
    });
  }
  let completedImages = 0;
  const blob = await replaceZipMediaSequentially(skeleton, replacements, () => {
    completedImages += 1;
    onProgress({ completedImages, totalImages, phase: "images" });
  });
  onProgress({ completedImages: totalImages, totalImages, phase: "document" });
  onProgress({ completedImages: totalImages, totalImages, phase: "save" });
  return blob;
}
