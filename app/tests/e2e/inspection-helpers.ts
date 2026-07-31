import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { FilePayload, Locator, Page } from "@playwright/test";
import JSZip from "jszip";
import { expect } from "./fixtures";

const fixturePhoto = await readFile(resolve("public/icons/icon-192.png"));
const realJpegPath = resolve("tests/fixtures/site-photo.jpg");

function photoPayloads(start: number, count: number): FilePayload[] {
  return Array.from({ length: count }, (_, offset) => ({
    name: `field-photo-${String(start + offset).padStart(3, "0")}.png`,
    mimeType: "image/png",
    buffer: fixturePhoto,
  }));
}

async function importPhotos(
  route: Locator,
  start: number,
  count: number,
): Promise<void> {
  await expandInspectionRoute(route);
  await route.getByLabel("相册文件").setInputFiles(photoPayloads(start, count));
  await expect(route.getByText(`已处理 ${count}/${count}`)).toBeVisible({ timeout: 120_000 });
}

async function expandInspectionRoute(route: Locator): Promise<void> {
  const toggle = route.locator(".inspection-route__toggle");
  if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
  }
}

export async function importRealJpegForRoute(page: Page, routeName: string): Promise<void> {
  const route = page.locator(".inspection-route").filter({
    has: page.getByRole("button", { name: routeName, exact: true }),
  });
  await expect(route).toHaveCount(1);
  await expandInspectionRoute(route);
  await route.getByLabel("相册文件").setInputFiles(realJpegPath);
  await expect(page.getByText("已处理 1/1")).toBeVisible({ timeout: 120_000 });
}

export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() =>
    document.documentElement.scrollWidth - window.innerWidth,
  )).toBeLessThanOrEqual(0);
}

export interface DownloadedWordContents {
  suggestedFilename: string;
  documentXml: string;
  mediaFileNames: string[];
  mediaBytes: Uint8Array;
}

export async function downloadGeneratedWord(page: Page): Promise<DownloadedWordContents> {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载Word" }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error("Playwright未提供Word下载路径");

  const zip = await JSZip.loadAsync(await readFile(downloadPath));
  const documentXml = await zip.file("word/document.xml")?.async("string");
  if (!documentXml) throw new Error("生成的Word缺少word/document.xml");
  const mediaFiles = Object.values(zip.files)
    .filter((file) => !file.dir && /^word\/media\//.test(file.name));
  if (mediaFiles.length !== 1) throw new Error("生成的Word应包含唯一一份照片媒体文件");
  return {
    suggestedFilename: download.suggestedFilename(),
    documentXml,
    mediaFileNames: mediaFiles.map((file) => file.name),
    mediaBytes: await mediaFiles[0].async("uint8array"),
  };
}

async function saveReward(group: Locator): Promise<void> {
  await group.getByRole("checkbox", { name: "设置奖励" }).check();
  await group.getByRole("textbox", { name: "奖励人员" }).fill("张三");
  await group.getByRole("button", { name: "30元" }).click();
  await group.getByRole("button", { name: "保存评价" }).click();
}

async function saveAssessment(group: Locator): Promise<void> {
  await group.getByRole("radio", { name: "考核问题" }).check();
  await group.getByRole("textbox", { name: "考核人员" }).fill("李四");
  await group.getByRole("button", { name: "50元" }).click();
  await group.getByRole("button", { name: "保存评价" }).click();
}

export interface StoredInspectionSummary {
  photos: number;
  groups: number;
  categories: Record<string, number>;
  rewards: number;
  assessments: number;
}

export async function readStoredSummary(page: Page): Promise<StoredInspectionSummary> {
  return page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
      const request = indexedDB.open("seven-s");
      request.onsuccess = () => resolveDatabase(request.result);
      request.onerror = () => reject(request.error);
    });
    const readAll = <T>(storeName: string) => new Promise<T[]>((resolveRows, reject) => {
      const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
      request.onsuccess = () => resolveRows(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
    const [photos, groups] = await Promise.all([
      readAll("photos"),
      readAll<{ category: string; awardAssessment: null | { type: string } }>("photoGroups"),
    ]);
    database.close();
    return {
      photos: photos.length,
      groups: groups.length,
      categories: groups.reduce<Record<string, number>>((counts, group) => {
        counts[group.category] = (counts[group.category] ?? 0) + 1;
        return counts;
      }, {}),
      rewards: groups.filter((group) => group.awardAssessment?.type === "reward").length,
      assessments: groups.filter((group) => group.awardAssessment?.type === "assessment").length,
    };
  });
}

export async function createCategorizedDraft(
  page: Page,
  photoCounts: readonly [number, number, number],
): Promise<{ title: string; totalPhotos: number }> {
  const totalPhotos = photoCounts.reduce((total, count) => total + count, 0);
  await page.goto("/#/inspections/new");
  const routeCheckboxes = page.getByRole("checkbox");
  await expect(routeCheckboxes.first()).toBeVisible();
  await page.getByRole("button", { name: "全不选" }).click();
  for (let index = 0; index < photoCounts.length; index += 1) {
    await routeCheckboxes.nth(index).check();
  }
  await page.getByRole("button", { name: "开始检查" }).click();
  await page.waitForURL(/#\/inspections\/(?!new$)[^/]+$/);
  const title = await page.getByRole("heading", { level: 2 }).textContent();
  if (!title) throw new Error("巡检标题未生成");

  let nextPhoto = 1;
  for (let entry = 0; entry < photoCounts.length; entry += 1) {
    await importPhotos(page.locator(".inspection-route").nth(entry), nextPhoto, photoCounts[entry]);
    nextPhoto += photoCounts[entry];
  }

  const groups = page.locator(".photo-group-editor");
  await expect(groups).toHaveCount(3);
  await saveReward(groups.nth(0));
  await groups.nth(1).getByRole("radio", { name: "提醒问题" }).check();
  await groups.nth(1).getByRole("button", { name: "保存评价" }).click();
  await saveAssessment(groups.nth(2));

  const firstGroup = groups.nth(0);
  await firstGroup.getByRole("button", { name: /^调整照片 / }).first().click();
  await firstGroup.getByRole("menuitem", { name: "提醒问题" }).click();

  await expect.poll(() => readStoredSummary(page), { timeout: 30_000 }).toMatchObject({
    photos: totalPhotos,
    groups: 4,
    categories: { good: 1, reminder: 2, assessment: 1 },
    rewards: 1,
    assessments: 1,
  });

  await page.reload();
  await expect(page.getByRole("heading", { name: title, level: 2 })).toBeVisible();
  for (let entry = 0; entry < photoCounts.length; entry += 1) {
    const route = page.locator(".inspection-route").nth(entry);
    await expandInspectionRoute(route);
    await expect(route.getByAltText("巡检照片缩略图")).toHaveCount(photoCounts[entry]);
  }
  return { title, totalPhotos };
}

export async function openReview(page: Page): Promise<void> {
  await page.getByRole("button", { name: "完成检查，进入复核" }).click();
  await expect(page.getByRole("heading", { name: "通报复核", level: 2 })).toBeVisible();
}
