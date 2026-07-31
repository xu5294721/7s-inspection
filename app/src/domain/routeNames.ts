import type { ChecklistItem } from "./models";

export const DEFAULT_ROUTE_TEMPLATE_NAME = "默认模板";

export function normalizeRouteName(name: string): string {
  return name.trim();
}

export function findDuplicateEnabledRouteName(items: ChecklistItem[]): string | undefined {
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.enabled) continue;
    const name = normalizeRouteName(item.routeName);
    if (seen.has(name)) return name;
    seen.add(name);
  }
  return undefined;
}

export function deduplicateEnabledRouteItems(items: ChecklistItem[]): ChecklistItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.enabled) return false;
    const name = normalizeRouteName(item.routeName);
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}
