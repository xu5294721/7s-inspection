import { writeFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import JSZip from "jszip";

const FIXED_DATE = new Date("2024-05-15T00:00:00.000Z");

const headers = [
  "路线顺序",
  "路线名称",
  "区域",
  "设备岗位",
  "检查部位",
  "检查标准",
  "责任工班",
  "7S类别",
  "好的表述",
  "提醒表述",
  "考核表述",
  "常见问题",
  "是否启用",
];

const workbook = new ExcelJS.Workbook();
workbook.creator = "7S管理";
workbook.lastModifiedBy = "7S管理";
workbook.created = FIXED_DATE;
workbook.modified = FIXED_DATE;
const worksheet = workbook.addWorksheet("导入模板");
worksheet.addRow(headers);
worksheet.addRow([
  1,
  "焊机间",
  "二线焊机",
  "",
  "检查标准第1项（原编号1）",
  "设备表面清洁，无积灰、油污。",
  "焊接工班",
  "清扫",
  "检查标准第1项（原编号1）落实较好。",
  "检查标准第1项（原编号1）落实不到位，本次予以提醒。",
  "检查标准第1项（原编号1）落实不到位。",
  "积灰未清理|油污未清理",
  "是",
]);
worksheet.getRow(1).font = { bold: true };
worksheet.columns.forEach((column) => {
  column.width = 20;
});

const sourceZip = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
const deterministicZip = new JSZip();
const sourceFiles = Object.values(sourceZip.files)
  .filter((file) => !file.dir)
  .sort((left, right) => left.name.localeCompare(right.name));
for (const file of sourceFiles) {
  deterministicZip.file(file.name, await file.async("nodebuffer"), {
    createFolders: false,
    date: FIXED_DATE,
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
}

await writeFile(
  new URL("../public/fixtures/checklist-import-template.xlsx", import.meta.url),
  await deterministicZip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
    platform: "DOS",
    comment: "",
  }),
);
