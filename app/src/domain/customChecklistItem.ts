import type { ChecklistItem } from "./models";

export function createCustomChecklistItem(
  routeName: string,
  id: string,
  timestamp: string,
): ChecklistItem {
  const normalizedName = routeName.trim();
  return {
    id,
    routeOrder: 0,
    routeName: normalizedName,
    area: normalizedName,
    device: "",
    part: normalizedName,
    standard: `检查${normalizedName}7S管理落实情况`,
    team: "相关责任工班",
    sevenSCategory: "",
    goodText: `${normalizedName}7S管理落实较好。`,
    reminderText: `${normalizedName}存在7S管理不到位问题，本次予以提醒。`,
    assessmentText: `${normalizedName}存在7S管理不到位问题。`,
    quickPhrases: [],
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
