import { describe, expect, it } from "vitest";
import { toLocalInspectionDateTime } from "./dates";

describe("toLocalInspectionDateTime", () => {
  it("keeps the inspection date and appends the local hour and minute of updatedAt", () => {
    const updatedAt = "2026-08-13T06:30:00.000Z";
    const updated = new Date(updatedAt);
    const hours = String(updated.getHours()).padStart(2, "0");
    const minutes = String(updated.getMinutes()).padStart(2, "0");
    expect(toLocalInspectionDateTime("2026-08-13", updatedAt)).toBe(`2026-08-13 ${hours}:${minutes}`);
  });

  it("pads single-digit hour and minute values", () => {
    const updatedAt = "2026-08-13T00:05:00.000Z";
    const updated = new Date(updatedAt);
    const hours = String(updated.getHours()).padStart(2, "0");
    const minutes = String(updated.getMinutes()).padStart(2, "0");
    expect(toLocalInspectionDateTime("2026-08-13", updatedAt)).toBe(`2026-08-13 ${hours}:${minutes}`);
    expect(toLocalInspectionDateTime("2026-08-13", updatedAt)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("falls back to the date only when updatedAt is not a valid timestamp", () => {
    expect(toLocalInspectionDateTime("2026-08-13", "")).toBe("2026-08-13");
    expect(toLocalInspectionDateTime("2026-08-13", "not-a-date")).toBe("2026-08-13");
  });
});
