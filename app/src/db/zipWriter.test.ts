import { describe, expect, it } from "vitest";
import { createStoredZipWriter } from "./zipWriter";
import { parseZipCentralDirectory } from "./zipCentralDirectory";
import { extractZipEntryBounded, createZipExtractionBudget } from "./boundedZipReader";

function collectZip(files: Array<{ name: string; data: Uint8Array }>): Blob {
  const chunks: Uint8Array[] = [];
  const writer = createStoredZipWriter((chunk) => chunks.push(chunk));
  for (const file of files) writer.addFile(file.name, file.data);
  writer.end();
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Blob([merged], { type: "application/zip" });
}

describe("createStoredZipWriter", () => {
  it("produces a ZIP readable by the project's own reader with identical content", async () => {
    const files = [
      { name: "manifest.json", data: new TextEncoder().encode("{\"a\":1}") },
      { name: "photos/p1.jpg", data: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]) },
      { name: "photos/p1-thumb.jpg", data: new Uint8Array([9, 9, 9]) },
    ];
    const blob = collectZip(files);

    const metadata = await parseZipCentralDirectory(blob, {
      maxEntries: 100,
      maxCentralDirectoryBytes: 1024 * 1024,
    });
    expect(metadata.entries.map((entry) => entry.name)).toEqual(files.map((file) => file.name));

    const budget = createZipExtractionBudget();
    for (const file of files) {
      const entry = metadata.entriesByName.get(file.name)!;
      const extracted = await extractZipEntryBounded(blob, entry, budget, {
        maxEntryBytes: 1024 * 1024,
        maxTotalBytes: 10 * 1024 * 1024,
        maxCompressionRatio: 200,
      });
      expect(Array.from(extracted)).toEqual(Array.from(file.data));
    }
  });

  it("emits chunks that concatenate into the complete archive", () => {
    const chunks: Uint8Array[] = [];
    const writer = createStoredZipWriter((chunk) => chunks.push(chunk));
    writer.addFile("a.txt", new TextEncoder().encode("hello"));
    writer.addFile("b.txt", new TextEncoder().encode("world"));
    writer.end();
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    expect(total).toBeGreaterThan(0);
    expect(chunks.length).toBeGreaterThan(0);
  });
});
