import { saveBlobToDownloads } from "../../platform/nativeFile";

export type ReportOutputResult = "shared" | "cancelled" | "unavailable";

export function downloadReport(blob: Blob, filename: string): Promise<void> {
  return saveBlobToDownloads(blob, filename);
}

export async function shareOrDownloadReport(
  blob: Blob,
  filename: string,
): Promise<ReportOutputResult> {
  if (
    typeof File !== "function" ||
    typeof navigator === "undefined" ||
    typeof navigator.canShare !== "function" ||
    typeof navigator.share !== "function"
  ) {
    return "unavailable";
  }

  let file: File;
  try {
    file = new File([blob], filename, { type: blob.type });
    if (!navigator.canShare({ files: [file] })) return "unavailable";
  } catch {
    return "unavailable";
  }

  try {
    await navigator.share({ files: [file], title: filename });
    return "shared";
  } catch (error) {
    if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") {
      return "cancelled";
    }
    return "unavailable";
  }
}
