import type { InspectionCheckTemplate } from "../domain/models";
import type { SevenSDb } from "./database";

const KEY = "inspection-check-template";

export const DEFAULT_INSPECTION_CHECK_TEMPLATE: InspectionCheckTemplate = {
  id: KEY,
  name: "7S检查内容模板",
  definitions: [
    { category: "environment", label: "环境卫生", options: ["干净整洁", "基本整洁", "清扫不到位", "存在积灰杂物"], defaultValue: "干净整洁" },
    { category: "placement", label: "物品定置", options: ["规范有序", "基本规范", "个别物品未定置", "摆放杂乱"] },
    { category: "equipment", label: "设备清洁保养", options: ["清洁保养良好", "表面无积灰油污", "清洁保养不到位", "存在积灰油污"] },
  ],
  itemOverrides: {},
  updatedAt: "2026-01-01T00:00:00.000Z",
};

export class InspectionCheckTemplateRepository {
  private readonly db: SevenSDb;

  constructor(db: SevenSDb) {
    this.db = db;
  }

  async get(): Promise<InspectionCheckTemplate> {
    const row = await this.db.settings.get(KEY);
    if (!row || !row.value || typeof row.value !== "object") return structuredClone(DEFAULT_INSPECTION_CHECK_TEMPLATE);
    const value = row.value as InspectionCheckTemplate;
    return {
      ...structuredClone(DEFAULT_INSPECTION_CHECK_TEMPLATE),
      ...value,
      definitions: value.definitions?.length ? value.definitions : structuredClone(DEFAULT_INSPECTION_CHECK_TEMPLATE.definitions),
      itemOverrides: value.itemOverrides ?? {},
    };
  }

  async save(template: InspectionCheckTemplate): Promise<void> {
    await this.db.settings.put({ key: KEY, value: template, updatedAt: template.updatedAt });
  }

  async updateDefinitions(definitions: InspectionCheckTemplate["definitions"], updatedAt: string): Promise<InspectionCheckTemplate> {
    const current = await this.get();
    const next = { ...current, definitions, updatedAt };
    await this.save(next);
    return next;
  }
}
