import type { PhotoCategory } from "./models";

export const PHOTO_CATEGORIES = [
  { id: "good", label: "好的方面" },
  { id: "general", label: "一般表现" },
  { id: "reminder", label: "提醒问题" },
  { id: "assessment", label: "考核问题" },
] as const satisfies readonly { id: PhotoCategory; label: string }[];

export function photoCategoryLabel(category: PhotoCategory): string {
  return PHOTO_CATEGORIES.find((item) => item.id === category)?.label ?? category;
}
