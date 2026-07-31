import Dexie from "dexie";
import type { ReportTemplate } from "../domain/models";
import { reportTemplateSchema } from "../domain/schemas";
import type { SevenSDb } from "./database";

export class TemplateVersionConflictError extends Error {
  constructor(id: string, version: number) {
    super(`模板 ${id} 版本 ${version} 已存在。`);
    this.name = "TemplateVersionConflictError";
  }
}

export class TemplateRepository {
  private readonly db: SevenSDb;

  constructor(db: SevenSDb) {
    this.db = db;
  }

  async save(template: ReportTemplate): Promise<void> {
    const key = [template.id, template.version] as const;
    if (await this.db.templates.get(key)) {
      throw new TemplateVersionConflictError(template.id, template.version);
    }

    try {
      await this.db.templates.add(template);
    } catch (error) {
      if (error instanceof Dexie.ConstraintError) {
        throw new TemplateVersionConflictError(template.id, template.version);
      }
      throw error;
    }
  }

  async seedIfMissing(template: ReportTemplate): Promise<boolean> {
    const key = [template.id, template.version] as const;
    return this.db.transaction("rw", this.db.templates, async () => {
      if (await this.db.templates.get(key)) return false;
      try {
        await this.db.templates.add(template);
        return true;
      } catch (error) {
        if (error instanceof Dexie.ConstraintError) return false;
        throw error;
      }
    });
  }

  async get(id: string, version: number): Promise<ReportTemplate | undefined> {
    const template = await this.db.templates.get([id, version]);
    return template ? reportTemplateSchema.parse(template) : undefined;
  }

  async listVersions(id: string): Promise<ReportTemplate[]> {
    const templates = await this.db.templates.where("id").equals(id).toArray();
    return templates
      .map((template) => reportTemplateSchema.parse(template))
      .sort((left, right) => right.version - left.version);
  }

  async getLatest(id: string): Promise<ReportTemplate | undefined> {
    return (await this.listVersions(id))[0];
  }
}
