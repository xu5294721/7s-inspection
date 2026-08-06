import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  saveFileBegin: vi.fn(),
  saveFileAppend: vi.fn(),
  saveFileEnd: vi.fn(),
  saveFileAbort: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "android",
  },
  registerPlugin: () => native,
}));

import { saveChunkStreamToDownloads } from "./nativeFile";

async function* chunksOf(...chunks: Uint8Array[]): AsyncIterable<Uint8Array> {
  for (const chunk of chunks) yield chunk;
}

describe("saveChunkStreamToDownloads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    native.saveFileBegin.mockResolvedValue({ sessionId: "s1" });
    native.saveFileAppend.mockResolvedValue(undefined);
    native.saveFileEnd.mockResolvedValue({ uri: "content://downloads/1" });
    native.saveFileAbort.mockResolvedValue(undefined);
  });

  it("begins, appends base64 chunks, and ends the native session", async () => {
    await saveChunkStreamToDownloads(
      chunksOf(new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])),
      "backup.zip",
      "application/zip",
    );

    expect(native.saveFileBegin).toHaveBeenCalledWith({ filename: "backup.zip", mimeType: "application/zip" });
    expect(native.saveFileAppend).toHaveBeenCalledTimes(1);
    expect(native.saveFileAppend).toHaveBeenCalledWith({ sessionId: "s1", data: expect.any(String) });
    expect(native.saveFileEnd).toHaveBeenCalledWith({ sessionId: "s1" });
    expect(native.saveFileAbort).not.toHaveBeenCalled();
  });

  it("aborts the native session when a chunk fails and rethrows", async () => {
    native.saveFileAppend.mockRejectedValueOnce(new Error("disk full"));

    await expect(saveChunkStreamToDownloads(chunksOf(new Uint8Array([1])), "a.zip", "application/zip"))
      .rejects.toThrow("disk full");
    expect(native.saveFileAbort).toHaveBeenCalledWith({ sessionId: "s1" });
    expect(native.saveFileEnd).not.toHaveBeenCalled();
  });

  it("passes the decoded base64 chunk through", async () => {
    const expected = new Uint8Array([0, 1, 2, 250, 251, 252]);
    await saveChunkStreamToDownloads(chunksOf(expected), "b.zip", "application/zip");
    expect(native.saveFileAppend).toHaveBeenCalledTimes(1);
    const { data } = native.saveFileAppend.mock.calls[0][0];
    const decoded = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
    expect(decoded).toEqual(expected);
  });

  it("splits a source chunk larger than the target size into multiple appends", async () => {
    const big = new Uint8Array(300 * 1024);
    for (let index = 0; index < big.length; index += 1) big[index] = index % 251;
    await saveChunkStreamToDownloads(chunksOf(big), "c.zip", "application/zip");
    expect(native.saveFileAppend).toHaveBeenCalledTimes(2);
    const merged: number[] = [];
    for (const call of native.saveFileAppend.mock.calls) {
      const { data } = call[0];
      const decoded = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      for (const byte of decoded) merged.push(byte);
    }
    expect(merged).toEqual(Array.from(big));
  });
});
