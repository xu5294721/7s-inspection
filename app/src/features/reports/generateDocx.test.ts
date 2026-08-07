import JSZip from "jszip";
import { convertMillimetersToTwip } from "docx";
import { vi } from "vitest";
import {
  DOCX_PHOTO_MEDIA_BUDGET,
  getDocxPhotoBudget,
} from "../../lib/images/compressDocxPhoto";
import { makeInspection, makePhoto, makePhotoGroup, makeTemplate } from "../../test/fixtures";
import { generateDocx } from "./generateDocx";
import { buildReportModel } from "./reportModel";

function attribute(tag: string, name: string): string | null {
  return new RegExp(`\\b${name}="([^"]+)"`).exec(tag)?.[1] ?? null;
}

function paragraphContaining(documentXml: string, text: string): string {
  const textIndex = documentXml.indexOf(text);
  if (textIndex < 0) throw new Error(`Missing paragraph text: ${text}`);
  const paragraphStart = documentXml.lastIndexOf("<w:p", textIndex);
  const paragraphEnd = documentXml.indexOf("</w:p>", textIndex);
  if (paragraphStart < 0 || paragraphEnd < 0) throw new Error(`Missing paragraph: ${text}`);
  return documentXml.slice(paragraphStart, paragraphEnd + "</w:p>".length);
}

async function drawingMediaReferences(blob: Blob) {
  const zip = await JSZip.loadAsync(blob);
  const documentXml = await zip.file("word/document.xml")!.async("string");
  const relationshipsXml = await zip.file("word/_rels/document.xml.rels")!.async("string");
  const targets = new Map(
    [...relationshipsXml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)]
      .map((match) => match[0])
      .filter((tag) => attribute(tag, "Type")?.endsWith("/image"))
      .map((tag) => [attribute(tag, "Id")!, `word/${attribute(tag, "Target")!}`]),
  );
  const references = [...documentXml.matchAll(/<w:drawing\b[\s\S]*?<\/w:drawing>/g)].map((match) => {
    const drawing = match[0];
    const properties = /<wp:docPr\b[^>]*\/?\s*>/.exec(drawing)![0];
    const blip = /<a:blip\b[^>]*\/?\s*>/.exec(drawing)![0];
    const photoId = attribute(properties, "descr")!;
    const relationshipId = attribute(blip, "r:embed")!;
    const target = targets.get(relationshipId)!;
    return { photoId, relationshipId, target, media: zip.file(target) };
  });
  return { zip, documentXml, relationshipsXml, references };
}

