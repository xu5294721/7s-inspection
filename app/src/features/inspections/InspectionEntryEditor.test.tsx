import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { DependenciesContext } from "../../app/dependenciesContext";
import { makeChecklistItem, makeInspection, makePhoto, makePhotoGroup } from "../../test/fixtures";
import { InspectionEntryEditor } from "./InspectionEntryEditor";

test("saves selected check content and renders photo editing controls", async () => {
  const user = userEvent.setup();
  const onSaveCheckSelections = vi.fn().mockResolvedValue(undefined);
  const entry = makeInspection().entries[0];
  const group = makePhotoGroup({ entryId: entry.id });
  const photo = makePhoto(undefined, { groupId: group.id });

  render(
    <InspectionEntryEditor
      entry={{ ...entry, groupIds: [group.id] }}
      groups={[group]}
      photos={[photo]}
      checklistItem={makeChecklistItem()}
      disabled={false}
      onFilesSelected={vi.fn()}
      onSaveCheckSelections={onSaveCheckSelections}
      onCreatePhotoGroup={vi.fn().mockResolvedValue(undefined)}
      onSavePhotoGroup={vi.fn().mockResolvedValue(undefined)}
      onSplit={vi.fn().mockResolvedValue(undefined)}
      onPhotoSave={vi.fn().mockResolvedValue(undefined)}
      onDeletePhoto={vi.fn()}
      onReplacePhoto={vi.fn()}
      onHighQualityChange={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "检查内容：请选择检查内容" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "环境卫生" }), "干净整洁");
  await user.click(screen.getByRole("button", { name: "确认" }));

  expect(onSaveCheckSelections).toHaveBeenCalledWith([
    { category: "environment", value: "干净整洁", isCustom: false },
  ]);
  expect(screen.getByRole("button", { name: "保存评价" })).toBeVisible();
  expect(screen.getByLabelText("相册文件")).toBeVisible();
});

test("defaults a photo-free evaluation to good after saving check content", async () => {
  const user = userEvent.setup();
  const onSaveCheckSelections = vi.fn().mockResolvedValue(undefined);
  const onCreatePhotoGroup = vi.fn().mockResolvedValue(undefined);
  const entry = makeInspection().entries[0]!;

  render(
    <InspectionEntryEditor
      entry={{ ...entry, groupIds: [] }}
      groups={[]}
      photos={[]}
      checklistItem={makeChecklistItem()}
      disabled={false}
      onFilesSelected={vi.fn()}
      onSaveCheckSelections={onSaveCheckSelections}
      onCreatePhotoGroup={onCreatePhotoGroup}
      onSavePhotoGroup={vi.fn().mockResolvedValue(undefined)}
      onSplit={vi.fn().mockResolvedValue(undefined)}
      onPhotoSave={vi.fn().mockResolvedValue(undefined)}
      onDeletePhoto={vi.fn()}
      onReplacePhoto={vi.fn()}
      onHighQualityChange={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("button", { name: "检查内容：请选择检查内容" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "环境卫生" }), "干净整洁");
  await user.click(screen.getByRole("button", { name: "确认" }));

  expect(onSaveCheckSelections).toHaveBeenCalledWith([
    { category: "environment", value: "干净整洁", isCustom: false },
  ]);
  expect(onCreatePhotoGroup).not.toHaveBeenCalled();
});

test("preselects only the environment default until each other category is opened", async () => {
  const user = userEvent.setup();
  const entry = makeInspection().entries[0]!;

  render(
    <DependenciesContext.Provider value={{ inspectionCheckTemplateRepository: { get: async () => ({ id: "inspection-check-template", name: "测试", definitions: [{ category: "environment", label: "环境卫生", options: ["干净整洁"], defaultValue: "干净整洁" }, { category: "placement", label: "物品定置", options: ["规范有序"], defaultValue: "规范有序" }], itemOverrides: {}, updatedAt: "2026-01-01" }), save: async () => undefined, updateDefinitions: async () => { throw new Error("unused"); } } } as never}>
    <InspectionEntryEditor
      entry={{ ...entry, groupIds: [] }}
      groups={[]}
      photos={[]}
      checklistItem={makeChecklistItem()}
      disabled={false}
      onFilesSelected={vi.fn()}
      onSaveCheckSelections={vi.fn().mockResolvedValue(undefined)}
      onCreatePhotoGroup={vi.fn().mockResolvedValue(undefined)}
      onSavePhotoGroup={vi.fn().mockResolvedValue(undefined)}
      onSplit={vi.fn().mockResolvedValue(undefined)}
      onPhotoSave={vi.fn().mockResolvedValue(undefined)}
      onDeletePhoto={vi.fn()}
      onReplacePhoto={vi.fn()}
      onHighQualityChange={vi.fn()}
    />,
    </DependenciesContext.Provider>,
  );

  await user.click(screen.getByRole("button", { name: "\u68c0\u67e5\u5185\u5bb9\uff1a\u8bf7\u9009\u62e9\u68c0\u67e5\u5185\u5bb9" }));
  const environment = screen.getByRole("combobox", { name: "\u73af\u5883\u536b\u751f" });
  const placement = screen.getByRole("combobox", { name: "\u7269\u54c1\u5b9a\u7f6e" });
  expect(environment).toHaveValue("干净整洁");
  expect(placement).toHaveValue("规范有序");
  await user.selectOptions(environment, "");
  expect(environment).toHaveValue("");
  expect(placement).toHaveValue("规范有序");
});

test("shows all four evaluation choices when an entry has no photos or evaluation group", async () => {
  const user = userEvent.setup();
  const onCreatePhotoGroup = vi.fn().mockResolvedValue(undefined);
  const entry = makeInspection().entries[0]!;

  render(
    <InspectionEntryEditor
      entry={{ ...entry, groupIds: [] }}
      groups={[]}
      photos={[]}
      checklistItem={makeChecklistItem()}
      disabled={false}
      onFilesSelected={vi.fn()}
      onSaveCheckSelections={vi.fn().mockResolvedValue(undefined)}
      onSavePhotoGroup={vi.fn().mockResolvedValue(undefined)}
      onCreatePhotoGroup={onCreatePhotoGroup}
      onSplit={vi.fn().mockResolvedValue(undefined)}
      onPhotoSave={vi.fn().mockResolvedValue(undefined)}
      onDeletePhoto={vi.fn()}
      onReplacePhoto={vi.fn()}
      onHighQualityChange={vi.fn()}
    />,
  );

  expect(screen.getByRole("radio", { name: "好的方面" })).toBeVisible();
  expect(screen.getByRole("radio", { name: "一般表现" })).toBeVisible();
  expect(screen.getByRole("radio", { name: "提醒问题" })).toBeVisible();
  expect(screen.getByRole("radio", { name: "考核问题" })).toBeVisible();
  expect(screen.getByRole("radio", { name: "好的方面" })).toBeChecked();

  await user.click(screen.getByRole("radio", { name: "考核问题" }));
  expect(onCreatePhotoGroup).toHaveBeenCalledWith("assessment");
});
