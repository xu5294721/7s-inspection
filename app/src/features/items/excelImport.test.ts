import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import ExcelJS from "exceljs";
import defaultItems from "../../data/default-checklist-items.json";
import idVectors from "./excel-import-id-vectors.json";
import {
  EXCEL_HEADERS,
  applyItemImport,
  buildImportPreview,
  deriveChecklistItemId,
  parseChecklistWorkbook,
  validateImportRows,
  type ImportRow,
} from "./excelImport";
import type { ChecklistItem } from "../../domain/models";

const execFileAsync = promisify(execFile);

const completeRow: ImportRow = {
  路线顺序: 1,
  路线名称: "焊机间",
  区域: "二线焊机",
  设备岗位: "焊机",
  检查部位: "油缸",
  检查标准: "表面无积灰、油泥",
  责任工班: "焊接工班",
  "7S类别": "清扫",
  好的表述: "油缸表面清理较干净。",
  一般表现表述: "油缸表面基本清洁，但标准化保养仍有提升空间。",
  提醒表述: "油缸表面清理不到位，本次予以提醒。",
  考核表述: "油缸表面积灰、油泥未清理。",
  常见问题: "积灰未清理| 油泥未清理 ||",
  是否启用: "是",
};

function row(overrides: Partial<ImportRow> = {}): ImportRow {
  return { ...completeRow, ...overrides };
}

function existingItem(overrides: Partial<ChecklistItem>): ChecklistItem {
  return {
    id: "existing",
    routeOrder: 99,
    routeName: "旧路线",
    area: "旧区域",
    device: "",
    part: "旧部位",
    standard: "旧标准",
    team: "旧班组",
    sevenSCategory: "",
    goodText: "旧好的表述",
    generalText: "旧一般表现表述",
    reminderText: "旧提醒表述",
    assessmentText: "旧考核表述",
    quickPhrases: [],
    enabled: true,
    createdAt: "2024-05-15T00:00:00.000Z",
    updatedAt: "2024-05-15T00:00:00.000Z",
    ...overrides,
  };
}

function importRowForItem(item: ChecklistItem, overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    路线顺序: item.routeOrder,
    路线名称: item.routeName,
    区域: item.area,
    设备岗位: item.device,
    检查部位: item.part,
    检查标准: item.standard,
    责任工班: item.team,
    "7S类别": item.sevenSCategory,
    好的表述: item.goodText,
    一般表现表述: item.generalText ?? "",
    提醒表述: item.reminderText,
    考核表述: item.assessmentText,
    常见问题: item.quickPhrases.join("|"),
    是否启用: item.enabled ? "是" : "否",
    ...overrides,
  };
}

describe("stable checklist item IDs", () => {
  test.each(idVectors)("matches the five-field Excel import SHA-256 fixture for $id", async (vector) => {
    await expect(deriveChecklistItemId(vector)).resolves.toBe(vector.id);
  });

  test("uses normalized inspection standards to distinguish items at the same location", async () => {
    const base = {
      routeName: "焊机间",
      area: "二线焊机",
      device: "焊机",
      part: "油缸",
    };

    await expect(deriveChecklistItemId({ ...base, standard: "表面无积灰" })).resolves.not.toBe(
      await deriveChecklistItemId({ ...base, standard: "表面无油泥" }),
    );
    await expect(deriveChecklistItemId({ ...base, standard: "  表面　无积灰\n" })).resolves.toBe(
      await deriveChecklistItemId({ ...base, standard: "表面 无积灰" }),
    );
  });
});