async function embeddedMediaBytes(blob: Blob): Promise<number> {
  const zip = await JSZip.loadAsync(blob);
  const media = zip.file(/^word\/media\//);
  const sizes = await Promise.all(media.map(async (file) => (await file.async("uint8array")).byteLength));
  return sizes.reduce((total, size) => total + size, 0);
}

function fivePhotoModel() {
  const photoIds = Array.from({ length: 5 }, (_, index) => `photo-${index + 1}`);
  const inspection = makeInspection({
    templateVersion: 1,
    entries: [{
      ...makeInspection().entries[0],
      groupIds: ["group-1"],
      itemSnapshot: {
        ...makeInspection().entries[0].itemSnapshot,
        routeName: "卷扬机间",
      },
      checkSelections: [
        { category: "environment", value: "干净整洁", isCustom: false },
        { category: "placement", value: "规范有序", isCustom: false },
        { category: "safety", value: "消防器材缺失", isCustom: true },
      ],
    }],
  });
  const template = makeTemplate({
    openingText: "正式开头。",
    generalHeading: "一、总体要求",
    requirements: ["第一项要求。", "第二项要求。"],
    situationHeading: "二、本次检查总体情况",
    closingText: "正式结尾。",
  });
  return buildReportModel({
    inspection,
    groups: [makePhotoGroup({ description: "设备清理较好。", photoIds })],
    photos: photoIds.map((id, index) => makePhoto(
      new Blob([`distinct-image-${index}`], { type: "image/jpeg" }),
      { id, order: index, width: 1200, height: 800 },
    )),
    template,
  }, template);
}

function layoutModel(photosPerRow: 2 | 3) {
  const dimensions = [
    { width: 600, height: 1200 },
    { width: 1600, height: 800 },
    { width: 900, height: 900 },
  ].slice(0, photosPerRow);
  const photoIds = dimensions.map((_, index) => `layout-photo-${index + 1}`);
  const inspection = makeInspection({
    templateVersion: 1,
    photosPerRowOverride: photosPerRow,
  });
  const template = makeTemplate({ marginMm: { top: 20, right: 22, bottom: 20, left: 22 } });
  return {
    dimensions,
    model: buildReportModel({
      inspection,
      groups: [makePhotoGroup({ photoIds })],
      photos: dimensions.map((dimension, index) => makePhoto(
        new Blob([`layout-${index}`], { type: "image/jpeg" }),
        { id: photoIds[index], order: index, ...dimension },
      )),
      template,
    }, template),
  };
}

test("writes the current formal general section and preserves its photo relationship", async () => {
  const template = makeTemplate({
    version: 3,
    name: "正式巡检通报模板",
    sections: [
      { category: "good", title: "好的方面", order: 0 },
      { category: "general", title: "一般表现", order: 1 },
      { category: "reminder", title: "提醒问题", order: 2 },
      { category: "assessment", title: "考核问题", order: 3 },
    ],
  });
  const inspection = makeInspection({ templateVersion: 3 });
  const model = buildReportModel({
    inspection,
    groups: [makePhotoGroup({
      id: "general-group",
      category: "general",
      description: "卷扬机间一般表现说明。",
      photoIds: ["general-photo"],
    })],
    photos: [makePhoto(undefined, { id: "general-photo", groupId: "general-group" })],
    template,
  }, template);

  const { documentXml, references } = await drawingMediaReferences(
    await generateDocx(model, () => undefined),
  );

  expect(documentXml).toContain("一般表现");
  expect(documentXml).toContain("卷扬机间一般表现说明。");
  expect(documentXml).not.toContain("（奖励：");
  expect(documentXml).not.toContain("（考核：");
  expect(references.map((reference) => reference.photoId)).toEqual(["general-photo"]);
  expect(references[0]?.media).not.toBeNull();
});

test("packages complete five-photo document content and image references", async () => {
  const model = fivePhotoModel();
  const blob = await generateDocx(model, () => undefined);
  const { zip, documentXml, relationshipsXml, references } = await drawingMediaReferences(blob);
  const drawingReferences = [...documentXml.matchAll(/<w:drawing>/g)];
  const embeddedRelationshipIds = [...documentXml.matchAll(/r:embed="([^"]+)"/g)].map((match) => match[1]);
  const imageRelationships = [...relationshipsXml.matchAll(
    /<Relationship Id="([^"]+)" Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/image" Target="([^"]+)"\/>/g,
  )];

  expect(blob.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  expect(documentXml).toContain("正式开头。");
  expect(documentXml).toContain("一、总体要求");
  expect(documentXml).toContain("第一项要求。");
  expect(documentXml).toContain("二、本次检查总体情况");
  expect(documentXml).toContain("好的方面");
  expect(documentXml).not.toContain("提醒事项");
  expect(documentXml).not.toContain("考核问题");
  expect(documentXml).toContain("卷扬机间：环境卫生干净整洁，物品定置规范有序。");
  expect(documentXml).toContain("向塘钢轨焊接整修车间");
  expect(documentXml).toContain("2026年7月28日");
  for (const annexText of ["附件：巡检照片明细表", "责任工班", "区域设备"]) {
    expect(documentXml).not.toContain(annexText);
  }
  expect(drawingReferences).toHaveLength(5);
  expect(embeddedRelationshipIds).toHaveLength(5);
  expect(new Set(embeddedRelationshipIds)).toEqual(new Set(imageRelationships.map((match) => match[1])));
  expect(zip.file(/^word\/media\//)).toHaveLength(5);
  expect(references.map((reference) => reference.photoId)).toEqual(
    model.sections.flatMap((section) => section.groups.flatMap((group) => group.photos.map((photo) => photo.id))),
  );
  expect(new Set(references.map((reference) => reference.relationshipId)).size).toBe(5);
  expect(new Set(references.map((reference) => reference.target)).size).toBe(5);
  references.forEach((reference) => expect(reference.media).not.toBeNull());
});

test("applies configured body font size and first-line indentation to report body and situation headings", async () => {
  const model = fivePhotoModel();
  Object.assign(model, { bodyFontSizePt: 16, firstLineIndentChars: 2 });
  const zip = await JSZip.loadAsync(await generateDocx(model, () => undefined));
  const documentXml = await zip.file("word/document.xml")!.async("string");

  for (const text of [
    model.openingText,
    `1. ${model.requirements[0]}`,
    `1. ${model.sections[0].groups[0].text}`,
    model.closingText,
  ]) {
    const paragraph = paragraphContaining(documentXml, text);
    expect(paragraph).toContain('<w:sz w:val="32"/>');
    expect(paragraph).toContain('<w:ind w:firstLine="640"/>');
  }

  for (const text of [
    model.situationHeading,
    model.sections[0].title,
    model.organizationName,
    model.signatureDate,
  ]) {
    const paragraph = paragraphContaining(documentXml, text);
    if (text === model.situationHeading || text === model.sections[0].title) {
      expect(paragraph).toContain('<w:ind w:firstLine="640"/>');
    } else {
      expect(paragraph).not.toContain("w:firstLine");
    }
  }
  expect(paragraphContaining(documentXml, model.generalHeading)).not.toContain("w:firstLine");
});

test("omits empty category and explicitly cleared heading paragraphs", async () => {
  const inspection = makeInspection({ templateVersion: 1 });
  const template = makeTemplate({
    generalHeading: "",
    situationHeading: "",
    requirements: ["保留总体要求明细。"],
  });
  const model = buildReportModel({
    inspection,
    groups: [makePhotoGroup({ category: "good", photoIds: ["photo-1"] })],
    photos: [makePhoto()],
    template,
  }, template);
  Object.assign(model, { bodyFontSizePt: 16, firstLineIndentChars: 2 });
  const zip = await JSZip.loadAsync(await generateDocx(model, () => undefined));
  const documentXml = await zip.file("word/document.xml")!.async("string");

  expect(documentXml).toContain("保留总体要求明细。");
  expect(documentXml).toContain("好的方面");
  expect(paragraphContaining(documentXml, "好的方面")).toContain('<w:ind w:firstLine="640"/>');
  expect(documentXml).not.toContain("一、“7S”巡检工作总体要求");
  expect(documentXml).not.toContain("二、本次检查总体情况");
  expect(documentXml).not.toContain("提醒事项");
  expect(documentXml).not.toContain("考核问题");
});

test("uses the same rounded half-point body size for text and first-line indentation", async () => {
  const model = fivePhotoModel();
  Object.assign(model, { bodyFontSizePt: 10.02, firstLineIndentChars: 1.25 });
  const zip = await JSZip.loadAsync(await generateDocx(model, () => undefined));
  const documentXml = await zip.file("word/document.xml")!.async("string");
  const paragraph = paragraphContaining(documentXml, model.openingText);

  expect(paragraph).toContain('<w:sz w:val="20"/>');
  expect(paragraph).toContain('<w:ind w:firstLine="250"/>');
});

test("does not round an exact decimal value below the twip boundary up", async () => {
  const model = fivePhotoModel();
  Object.assign(model, { bodyFontSizePt: 10, firstLineIndentChars: 1.2524999999998 });
  const zip = await JSZip.loadAsync(await generateDocx(model, () => undefined));
  const documentXml = await zip.file("word/document.xml")!.async("string");

  expect(paragraphContaining(documentXml, model.openingText)).toContain(
    '<w:ind w:firstLine="250"/>',
  );
});

test("rejects first-line indentation beyond Word's signed twips range", async () => {
  const model = fivePhotoModel();
  Object.assign(model, { bodyFontSizePt: 1e307, firstLineIndentChars: 2 });

  await expect(generateDocx(model, () => undefined)).rejects.toThrow(
    "正文首行缩进超出Word支持范围。",
  );
});

test("writes configured report section headings in the saved order", async () => {
  const inspection = makeInspection({ templateVersion: 1 });
  const template = makeTemplate({
    sections: [
      { category: "assessment", title: "考核章节", order: 0 },
      { category: "good", title: "好的章节", order: 1 },
      { category: "reminder", title: "提醒章节", order: 2 },
    ],
  });
  const model = buildReportModel({
    inspection,
    groups: [
      makePhotoGroup({ id: "assessment-group", category: "assessment", photoIds: ["assessment-photo"], awardAssessment: { type: "assessment", people: "李四", amount: 50 } }),
      makePhotoGroup({ id: "good-group", category: "good", photoIds: ["good-photo"] }),
      makePhotoGroup({ id: "reminder-group", category: "reminder", photoIds: ["reminder-photo"] }),
    ],
    photos: [
      makePhoto(undefined, { id: "assessment-photo", groupId: "assessment-group" }),
      makePhoto(undefined, { id: "good-photo", groupId: "good-group" }),
      makePhoto(undefined, { id: "reminder-photo", groupId: "reminder-group" }),
    ],
    template,
  }, template);
  const zip = await JSZip.loadAsync(await generateDocx(model, () => undefined));
  const documentXml = await zip.file("word/document.xml")!.async("string");

  expect(documentXml.indexOf("考核章节")).toBeLessThan(documentXml.indexOf("好的章节"));
  expect(documentXml.indexOf("好的章节")).toBeLessThan(documentXml.indexOf("提醒章节"));
});

test.each([2, 3] as const)(
  "divides the exact content width into %i columns and uses a fixed 3:4 photo frame",
  async (photosPerRow) => {
    const { model } = layoutModel(photosPerRow);
    const zip = await JSZip.loadAsync(await generateDocx(model, () => undefined));
    const documentXml = await zip.file("word/document.xml")!.async("string");
    const photoTable = documentXml.match(/<w:tbl>(?:(?!<w:tbl>)[\s\S])*?<w:drawing>[\s\S]*?<\/w:tbl>/)?.[0];
    expect(photoTable).toBeDefined();
    const gridWidths = [...photoTable!.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)]
      .map((match) => Number(match[1]));
    const extents = [...photoTable!.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)]
      .map((match) => ({ width: Number(match[1]), height: Number(match[2]) }));

    expect(gridWidths).toHaveLength(photosPerRow);
    expect(gridWidths.reduce((total, width) => total + width, 0)).toBe(
      convertMillimetersToTwip(210 - 22 - 22),
    );
    expect(extents).toHaveLength(photosPerRow);
    expect(new Set(extents.map(({ width, height }) => String(width) + "x" + String(height))).size).toBe(1);
    const firstExtent = extents[0]!;
    expect(firstExtent.width / firstExtent.height).toBeCloseTo(3 / 4, 3);
  },
);

