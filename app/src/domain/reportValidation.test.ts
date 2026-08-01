import { reportTemplateSchema } from "./schemas";
import { validateReportReadiness } from "./reportValidation";
import type { InspectionGraph, PhotoAsset, PhotoGroup, ReportTemplate } from "./models";
import { makeTemplate } from "../test/fixtures";

const inspection = {
  id: "inspection-1",
  inspectionDate: "2026-07-28",
  title: "7S巡检通报",
  templateId: "template-1",
  templateVersion: 1,
  photoLayoutModeOverride: null,
  photosPerRowOverride: null,
  status: "draft" as const,
  entries: [
    {
      id: "entry-1",
      inspectionId: "inspection-1",
      itemId: "item-1",
      itemSnapshot: {
        id: "item-1",
        routeOrder: 1,
        routeName: "焊机间",
        area: "二线焊机",
        device: "焊机",
        part: "油缸",
        standard: "油缸表面无积灰、油污",
        team: "焊接工班",
        sevenSCategory: "清扫" as const,
        goodText: "设备清洁较好。",
        reminderText: "设备清洁不到位，本次予以提醒。",
        assessmentText: "设备卫生未按要求落实。",
        quickPhrases: [],
      },
      checkSelections: [],
      groupIds: ["group-1"],
      order: 0,
    },
  ],
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  deletedAt: null,
};

const group: PhotoGroup = {
  id: "group-1",
  inspectionId: "inspection-1",
  entryId: "entry-1",
  category: "good",
  description: "设备清洁较好。",
  awardAssessment: null,
  photoIds: ["photo-1"],
  order: 0,
};

const photo: PhotoAsset = {
  id: "photo-1",
  inspectionId: "inspection-1",
  groupId: "group-1",
  capturedAt: "2026-07-28T00:00:00.000Z",
  order: 0,
  imageBlob: new Blob(["image"]),
  thumbnailBlob: new Blob(["thumbnail"]),
  width: 100,
  height: 100,
  highQuality: false,
  annotationJson: null,
};

const template: ReportTemplate = {
  id: "template-1",
  version: 1,
  name: "默认模板",
  titlePattern: "{date}7S巡检通报",
  openingText: "现将巡检情况通报如下。",
  requirements: ["落实整改"],
  closingText: "请按要求整改。",
  organizationName: "向塘钢轨焊接整修车间",
  bodyFont: "仿宋",
  headingFont: "黑体",
  titleFont: "方正小标宋简体",
  bodyFontSizePt: 12,
  titleFontSizePt: 18,
  lineSpacing: 1.5,
  firstLineIndentChars: 2,
  marginMm: { top: 20, right: 20, bottom: 20, left: 20 },
  photoLayoutMode: "fixed",
  photosPerRow: 3,
  sections: [
    { category: "good", title: "好的方面", order: 0 },
    { category: "reminder", title: "提醒事项", order: 1 },
    { category: "assessment", title: "考核问题", order: 2 },
  ],
  photoGapPt: 6,
  signatureDatePattern: "YYYY年MM月DD日",
};

function makeGraph(overrides: Partial<InspectionGraph> = {}): InspectionGraph {
  return {
    inspection,
    groups: [group],
    photos: [photo],
    template,
    ...overrides,
  };
}

test("accepts a complete inspection graph", () => {
  expect(validateReportReadiness(makeGraph())).toEqual([]);
});

test("rejects an inspection with no persisted photos", () => {
  const errors = validateReportReadiness(makeGraph({
    inspection: { ...inspection, entries: [{ ...inspection.entries[0], checkSelections: [], groupIds: [] }] },
    groups: [],
    photos: [],
  }));

  expect(errors).toContainEqual(expect.objectContaining({
    groupId: null,
    field: "photos",
    code: "REPORT_PHOTO_REQUIRED",
  }));
});

test("rejects a missing persisted template version", () => {
  const errors = validateReportReadiness(makeGraph({ template: undefined }));

  expect(errors).toContainEqual(expect.objectContaining({
    groupId: null,
    field: "template",
    code: "TEMPLATE_NOT_FOUND",
    message: "巡检引用的报告模板版本不存在。",
  }));
});

