import JSZip from "jszip";
import { makeInspection, makePhoto, makePhotoGroup, makeTemplate } from "../../test/fixtures";
import { generateDocx } from "./generateDocx";
import { buildReportModel } from "./reportModel";

function attribute(tag: string, name: string): string | null {
  return new RegExp(`\\b${name}="([^"]+)"`).exec(tag)?.[1] ?? null;
}

async function drawingReferences(blob: Blob) {
  const zip = await JSZip.loadAsync(blob);
  const documentXml = await zip.file("word/document.xml")!.async("string");
  const relationshipsXml = await zip.file("word/_rels/document.xml.rels")!.async("string");
  const targets = new Map(
    [...relationshipsXml.matchAll(/<Relationship\b[^>]*\/?\s*>/g)]
      .map((match) => match[0])
      .filter((tag) => attribute(tag, "Type")?.endsWith("/image"))
      .map((tag) => [attribute(tag, "Id")!, `word/${attribute(tag, "Target")!}`]),
  );
  return [...documentXml.matchAll(/<w:drawing\b[\s\S]*?<\/w:drawing>/g)].map((match) => {
    const drawing = match[0];
    const properties = /<wp:docPr\b[^>]*\/?\s*>/.exec(drawing)![0];
    const blip = /<a:blip\b[^>]*\/?\s*>/.exec(drawing)![0];
    const photoId = attribute(properties, "descr")!;
    const relationshipId = attribute(blip, "r:embed")!;
    const target = targets.get(relationshipId)!;
    return { photoId, relationshipId, target, media: zip.file(target) };
  });
}

test("processes 100 realistic photos with bounded temporary bytes and complete references", async () => {
  let fullImageArrayBufferCalls = 0;
  let totalStreamedBytes = 0;
  let maxTemporaryChunkBytes = 0;
  class TrackedImageBlob extends Blob {
    readonly payload: Uint8Array<ArrayBuffer>;

    constructor(payload: Uint8Array<ArrayBuffer>) {
      super([payload], { type: "image/jpeg" });
      this.payload = payload;
    }

    override async arrayBuffer(): Promise<ArrayBuffer> {
      fullImageArrayBufferCalls += 1;
      return super.arrayBuffer();
    }

    override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
      let offset = 0;
      return new ReadableStream<Uint8Array<ArrayBuffer>>({
        pull: (controller) => {
          if (offset >= this.payload.byteLength) {
            controller.close();
            return;
          }
          const nextOffset = Math.min(offset + 64 * 1024, this.payload.byteLength);
          const chunk = this.payload.slice(offset, nextOffset);
          totalStreamedBytes += chunk.byteLength;
          maxTemporaryChunkBytes = Math.max(maxTemporaryChunkBytes, chunk.byteLength);
          controller.enqueue(chunk);
          offset = nextOffset;
        },
      });
    }
  }

  const photoIds = Array.from({ length: 100 }, (_, index) => `stress-photo-${index + 1}`);
  const inspection = makeInspection({ templateVersion: 1 });
  const template = makeTemplate();
  const model = buildReportModel({
    inspection,
    groups: [makePhotoGroup({ photoIds })],
    photos: photoIds.map((id, index) => makePhoto(
      new Blob([new Uint8Array(256 * 1024).fill(index)], { type: "image/jpeg" }),
      { id, order: index, width: 1200, height: 800 },
    )),
    template,
  }, template);
  let activeRenders = 0;
  let maxActiveRenders = 0;
  let renderedIndex = 0;
  const progress: Array<{ completedImages: number; totalImages: number; phase: string }> = [];

  const blob = await generateDocx(model, (update) => progress.push(update), {
    renderAnnotation: async (source) => {
      activeRenders += 1;
      maxActiveRenders = Math.max(maxActiveRenders, activeRenders);
      await Promise.resolve();
      activeRenders -= 1;
      renderedIndex += 1;
      return new TrackedImageBlob(new Uint8Array(source.size).fill(renderedIndex));
    },
    compressForDocx: async (source) => source,
  });

  const references = await drawingReferences(blob);
  const imageProgress = progress.filter((update) => update.phase === "images");
  expect(blob.size).toBeGreaterThan(25 * 1024 * 1024);
  expect(fullImageArrayBufferCalls).toBe(0);
  expect(totalStreamedBytes).toBe(100 * 256 * 1024);
  expect(maxTemporaryChunkBytes).toBe(64 * 1024);
  expect(maxActiveRenders).toBe(1);
  expect(references).toHaveLength(100);
  expect(references.map((reference) => reference.photoId)).toEqual(photoIds);
  expect(new Set(references.map((reference) => reference.relationshipId)).size).toBe(100);
  expect(new Set(references.map((reference) => reference.target)).size).toBe(100);
  references.forEach((reference) => expect(reference.media).not.toBeNull());
  expect(imageProgress.map((update) => update.completedImages)).toEqual(
    Array.from({ length: 100 }, (_, index) => index + 1),
  );
  expect(progress.slice(-2)).toEqual([
    { completedImages: 100, totalImages: 100, phase: "document" },
    { completedImages: 100, totalImages: 100, phase: "save" },
  ]);
}, 30_000);