test("uses a centered 9 by 12 centimeter frame for a single photo", async () => {
  const inspection = makeInspection({
    templateVersion: 1,
    photosPerRowOverride: 3,
  });
  const template = makeTemplate({ marginMm: { top: 20, right: 22, bottom: 20, left: 22 } });
  const model = buildReportModel({
    inspection,
    groups: [makePhotoGroup({ photoIds: ["single-photo"] })],
    photos: [makePhoto(undefined, { id: "single-photo", width: 1600, height: 900 })],
    template,
  }, template);

  const zip = await JSZip.loadAsync(await generateDocx(model, () => undefined));
  const documentXml = await zip.file("word/document.xml")!.async("string");
  const photoTable = documentXml.match(/<w:tbl>(?:(?!<w:tbl>)[\s\S])*?<w:drawing>[\s\S]*?<\/w:tbl>/)?.[0];
  const gridWidths = [...photoTable!.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)]
    .map((match) => Number(match[1]));
  const extent = [...photoTable!.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)]
    .map((match) => ({ width: Number(match[1]), height: Number(match[2]) }))[0];
  const pxPerMm = 96 / 25.4;
  const emuPerPx = 9_525;

  expect(gridWidths).toHaveLength(1);
  expect(extent).toEqual({
    width: Math.round(90 * pxPerMm) * emuPerPx,
    height: Math.round(120 * pxPerMm) * emuPerPx,
  });
});

