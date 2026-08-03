import {
  downloadGeneratedWord,
  importRealJpegForRoute,
  openReview,
} from "./inspection-helpers";
import { expect, test } from "./fixtures";

const photographedRoute = "卷扬机间";
const selectedEmptyRoute = "百米轨场平移小车";
const uncheckedRoute = "焊后间与门吊之间区域";
const selectedContentSentence = "卷扬机间：环境卫生干净整洁，物品定置工具摆放整齐。";
const oldGenericAutoWording = "卷扬机间7S管理落实较好。";

function paragraphContaining(documentXml: string, text: string): string {
  const textIndex = documentXml.indexOf(text);
  if (textIndex < 0) throw new Error(`Missing paragraph text: ${text}`);
  const paragraphStart = documentXml.lastIndexOf("<w:p", textIndex);
  const paragraphEnd = documentXml.indexOf("</w:p>", textIndex);
  if (paragraphStart < 0 || paragraphEnd < 0) throw new Error(`Missing paragraph: ${text}`);
  return documentXml.slice(paragraphStart, paragraphEnd + "</w:p>".length);
}

function paragraphsWithKeepNext(documentXml: string): string[] {
  return [...documentXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)]
    .map((match) => match[0])
    .filter((paragraph) => /<w:keepNext\s*\/>/.test(paragraph));
}

test("exports selected inspection content without the old annex or generic wording", async ({ page }, testInfo) => {
  const captureScreenshot = page.screenshot.bind(page);
  test.setTimeout(120_000);
  await page.goto("/#/settings/templates");
  await expect(page.getByText("当前编辑 v3，保存后将生成 v4")).toBeVisible();
  const generalHeading = await page.getByRole("textbox", { name: "总体要求标题" }).inputValue();
  const situationHeadingInput = page.getByRole("textbox", { name: "总体情况标题" });
  const situationHeading = `${await situationHeadingInput.inputValue()}（自定义）`;
  const goodHeading = await page.getByRole("textbox", { name: "good章节名称" }).inputValue();
  const generalSectionHeading = await page.getByRole("textbox", { name: "general章节名称" }).inputValue();
  const customGeneralSectionHeading = "一般情况（本次自定义章节）";
  const reminderHeading = await page.getByRole("textbox", { name: "reminder章节名称" }).inputValue();
  const assessmentHeading = await page.getByRole("textbox", { name: "assessment章节名称" }).inputValue();
  await page.getByRole("textbox", { name: "总体要求标题" }).clear();
  await situationHeadingInput.fill(situationHeading);
  await page.getByRole("textbox", { name: "general章节名称" }).fill(customGeneralSectionHeading);
  await page.getByRole("textbox", { name: "正文字号" }).fill("三号");
  await page.getByRole("textbox", { name: "正文首行缩进" }).fill("2");
  await page.getByRole("button", { name: "保存为新版本" }).click();
  await expect(page.getByText("当前编辑 v4，保存后将生成 v5")).toBeVisible();
  await page.goto("/#/inspections/new");
  await expect(page.getByRole("checkbox", { name: photographedRoute })).toBeVisible();
  await page.getByRole("button", { name: "全不选" }).click();
  await page.getByRole("checkbox", { name: photographedRoute }).check();
  await page.getByRole("checkbox", { name: selectedEmptyRoute }).check();
  await expect(page.getByRole("checkbox", { name: uncheckedRoute })).not.toBeChecked();
  await page.getByRole("button", { name: "开始检查" }).click();
  await page.waitForURL(/#\/inspections\/(?!new$)[^/]+$/);

  const photographedRouteCard = page.locator(".inspection-route").filter({
    has: page.getByRole("button", { name: photographedRoute, exact: true }),
  });
  await photographedRouteCard.locator(".inspection-route__toggle").click();
  await photographedRouteCard.getByRole("button", { name: "检查内容：请选择检查内容" }).click();
  await photographedRouteCard.getByRole("combobox", { name: "环境卫生" }).selectOption("干净整洁");
  await photographedRouteCard.getByRole("combobox", { name: "物品定置" }).selectOption({ label: "自定义" });
  await photographedRouteCard.getByRole("textbox", { name: "物品定置自定义内容" }).fill("工具摆放整齐");
  await photographedRouteCard.getByRole("button", { name: "确认" }).click();

  await importRealJpegForRoute(page, photographedRoute);
  const photoGroup = page.locator(".photo-group-editor");
  await expect(photoGroup).toHaveCount(1);
  await photoGroup.getByRole("radio", { name: "一般表现" }).check();
  await photoGroup.getByRole("button", { name: "保存评价" }).click();
  await openReview(page);

  await page.getByRole("button", { name: "生成Word" }).click();
  await expect(page.getByText("Word已生成，可分享或下载。")).toBeVisible({ timeout: 120_000 });

  const word = await downloadGeneratedWord(page);
  expect(word.suggestedFilename).toMatch(/7S巡检通报\.docx$/);
  expect(word.mediaFileNames).toHaveLength(1);
  expect(word.mediaFileNames[0]).toMatch(/\.jpe?g$/i);
  expect(Array.from(word.mediaBytes.subarray(0, 3))).toEqual([0xff, 0xd8, 0xff]);
  expect(word.documentXml).toContain(photographedRoute);
  expect(word.documentXml).not.toContain(selectedEmptyRoute);
  expect(word.documentXml).not.toContain(uncheckedRoute);
  expect(word.documentXml.match(new RegExp(selectedContentSentence, "g"))).toHaveLength(1);
  expect(word.documentXml).not.toContain("附件：巡检照片明细表");
  expect(word.documentXml).not.toContain("责任工班");
  expect(word.documentXml).not.toContain("区域设备");
  expect(word.documentXml).not.toContain(oldGenericAutoWording);
  expect(word.documentXml).not.toContain(generalHeading);
  expect(word.documentXml).not.toContain(goodHeading);
  expect(word.documentXml).toContain(customGeneralSectionHeading);
  expect(word.documentXml).not.toContain(generalSectionHeading);
  expect(word.documentXml).not.toContain(reminderHeading);
  expect(word.documentXml).not.toContain(assessmentHeading);
  expect(word.documentXml.match(/<w:drawing\b/g)).toHaveLength(1);
  expect(word.documentXml).toContain('<w:sz w:val="32"/>');
  expect(word.documentXml).toContain('<w:ind w:firstLine="640"/>');
  expect(paragraphContaining(word.documentXml, situationHeading)).toContain(
    '<w:ind w:firstLine="640"/>',
  );
  expect(paragraphContaining(word.documentXml, generalSectionHeading)).toContain('<w:ind w:firstLine="640"/>');

  const routeHeadings = paragraphsWithKeepNext(word.documentXml);
  expect(routeHeadings).toHaveLength(1);
  expect(routeHeadings[0]).toContain(photographedRoute);

  const verificationDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载Word" }).click();
  const verificationDownload = await verificationDownloadPromise;
  await verificationDownload.saveAs(testInfo.outputPath("selected-content-report.docx"));
  await captureScreenshot({
    path: testInfo.outputPath("selected-content-word-review.png"),
    fullPage: true,
  });
});
