import type { InspectionCheckCategory, InspectionCheckSelection } from "./models";

interface InspectionCheckDefinition {
  category: InspectionCheckCategory;
  label: string;
  options: readonly string[];
}

export const INSPECTION_CHECK_DEFINITIONS = [
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
] as const satisfies readonly InspectionCheckDefinition[];

export class InspectionCheckSelectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InspectionCheckSelectionValidationError";
  }
}

const definitionsByCategory = new Map(
  INSPECTION_CHECK_DEFINITIONS.map((definition) => [definition.category, definition]),
);

function requireDefinition(category: InspectionCheckCategory): InspectionCheckDefinition {
  const definition = definitionsByCategory.get(category);
  if (!definition) {
    throw new InspectionCheckSelectionValidationError("\u68c0\u67e5\u5185\u5bb9\u7c7b\u522b\u65e0\u6548\u3002");
  }
  return definition;
}

export function normalizeInspectionCheckSelections(
  selections: readonly InspectionCheckSelection[],
): InspectionCheckSelection[] {
  const selectionsByCategory = new Map<InspectionCheckCategory, InspectionCheckSelection>();

  for (const selection of selections) {
    const definition = requireDefinition(selection.category);
    if (selectionsByCategory.has(definition.category)) {
      throw new InspectionCheckSelectionValidationError("\u68c0\u67e5\u5185\u5bb9\u7c7b\u522b\u4e0d\u80fd\u91cd\u590d\u3002");
    }

    const value = selection.value.trim();
    if (selection.isCustom) {
      if (!value) {
        throw new InspectionCheckSelectionValidationError("\u81ea\u5b9a\u4e49\u68c0\u67e5\u5185\u5bb9\u4e0d\u80fd\u4e3a\u7a7a\u3002");
      }
    } else if (!definition.options.includes(value)) {
      throw new InspectionCheckSelectionValidationError("\u56fa\u5b9a\u68c0\u67e5\u5185\u5bb9\u65e0\u6548\u3002");
    }

    selectionsByCategory.set(definition.category, {
      category: definition.category,
      value,
      isCustom: selection.isCustom,
    });
  }

  return INSPECTION_CHECK_DEFINITIONS.flatMap((definition) => {
    const selection = selectionsByCategory.get(definition.category);
    return selection ? [selection] : [];
  });
}

export function formatInspectionCheckSummary(
  selections: readonly InspectionCheckSelection[],
  separator: "\u3001" | "\uff0c" = "\u3001",
): string {
  return normalizeInspectionCheckSelections(selections)
    .map((selection) => `${requireDefinition(selection.category).label}${selection.value}`)
    .join(separator);
}

export function formatInspectionEvaluationDescription(
  routeName: string,
  selections: readonly InspectionCheckSelection[],
): string {
  const summary = formatInspectionCheckSummary(selections, "\uff0c");
  return summary ? `${routeName}：${summary}。` : "";
}
