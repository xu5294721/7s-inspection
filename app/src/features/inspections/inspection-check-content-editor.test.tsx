import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { makeInspection } from "../../test/fixtures";
import { InspectionCheckContentEditor } from "./InspectionCheckContentEditor";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderEditor(
  onSave = vi.fn<(_: ReturnType<typeof makeInspection>["entries"][number]["checkSelections"]) => Promise<void>>()
    .mockResolvedValue(undefined),
) {
  const entry = makeInspection().entries[0];
  return { onSave, ...render(<InspectionCheckContentEditor entry={entry} disabled={false} onSave={onSave} />) };
}

test("shows the empty summary and four independent check-content comboboxes", async () => {
  const user = userEvent.setup();
  renderEditor();

  await user.click(screen.getByRole("button", { name: "检查内容：请选择检查内容" }));

  const comboboxes = screen.getAllByRole("combobox");
  expect(comboboxes).toHaveLength(4);
  for (const [index, label] of ["环境卫生", "物品定置", "设备清洁保养", "安全防护"].entries()) {
    expect(comboboxes[index]).toHaveAccessibleName(label);
  }
});

test("offers unselected, the four fixed values, and custom for every category", async () => {
  const user = userEvent.setup();
  renderEditor();

  await user.click(screen.getByRole("button", { name: "检查内容：请选择检查内容" }));
  const environment = screen.getByRole("combobox", { name: "环境卫生" });

  expect(Array.from((environment as HTMLSelectElement).options, (option) => option.text)).toEqual([
    "未选择",
    "干净整洁",
    "基本整洁",
    "清扫不到位",
    "存在积灰杂物",
    "自定义",
  ]);
});

test("saves fixed selections in the definition order and displays the enumeration-comma summary", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockResolvedValue(undefined);
  renderEditor(onSave);

  await user.click(screen.getByRole("button", { name: "检查内容：请选择检查内容" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "安全防护" }), "安全通道畅通");
  await user.selectOptions(screen.getByRole("combobox", { name: "环境卫生" }), "干净整洁");
  await user.click(screen.getByRole("button", { name: "确认" }));

  expect(onSave).toHaveBeenCalledWith([
    { category: "environment", value: "干净整洁", isCustom: false },
    { category: "safety", value: "安全通道畅通", isCustom: false },
  ]);
  expect(await screen.findByRole("button", { name: "检查内容：环境卫生干净整洁、安全防护安全通道畅通" })).toBeVisible();
});

test("uses explicit select labels without wrapping the separately named custom input", async () => {
  const user = userEvent.setup();
  renderEditor();

  await user.click(screen.getByRole("button", { name: "检查内容：请选择检查内容" }));
  for (const label of ["环境卫生", "物品定置", "设备清洁保养", "安全防护"]) {
    const select = screen.getByRole("combobox", { name: label });
    const explicitLabel = screen.getByText(label, { selector: "label" });
    expect(select).toHaveAttribute("id");
    expect(explicitLabel).toHaveAttribute("for", select.id);
    expect(select.closest("label")).toBeNull();
  }

  await user.selectOptions(screen.getByRole("combobox", { name: "物品定置" }), "__custom__");
  const custom = screen.getByRole("textbox", { name: "物品定置自定义内容" });
  expect(custom.closest("label")).toBeNull();
});

test("shows the exact category-specific description hint for every custom input", async () => {
  const user = userEvent.setup();
  renderEditor();

  await user.click(screen.getByRole("button", { name: "检查内容：请选择检查内容" }));
  for (const label of ["环境卫生", "物品定置", "设备清洁保养", "安全防护"]) {
    const select = screen.getByRole("combobox", { name: label });
    await user.selectOptions(select, "__custom__");
    expect(screen.getByRole("textbox", { name: `${label}自定义内容` })).toHaveAttribute(
      "placeholder",
      `仅输入“${label}”后的描述`,
    );
    await user.selectOptions(select, "");
  }
});