test("rejects a template that does not match the inspection snapshot", () => {
  const errors = validateReportReadiness(makeGraph({
    template: { ...template, version: 2 },
  }));

  expect(errors).toContainEqual(expect.objectContaining({
    groupId: null,
    field: "template",
    code: "TEMPLATE_REFERENCE_MISMATCH",
    message: "报告模板版本与巡检记录不一致。",
  }));
});

test("rejects duplicate group ids without losing the duplicate evidence", () => {
  const errors = validateReportReadiness(
    makeGraph({
      groups: [group, { ...group, photoIds: ["photo-2"] }],
      photos: [photo, { ...photo, id: "photo-2" }],
    }),
  );

  expect(errors).toContainEqual(
    expect.objectContaining({
      groupId: "group-1",
      field: "id",
      code: "DUPLICATE_GROUP_ID",
      message: "照片组 ID 不能重复。",
    }),
  );
});

test("rejects duplicate group references within an inspection entry", () => {
  const errors = validateReportReadiness(
    makeGraph({
      inspection: {
        ...inspection,
        entries: [{ ...inspection.entries[0], checkSelections: [], groupIds: ["group-1", "group-1"] }],
      },
    }),
  );

  expect(errors).toContainEqual(
    expect.objectContaining({
      groupId: "group-1",
      field: "groupIds",
      code: "DUPLICATE_GROUP_REFERENCE",
      message: "巡检项点不能重复引用同一照片组。",
    }),
  );
});

test("rejects an inspection entry whose inspection id does not match the graph", () => {
  const errors = validateReportReadiness(
    makeGraph({
      inspection: {
        ...inspection,
        entries: [{ ...inspection.entries[0], inspectionId: "inspection-2", checkSelections: [] }],
      },
    }),
  );

  expect(errors).toContainEqual(
    expect.objectContaining({
      groupId: null,
      field: "entries.entry-1.inspectionId",
      code: "ENTRY_INSPECTION_MISMATCH",
      message: "巡检项点所属巡检记录不一致。",
    }),
  );
});

test("rejects empty group content", () => {
  const errors = validateReportReadiness(makeGraph({ groups: [{ ...group, description: "  ", photoIds: [] }] }));

  expect(errors.map((error) => error.code)).toEqual(["EMPTY_DESCRIPTION", "EMPTY_PHOTO_GROUP", "PHOTO_NOT_GROUPED"]);
  expect(errors[0]).toMatchObject({ groupId: "group-1", field: "description", message: "照片组说明不能为空。" });
});

test("rejects incomplete assessment details", () => {
  const errors = validateReportReadiness(
    makeGraph({ groups: [{ ...group, category: "assessment" }] }),
  );

  expect(errors.map((error) => error.code)).toEqual(["ASSESSMENT_DETAILS_REQUIRED"]);
});

test("rejects incompatible award assessment category", () => {
  const errors = validateReportReadiness(
    makeGraph({
      groups: [
        {
          ...group,
          category: "reminder",
          awardAssessment: { type: "reward", people: "张三", amount: 50 },
        },
      ],
    }),
  );

  expect(errors.map((error) => error.code)).toEqual(["CATEGORY_AWARD_INCOMPATIBLE"]);
});

test("rejects reward data in assessment category", () => {
  const errors = validateReportReadiness(
    makeGraph({
      groups: [
        {
          ...group,
          category: "assessment",
          awardAssessment: { type: "reward", people: "张三", amount: 50 },
        },
      ],
    }),
  );

  expect(errors.map((error) => error.code)).toEqual(["CATEGORY_AWARD_INCOMPATIBLE"]);
});

test("validates reward amount boundaries", () => {
  const zero = validateReportReadiness(
    makeGraph({ groups: [{ ...group, awardAssessment: { type: "reward", people: "张三", amount: 0 } }] }),
  );
  const positive = validateReportReadiness(
    makeGraph({ groups: [{ ...group, awardAssessment: { type: "reward", people: "张三", amount: 1 } }] }),
  );

  expect(zero.map((error) => error.code)).toEqual(["REWARD_DETAILS_INCOMPLETE"]);
  expect(positive).toEqual([]);
});

