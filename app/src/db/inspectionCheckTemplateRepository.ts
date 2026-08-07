import type { InspectionCheckTemplate } from "../domain/models";
import type { SevenSDb } from "./database";

const KEY = "inspection-check-template";

export const DEFAULT_INSPECTION_CHECK_TEMPLATE: InspectionCheckTemplate = {
  id: KEY,
  name: "7S??????",
  definitions: [
    { category: "environment", label: "????", options: ["????", "????", "?????", "??????"], defaultValue: "????" },
    { category: "placement", label: "????", options: ["????", "????", "???????", "????"] },
    { category: "equipment", label: "??????", options: ["??????", "???????", "???????", "??????"] },
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
