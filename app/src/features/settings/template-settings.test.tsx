import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createAppDependencies } from "../../app/dependencies";
import { createTestDb } from "../../db/database";
import { InspectionRepository } from "../../db/inspectionRepository";
import { TemplateRepository } from "../../db/templateRepository";
import { makeInspection, makePhotoGroup } from "../../test/fixtures";
import { renderWithRouter } from "../../test/renderWithRouter";

test("saves a new template version and applies it to an ungenerated inspection", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`template-version-${Date.now()}`);
  const dependencies = createAppDependencies(database);
  const inspection = makeInspection({ id: "old-template-inspection", templateVersion: 2, entries: [] });
  await new InspectionRepository(database).saveGraph({ inspection, groups: [], photos: [] });
  const view = renderWithRouter({ database, initialPath: "/settings/templates", appProps: { dependencies } });

  const title = await screen.findByRole("textbox", { name: "标题格式" });
  await user.clear(title);
  await user.type(title, "新版 {date} 巡检通报");
  await user.clear(screen.getByRole("textbox", { name: "正文字号" }));
  await user.type(screen.getByRole("textbox", { name: "正文字号" }), "三号");
  await user.clear(screen.getByRole("textbox", { name: "正文首行缩进" }));
  await user.type(screen.getByRole("textbox", { name: "正文首行缩进" }), "2");
  await user.selectOptions(screen.getByRole("combobox", { name: "每行照片数" }), "2");
  await user.click(screen.getByRole("button", { name: "保存为新版本" }));

  const templates = new TemplateRepository(database);
  await waitFor(async () => expect((await templates.getLatest("template-default"))?.version).toBe(3));
  expect((await templates.get("template-default", 2))?.titlePattern).not.toBe("新版 {date} 巡检通报");
  expect((await templates.getLatest("template-default"))?.photosPerRow).toBe(2);
  expect((await templates.getLatest("template-default"))?.bodyFontSizePt).toBe(16);
  expect((await templates.getLatest("template-default"))?.firstLineIndentChars).toBe(2);
  await waitFor(() => expect(screen.getByRole("textbox", { name: "正文字号" })).toHaveValue("16"));
  expect(screen.getByRole("textbox", { name: "正文首行缩进" })).toHaveValue("2");
  const restored = await new InspectionRepository(database).getGraph("old-template-inspection");
  expect(restored?.inspection.templateVersion).toBe(3);
  expect(restored?.template?.version).toBe(3);
  view.unmount();

  const newInspectionView = renderWithRouter({ database, initialPath: "/inspections/new", appProps: { dependencies } });
  await user.click(await screen.findByRole("checkbox", { name: "一线焊机" }));
  await user.click(screen.getByRole("button", { name: "开始检查" }));
  await waitFor(async () => expect(await database.inspections.count()).toBe(2));
  const created = (await database.inspections.toArray()).find((item) => item.id !== "old-template-inspection");
  expect(created?.templateVersion).toBe(3);
  newInspectionView.unmount();
});

test("rejects unsupported body font size input without creating a template version", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`template-font-size-validation-${Date.now()}`);
  const dependencies = createAppDependencies(database);
  const view = renderWithRouter({ database, initialPath: "/settings/templates", appProps: { dependencies } });
  const templates = new TemplateRepository(database);

  await screen.findByRole("textbox", { name: "正文字号" });
  const versionCount = await database.templates.count();
  await user.clear(screen.getByRole("textbox", { name: "正文字号" }));
  await user.type(screen.getByRole("textbox", { name: "正文字号" }), "四号");
  await user.click(screen.getByRole("button", { name: "保存为新版本" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("正文字号请输入三号或大于0的磅值");
  expect(await database.templates.count()).toBe(versionCount);
  expect((await templates.getLatest("template-default"))?.version).toBe(2);
  view.unmount();
});

test("preserves explicitly cleared report headings in the next template version", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`template-cleared-headings-${Date.now()}`);
  const dependencies = createAppDependencies(database);
  const templates = new TemplateRepository(database);
  const view = renderWithRouter({ database, initialPath: "/settings/templates", appProps: { dependencies } });
  await screen.findByRole("textbox", { name: "总体要求标题" });
  const initial = await templates.getLatest("template-default");
  await templates.save({
    ...initial!,
    version: initial!.version + 1,
    generalHeading: "一、总体要求",
    situationHeading: "二、本次检查总体情况",
  });
  view.unmount();
  const editingView = renderWithRouter({ database, initialPath: "/settings/templates", appProps: { dependencies } });

  await screen.findByRole("textbox", { name: "总体要求标题" });
  await user.clear(screen.getByRole("textbox", { name: "总体要求标题" }));
  await user.clear(screen.getByRole("textbox", { name: "总体情况标题" }));
  await user.click(screen.getByRole("button", { name: "保存为新版本" }));

  await waitFor(async () => expect((await templates.getLatest("template-default"))?.version).toBe(4));
  expect((await templates.getLatest("template-default"))?.generalHeading).toBe("");
  expect((await templates.getLatest("template-default"))?.situationHeading).toBe("");
  editingView.unmount();
});