test("rejects decimal assessment and reward amounts", () => {
  const assessmentErrors = validateReportReadiness(
    makeGraph({
      groups: [{
        ...group,
        category: "assessment",
        awardAssessment: { type: "assessment", people: "李四", amount: 1.5 },
      }],
    }),
  );
  const rewardErrors = validateReportReadiness(
    makeGraph({
      groups: [{
        ...group,
        awardAssessment: { type: "reward", people: "张三", amount: 1.5 },
      }],
    }),
  );

  expect(assessmentErrors.map((error) => error.code)).toEqual(["ASSESSMENT_DETAILS_REQUIRED"]);
  expect(rewardErrors.map((error) => error.code)).toEqual(["REWARD_DETAILS_INCOMPLETE"]);
});

test("rejects duplicate and missing photo references", () => {
  const errors = validateReportReadiness(
    makeGraph({ groups: [{ ...group, photoIds: ["photo-1", "photo-1", "photo-missing"] }] }),
  );

  expect(errors.map((error) => error.code)).toEqual([
    "DUPLICATE_PHOTO_REFERENCE",
    "PHOTO_NOT_FOUND",
  ]);
});

test("rejects photo group mismatches and orphan photos", () => {
  const mismatch = validateReportReadiness(
    makeGraph({ photos: [{ ...photo, groupId: "group-other" }] }),
  );
  const orphan = validateReportReadiness(
    makeGraph({ groups: [{ ...group, photoIds: [] }] }),
  );

  expect(mismatch.map((error) => error.code)).toContain("PHOTO_GROUP_MISMATCH");
  expect(orphan.map((error) => error.code)).toContain("PHOTO_NOT_GROUPED");
});

test("rejects photo group foreign keys that do not exist", () => {
  const errors = validateReportReadiness(
    makeGraph({ groups: [], photos: [{ ...photo, groupId: "group-missing" }] }),
  );

  expect(errors.map((error) => error.code)).toContain("PHOTO_GROUP_NOT_FOUND");
});

test("rejects duplicate persisted photo ids", () => {
  const errors = validateReportReadiness(makeGraph({ photos: [photo, { ...photo }] }));

  expect(errors.map((error) => error.code)).toEqual(["DUPLICATE_PHOTO_ID"]);
});

test("validates complete report template structure", () => {
  const invalid = reportTemplateSchema.safeParse({
    ...template,
    sections: [{ category: "good", title: "好的方面", order: 0 }],
    photoGapPt: -1,
    signatureDatePattern: "",
  });

  expect(reportTemplateSchema.safeParse(template).success).toBe(true);
  expect(invalid.success).toBe(false);
});

test("accepts explicitly cleared optional report headings", () => {
  const parsed = reportTemplateSchema.parse({
    ...makeTemplate(),
    generalHeading: "",
    situationHeading: "",
  });

  expect(parsed.generalHeading).toBe("");
  expect(parsed.situationHeading).toBe("");
});

test("defaults a legacy template first-line indent to two characters", () => {
  const legacyTemplate = { ...makeTemplate(), firstLineIndentChars: 0 };
  delete (legacyTemplate as { firstLineIndentChars?: number }).firstLineIndentChars;
  const explicitTemplate = { ...makeTemplate(), firstLineIndentChars: 3 };

  expect(
    (reportTemplateSchema.parse(legacyTemplate) as { firstLineIndentChars: number }).firstLineIndentChars,
  ).toBe(2);
  expect(
    (reportTemplateSchema.parse(explicitTemplate) as { firstLineIndentChars: number }).firstLineIndentChars,
  ).toBe(3);
});

test("rejects duplicate template section categories", () => {
  const result = reportTemplateSchema.safeParse({
    ...template,
    sections: [...template.sections, { category: "good", title: "重复章节", order: 3 }],
  });

  expect(result.success).toBe(false);
});
