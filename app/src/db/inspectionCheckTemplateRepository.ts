import type { InspectionCheckTemplate } from "../domain/models";
import type { SevenSDb } from "./database";
import v1125DefaultConfigJson from "../data/v1.1.25-default-config.json";

const KEY = "inspection-check-template";
const v1125CheckTemplate = (v1125DefaultConfigJson as {
  inspectionCheckTemplate: InspectionCheckTemplate;
}).inspectionCheckTemplate;

export const DEFAULT_INSPECTION_CHECK_TEMPLATE: InspectionCheckTemplate = {
  ...v1125CheckTemplate,
  definitions: v1125CheckTemplate.definitions.map((definition) => definition.category === "environment"
    ? { ...definition, options: [...definition.options, "干净整洁", "基本整洁"] }
    : definition),
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
