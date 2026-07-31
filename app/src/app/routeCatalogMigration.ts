import defaultChecklistItemsJson from "../data/default-checklist-items.json";
import { createCoreInspectionItems } from "../data/core-inspection-items";
import type { ChecklistItem, InspectionRouteTemplate } from "../domain/models";
import { DEFAULT_ROUTE_TEMPLATE_NAME, normalizeRouteName } from "../domain/routeNames";
import type { SevenSDb } from "../db/database";

const ROUTE_CATALOG_VERSION_KEY = "inspectionRouteCatalogVersion";
const ROUTE_CATALOG_VERSION = 2;
const DEFAULT_ROUTE_TEMPLATE_ID = "route-template-default";
const legacyItemsById = new Map(
  (defaultChecklistItemsJson as ChecklistItem[]).map((item) => [item.id, item]),
);

export interface RouteCatalogMigrationResult {
  inserted: number;
  disabledLegacy: number;
  defaultTemplateCreated: boolean;
}

function createDefaultRouteTemplate(timestamp: string, itemIds: string[]): InspectionRouteTemplate {
  return {
    id: DEFAULT_ROUTE_TEMPLATE_ID,
    name: DEFAULT_ROUTE_TEMPLATE_NAME,
    itemIds,
    isDefault: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function hasValidItemList(
  template: InspectionRouteTemplate,
  itemsById: Map<string, ChecklistItem>,
): boolean {
  if (template.itemIds.length === 0 || new Set(template.itemIds).size !== template.itemIds.length) {
    return false;
  }
  for (const itemId of template.itemIds) {
    if (!itemsById.has(itemId)) return false;
  }
  return true;
}

function fallbackItemIds(
  coreItems: ChecklistItem[],
  itemsById: Map<string, ChecklistItem>,
): string[] {
  const usedIds = new Set<string>();
  const result: string[] = [];
  for (const coreItem of coreItems) {
    const enabledMatch = [...itemsById.values()]
      .filter((item) => item.enabled && normalizeRouteName(item.routeName) === normalizeRouteName(coreItem.routeName))
      .sort((left, right) => left.routeOrder - right.routeOrder || left.id.localeCompare(right.id))[0];
    const itemId = enabledMatch?.id ?? (itemsById.has(coreItem.id) ? coreItem.id : undefined);
    if (!itemId || usedIds.has(itemId)) continue;
    usedIds.add(itemId);
    result.push(itemId);
  }
  return result;
}

function repairedTemplateNames(
  templates: InspectionRouteTemplate[],
  retainedDefaultId: string,
): Map<string, string> {
  const assignedNames = new Set([DEFAULT_ROUTE_TEMPLATE_NAME]);
  const namesById = new Map([[retainedDefaultId, DEFAULT_ROUTE_TEMPLATE_NAME]]);
  for (const template of [...templates]
    .filter((entry) => entry.id !== retainedDefaultId)
    .sort((left, right) => left.id.localeCompare(right.id))) {
    const baseName = template.name.trim() || "未命名模板";
    let candidate = baseName;
    let counter = 2;
    while (assignedNames.has(candidate)) {
      candidate = `${baseName}（${counter}）`;
      counter += 1;
    }
    assignedNames.add(candidate);
    namesById.set(template.id, candidate);
  }
  return namesById;
}

function sameLegacySemanticContent(item: ChecklistItem, original: ChecklistItem): boolean {
  const {
    enabled: _itemEnabled,
    createdAt: _itemCreatedAt,
    updatedAt: _itemUpdatedAt,
    ...itemContent
  } = item;
  const {
    enabled: _originalEnabled,
    createdAt: _originalCreatedAt,
    updatedAt: _originalUpdatedAt,
    ...originalContent
  } = original;
  return JSON.stringify(itemContent) === JSON.stringify(originalContent);
}

function compareStableText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function repairEnabledRouteNameConflicts(
  items: ChecklistItem[],
  coreItemIds: Set<string>,
  recoveredLegacyIds: Set<string>,
  timestamp: string,
): ChecklistItem[] {
  const groups = new Map<string, ChecklistItem[]>();
  for (const item of items) {
    if (!item.enabled) continue;
    const name = normalizeRouteName(item.routeName);
    groups.set(name, [...(groups.get(name) ?? []), item]);
  }

  const occupiedNames = new Set(items.map((item) => normalizeRouteName(item.routeName)));
  const repaired: ChecklistItem[] = [];
  const priority = (item: ChecklistItem): number => {
    if (coreItemIds.has(item.id)) return 0;
    if (recoveredLegacyIds.has(item.id)) return 2;
    return 1;
  };

  for (const [baseName, group] of [...groups.entries()]
    .sort(([left], [right]) => compareStableText(left, right))) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((left, right) =>
      priority(left) - priority(right) ||
      left.routeOrder - right.routeOrder ||
      compareStableText(left.id, right.id));
    const [winner, ...conflicts] = ordered;
    if (winner.routeName !== baseName) {
      repaired.push({ ...winner, routeName: baseName, updatedAt: timestamp });
    }
    let counter = 2;
    for (const item of conflicts) {
      let candidate = `${baseName}（${counter}）`;
      while (occupiedNames.has(normalizeRouteName(candidate))) {
        counter += 1;
        candidate = `${baseName}（${counter}）`;
      }
      occupiedNames.add(normalizeRouteName(candidate));
      repaired.push({ ...item, routeName: candidate, updatedAt: timestamp });
      counter += 1;
    }
  }
  return repaired;
}

export async function ensureRouteCatalog(
  db: SevenSDb,
  timestamp = new Date().toISOString(),
): Promise<RouteCatalogMigrationResult> {
  const coreItems = createCoreInspectionItems(timestamp);

  return db.transaction("rw", db.checklistItems, db.routeTemplates, db.settings, async () => {
    const version = await db.settings.get(ROUTE_CATALOG_VERSION_KEY);
    const needsCatalogUpgrade = version?.value !== ROUTE_CATALOG_VERSION;
    const coreItemIds = new Set(coreItems.map((item) => item.id));
    const recoveredLegacyIds = new Set<string>();
    let disabledLegacy = 0;
    if (needsCatalogUpgrade) {
      const legacyRows = (await db.checklistItems.bulkGet([...legacyItemsById.keys()]))
        .filter((item): item is ChecklistItem => item !== undefined);
      const repairedLegacyRows = legacyRows.flatMap((item) => {
        const original = legacyItemsById.get(item.id);
        if (!original) return [];
        const shouldEnable = !sameLegacySemanticContent(item, original);
        if (shouldEnable && !item.enabled) recoveredLegacyIds.add(item.id);
        if (item.enabled === shouldEnable) return [];
        if (!shouldEnable) disabledLegacy += 1;
        return [{ ...item, enabled: shouldEnable, updatedAt: timestamp }];
      });
      if (repairedLegacyRows.length > 0) await db.checklistItems.bulkPut(repairedLegacyRows);
    }

    const catalogBeforeInsert = await db.checklistItems.toArray();
    const existingCoreIds = new Set(catalogBeforeInsert.map((item) => item.id));
    const enabledNames = new Set(
      catalogBeforeInsert.filter((item) => item.enabled).map((item) => normalizeRouteName(item.routeName)),
    );
    const missingCoreItems = coreItems
      .filter((item) => !existingCoreIds.has(item.id))
      .map((item) => {
        if (needsCatalogUpgrade) return item;
        const name = normalizeRouteName(item.routeName);
        const enabled = !enabledNames.has(name);
        if (enabled) enabledNames.add(name);
        return enabled ? item : { ...item, enabled: false };
      });
    if (missingCoreItems.length > 0) await db.checklistItems.bulkAdd(missingCoreItems);

    if (needsCatalogUpgrade) {
      const nameRepairs = repairEnabledRouteNameConflicts(
        await db.checklistItems.toArray(),
        coreItemIds,
        recoveredLegacyIds,
        timestamp,
      );
      if (nameRepairs.length > 0) await db.checklistItems.bulkPut(nameRepairs);
      await db.settings.put({
        key: ROUTE_CATALOG_VERSION_KEY,
        value: ROUTE_CATALOG_VERSION,
        updatedAt: timestamp,
      });
    }

    const existingTemplates = await db.routeTemplates.toArray();
    const canonical = existingTemplates.find((template) => template.id === DEFAULT_ROUTE_TEMPLATE_ID);
    const existingDefaults = existingTemplates
      .filter((template) => template.isDefault)
      .sort((left, right) => left.id.localeCompare(right.id));
    const createdDefault = !canonical && existingDefaults.length === 0;
    const retainedDefaultId = existingDefaults[0]?.id ?? canonical?.id ?? DEFAULT_ROUTE_TEMPLATE_ID;
    const itemsById = new Map((await db.checklistItems.toArray()).map((item) => [item.id, item]));
    const initialDefaultIds = fallbackItemIds(coreItems, itemsById);
    const templatesWithDefault = createdDefault
      ? [...existingTemplates, createDefaultRouteTemplate(timestamp, initialDefaultIds)]
      : existingTemplates;
    const namesById = repairedTemplateNames(templatesWithDefault, retainedDefaultId);
    let retainedItemIds = templatesWithDefault.find((template) => template.id === retainedDefaultId)?.itemIds ?? [];
    const retainedTemplate = templatesWithDefault.find((template) => template.id === retainedDefaultId);
    if (!retainedTemplate || !hasValidItemList(retainedTemplate, itemsById)) {
      retainedItemIds = fallbackItemIds(coreItems, itemsById);
      if (retainedItemIds.length === 0) {
        const firstCoreItem = coreItems[0];
        const existingFirst = itemsById.get(firstCoreItem.id);
        const repairedFirst = {
          ...firstCoreItem,
          createdAt: existingFirst?.createdAt ?? firstCoreItem.createdAt,
          updatedAt: timestamp,
        };
        await db.checklistItems.put(repairedFirst);
        itemsById.set(repairedFirst.id, repairedFirst);
        retainedItemIds = [repairedFirst.id];
      }
    }

    const repairedTemplates = templatesWithDefault.map((template) => {
      const isRetainedDefault = template.id === retainedDefaultId;
      const name = namesById.get(template.id) ?? template.name.trim();
      const itemIds = isRetainedDefault ? retainedItemIds : template.itemIds;
      const changed = template.isDefault !== isRetainedDefault ||
        template.name !== name ||
        !sameIds(template.itemIds, itemIds);
      return changed
        ? { ...template, name, itemIds, isDefault: isRetainedDefault, updatedAt: timestamp }
        : template;
    });
    const existingById = new Map(existingTemplates.map((template) => [template.id, template]));
    const existingChanged = repairedTemplates.some((template) => {
      const existing = existingById.get(template.id);
      return existing !== undefined && (
        existing.name !== template.name ||
        existing.isDefault !== template.isDefault ||
        !sameIds(existing.itemIds, template.itemIds)
      );
    });

    if (existingChanged) {
      await db.routeTemplates.clear();
      await db.routeTemplates.bulkAdd(repairedTemplates);
    } else if (createdDefault) {
      const newDefault = repairedTemplates.find((template) => template.id === DEFAULT_ROUTE_TEMPLATE_ID);
      if (!newDefault) throw new Error("默认路线模板修复失败。");
      await db.routeTemplates.add(newDefault);
    }

    return {
      inserted: missingCoreItems.length,
      disabledLegacy,
      defaultTemplateCreated: createdDefault,
    };
  });
}
