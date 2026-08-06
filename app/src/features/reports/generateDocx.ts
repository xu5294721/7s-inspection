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
import type { ReportModel, ReportPhoto } from "./reportModel";
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

const a4WidthMm = 210;
const a4HeightMm = 297;
const docxPhotoFrameAspectRatio = 3 / 4;
const singlePhotoWidthMm = 90;
const singlePhotoHeightMm = 120;
const pxPerMm = 96 / 25.4;
const maximumWordTwips = 2_147_483_647n;

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
    firstLineIndent?: boolean;
  } = {},
): Paragraph {
  return new Paragraph({
    children: [textRun(model, text, options)],
    alignment: options.alignment,
    keepNext: options.keepNext,
    indent: options.firstLineIndent
      ? { firstLine: firstLineIndentTwips(bodyFontHalfPoints(model) / 2, model.firstLineIndentChars) }
      : undefined,
    spacing: {
      line: Math.round(model.lineSpacing * 240),
      lineRule: LineRuleType.AUTO,
      after: 0,
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

function imageTable(model: ReportModel, photos: PreparedPhoto[]): Table {
  const isSinglePhoto = photos.length === 1;
  const fillsRowWidth = !isSinglePhoto || model.photoLayoutMode === "adaptive";
  const columns = isSinglePhoto
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
  const gapTwips = Math.round(model.photoGapPt * 20 / 2);
  const imageWidthPx = fillsRowWidth
    ? Math.max(1, Math.floor((cellWidthMm - (model.photoGapPt * 25.4 / 72)) * pxPerMm))
    : Math.round(singlePhotoWidthMm * pxPerMm);
  const imageHeightPx = fillsRowWidth
    ? Math.max(1, imageWidthPx / docxPhotoFrameAspectRatio)
    : Math.round(singlePhotoHeightMm * pxPerMm);
  const rows = chunks(photos, columns).map((row) => {
    const cells = Array.from({ length: columns }, (_, index) => {
      const photo = row[index];
      const cellWidthTwips = columnWidths[index];
      if (!photo) {
        return new TableCell({
          width: { size: cellWidthTwips, type: WidthType.DXA },
          children: [new Paragraph("")],
        });
      }
      const width = imageWidthPx;
      const height = imageHeightPx;
      return new TableCell({
        width: { size: cellWidthTwips, type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        margins: { left: gapTwips, right: gapTwips },
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new ImageRun({
            type: photo.type,
            data: photo.data,
            transformation: { width, height },
            altText: { title: photo.id, description: photo.id, name: photo.id },
          })],
          spacing: { after: 0 },
        })],
      });
    });
    return new TableRow({ children: cells, cantSplit: true });
  });
  return new Table({
    rows,
    width: { size: contentWidthTwips, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    borders: TableBorders.NONE,
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
  if (model.generalHeading.trim()) {
    children.push(bodyParagraph(model, model.generalHeading, { bold: true, heading: true }));
  }
  children.push(
    ...model.requirements.map((requirement, index) => bodyParagraph(
      model,
      `${index + 1}. ${requirement}`,
      { firstLineIndent: true },
    )),
  );
  if (model.situationHeading.trim()) {
    children.push(bodyParagraph(model, model.situationHeading, {
      bold: true,
      heading: true,
      firstLineIndent: true,
    }));
  }

  for (const section of model.sections) {
    if (section.title.trim()) {
      children.push(bodyParagraph(model, section.title, {
        bold: true,
        heading: true,
        firstLineIndent: true,
      }));
    }
    for (const group of section.groups) {
      children.push(bodyParagraph(model, `${group.number}. ${group.text}`, {
        keepNext: true,
        firstLineIndent: true,
      }));
      children.push(imageTable(model, group.photos.map((photo) => {
        const prepared = preparedById.get(photo.id);
        if (!prepared) throw new Error(`照片 ${photo.id} 尚未处理。`);
        return prepared;
      })));
    }
  }

  children.push(
    bodyParagraph(model, model.closingText, { firstLineIndent: true }),
    bodyParagraph(model, model.organizationName, { alignment: AlignmentType.RIGHT }),
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