test("applies a saved template version to ungenerated inspections", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`template-active-inspection-${Date.now()}`);
  const dependencies = createAppDependencies(database);
  const repository = new InspectionRepository(database);
  const inspection = makeInspection({
    templateVersion: 2,
    status: "reviewed",
  });
  await repository.saveGraph({
    inspection,
    groups: [makePhotoGroup({ inspectionId: inspection.id, entryId: inspection.entries[0]!.id, photoIds: [] })],
    photos: [],
  });
  const view = renderWithRouter({ database, initialPath: "/settings/templates", appProps: { dependencies } });

  await screen.findByRole("textbox", { name: "总体要求标题" });
  await user.clear(screen.getByRole("textbox", { name: "总体要求标题" }));
  await user.click(screen.getByRole("button", { name: "保存为新版本" }));

  await waitFor(async () => expect((await repository.getGraph(inspection.id))?.inspection.templateVersion).toBe(3));
  expect((await repository.getGraph(inspection.id))?.template?.generalHeading).toBe("");
  view.unmount();
});

test("exposes adaptive or fixed layout and one to four photos per row", async () => {
  const database = createTestDb(`template-settings-${Date.now()}`);
  const view = renderWithRouter({ database, initialPath: "/settings" });

  await screen.findByRole("link", { name: "Word模板设置" });
  await userEvent.setup().click(screen.getByRole("link", { name: "Word模板设置" }));
  const mode = await screen.findByRole("combobox", { name: "照片排版模式" });
  const photosPerRow = await screen.findByRole("combobox", { name: "每行照片数" });
  expect(Array.from((mode as HTMLSelectElement).options).map((option) => option.value)).toEqual(["adaptive", "fixed"]);
  expect(Array.from((photosPerRow as HTMLSelectElement).options).map((option) => option.value)).toEqual(["1", "2", "3", "4"]);
  view.unmount();
});

test("saves adaptive mode and a one-photo row limit as a new template version", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`template-photo-layout-save-${Date.now()}`);
  const dependencies = createAppDependencies(database);
  const templates = new TemplateRepository(database);
  const view = renderWithRouter({ database, initialPath: "/settings/templates", appProps: { dependencies } });

  await screen.findByRole("combobox", { name: "照片排版模式" });
  await user.selectOptions(screen.getByRole("combobox", { name: "照片排版模式" }), "adaptive");
  await user.selectOptions(screen.getByRole("combobox", { name: "每行照片数" }), "1");
  await user.click(screen.getByRole("button", { name: "保存为新版本" }));

  await waitFor(async () => expect((await templates.getLatest("template-default"))).toMatchObject({
    photoLayoutMode: "adaptive",
    photosPerRow: 1,
  }));
  view.unmount();
});

test("shows an explicit error when the default template is unavailable", async () => {
  const database = createTestDb(`template-missing-${Date.now()}`);
  const dependencies = createAppDependencies(database);
  const view = renderWithRouter({
    database,
    initialPath: "/settings/templates",
    appProps: {
      dependencies: {
        ...dependencies,
        templateRepository: {
          listVersions: (id) => dependencies.templateRepository.listVersions(id),
          getLatest: async () => undefined,
          save: (template) => dependencies.templateRepository.save(template),
          seedIfMissing: (template) => dependencies.templateRepository.seedIfMissing(template),
        },
      },
    },
  });

  expect(await screen.findByRole("alert")).toHaveTextContent("默认模板不存在");
  view.unmount();
});
