import ExcelJS from "exceljs";
import type { ItemRepository } from "../../db/itemRepository";
import { defaultGeneralText } from "../../domain/inspection";
import type { ChecklistItem, SevenSCategory } from "../../domain/models";

export const EXCEL_HEADERS = [
  "路线顺序",
  "路线名称",
  "区域",
  "设备岗位",
  "检查部位",
  "检查标准",
  "责任工班",
  "7S类别",
  "好的表述",
  "一般表现表述",
  "提醒表述",
  "考核表述",
  "常见问题",
  "是否启用",
] as const;

const LEGACY_EXCEL_HEADERS = EXCEL_HEADERS.filter(
  (header) => header !== "一般表现表述",
);

export const ITEM_SOURCE_TIMESTAMP = "2024-05-15T00:00:00.000Z";

export type ExcelHeader = (typeof EXCEL_HEADERS)[number];
export type ImportRow = Record<ExcelHeader, unknown>;

export interface ImportError {
  row: number;
  field: string;
  message: string;
}

export interface ParsedImportItem {
  row: number;
  item: ChecklistItem;
}

export interface ParsedImport {
  items: ParsedImportItem[];
  errors: ImportError[];
}

export interface ImportPreview {
  items: ChecklistItem[];
  errors: ImportError[];
  added: string[];
  changed: string[];
  disabled: string[];
}

type StableItemKey = Pick<
  ChecklistItem,
  "routeName" | "area" | "device" | "part" | "standard"
>;
type ImportRepository = Pick<ItemRepository, "bulkPut">;

const SEVEN_S_CATEGORIES = new Set<SevenSCategory>([
  "",
  "整理",
  "整顿",
  "清扫",
  "清洁",
  "素养",
  "安全",
  "节约",
]);

const REQUIRED_TEXT_FIELDS = [
  ["路线名称", "routeName"],
  ["区域", "area"],
  ["检查部位", "part"],
  ["检查标准", "standard"],
  ["责任工班", "team"],
  ["好的表述", "goodText"],
  ["一般表现表述", "generalText"],
  ["提醒表述", "reminderText"],
  ["考核表述", "assessmentText"],
] as const;

const COMPARABLE_FIELDS = [
  "routeOrder",
  "routeName",
  "area",
  "device",
  "part",
  "standard",
  "team",
  "sevenSCategory",
  "goodText",
  "generalText",
  "reminderText",
  "assessmentText",
  "quickPhrases",
  "enabled",
] as const satisfies readonly (keyof ChecklistItem)[];

export function normalizeItemIdPart(value: string): string {
  return value.trim().replace(/[\s\u3000]+/gu, " ");
}

function stableItemIdentity(key: StableItemKey): string {
  return [key.routeName, key.area, key.device, key.part, key.standard]
    .map(normalizeItemIdPart)
    .join("\u001f");
}

export async function deriveChecklistItemId(key: StableItemKey): Promise<string> {
  const canonicalKey = stableItemIdentity(key);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalKey),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

function requiredText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  return typeof value === "string" ? value.trim() : null;
}

function positiveInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string" && /^[1-9]\d*$/u.test(value.trim())) {
    return Number(value.trim());
  }
  return null;
}

function addError(errors: ImportError[], row: number, field: string, message: string): void {
  errors.push({ row, field, message });
}

