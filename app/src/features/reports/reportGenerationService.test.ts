// @vitest-environment node

import { afterEach, vi } from "vitest";
import { createTestDb, type SevenSDb } from "../../db/database";
import { InspectionRepository } from "../../db/inspectionRepository";
import { TemplateRepository } from "../../db/templateRepository";
import { makeInspection, makePhoto, makePhotoGroup, makeTemplate } from "../../test/fixtures";
import { generateDocx } from "./generateDocx";
import { buildReportFilename, buildReportModel } from "./reportModel";
import { generateInspectionReport, type ReportPackager } from "./reportGenerationService";

const databases: SevenSDb[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map(async (database) => {
    database.close();
    await database.delete();
  }));
});

async function readyRepository(name: string) {
  const database = createTestDb(`${name}-${Date.now()}`);
  databases.push(database);
  const repository = new InspectionRepository(database);
  const template = makeTemplate();
  await new TemplateRepository(database).save(template);
  await repository.saveGraph({
    inspection: makeInspection(),
    groups: [makePhotoGroup()],
    photos: [makePhoto(new Blob(["real-image-bytes"], { type: "image/jpeg" }))],
  });
  return { repository, database };
}

const realPackager: ReportPackager = {
  buildReportModel,
  buildReportFilename,
  generateDocx: (model, onProgress) => generateDocx(model, onProgress, {
    renderAnnotation: async (source) => source,
  }),
};

test("commits generated only after a real DOCX package succeeds", async () => {
  const { repository } = await readyRepository("report-service-success");
  const packager: ReportPackager = {
    ...realPackager,
    generateDocx: async (model, onProgress) => {
      const blob = await realPackager.generateDocx(model, onProgress);
      expect(blob.size).toBeGreaterThan(0);
      expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("draft");
      return blob;
    },
  };

  const result = await generateInspectionReport(repository, packager, "inspection-1", () => undefined);

  expect(result.blob.type).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  expect(result.graph.inspection.status).toBe("generated");
  expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("generated");
});

test.each([
  ["packager rejects", async () => { throw new Error("packaging failed"); }],
  ["packager returns invalid DOCX", async () => new Blob(["not-a-docx"], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })],
] as const)("leaves status unchanged when %s", async (_case, generate) => {
  const { repository } = await readyRepository(`report-service-failure-${_case}`);
  const packager: ReportPackager = {
    ...realPackager,
    generateDocx: vi.fn(generate),
  };

  await expect(generateInspectionReport(repository, packager, "inspection-1", () => undefined)).rejects.toThrow();
  expect((await repository.getGraph("inspection-1"))?.inspection.status).toBe("draft");
});