test("shows only the selected custom input, trims it, and rejects an empty value", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockResolvedValue(undefined);
  renderEditor(onSave);

  await user.click(screen.getByRole("button", { name: "检查内容：请选择检查内容" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "物品定置" }), "__custom__");
  const custom = screen.getByRole("textbox", { name: "物品定置自定义内容" });
  expect(screen.queryByRole("textbox", { name: "环境卫生自定义内容" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "确认" }));
  expect(screen.getByRole("alert")).toHaveTextContent("请输入自定义检查内容");
  expect(onSave).not.toHaveBeenCalled();

  await user.type(custom, "  工具分类摆放  ");
  await user.click(screen.getByRole("button", { name: "确认" }));
  expect(onSave).toHaveBeenCalledWith([
    { category: "placement", value: "工具分类摆放", isCustom: true },
  ]);
});

test("cancel restores the opened state and confirming cleared values saves an empty array", async () => {
  const user = userEvent.setup();
  const entry = makeInspection({
    entries: [{
      ...makeInspection().entries[0],
      checkSelections: [{ category: "environment", value: "干净整洁", isCustom: false }],
    }],
  }).entries[0];
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<InspectionCheckContentEditor entry={entry} disabled={false} onSave={onSave} />);

  await user.click(screen.getByRole("button", { name: "检查内容：环境卫生干净整洁" }));
  await user.selectOptions(screen.getByRole("combobox", { name: "环境卫生" }), "基本整洁");
  await user.click(screen.getByRole("button", { name: "取消" }));
  await user.click(screen.getByRole("button", { name: "检查内容：环境卫生干净整洁" }));
  expect(screen.getByRole("combobox", { name: "环境卫生" })).toHaveValue("干净整洁");

  await user.selectOptions(screen.getByRole("combobox", { name: "环境卫生" }), "");
  await user.click(screen.getByRole("button", { name: "确认" }));
  expect(onSave).toHaveBeenCalledWith([]);
});

test("clicking the expanded summary intentionally discards the draft like cancel", async () => {
  const user = userEvent.setup();
  const entry = makeInspection({
    entries: [{
      ...makeInspection().entries[0],
      checkSelections: [{ category: "environment", value: "干净整洁", isCustom: false }],
    }],
  }).entries[0];
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<InspectionCheckContentEditor entry={entry} disabled={false} onSave={onSave} />);

  const summary = screen.getByRole("button", { name: "检查内容：环境卫生干净整洁" });
  await user.click(summary);
  await user.selectOptions(screen.getByRole("combobox", { name: "环境卫生" }), "基本整洁");
  await user.selectOptions(screen.getByRole("combobox", { name: "物品定置" }), "__custom__");
  await user.click(screen.getByRole("button", { name: "确认" }));
  expect(screen.getByRole("alert")).toHaveTextContent("请输入自定义检查内容");

  await user.click(summary);
  expect(summary).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("combobox", { name: "环境卫生" })).not.toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();

  await user.click(summary);
  expect(screen.getByRole("combobox", { name: "环境卫生" })).toHaveValue("干净整洁");
  expect(screen.getByRole("combobox", { name: "物品定置" })).toHaveValue("");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("disables every editor control while saving and prevents duplicate confirmation", async () => {
  const user = userEvent.setup();
  const pending = deferred<void>();
  const onSave = vi.fn().mockReturnValue(pending.promise);
  renderEditor(onSave);

  const summary = screen.getByRole("button", { name: "检查内容：请选择检查内容" });
  await user.click(summary);
  await user.selectOptions(screen.getByRole("combobox", { name: "环境卫生" }), "干净整洁");
  await user.dblClick(screen.getByRole("button", { name: "确认" }));

  expect(onSave).toHaveBeenCalledTimes(1);
  expect(summary).toBeDisabled();
  expect(screen.getByRole("combobox", { name: "环境卫生" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "确认" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();

  await act(async () => {
    pending.resolve();
    await pending.promise;
  });
});

test("keeps rejected draft values open and reports the save error at the first operable row", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockRejectedValue(new Error("保存失败"));
  renderEditor(onSave);

  await user.click(screen.getByRole("button", { name: "检查内容：请选择检查内容" }));
  const environment = screen.getByRole("combobox", { name: "环境卫生" });
  await user.selectOptions(environment, "干净整洁");
  await user.click(screen.getByRole("button", { name: "确认" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
  expect(environment).toHaveValue("干净整洁");
  expect(environment).toHaveFocus();
});
