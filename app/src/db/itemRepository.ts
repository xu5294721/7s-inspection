import type { ChecklistItem } from "../domain/models";
import { findDuplicateEnabledRouteName, normalizeRouteName } from "../domain/routeNames";
import type { SevenSDb } from "./database";

function normalizedItem(item: ChecklistItem): ChecklistItem {
  return { ...item, routeName: normalizeRouteName(item.routeName) };
}

function assertUniqueEnabledNames(items: ChecklistItem[]): void {
  const duplicate = findDuplicateEnabledRouteName(items);
  if (duplicate !== undefined) throw new Error(`检查项目名称已存在：${duplicate}。`);
}

export class ItemRepository {
  private readonly db: SevenSDb;

  constructor(db: SevenSDb) {
    this.db = db;
  }

  async listEnabled(): Promise<ChecklistItem[]> {
    const items = await this.db.checklistItems.toArray();
    return items
      .filter((item) => item.enabled)
      .sort((left, right) => left.routeOrder - right.routeOrder || left.id.localeCompare(right.id));
  }

  async listAll(): Promise<ChecklistItem[]> {
    const items = await this.db.checklistItems.toArray();
    return items.sort((left, right) => left.routeOrder - right.routeOrder || left.id.localeCompare(right.id));
  }

  get(id: string): Promise<ChecklistItem | undefined> {
    return this.db.checklistItems.get(id);
  }

  async put(item: ChecklistItem): Promise<void> {
    await this.db.transaction("rw", this.db.checklistItems, async () => {
      const persisted = normalizedItem(item);
      const existing = (await this.db.checklistItems.toArray()).filter((row) => row.id !== persisted.id);
      assertUniqueEnabledNames([...existing, persisted]);
      await this.db.checklistItems.put(persisted);
    });
  }

  async bulkPut(items: ChecklistItem[]): Promise<void> {
    await this.db.transaction("rw", this.db.checklistItems, async () => {
      const persisted = items.map(normalizedItem);
      const incomingIds = new Set(persisted.map((item) => item.id));
      const existing = (await this.db.checklistItems.toArray()).filter((row) => !incomingIds.has(row.id));
      assertUniqueEnabledNames([...existing, ...persisted]);
      await this.db.checklistItems.bulkPut(persisted);
    });
  }

  async seedIfEmpty(items: ChecklistItem[]): Promise<boolean> {
    return this.db.transaction("rw", this.db.checklistItems, async () => {
      if ((await this.db.checklistItems.count()) > 0) {
        return false;
      }

      const persisted = items.map(normalizedItem);
      assertUniqueEnabledNames(persisted);
      await this.db.checklistItems.bulkAdd(persisted);
      return true;
    });
  }

  async disable(id: string, updatedAt = new Date().toISOString()): Promise<void> {
    const updated = await this.db.checklistItems.update(id, { enabled: false, updatedAt });
    if (updated === 0) {
      throw new Error(`巡检项点 ${id} 不存在。`);
    }
  }
}