test("fills the content width for a single photo in adaptive layout", async () => {
  const inspection = makeInspection({ templateVersion: 1 });
  const template = makeTemplate({
    photoLayoutMode: "adaptive",
    marginMm: { top: 20, right: 22, bottom: 20, left: 22 },
  });
  const model = buildReportModel({
    inspection,
    groups: [makePhotoGroup({ photoIds: ["single-photo"] })],
    photos: [makePhoto(undefined, { id: "single-photo", width: 1600, height: 900 })],
    template,
  }, template);

  const zip = await JSZip.loadAsync(await generateDocx(model, () => undefined));
  const documentXml = await zip.file("word/document.xml")!.async("string");
  const photoTable = documentXml.match(/<w:tbl>(?:(?!<w:tbl>)[\s\S])*?<w:drawing>[\s\S]*?<\/w:tbl>/)?.[0];
  const gridWidths = [...photoTable!.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)]
    .map((match) => Number(match[1]));
  const extent = [...photoTable!.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)]
    .map((match) => ({ width: Number(match[1]), height: Number(match[2]) }))[0];
  const pxPerMm = 96 / 25.4;
  const emuPerPx = 9_525;
  const contentWidthMm = 210 - 22 - 22;
  const gapMm = 6 * 25.4 / 72;
  const expectedWidthPx = Math.floor((contentWidthMm - gapMm) * pxPerMm);

  expect(gridWidths).toHaveLength(1);
  expect(extent).toBeDefined();
  expect(extent.width).toBe(expectedWidthPx * emuPerPx);
  expect(extent.width / extent.height).toBeCloseTo(3 / 4, 3);
  expect(extent.width).toBeGreaterThan(Math.round(90 * pxPerMm) * emuPerPx);
});

