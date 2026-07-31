// @vitest-environment node

import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, test, vi } from "vitest";

const originalExecutable = process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH;

afterEach(() => {
  if (originalExecutable === undefined) delete process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH;
  else process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH = originalExecutable;
  vi.resetModules();
});

test("uses bundled Chromium by default with the two exact mobile projects", async () => {
  delete process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH;
  vi.resetModules();
  const { default: config } = await import("../playwright.config");

  expect(config.use?.launchOptions?.executablePath).toBeUndefined();
  expect(config.projects?.map((project) => ({
    name: project.name,
    browserName: project.use?.browserName,
    viewport: project.use?.viewport,
  }))).toEqual([
    { name: "mobile-360", browserName: "chromium", viewport: { width: 360, height: 800 } },
    { name: "mobile-412", browserName: "chromium", viewport: { width: 412, height: 915 } },
  ]);
});

test("uses an existing Chrome path only when explicitly configured", async () => {
  expect(existsSync(process.execPath)).toBe(true);
  process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH = process.execPath;
  vi.resetModules();
  const { default: config } = await import("../playwright.config");

  expect(config.use?.launchOptions?.executablePath).toBe(process.execPath);
});

test("rejects an explicitly configured Chrome path that does not exist", async () => {
  process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH = resolve("missing-playwright-browser.exe");
  vi.resetModules();

  await expect(import("../playwright.config")).rejects.toThrow(
    "PLAYWRIGHT_CHROME_EXECUTABLE_PATH does not exist",
  );
});

test("all E2E specs share console-error handling and no E2E support file writes success screenshots", async () => {
  const directory = resolve("tests/e2e");
  const files = (await readdir(directory)).filter((name) => name.endsWith(".ts"));
  const specs = files.filter((name) => name.endsWith(".spec.ts"));
  expect(specs).not.toHaveLength(0);

  for (const file of files) {
    const source = await readFile(resolve(directory, file), "utf8");
    if (file.endsWith(".spec.ts")) {
      expect(source, file).toMatch(/from ["']\.\/fixtures["']/);
    }
    expect(source, file).not.toContain(".screenshot(");
    expect(source, file).not.toContain("task-12-visual-");
  }
});
