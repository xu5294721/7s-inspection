import {
  INSPECTION_CHECK_DEFINITIONS,
  InspectionCheckSelectionValidationError,
  formatInspectionEvaluationDescription,
  formatInspectionCheckSummary,
  normalizeInspectionCheckSelections,
} from "./inspectionCheckContents";
import type { InspectionCheckSelection } from "./models";

test("defines the inspection check categories and options in the fixed order", () => {
  expect(INSPECTION_CHECK_DEFINITIONS).toEqual([
    {
      category: "environment",
      label: "\u73af\u5883\u536b\u751f",
      options: ["\u5e72\u51c0\u6574\u6d01", "\u57fa\u672c\u6574\u6d01", "\u6e05\u626b\u4e0d\u5230\u4f4d", "\u5b58\u5728\u79ef\u7070\u6742\u7269"],
    },
    {
      category: "placement",
      label: "\u7269\u54c1\u5b9a\u7f6e",
      options: ["\u89c4\u8303\u6709\u5e8f", "\u57fa\u672c\u89c4\u8303", "\u4e2a\u522b\u7269\u54c1\u672a\u5b9a\u7f6e", "\u6446\u653e\u6742\u4e71"],
    },
    {
      category: "equipment",
      label: "\u8bbe\u5907\u6e05\u6d01\u4fdd\u517b",
      options: ["\u6e05\u6d01\u4fdd\u517b\u826f\u597d", "\u8868\u9762\u65e0\u79ef\u7070\u6cb9\u6c61", "\u6e05\u6d01\u4fdd\u517b\u4e0d\u5230\u4f4d", "\u5b58\u5728\u79ef\u7070\u6cb9\u6c61"],
    },
    {
      category: "safety",
      label: "\u5b89\u5168\u9632\u62a4",
      options: ["\u9632\u62a4\u63aa\u65bd\u9f50\u5168", "\u6d88\u9632\u8bbe\u65bd\u72b6\u6001\u826f\u597d", "\u5b89\u5168\u901a\u9053\u7545\u901a", "\u5b58\u5728\u5b89\u5168\u9690\u60a3"],
    },
  ]);
});

test("normalizes fixed and custom selections, trims values, and sorts categories", () => {
  const selections: InspectionCheckSelection[] = [
    { category: "safety", value: "  \u5b89\u5168\u901a\u9053\u7545\u901a  ", isCustom: false },
    { category: "environment", value: "  \u81ea\u5b9a\u4e49\u6e05\u6d01\u8981\u6c42  ", isCustom: true },
  ];

  expect(normalizeInspectionCheckSelections(selections)).toEqual([
    { category: "environment", value: "\u81ea\u5b9a\u4e49\u6e05\u6d01\u8981\u6c42", isCustom: true },
    { category: "safety", value: "\u5b89\u5168\u901a\u9053\u7545\u901a", isCustom: false },
  ]);
  expect(selections[0]?.value).toBe("  \u5b89\u5168\u901a\u9053\u7545\u901a  ");
});

test("formats normalized selections with labels and the requested separator", () => {
  const selections: InspectionCheckSelection[] = [
    { category: "placement", value: "\u89c4\u8303\u6709\u5e8f", isCustom: false },
    { category: "environment", value: "\u5e72\u51c0\u6574\u6d01", isCustom: false },
  ];

  expect(formatInspectionCheckSummary(selections)).toBe("\u73af\u5883\u536b\u751f\u5e72\u51c0\u6574\u6d01\u3001\u7269\u54c1\u5b9a\u7f6e\u89c4\u8303\u6709\u5e8f");
  expect(formatInspectionCheckSummary(selections, "\uff0c")).toBe("\u73af\u5883\u536b\u751f\u5e72\u51c0\u6574\u6d01\uff0c\u7269\u54c1\u5b9a\u7f6e\u89c4\u8303\u6709\u5e8f");
  expect(formatInspectionCheckSummary([])).toBe("");
});

test("formats selected checks as the evaluation description used by field, review, and Word", () => {
  expect(formatInspectionEvaluationDescription("卷扬机间", [
    { category: "placement", value: "规范有序", isCustom: false },
    { category: "environment", value: "干净整洁", isCustom: false },
  ])).toBe("卷扬机间：环境卫生干净整洁，物品定置规范有序。");
  expect(formatInspectionEvaluationDescription("卷扬机间", [])).toBe("");
});

test("rejects duplicate categories", () => {
  expect(() => normalizeInspectionCheckSelections([
    { category: "environment", value: "\u5e72\u51c0\u6574\u6d01", isCustom: false },
    { category: "environment", value: "\u57fa\u672c\u6574\u6d01", isCustom: false },
  ])).toThrow(InspectionCheckSelectionValidationError);
  expect(() => normalizeInspectionCheckSelections([
    { category: "environment", value: "\u5e72\u51c0\u6574\u6d01", isCustom: false },
    { category: "environment", value: "\u57fa\u672c\u6574\u6d01", isCustom: false },
  ])).toThrow("\u68c0\u67e5\u5185\u5bb9\u7c7b\u522b\u4e0d\u80fd\u91cd\u590d\u3002");
});

test("rejects unknown categories", () => {
  const selections = [
    { category: "unknown", value: "value", isCustom: true },
  ] as unknown as InspectionCheckSelection[];

  expect(() => normalizeInspectionCheckSelections(selections)).toThrow("\u68c0\u67e5\u5185\u5bb9\u7c7b\u522b\u65e0\u6548\u3002");
});

test("rejects a fixed option outside its category", () => {
  expect(() => normalizeInspectionCheckSelections([
    { category: "environment", value: "\u89c4\u8303\u6709\u5e8f", isCustom: false },
  ])).toThrow("\u56fa\u5b9a\u68c0\u67e5\u5185\u5bb9\u65e0\u6548\u3002");
});

test("rejects an empty custom value", () => {
  expect(() => normalizeInspectionCheckSelections([
    { category: "equipment", value: "   ", isCustom: true },
  ])).toThrow("\u81ea\u5b9a\u4e49\u68c0\u67e5\u5185\u5bb9\u4e0d\u80fd\u4e3a\u7a7a\u3002");
});
