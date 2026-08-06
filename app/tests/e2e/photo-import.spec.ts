import { resolve } from "node:path";
import { expect, test } from "./fixtures";
import { openInspectionEntry } from "./inspection-helpers";

test("photo import stores decodable 2000px report and 320px thumbnail JPEGs", async ({ page }) => {
  await page.goto("/#/inspections/new");
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: "开始检查" }).click();
  await expect(page.getByRole("heading", { name: /7S巡检通报/ })).toBeVisible();

  const entryDialog = await openInspectionEntry(page, page.locator(".inspection-route").first());
  await entryDialog.getByLabel("相册文件").setInputFiles(
    resolve("tests/fixtures/site-photo.jpg"),
  );
  await expect(page.getByText("已处理 1/1")).toBeVisible();
  await expect(entryDialog.getByAltText("巡检照片缩略图")).toBeVisible();

  const dimensions = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => {
      const request = indexedDB.open("seven-s");
      request.onsuccess = () => resolveDatabase(request.result);
      request.onerror = () => reject(request.error);
    });
    const photo = await new Promise<{
      imageBlob: Blob;
      thumbnailBlob: Blob;
      width: number;
      height: number;
    }>((resolvePhoto, reject) => {
      const request = database.transaction("photos", "readonly").objectStore("photos").getAll();
      request.onsuccess = () => resolvePhoto(request.result[0]);
      request.onerror = () => reject(request.error);
    });
    const report = await createImageBitmap(photo.imageBlob);
    const thumbnail = await createImageBitmap(photo.thumbnailBlob);
    const result = {
      model: { width: photo.width, height: photo.height },
      report: { width: report.width, height: report.height },
      thumbnail: { width: thumbnail.width, height: thumbnail.height },
      reportType: photo.imageBlob.type,
      thumbnailType: photo.thumbnailBlob.type,
    };
    report.close();
    thumbnail.close();
    database.close();
    return result;
  });

  expect(dimensions.model).toEqual(dimensions.report);
  expect(Math.max(dimensions.report.width, dimensions.report.height)).toBe(2000);
  expect(Math.max(dimensions.thumbnail.width, dimensions.thumbnail.height)).toBe(320);
  expect(dimensions.reportType).toBe("image/jpeg");
  expect(dimensions.thumbnailType).toBe("image/jpeg");
});