test("adapts each photo group independently up to the configured limit", async () => {
  const baseInspection = makeInspection();
  const firstEntry = {
    ...baseInspection.entries[0],
    id: "entry-one-photo",
    itemId: "item-one-photo",
    itemSnapshot: { ...baseInspection.entries[0].itemSnapshot, id: "item-one-photo", routeName: "一个照片项点" },
    groupIds: ["group-one-photo"],
  };
  const secondEntry = {
    ...baseInspection.entries[0],
    id: "entry-five-photos",
    itemId: "item-five-photos",
    itemSnapshot: { ...baseInspection.entries[0].itemSnapshot, id: "item-five-photos", routeName: "五个照片项点" },
    groupIds: ["group-five-photos"],
  };
  const singlePhotoId = "adaptive-single-photo";
  const photoIds = Array.from({ length: 5 }, (_, index) => `adaptive-group-photo-${index + 1}`);
  const template = makeTemplate({ photoLayoutMode: "adaptive", photosPerRow: 4 });
  const model = buildReportModel({
    inspection: {
      ...baseInspection,
      entries: [firstEntry, secondEntry],
      reviewRouteOrder: ["一个照片项点", "五个照片项点"],
    },
    groups: [
      makePhotoGroup({ id: "group-one-photo", entryId: firstEntry.id, photoIds: [singlePhotoId] }),
      makePhotoGroup({ id: "group-five-photos", entryId: secondEntry.id, photoIds, order: 1 }),
    ],
    photos: [
      makePhoto(undefined, { id: singlePhotoId, groupId: "group-one-photo" }),
      ...photoIds.map((id) => makePhoto(undefined, { id, groupId: "group-five-photos" })),
    ],
    template,
  }, template);

  const zip = await JSZip.loadAsync(await generateDocx(model, () => undefined));
  const documentXml = await zip.file("word/document.xml")!.async("string");
  const photoTables = [...documentXml.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>/g)]
    .map((match) => match[0])
    .filter((table) => table.includes("<w:drawing>"));
  const columnCounts = photoTables.map((table) => [...table.matchAll(/<w:gridCol w:w="(\d+)"\/>/g)].length);

  expect(columnCounts).toEqual([1, 4]);
});

test("uses fixed 3:4 frames for extreme portrait and landscape images", async () => {
  const { model } = layoutModel(2);
  const photos = model.sections[0].groups[0].photos;
  Object.assign(photos[0], { width: 100, height: 10_000 });
  Object.assign(photos[1], { width: 10_000, height: 100 });

  const zip = await JSZip.loadAsync(await generateDocx(model, () => undefined));
  const documentXml = await zip.file("word/document.xml")!.async("string");
  const extents = [...documentXml.matchAll(/<wp:extent cx="(\d+)" cy="(\d+)"\/>/g)]
    .map((match) => ({ width: Number(match[1]), height: Number(match[2]) }));
  const emuPerPx = 9_525;
  const pxPerMm = 96 / 25.4;
  const maxCellWidthPx = ((210 - 22 - 22) / 2 - (6 * 25.4 / 72)) * pxPerMm;
  const maxPageHeightPx = (297 - 20 - 20) * pxPerMm;

  expect(extents).toHaveLength(2);
  expect(extents[0].height).toBeLessThanOrEqual(Math.floor(maxPageHeightPx) * emuPerPx);
  expect(extents[1].width).toBeLessThanOrEqual(Math.floor(maxCellWidthPx) * emuPerPx);
  expect(new Set(extents.map(({ width, height }) => String(width) + "x" + String(height))).size).toBe(1);
  extents.forEach(({ width, height }) => {
    expect(width / height).toBeCloseTo(3 / 4, 3);
  });
});

