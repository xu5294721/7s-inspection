// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { build } from "vite";

let outputDirectory = "";

beforeAll(async () => {
  outputDirectory = await mkdtemp(join(tmpdir(), "seven-s-pwa-"));
  await build({
    configFile: resolve("vite.config.ts"),
    logLevel: "silent",
    build: { outDir: outputDirectory },
  });
}, 120_000);

afterAll(async () => {
  if (outputDirectory) {
    await rm(outputDirectory, { recursive: true, force: true });
  }
});

test("production build emits the installable 7S inspection manifest", async () => {
  const manifest = JSON.parse(
    await readFile(join(outputDirectory, "manifest.webmanifest"), "utf8"),
  ) as {
    name?: string;
    short_name?: string;
    display?: string;
    theme_color?: string;
    start_url?: string;
    lang?: string;
    icons?: Array<{ src?: string; sizes?: string; type?: string; purpose?: string }>;
  };

  expect(manifest).toMatchObject({
    name: "7S巡检",
    short_name: "7S巡检",
    display: "standalone",
    theme_color: "#087456",
    start_url: "./",
    lang: "zh-CN",
  });
  expect(manifest.icons).toEqual(
    expect.arrayContaining([
      {
        src: "icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ]),
  );

  const html = await readFile(join(outputDirectory, "index.html"), "utf8");
  expect(html).toContain('<html lang="zh-CN">');
  expect(html).toContain("<title>7S巡检</title>");
});
