import { existsSync } from "node:fs";
import { defineConfig } from "@playwright/test";

function configuredBrowserExecutable(): string | undefined {
  const executablePath = process.env.PLAYWRIGHT_CHROME_EXECUTABLE_PATH?.trim();
  if (!executablePath) return undefined;
  if (!existsSync(executablePath)) {
    throw new Error(`PLAYWRIGHT_CHROME_EXECUTABLE_PATH does not exist: ${executablePath}`);
  }
  return executablePath;
}

const browserExecutable = configuredBrowserExecutable();

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4174",
    launchOptions: browserExecutable ? { executablePath: browserExecutable } : undefined,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    serviceWorkers: "allow",
  },
  projects: [
    {
      name: "mobile-360",
      use: {
        browserName: "chromium",
        viewport: { width: 360, height: 800 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "mobile-390",
      use: {
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "mobile-412",
      use: {
        browserName: "chromium",
        viewport: { width: 412, height: 915 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "mobile-430",
      use: {
        browserName: "chromium",
        viewport: { width: 430, height: 932 },
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: "tablet-768",
      use: {
        browserName: "chromium",
        viewport: { width: 768, height: 1024 },
        hasTouch: true,
        isMobile: false,
      },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 4174",
    url: "http://127.0.0.1:4174",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
