import type { PhotoLayoutMode, PhotosPerRow } from "./models";

export const PHOTO_ROW_COUNTS = [1, 2, 3, 4] as const satisfies readonly PhotosPerRow[];

export function columnsForPhotoCount(
  mode: PhotoLayoutMode,
  photosPerRow: PhotosPerRow,
  photoCount: number,
): PhotosPerRow {
  if (mode === "fixed") return photosPerRow;
  return Math.max(1, Math.min(photosPerRow, photoCount)) as PhotosPerRow;
}