export async function validateImportRows(
  rows: readonly Partial<ImportRow>[],
  firstExcelRow = 2,
  sourceRowNumbers?: readonly number[],
  timestamp = new Date().toISOString(),
): Promise<ParsedImport> {
  const errors: ImportError[] = [];
  const candidates: ParsedImportItem[] = [];

  for (const [index, sourceRow] of rows.entries()) {
    const excelRow = sourceRowNumbers?.[index] ?? firstExcelRow + index;
    const routeOrder = positiveInteger(sourceRow["路线顺序"]);
    if (routeOrder === null) {
      addError(errors, excelRow, "路线顺序", "路线顺序必须为正整数。");
    }

    const texts: Partial<Record<(typeof REQUIRED_TEXT_FIELDS)[number][1], string>> = {};
    for (const [header, property] of REQUIRED_TEXT_FIELDS) {
      const value = property === "generalText"
        ? optionalText(sourceRow[header])
        : requiredText(sourceRow[header]);
      if (value === null) {
        addError(errors, excelRow, header, `${header}必须为非空文本。`);
      } else {
        texts[property] = value;
      }
    }

    const device = optionalText(sourceRow["设备岗位"]);
    if (device === null) {
      addError(errors, excelRow, "设备岗位", "设备岗位必须为文本或空值。");
    }

    const categoryValue = optionalText(sourceRow["7S类别"]);
    const sevenSCategory =
      categoryValue !== null && SEVEN_S_CATEGORIES.has(categoryValue as SevenSCategory)
        ? (categoryValue as SevenSCategory)
        : null;
    if (sevenSCategory === null) {
      addError(errors, excelRow, "7S类别", "7S类别必须为空或七个合法类别之一。");
    }

    const quickPhraseText = optionalText(sourceRow["常见问题"]);
    if (quickPhraseText === null) {
      addError(errors, excelRow, "常见问题", "常见问题必须为文本或空值。");
    }

    const enabledValue = optionalText(sourceRow["是否启用"]);
    const enabled = enabledValue === "是" ? true : enabledValue === "否" ? false : null;
    if (enabled === null) {
      addError(errors, excelRow, "是否启用", "是否启用只能填写“是”或“否”。");
    }

    if (errors.some((error) => error.row === excelRow)) {
      continue;
    }

    const stableKey = {
      routeName: texts.routeName!,
      area: texts.area!,
      device: device!,
      part: texts.part!,
      standard: texts.standard!,
    };
    candidates.push({
      row: excelRow,
      item: {
        id: await deriveChecklistItemId(stableKey),
        routeOrder: routeOrder!,
        ...stableKey,
        team: texts.team!,
        sevenSCategory: sevenSCategory!,
        goodText: texts.goodText!,
        generalText: texts.generalText || defaultGeneralText(stableKey),
        reminderText: texts.reminderText!,
        assessmentText: texts.assessmentText!,
        quickPhrases: quickPhraseText!
          .split("|")
          .map((phrase) => phrase.trim())
          .filter(Boolean),
        enabled: enabled!,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    });
  }

  const rowsById = new Map<string, number[]>();
  for (const candidate of candidates) {
    const duplicateRows = rowsById.get(candidate.item.id) ?? [];
    duplicateRows.push(candidate.row);
    rowsById.set(candidate.item.id, duplicateRows);
  }
  const duplicateIds = new Set(
    [...rowsById.entries()].filter(([, duplicateRows]) => duplicateRows.length > 1).map(([id]) => id),
  );
  for (const candidate of candidates) {
    if (duplicateIds.has(candidate.item.id)) {
      const duplicateRows = rowsById.get(candidate.item.id)!;
      addError(
        errors,
        candidate.row,
        "检查部位",
        `派生 ID 与工作簿第 ${duplicateRows.filter((row) => row !== candidate.row).join("、")} 行重复。`,
      );
    }
  }

  return {
    items: candidates.filter((candidate) => !duplicateIds.has(candidate.item.id)),
    errors: errors.sort((left, right) => left.row - right.row),
  };
}

function cellText(cell: ExcelJS.Cell): string {
  return cell.text;
}

export async function parseChecklistWorkbook(
  file: Blob | ArrayBuffer | Uint8Array,
): Promise<ParsedImport> {
  const workbook = new ExcelJS.Workbook();
  const bytes = file instanceof Blob ? await file.arrayBuffer() : file;
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    return { items: [], errors: [{ row: 1, field: "工作表", message: "工作簿没有工作表。" }] };
  }

  const actualHeaders = Array.from(
    { length: worksheet.actualColumnCount },
    (_, index) => cellText(worksheet.getRow(1).getCell(index + 1)),
  );
  const expectedHeaders = actualHeaders.length === LEGACY_EXCEL_HEADERS.length
    ? LEGACY_EXCEL_HEADERS
    : EXCEL_HEADERS;
  const headerErrors: ImportError[] = [];
  for (const [index, expected] of expectedHeaders.entries()) {
    if (actualHeaders[index] !== expected) {
      addError(headerErrors, 1, expected, `第 ${index + 1} 列表头必须为“${expected}”。`);
    }
  }
  if (actualHeaders.length !== expectedHeaders.length) {
    addError(
      headerErrors,
      1,
      "表头",
      `工作表必须恰好包含 ${EXCEL_HEADERS.length} 列，或使用旧版 ${LEGACY_EXCEL_HEADERS.length} 列表头。`,
    );
  }
  if (new Set(actualHeaders).size !== actualHeaders.length) {
    addError(headerErrors, 1, "表头", "工作表表头不得重复。");
  }
  if (headerErrors.length > 0) {
    return { items: [], errors: headerErrors };
  }

  const rows: Partial<ImportRow>[] = [];
  const sourceRowNumbers: number[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const worksheetRow = worksheet.getRow(rowNumber);
    if (!worksheetRow.hasValues) {
      continue;
    }
    const sourceRow: Partial<ImportRow> = {};
    for (const [index, header] of expectedHeaders.entries()) {
      const cell = worksheetRow.getCell(index + 1);
      sourceRow[header] = cell.value;
    }
    rows.push(sourceRow);
    sourceRowNumbers.push(rowNumber);
  }
  return validateImportRows(rows, 2, sourceRowNumbers);
}