test("packages annotation renderer output instead of the unannotated source", async () => {
  const model = fivePhotoModel();
  const photo = model.sections[0].groups[0].photos[0];
  photo.annotationJson = JSON.stringify([
    { type: "ellipse", x: 0.1, y: 0.1, width: 0.2, height: 0.2, color: "#d12f2f" },
  ]);
  model.sections[0].groups[0].photos = [photo];
  const rendered = new Blob(["annotated-image-bytes"], { type: "image/jpeg" });
  const render = vi.fn().mockResolvedValue(rendered);

  const zip = await JSZip.loadAsync(await generateDocx(model, () => undefined, {
    renderAnnotation: render,
  }));
  const media = zip.file(/^word\/media\//);

  expect(render).toHaveBeenCalledOnce();
  expect(render).toHaveBeenCalledWith(photo.imageBlob, photo.annotationJson);
  expect(media).toHaveLength(1);
  await expect(media[0].async("string")).resolves.toBe("annotated-image-bytes");
});

test("passes annotated output to the Word compressor before packaging", async () => {
  const model = fivePhotoModel();
  const photo = model.sections[0].groups[0].photos[0];
  const rendered = new Blob(["rendered-jpeg"], { type: "image/jpeg" });
  const compressed = new Blob(["compressed-jpeg"], { type: "image/jpeg" });
  const renderAnnotation = vi.fn().mockResolvedValue(rendered);
  const compressForDocx = vi.fn().mockResolvedValue(compressed);

  const zip = await JSZip.loadAsync(await generateDocx(model, () => undefined, {
    renderAnnotation,
    compressForDocx,
  }));

  expect(renderAnnotation).toHaveBeenCalledWith(photo.imageBlob, photo.annotationJson);
  expect(compressForDocx).toHaveBeenCalledWith(rendered, expect.any(Number));
  await expect(zip.file(/^word\/media\//)[0].async("string")).resolves.toBe("compressed-jpeg");
});

test("keeps an 80-photo DOCX media payload within the configured budget", async () => {
  const photoIds = Array.from({ length: 80 }, (_, index) => `budget-photo-${index + 1}`);
  const inspection = makeInspection({ templateVersion: 1 });
  const template = makeTemplate();
  const model = buildReportModel({
    inspection,
    groups: [makePhotoGroup({ photoIds })],
    photos: photoIds.map((id, index) => makePhoto(
      new Blob([`source-${index}`], { type: "image/jpeg" }),
      { id, order: index, width: 1200, height: 800 },
    )),
    template,
  }, template);
  const compressForDocx = vi.fn(async (_source: Blob, targetBytes: number) =>
    new Blob([new Uint8Array(targetBytes).fill(3)], { type: "image/jpeg" }));

  const blob = await generateDocx(model, () => undefined, {
    renderAnnotation: async (source) => source,
    compressForDocx,
  });

  expect(compressForDocx).toHaveBeenCalledTimes(80);
  expect(await embeddedMediaBytes(blob)).toBeLessThanOrEqual(DOCX_PHOTO_MEDIA_BUDGET);
  expect(blob.size).toBeLessThan(8 * 1024 * 1024);
  expect(compressForDocx).toHaveBeenCalledWith(
    expect.any(Blob),
    getDocxPhotoBudget(80).targetBytes,
  );
});

test("emits only the text line for a no-photo group without a photo table", async () => {
  const template = makeTemplate();
  const inspection = makeInspection();
  const entry = { ...inspection.entries[0], id: "entry-no-photo", groupIds: ["group-no-photo"] };
  const model = buildReportModel({
    inspection: { ...inspection, entries: [entry] },
    groups: [
      makePhotoGroup({ id: "group-no-photo", entryId: entry.id, description: "纯文字评价。", photoIds: [] }),
    ],
    photos: [makePhoto()],
    template,
  }, template);

  const zip = await JSZip.loadAsync(await generateDocx(model, () => undefined));
  const documentXml = await zip.file("word/document.xml")!.async("string");
  const body = documentXml.slice(documentXml.indexOf("<w:body>"), documentXml.indexOf("</w:body>"));

  expect(body).toContain("纯文字评价。");
  expect(body).not.toContain("<w:tbl>");
  expect(body).not.toContain("<w:drawing>");
});
