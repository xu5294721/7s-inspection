import { describe, expect, test, vi } from "vitest";
import { createPlatformRuntime } from "./runtime";

describe("PlatformRuntime", () => {
  test.each([
    [true, "android", true],
    [true, "ios", false],
    [false, "android", false],
    [false, "web", false],
  ] as const)("native=%s platform=%s returns %s", (native, platform, expected) => {
    const capacitor = {
      isNativePlatform: vi.fn(() => native),
      getPlatform: vi.fn(() => platform),
    };

    expect(createPlatformRuntime(capacitor).isNativeAndroid()).toBe(expected);
  });
});