function itemsEqual(left: ChecklistItem, right: ChecklistItem): boolean {
  return COMPARABLE_FIELDS.every((field) => {
    if (field === "quickPhrases") {
      return JSON.stringify(left[field]) === JSON.stringify(right[field]);
    }
    return left[field] === right[field];
  });
}

export function buildImportPreview(
  parsed: ParsedImport,
  existingItems: readonly ChecklistItem[],
): ImportPreview {
  const existingById = new Map(existingItems.map((item) => [item.id, item]));
  const existingByIdentity = new Map<string, ChecklistItem[]>();
  for (const existing of existingItems) {
    const identity = stableItemIdentity(existing);
    const matches = existingByIdentity.get(identity) ?? [];
    matches.push(existing);
    existingByIdentity.set(identity, matches);
  }
  const errors = [...parsed.errors];
  const items: ChecklistItem[] = [];
  for (const { row, item } of parsed.items) {
    let existing = existingById.get(item.id);
    if (!existing) {
      const matches = existingByIdentity.get(stableItemIdentity(item)) ?? [];
      if (matches.length > 1) {
        addError(
          errors,
          row,
          "检查标准",
          `现有项点中有 ${matches.length} 条与该行的路线、区域、设备、部位和检查标准完全一致，无法确定应复用的 ID。请先处理重复项。`,
        );
        continue;
      }
      [existing] = matches;
    }
    if (!existing) {
      items.push(item);
      continue;
    }
    const matchedItem = item.id === existing.id ? item : { ...item, id: existing.id };
    items.push(
      itemsEqual(existing, matchedItem)
        ? existing
        : { ...matchedItem, createdAt: existing.createdAt },
    );
  }
  const added: string[] = [];
  const changed: string[] = [];
  const disabled: string[] = [];

  for (const item of items) {
    const existing = existingById.get(item.id);
    if (!existing) {
      added.push(item.id);
    } else if (existing.enabled && !item.enabled) {
      disabled.push(item.id);
    } else if (!itemsEqual(existing, item)) {
      changed.push(item.id);
    }
  }

  return {
    items,
    errors: errors.sort((left, right) => left.row - right.row),
    added,
    changed,
    disabled,
  };
}

export async function applyItemImport(
  preview: ImportPreview,
  repository: ImportRepository,
): Promise<void> {
  if (preview.errors.length > 0) {
    throw new Error("导入校验失败，请修正后重新导入。");
  }
  const changedIds = new Set([...preview.added, ...preview.changed, ...preview.disabled]);
  const itemsToWrite = preview.items.filter((item) => changedIds.has(item.id));
  if (itemsToWrite.length > 0) {
    await repository.bulkPut(itemsToWrite);
  }
}
