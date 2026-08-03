import type { Inspection, InspectionGraph, PhotoCategory } from "./models";

function compareEntryOrder(
  left: Inspection["entries"][number],
  right: Inspection["entries"][number],
): number {
  return left.order - right.order || left.id.localeCompare(right.id);
}

function entryRouteNames(inspection: Inspection): string[] {
  const names: string[] = [];
  const seen = new Set<string>();

  for (const entry of [...inspection.entries].sort(compareEntryOrder)) {
    const routeName = entry.itemSnapshot.routeName;
    if (!seen.has(routeName)) {
      seen.add(routeName);
      names.push(routeName);
    }
  }

  return names;
}

export function resolveReviewRouteOrder(inspection: Inspection): string[] {
  const currentRouteNames = entryRouteNames(inspection);
  const currentRouteNameSet = new Set(currentRouteNames);
  const resolved: string[] = [];
  const seen = new Set<string>();

  for (const routeName of inspection.reviewRouteOrder ?? []) {
    if (currentRouteNameSet.has(routeName) && !seen.has(routeName)) {
      seen.add(routeName);
      resolved.push(routeName);
    }
  }
  for (const routeName of currentRouteNames) {
    if (!seen.has(routeName)) {
      seen.add(routeName);
      resolved.push(routeName);
    }
  }

  return resolved;
}

export function resolveReviewRouteOrderForCategory(
  inspection: Inspection,
  category: PhotoCategory,
  currentRouteNames: readonly string[],
): string[] {
  const currentRouteNameSet = new Set(currentRouteNames);
  const resolved: string[] = [];
  const seen = new Set<string>();
  const savedRouteNames = inspection.reviewRouteOrderByCategory?.[category] ?? [];

  for (const routeName of savedRouteNames) {
    if (currentRouteNameSet.has(routeName) && !seen.has(routeName)) {
      seen.add(routeName);
      resolved.push(routeName);
    }
  }
  for (const routeName of resolveReviewRouteOrder(inspection)) {
    if (currentRouteNameSet.has(routeName) && !seen.has(routeName)) {
      seen.add(routeName);
      resolved.push(routeName);
    }
  }

  return resolved;
}

export function sortRouteNamesForReviewByCategory(
  graph: InspectionGraph,
): Record<PhotoCategory, string[]> {
  const entryById = new Map(graph.inspection.entries.map((entry) => [entry.id, entry]));
  const routeNamesByCategory: Record<PhotoCategory, string[]> = {
    good: [],
    general: [],
    reminder: [],
    assessment: [],
  };

  for (const category of Object.keys(routeNamesByCategory) as PhotoCategory[]) {
    const names = new Set<string>();
    for (const group of graph.groups) {
      if (group.category !== category || group.photoIds.length === 0) continue;
      const entry = entryById.get(group.entryId);
      if (entry) names.add(entry.itemSnapshot.routeName);
    }
    routeNamesByCategory[category] = resolveReviewRouteOrderForCategory(
      graph.inspection,
      category,
      [...names],
    );
  }

  return routeNamesByCategory;
}

export function sortRouteNamesForReview(graph: InspectionGraph): string[] {
  const routeNamesWithPhotos = new Set<string>();
  const entryById = new Map(graph.inspection.entries.map((entry) => [entry.id, entry]));

  for (const group of graph.groups) {
    if (group.photoIds.length === 0) continue;
    const entry = entryById.get(group.entryId);
    if (entry) routeNamesWithPhotos.add(entry.itemSnapshot.routeName);
  }

  return resolveReviewRouteOrder(graph.inspection)
    .filter((routeName) => routeNamesWithPhotos.has(routeName));
}