describe("validateImportRows", () => {
  test("accepts a valid row, trims phrases, and allows an empty device", async () => {
    const result = await validateImportRows([row({ 设备岗位: "" })]);

    expect(result.errors).toEqual([]);
    expect(result.items[0].item).toMatchObject({
      device: "",
      sevenSCategory: "清扫",
      enabled: true,
      quickPhrases: ["积灰未清理", "油泥未清理"],
    });
  });

  test("uses the independent general-performance text or a legacy fallback", async () => {
    const withGeneralText = await validateImportRows([row()]);
    const legacy = await validateImportRows([row({ 一般表现表述: "" })]);

    expect(withGeneralText.items[0]?.item.generalText).toBe("油缸表面基本清洁，但标准化保养仍有提升空间。");
    expect(legacy.items[0]?.item.generalText).toBe("油缸7S管理基本落实，但现场标准仍有提升空间。");
  });

  test("reports exact Excel rows and Chinese field names", async () => {
    const result = await validateImportRows([
      row({ 路线顺序: "abc", 路线名称: "", "7S类别": "卫生", 是否启用: "true" }),
    ]);

    expect(result.items).toEqual([]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 2, field: "路线顺序" }),
        expect.objectContaining({ row: 2, field: "路线名称" }),
        expect.objectContaining({ row: 2, field: "7S类别" }),
        expect.objectContaining({ row: 2, field: "是否启用" }),
      ]),
    );
  });

  test("reports every workbook row that derives a duplicate ID", async () => {
    const result = await validateImportRows([row(), row({ 好的表述: "后到行不得覆盖" })]);

    expect(result.items).toEqual([]);
    expect(result.errors.filter((error) => error.field === "检查部位").map((error) => error.row)).toEqual([
      2,
      3,
    ]);
  });
});

describe("parseChecklistWorkbook", () => {
  test("reads only the first worksheet and requires the exact ordered headers", async () => {
    const workbook = new ExcelJS.Workbook();
    const first = workbook.addWorksheet("导入模板");
    first.addRow(EXCEL_HEADERS);
    first.addRow(EXCEL_HEADERS.map((header) => completeRow[header]));
    const ignored = workbook.addWorksheet("忽略");
    ignored.addRow(["错误表头"]);

    const parsed = await parseChecklistWorkbook(await workbook.xlsx.writeBuffer());

    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toHaveLength(1);

    const invalidWorkbook = new ExcelJS.Workbook();
    invalidWorkbook.addWorksheet("错误").addRow([...EXCEL_HEADERS].reverse());
    const invalid = await parseChecklistWorkbook(await invalidWorkbook.xlsx.writeBuffer());
    expect(invalid.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ row: 1, field: "路线顺序" })]),
    );
  });

  test("accepts the legacy 13-column workbook shape", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("旧导入模板");
    const legacyHeaders = EXCEL_HEADERS.filter((header) => header !== "一般表现表述");
    worksheet.addRow(legacyHeaders);
    worksheet.addRow(legacyHeaders.map((header) => completeRow[header]));

    const parsed = await parseChecklistWorkbook(await workbook.xlsx.writeBuffer());

    expect(parsed.errors).toEqual([]);
    expect(parsed.items[0]?.item.generalText).toBe("油缸7S管理基本落实，但现场标准仍有提升空间。");
  });

  test("preserves physical Excel row numbers when blank rows are skipped", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("导入模板");
    worksheet.addRow(EXCEL_HEADERS);
    worksheet.addRow(EXCEL_HEADERS.map((header) => completeRow[header]));
    for (const [index, header] of EXCEL_HEADERS.entries()) {
      worksheet.getRow(4).getCell(index + 1).value =
        header === "路线顺序" ? "not-a-number" : String(completeRow[header] ?? "");
    }

    const parsed = await parseChecklistWorkbook(await workbook.xlsx.writeBuffer());

    expect(parsed.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ row: 4, field: "路线顺序" })]),
    );
  });

  test("rejects numeric required text cells while accepting numeric and string route orders", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("导入模板");
    worksheet.addRow(EXCEL_HEADERS);
    worksheet.addRow(EXCEL_HEADERS.map((header) => (header === "路线名称" ? 123 : completeRow[header])));
    worksheet.addRow(
      EXCEL_HEADERS.map((header) =>
        header === "路线顺序" ? "2" : header === "路线名称" ? "字符串路线" : completeRow[header],
      ),
    );

    const parsed = await parseChecklistWorkbook(await workbook.xlsx.writeBuffer());

    expect(parsed.errors).toContainEqual({ row: 2, field: "路线名称", message: "路线名称必须为非空文本。" });
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].row).toBe(3);
    expect(parsed.items[0].item.routeOrder).toBe(2);
  });

  test("round trips the generated example workbook", async () => {
    const bytes = await readFile(resolve(process.cwd(), "public/fixtures/checklist-import-template.xlsx"));

    const parsed = await parseChecklistWorkbook(bytes);

    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0].item).toMatchObject({ routeName: "焊机间", device: "", enabled: true });
  });

  test("generates byte-identical templates that still round trip through the importer", async () => {
    const templatePath = resolve(process.cwd(), "public/fixtures/checklist-import-template.xlsx");
    const generator = "scripts/generate-checklist-import-template.mjs";

    await execFileAsync(process.execPath, [generator], { cwd: process.cwd() });
    const first = await readFile(templatePath);
    await execFileAsync(process.execPath, [generator], { cwd: process.cwd() });
    const second = await readFile(templatePath);

    expect(second.equals(first)).toBe(true);
    expect(createHash("sha256").update(second).digest("hex")).toBe(
      createHash("sha256").update(first).digest("hex"),
    );
    await expect(parseChecklistWorkbook(second)).resolves.toMatchObject({
      errors: [],
      items: [expect.any(Object)],
    });
  });
});

