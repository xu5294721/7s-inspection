import type {
  ChecklistItem,
  Inspection,
  PhotoAsset,
  PhotoGroup,
  ReportTemplate,
} from "../domain/models";

export function makeChecklistItem(overrides: Partial<ChecklistItem> = {}): ChecklistItem {
  return {
    id: "item-1",
    routeOrder: 1,
    routeName: "焊机间",
    area: "二线焊机",
    device: "焊机",
    part: "油缸",
    standard: "油缸表面无积灰、油泥",
    team: "焊接工班",
    sevenSCategory: "清扫",
    goodText: "油缸表面清理较干净。",
    generalText: "油缸7S管理基本落实，但现场标准仍有提升空间。",
    reminderText: "油缸表面清理不到位，本次予以提醒。",
    assessmentText: "油缸表面积灰、油泥未清理。",
    quickPhrases: ["积灰未清理", "油泥未清理"],
    enabled: true,
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    ...overrides,
  };
}

export function makeInspection(overrides: Partial<Inspection> = {}): Inspection {
  const item = makeChecklistItem();
  const { enabled: _enabled, createdAt: _createdAt, updatedAt: _updatedAt, ...itemSnapshot } = item;

  return {
    id: "inspection-1",
    inspectionDate: "2026-07-28",
    title: "向塘钢轨焊接整修车间7月28日7S巡检通报",
    templateId: "template-default",
    templateVersion: 1,
    photoLayoutModeOverride: null,
    photosPerRowOverride: null,
    status: "draft",
    entries: [
      {
        id: "entry-1",
        inspectionId: "inspection-1",
        itemId: item.id,
        itemSnapshot,
        checkSelections: [],
        groupIds: ["group-1"],
        order: 0,
      },
    ],
    createdAt: "2026-07-28T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

export function makePhotoGroup(overrides: Partial<PhotoGroup> = {}): PhotoGroup {
  return {
    id: "group-1",
    inspectionId: "inspection-1",
    entryId: "entry-1",
    category: "good",
    description: "油缸表面清理较干净。",
    awardAssessment: null,
    photoIds: ["photo-1"],
    order: 0,
    ...overrides,
  };
}

export function makePhoto(
  imageBlob = new Blob(["image"], { type: "image/jpeg" }),
  overrides: Partial<PhotoAsset> = {},
): PhotoAsset {
  return {
    id: "photo-1",
    inspectionId: "inspection-1",
    groupId: "group-1",
    capturedAt: "2026-07-28T00:00:00.000Z",
    order: 0,
    imageBlob,
    thumbnailBlob: new Blob(["thumb"], { type: "image/jpeg" }),
    width: 1200,
    height: 1600,
    highQuality: false,
    annotationJson: null,
    ...overrides,
  };
}

export function makeTemplate(overrides: Partial<ReportTemplate> = {}): ReportTemplate {
  return {
    id: "template-default",
    version: 1,
    name: "默认模板",
    titlePattern: "{date}7S巡检通报",
    openingText: "现将巡检情况通报如下。",
    requirements: ["请责任工班按要求整改。"],
    closingText: "请各工班举一反三，持续抓好现场7S管理。",
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
    signatureDatePattern: "YYYY年M月D日",
    ...overrides,
  };
}
