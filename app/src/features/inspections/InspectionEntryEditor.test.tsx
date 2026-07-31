import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
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