describe("buildImportPreview and applyItemImport", () => {
  test("reuses a legacy default ID when an unchanged five-field Excel row matches uniquely", async () => {
    const legacyDefault = defaultItems[0] as ChecklistItem;
    const parsed = await validateImportRows(
      [importRowForItem(legacyDefault)],
      2,
      undefined,
      legacyDefault.updatedAt,
    );
    expect(parsed.items[0].item.id).not.toBe(legacyDefault.id);

    const preview = buildImportPreview(parsed, [legacyDefault]);
    const written: ChecklistItem[][] = [];
    await applyItemImport(preview, { bulkPut: async (items) => void written.push(items) });

    expect(preview.errors).toEqual([]);
    expect(preview.added).toEqual([]);
    expect(preview.changed).toEqual([]);
    expect(preview.disabled).toEqual([]);
    expect(preview.items).toEqual([legacyDefault]);
    expect(written).toEqual([]);
  });

  test("writes a uniquely matched legacy item change back under its existing ID", async () => {
    const parsed = await validateImportRows([row({ 路线名称: "焊机　间" })]);
    const imported = parsed.items[0].item;
    const legacy = existingItem({
      ...imported,
      id: "legacy-four-field-id",
      routeName: "焊机 间",
      team: "旧责任工班",
    });

    const preview = buildImportPreview(parsed, [legacy]);
    const written: ChecklistItem[][] = [];
    await applyItemImport(preview, { bulkPut: async (items) => void written.push(items) });

    expect(preview.errors).toEqual([]);
    expect(preview.added).toEqual([]);
    expect(preview.changed).toEqual([legacy.id]);
    expect(preview.items[0]).toMatchObject({ id: legacy.id, team: imported.team });
    expect(written[0]).toEqual([expect.objectContaining({ id: legacy.id, team: imported.team })]);
  });

  test("keeps a different standard as a distinct addition beside a legacy item", async () => {
    const parsed = await validateImportRows([row({ 检查标准: "另一条检查标准" })]);
    const imported = parsed.items[0].item;
    const legacy = existingItem({
      ...imported,
      id: "legacy-four-field-id",
      standard: completeRow.检查标准 as string,
    });

    const preview = buildImportPreview(parsed, [legacy]);

    expect(preview.errors).toEqual([]);
    expect(preview.added).toEqual([imported.id]);
    expect(preview.items[0].id).toBe(imported.id);
  });

  test("fails closed when multiple legacy items share one normalized five-field identity", async () => {
    const parsed = await validateImportRows([row()]);
    const imported = parsed.items[0].item;
    const duplicates = [
      existingItem({ ...imported, id: "legacy-duplicate-a" }),
      existingItem({ ...imported, id: "legacy-duplicate-b" }),
    ];

    const preview = buildImportPreview(parsed, duplicates);
    const written: ChecklistItem[][] = [];
    const repository = { bulkPut: async (items: ChecklistItem[]) => void written.push(items) };

    expect(preview.errors).toEqual([
      expect.objectContaining({
        row: 2,
        field: "检查标准",
        message: expect.stringMatching(/2 条.*无法确定.*ID/),
      }),
    ]);
    expect(preview.items).toEqual([]);
    expect(preview.added).toEqual([]);
    expect(preview.changed).toEqual([]);
    await expect(applyItemImport(preview, repository)).rejects.toThrow("导入校验失败");
    expect(written).toEqual([]);
  });

  test("previews same-location rows with different standards as distinct additions", async () => {
    const parsed = await validateImportRows([
      row({ 检查标准: "表面无积灰" }),
      row({ 检查标准: "表面无油泥" }),
    ]);

    const preview = buildImportPreview(parsed, []);

    expect(preview.errors).toEqual([]);
    expect(preview.items).toHaveLength(2);
    expect(new Set(preview.added)).toHaveProperty("size", 2);
  });

  test("classifies added, changed, and explicitly disabled items without disabling absent old items", async () => {
    const parsed = await validateImportRows([
      row({ 区域: "新增区域" }),
      row({ 区域: "修改区域", 检查标准: "新标准" }),
      row({ 区域: "停用区域", 是否启用: "否" }),
    ]);
    const [added, changed, disabled] = parsed.items.map(({ item }) => item);
    const absentOld = existingItem({ id: "absent-old" });
    const preview = buildImportPreview(parsed, [
      existingItem({ ...changed, standard: "旧标准" }),
      existingItem({ ...disabled, enabled: true }),
      absentOld,
    ]);

    expect(preview.added).toEqual([added.id]);
    expect(preview.changed).toEqual([changed.id]);
    expect(preview.disabled).toEqual([disabled.id]);
    expect(preview.items.map((item) => item.id)).not.toContain(absentOld.id);
  });

  test("keeps unchanged existing items and writes only added, changed, and disabled items", async () => {
    const importedAt = "2026-07-28T08:00:00.000Z";
    const parsed = await validateImportRows(
      [
        row({ 区域: "新增区域" }),
        row({ 区域: "未变更区域" }),
        row({ 区域: "修改区域", 检查标准: "新标准" }),
        row({ 区域: "停用区域", 是否启用: "否" }),
      ],
      2,
      undefined,
      importedAt,
    );
    const [added, unchanged, changed, disabled] = parsed.items.map(({ item }) => item);
    const unchangedExisting = existingItem({
      ...unchanged,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-02T00:00:00.000Z",
    });
    const changedExisting = existingItem({
      ...changed,
      standard: "旧标准",
      createdAt: "2024-02-01T00:00:00.000Z",
      updatedAt: "2024-02-02T00:00:00.000Z",
    });
    const disabledExisting = existingItem({
      ...disabled,
      enabled: true,
      createdAt: "2024-03-01T00:00:00.000Z",
      updatedAt: "2024-03-02T00:00:00.000Z",
    });
    const preview = buildImportPreview(parsed, [unchangedExisting, changedExisting, disabledExisting]);
    const written: ChecklistItem[][] = [];

    await applyItemImport(preview, { bulkPut: async (items) => void written.push(items) });

    expect(preview.items.find((item) => item.id === unchanged.id)).toBe(unchangedExisting);
    expect(preview.items.find((item) => item.id === changed.id)).toMatchObject({
      createdAt: changedExisting.createdAt,
      updatedAt: importedAt,
    });
    expect(preview.items.find((item) => item.id === disabled.id)).toMatchObject({
      createdAt: disabledExisting.createdAt,
      updatedAt: importedAt,
    });
    expect(preview.added).toEqual([added.id]);
    expect(preview.changed).toEqual([changed.id]);
    expect(preview.disabled).toEqual([disabled.id]);
    expect(written).toHaveLength(1);
    expect(written[0].map((item) => item.id)).toEqual([added.id, changed.id, disabled.id]);
  });

  test("rejects an invalid preview without writing any valid rows", async () => {
    const parsed = await validateImportRows([row(), row({ 路线名称: "" })]);
    const preview = buildImportPreview(parsed, []);
    const written: ChecklistItem[][] = [];
    const repository = { bulkPut: async (items: ChecklistItem[]) => void written.push(items) };

    expect(preview.errors).toHaveLength(1);
    await expect(applyItemImport(preview, repository)).rejects.toThrow("导入校验失败");
    expect(written).toEqual([]);
  });
});
