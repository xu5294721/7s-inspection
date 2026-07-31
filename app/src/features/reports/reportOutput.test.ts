import { afterEach, vi } from "vitest";
import { downloadReport, shareOrDownloadReport } from "./reportOutput";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("shares the generated Word file when Web Share supports files", async () => {
  const blob = new Blob(["docx"], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const canShare = vi.fn().mockReturnValue(true);
  const share = vi.fn().mockResolvedValue(undefined);
  const createObjectURL = vi.fn();
  Object.defineProperties(navigator, {
    canShare: { configurable: true, value: canShare },
    share: { configurable: true, value: share },
  });
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });

  await expect(shareOrDownloadReport(blob, "巡检通报.docx")).resolves.toBe("shared");

  const file = canShare.mock.calls[0][0].files[0] as File;
  expect(file.name).toBe("巡检通报.docx");
  expect(file.type).toBe(blob.type);
  expect(share).toHaveBeenCalledWith({ files: [file], title: "巡检通报.docx" });
  expect(createObjectURL).not.toHaveBeenCalled();
});

test("returns unavailable when the platform has no File constructor", async () => {
  const blob = new Blob(["docx"], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  vi.stubGlobal("File", undefined);

  await expect(shareOrDownloadReport(blob, "巡检通报.docx")).resolves.toBe("unavailable");
});

test("returns unavailable without downloading when Web Share methods are missing", async () => {
  const blob = new Blob(["docx"], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  Object.defineProperties(navigator, {
    canShare: { configurable: true, value: undefined },
    share: { configurable: true, value: undefined },
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

  await expect(shareOrDownloadReport(blob, "巡检通报.docx")).resolves.toBe("unavailable");
  expect(click).not.toHaveBeenCalled();
});

test.each([
  ["canShare returns false", vi.fn().mockReturnValue(false), vi.fn()],
  ["canShare throws", vi.fn().mockImplementation(() => { throw new Error("capability failure"); }), vi.fn()],
  ["share throws", vi.fn().mockReturnValue(true), vi.fn().mockRejectedValue(new Error("share failure"))],
])("returns unavailable when %s", async (_case, canShare, share) => {
  Object.defineProperties(navigator, {
    canShare: { configurable: true, value: canShare },
    share: { configurable: true, value: share },
  });

  await expect(shareOrDownloadReport(new Blob(["docx"]), "巡检通报.docx"))
    .resolves.toBe("unavailable");
});

test("defers download URL revocation until after the click task", () => {
  vi.useFakeTimers();
  const blob = new Blob(["docx"], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  const createObjectURL = vi.fn().mockReturnValue("blob:report-download");
  const revokeObjectURL = vi.fn();
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, value: createObjectURL },
    revokeObjectURL: { configurable: true, value: revokeObjectURL },
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

  downloadReport(blob, "向塘巡检通报.docx");

  const clickedAnchor = click.mock.contexts[0] as HTMLAnchorElement;
  expect(createObjectURL).toHaveBeenCalledWith(blob);
  expect(clickedAnchor?.download).toBe("向塘巡检通报.docx");
  expect(clickedAnchor?.href).toBe("blob:report-download");
  expect(clickedAnchor?.isConnected).toBe(false);
  expect(revokeObjectURL).not.toHaveBeenCalled();

  vi.runAllTimers();
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:report-download");
});

test("returns cancellation without downloading when the user cancels the share sheet", async () => {
  const blob = new Blob(["docx"], {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  Object.defineProperties(navigator, {
    canShare: { configurable: true, value: vi.fn().mockReturnValue(true) },
    share: {
      configurable: true,
      value: vi.fn().mockRejectedValue(new DOMException("cancelled", "AbortError")),
    },
  });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

  await expect(shareOrDownloadReport(blob, "取消分享.docx")).resolves.toBe("cancelled");

  expect(click).not.toHaveBeenCalled();
});
