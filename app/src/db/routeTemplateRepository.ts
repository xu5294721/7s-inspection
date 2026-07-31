import Dexie from "dexie";
import type { ChecklistItem, InspectionRouteTemplate } from "../domain/models";
import { checklistItemSchema, inspectionRouteTemplateSchema } from "../domain/schemas";
import { DEFAULT_ROUTE_TEMPLATE_NAME, normalizeRouteName } from "../domain/routeNames";
import type { SevenSDb } from "./database";

export class RouteTemplateValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RouteTemplateValidationError";
  }
}

export class RouteTemplateRepository {
  private readonly db: SevenSDb;

  constructor(db: SevenSDb) {
    this.db = db;
  }

  async list(): Promise<InspectionRouteTemplate[]> {
    const templates = await this.db.routeTemplates.toArray();
    return templates.sort(
      (left, right) =>
        Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name),
    );
  }

  get(id: string): Promise<InspectionRouteTemplate | undefined> {
    return this.db.routeTemplates.get(id);
  }

  async save(template: InspectionRouteTemplate): Promise<void> {
    const parsedTemplate = inspectionRouteTemplateSchema.parse(template);

    try {
      await this.db.transaction("rw", this.db.checklistItems, this.db.routeTemplates, async () => {
        const items = await this.getExistingItems(parsedTemplate.itemIds);
        this.assertUniqueRouteNames(items);
        await this.assertDefaultNotDemoted(parsedTemplate);
        if (!parsedTemplate.isDefault && parsedTemplate.name === DEFAULT_ROUTE_TEMPLATE_NAME) {
          throw new RouteTemplateValidationError("默认模板名称仅供默认模板使用。");
        }
        await this.assertUniqueTemplateName(parsedTemplate.name, parsedTemplate.id);
        await this.assertOnlyDefault(parsedTemplate);
        await this.db.routeTemplates.put(parsedTemplate);
      });
    } catch (error) {
      if (error instanceof Dexie.ConstraintError) {
        throw new RouteTemplateValidationError("模板名称已存在。");
      }
      throw error;
    }
  }

  async saveWithCustomItems(
    template: InspectionRouteTemplate,
    customItems: ChecklistItem[],
  ): Promise<{ template: InspectionRouteTemplate; items: ChecklistItem[] }> {
    const parsedTemplate = inspectionRouteTemplateSchema.parse(template);
    const parsedItems = customItems.map((item) => {
      const parsed = checklistItemSchema.parse({ ...item, routeName: item.routeName.trim() });
      if (!parsed.enabled) {
        throw new RouteTemplateValidationError("自定义检查项目必须启用。");
      }
      return parsed;
    });

    return this.db.transaction("rw", this.db.checklistItems, this.db.routeTemplates, async () => {
      const existingItems = await this.db.checklistItems.toArray();
      const existingIds = new Set(existingItems.map((item) => item.id));
      if (parsedItems.some((item) => existingIds.has(item.id))) {
        throw new RouteTemplateValidationError("自定义检查项目已存在，无法重复保存。");
      }

      const firstCustomOrder = Math.max(0, ...existingItems.map((item) => item.routeOrder)) + 1;
      const persistedItems = parsedItems.map((item, index) => ({
        ...item,
        routeOrder: firstCustomOrder + index,
      }));
      const allItems = [...existingItems, ...persistedItems];
      const itemById = new Map(allItems.map((item) => [item.id, item]));
      const templateItems = parsedTemplate.itemIds.map((itemId) => itemById.get(itemId));
      const missingItemId = parsedTemplate.itemIds.find((_itemId, index) => !templateItems[index]);
      if (missingItemId) {
        throw new RouteTemplateValidationError(`检查项目 ${missingItemId} 不存在或已停用。`);
      }

      this.assertUniqueRouteNames(templateItems as ChecklistItem[]);
      await this.assertDefaultNotDemoted(parsedTemplate);
      if (!parsedTemplate.isDefault && parsedTemplate.name === DEFAULT_ROUTE_TEMPLATE_NAME) {
        throw new RouteTemplateValidationError("默认模板名称仅供默认模板使用。");
      }
      await this.assertUniqueTemplateName(parsedTemplate.name, parsedTemplate.id);
      await this.assertOnlyDefault(parsedTemplate);
      if (persistedItems.length > 0) await this.db.checklistItems.bulkAdd(persistedItems);
      await this.db.routeTemplates.put(parsedTemplate);
      return { template: parsedTemplate, items: persistedItems };
    });
  }

  async remove(id: string): Promise<void> {
    await this.db.transaction("rw", this.db.routeTemplates, async () => {
      const template = await this.db.routeTemplates.get(id);
      if (!template) throw new RouteTemplateValidationError(`路线模板 ${id} 不存在。`);
      if (template.isDefault) throw new RouteTemplateValidationError("默认模板不能删除。");
      await this.db.routeTemplates.delete(id);
    });
  }

  async addCustomItem(
    templateId: string,
    item: ChecklistItem,
  ): Promise<{ item: ChecklistItem; template: InspectionRouteTemplate }> {
    const itemName = item.routeName.trim();
    if (!itemName) throw new RouteTemplateValidationError("检查项目名称不能为空。");
    const parsedItem = checklistItemSchema.parse({ ...item, routeName: itemName });
    if (!parsedItem.enabled) {
      throw new RouteTemplateValidationError("自定义检查项目必须启用。");
    }

    return this.db.transaction("rw", this.db.checklistItems, this.db.routeTemplates, async () => {
      const template = await this.db.routeTemplates.get(templateId);
      if (!template) throw new RouteTemplateValidationError(`路线模板 ${templateId} 不存在。`);

      const existingItems = await this.db.checklistItems.toArray();
      const hasSameName = existingItems.some(
        (existing) => existing.enabled && normalizeRouteName(existing.routeName) === itemName,
      );
      if (hasSameName) throw new RouteTemplateValidationError("检查项目名称已存在。");

      const persistedItem = {
        ...parsedItem,
        routeOrder: Math.max(0, ...existingItems.map((existing) => existing.routeOrder)) + 1,
      };
      const updatedTemplate = {
        ...template,
        itemIds: [...template.itemIds, persistedItem.id],
        updatedAt: new Date().toISOString(),
      };
      await this.db.checklistItems.add(persistedItem);
      await this.db.routeTemplates.put(updatedTemplate);
      return { item: persistedItem, template: updatedTemplate };
    });
  }

  private async getExistingItems(itemIds: string[]): Promise<ChecklistItem[]> {
    const items = await this.db.checklistItems.bulkGet(itemIds);
    const invalidId = itemIds.find((_itemId, index) => {
      const item = items[index];
      return !item;
    });
    if (invalidId) {
      throw new RouteTemplateValidationError(`检查项目 ${invalidId} 不存在或已停用。`);
    }
    return items as ChecklistItem[];
  }

  private assertUniqueRouteNames(items: ChecklistItem[]): void {
    const duplicateName = items
      .filter((item) => item.enabled)
      .map((item) => normalizeRouteName(item.routeName))
      .find((routeName, index, routeNames) => routeNames.indexOf(routeName) !== index);
    if (duplicateName !== undefined) {
      throw new RouteTemplateValidationError(`检查项目名称 ${duplicateName} 重复。`);
    }
  }

  private async assertUniqueTemplateName(name: string, id: string): Promise<void> {
    const existing = await this.db.routeTemplates.where("name").equals(name).first();
    if (existing && existing.id !== id) {
      throw new RouteTemplateValidationError("模板名称已存在。");
    }
  }

  private async assertOnlyDefault(template: InspectionRouteTemplate): Promise<void> {
    if (!template.isDefault) return;

    const existingDefault = (await this.db.routeTemplates.toArray()).find(
      (existing) => existing.isDefault && existing.id !== template.id,
    );
    if (existingDefault) throw new RouteTemplateValidationError("只能保留一个默认模板。");
  }

  private async assertDefaultNotDemoted(template: InspectionRouteTemplate): Promise<void> {
    const existing = await this.db.routeTemplates.get(template.id);
    if (existing?.isDefault && !template.isDefault) {
      throw new RouteTemplateValidationError("默认模板不能取消默认状态。");
    }
  }
}
