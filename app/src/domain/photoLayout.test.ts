import { makeInspection, makeTemplate } from "../test/fixtures";
import { inspectionRecordSchema, reportTemplateSchema } from "./schemas";
import { columnsForPhotoCount } from "./photoLayout";

test.each([
  ["adaptive", 4, 1, 1],
  ["adaptive", 4, 2, 2],
  ["adaptive", 4, 4, 4],
  ["adaptive", 4, 5, 4],
  ["fixed", 2, 1, 2],
  ["fixed", 2, 5, 2],
])("calculates %s layout columns", (mode, limit, count, expected) => {
  expect(columnsForPhotoCount(mode as "adaptive" | "fixed", limit as 1 | 2 | 3 | 4, count)).toBe(expected);
});

test("accepts 1 to 4 rows and defaults missing persisted mode to fixed", () => {
  const parsedTemplate = reportTemplateSchema.parse({
    ...makeTemplate(),
    photosPerRow: 1,
  }) as Record<string, unknown>;
  expect(parsedTemplate.photosPerRow).toBe(1);

  const legacyTemplate = reportTemplateSchema.parse(makeTemplate()) as Record<string, unknown>;
  expect(legacyTemplate.photoLayoutMode).toBe("fixed");

  const legacyInspection = inspectionRecordSchema.parse(makeInspection()) as Record<string, unknown>;
  expect(legacyInspection.photoLayoutModeOverride).toBeNull();
});
