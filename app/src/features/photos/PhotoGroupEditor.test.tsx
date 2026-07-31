import { act, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import { makeChecklistItem, makePhoto, makePhotoGroup } from "../../test/fixtures";
import { PhotoGroupEditor } from "./PhotoGroupEditor";

const globalCss = readFileSync(resolve("src/styles/global.css"), "utf8");

afterEach(() => {
  vi.useRealTimers();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("exposes the three photo categories as accessible radios", () => {
  render(
    <PhotoGroupEditor
      item={makeChecklistItem()}
      group={makePhotoGroup()}
      photos={[makePhoto()]}
      onSave={vi.fn()}
      onSplit={vi.fn()}
    />,
  );

  expect(screen.getByRole("radio", { name: "好的方面" })).toBeChecked();
  expect(screen.getByRole("radio", { name: "提醒问题" })).not.toBeChecked();
  expect(screen.getByRole("radio", { name: "考核问题" })).not.toBeChecked();
});

test("shows selected check content as an editable evaluation description", () => {
  render(
    <PhotoGroupEditor
      item={makeChecklistItem()}
      group={makePhotoGroup()}
      photos={[makePhoto()]}
      descriptionOverride="卷扬机间：环境卫生干净整洁，物品定置规范有序。"
      onSave={vi.fn()}
      onSplit={vi.fn()}
    />,
  );

  const description = screen.getByRole("textbox", { name: "评价说明" });
  expect(description).toHaveValue("卷扬机间：环境卫生干净整洁，物品定置规范有序。");
  expect(description).not.toHaveAttribute("readonly");
});

test("switching to reminder replaces untouched good text with reminder text", async () => {
  const user = userEvent.setup();
  const item = makeChecklistItem();
  render(
    <PhotoGroupEditor
      item={item}
      group={makePhotoGroup()}
      photos={[makePhoto()]}
      onSave={vi.fn().mockResolvedValue(undefined)}
      onSplit={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("radio", { name: "提醒问题" }));

  expect(screen.getByRole("textbox", { name: "评价说明" })).toHaveValue(item.reminderText);
});

test("edited text is not overwritten when category changes", async () => {
  const user = userEvent.setup();
  const item = makeChecklistItem();
  render(
    <PhotoGroupEditor
      item={item}
      group={makePhotoGroup()}
      photos={[makePhoto()]}
      onSave={vi.fn().mockResolvedValue(undefined)}
      onSplit={vi.fn()}
    />,
  );

  const description = screen.getByRole("textbox", { name: "评价说明" });
  await user.clear(description);
  await user.type(description, "现场补充说明");
  await user.click(screen.getByRole("radio", { name: "提醒问题" }));

  expect(description).toHaveValue("现场补充说明");
});

test("good groups save an optional complete reward", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <PhotoGroupEditor
      item={makeChecklistItem()}
      group={makePhotoGroup()}
      photos={[makePhoto()]}
      onSave={onSave}
      onSplit={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("checkbox", { name: "设置奖励" }));
  await user.type(screen.getByRole("textbox", { name: "奖励人员" }), "张三");
  await user.click(screen.getByRole("button", { name: "50元" }));
  await user.click(screen.getByRole("button", { name: "保存评价" }));

  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
    awardAssessment: { type: "reward", people: "张三", amount: 50 },
  }));
});

test("assessment groups accept manual people and a custom amount", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <PhotoGroupEditor
      item={makeChecklistItem()}
      group={makePhotoGroup()}
      photos={[makePhoto()]}
      onSave={onSave}
      onSplit={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("radio", { name: "考核问题" }));
  await user.type(screen.getByRole("textbox", { name: "考核人员" }), "李四");
  await user.type(screen.getByRole("spinbutton", { name: "其他金额" }), "120");
  await user.click(screen.getByRole("button", { name: "保存评价" }));

  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
    category: "assessment",
    awardAssessment: { type: "assessment", people: "李四", amount: 120 },
  }));
});

test.each(["0", "-1", "1.5", "9007199254740992"])(
  "rejects invalid custom amount %s",
  async (amount) => {
    const user = userEvent.setup();
    render(
      <PhotoGroupEditor
        item={makeChecklistItem()}
        group={makePhotoGroup({ category: "assessment" })}
        photos={[makePhoto()]}
        onSave={vi.fn().mockResolvedValue(undefined)}
        onSplit={vi.fn()}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: "考核人员" }), "李四");
    fireEvent.change(screen.getByRole("spinbutton", { name: "其他金额" }), {
      target: { value: amount },
    });
    await user.click(screen.getByRole("button", { name: "保存评价" }));

    expect(screen.getByRole("alert")).toHaveTextContent("请输入大于0的整数金额");
  },
);

test("changing category clears incompatible reward fields", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <PhotoGroupEditor
      item={makeChecklistItem()}
      group={makePhotoGroup({
        awardAssessment: { type: "reward", people: "张三", amount: 50 },
      })}
      photos={[makePhoto()]}
      onSave={onSave}
      onSplit={vi.fn()}
    />,
  );

  await user.click(screen.getByRole("radio", { name: "提醒问题" }));

  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
    category: "reminder",
    awardAssessment: null,
  }));
  expect(screen.queryByRole("textbox", { name: "奖励人员" })).not.toBeInTheDocument();
});

test("debounces description persistence by 300ms", () => {
  vi.useFakeTimers();
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <PhotoGroupEditor
      item={makeChecklistItem()}
      group={makePhotoGroup()}
      photos={[makePhoto()]}
      onSave={onSave}
      onSplit={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByRole("textbox", { name: "评价说明" }), {
    target: { value: "新的现场说明" },
  });
  expect(onSave).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(299));
  expect(onSave).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ description: "新的现场说明" }));
});

test("flushes pending text when the editor unmounts", () => {
  vi.useFakeTimers();
  const onSave = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <PhotoGroupEditor
      item={makeChecklistItem()}
      group={makePhotoGroup()}
      photos={[makePhoto()]}
      onSave={onSave}
      onSplit={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "评价说明" }), {
    target: { value: "离开前保存" },
  });

  view.unmount();

  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ description: "离开前保存" }));
});

test("keeps a failed autosave dirty and retries it on unmount", async () => {
  vi.useFakeTimers();
  const onSave = vi.fn()
    .mockRejectedValueOnce(new Error("瞬时保存失败"))
    .mockResolvedValue(undefined);
  const view = render(
    <PhotoGroupEditor
      item={makeChecklistItem()}
      group={makePhotoGroup()}
      photos={[makePhoto()]}
      onSave={onSave}
      onSplit={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "评价说明" }), {
    target: { value: "需要重试的说明" },
  });
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(screen.getByRole("alert")).toHaveTextContent("瞬时保存失败");

  view.unmount();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(onSave).toHaveBeenCalledTimes(2);
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
    description: "需要重试的说明",
  }));
});

test("saves the latest edit after an instant failure without an unhandled rejection", async () => {
  vi.useFakeTimers();
  const onSave = vi.fn()
    .mockRejectedValueOnce(new Error("第一次失败"))
    .mockResolvedValue(undefined);
  const view = render(
    <PhotoGroupEditor
      item={makeChecklistItem()}
      group={makePhotoGroup()}
      photos={[makePhoto()]}
      onSave={onSave}
      onSplit={vi.fn()}
    />,
  );
  const description = screen.getByRole("textbox", { name: "评价说明" });
  fireEvent.change(description, { target: { value: "第一次内容" } });
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    await Promise.resolve();
  });
  fireEvent.change(description, { target: { value: "失败后的最新内容" } });

  view.unmount();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
    description: "失败后的最新内容",
  }));
});

test("serializes autosaves and preserves the newest dirty version", async () => {
  vi.useFakeTimers();
  const firstSave = deferred<void>();
  const onSave = vi.fn()
    .mockImplementationOnce(() => firstSave.promise)
    .mockResolvedValue(undefined);
  render(
    <PhotoGroupEditor
      item={makeChecklistItem()}
      group={makePhotoGroup()}
      photos={[makePhoto()]}
      onSave={onSave}
      onSplit={vi.fn()}
    />,
  );
  const description = screen.getByRole("textbox", { name: "评价说明" });
  fireEvent.change(description, { target: { value: "排队内容一" } });
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
  });
  fireEvent.change(description, { target: { value: "排队内容二" } });
  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
  });
  expect(onSave).toHaveBeenCalledTimes(1);

  await act(async () => {
    firstSave.resolve();
    await firstSave.promise;
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(onSave).toHaveBeenCalledTimes(2);
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({
    description: "排队内容二",
  }));
});

test("changing one selected photo requests a new group", async () => {
  const user = userEvent.setup();
  const onSplit = vi.fn().mockResolvedValue(undefined);
  const first = makePhoto();
  const second = makePhoto(undefined, { id: "photo-2", order: 1 });
  const group = makePhotoGroup({ photoIds: [first.id, second.id] });
  render(
    <PhotoGroupEditor
      item={makeChecklistItem()}
      group={group}
      photos={[first, second]}
      onSave={vi.fn()}
      onSplit={onSplit}
    />,
  );

  await user.click(screen.getByRole("button", { name: "调整照片 photo-1" }));
  await user.click(screen.getByRole("menuitem", { name: "提醒问题" }));

  expect(onSplit).toHaveBeenCalledWith("photo-1", "reminder");
});

test("changing a one-photo group updates it without splitting", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onSplit = vi.fn();
  render(
    <PhotoGroupEditor
      item={makeChecklistItem()}
      group={makePhotoGroup()}
      photos={[makePhoto()]}
      onSave={onSave}
      onSplit={onSplit}
    />,
  );

  await user.click(screen.getByRole("button", { name: "调整照片 photo-1" }));
  await user.click(screen.getByRole("menuitem", { name: "考核问题" }));

  expect(onSplit).not.toHaveBeenCalled();
  expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ category: "assessment" }));
});

test("opens annotation only from the photo edit icon", async () => {
  const user = userEvent.setup();
  render(
    <PhotoGroupEditor
      item={makeChecklistItem()}
      group={makePhotoGroup()}
      photos={[makePhoto()]}
      onSave={vi.fn()}
      onSplit={vi.fn()}
      onPhotoSave={vi.fn()}
    />,
  );

  expect(screen.queryByRole("dialog", { name: "照片标注" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "标注照片 photo-1" }));
  expect(screen.getByRole("dialog", { name: "照片标注" })).toBeVisible();
});

test("uses a viewport-contained photo category menu on narrow screens", () => {
  expect(globalCss).toMatch(
    /@media\s*\(max-width:\s*420px\)[\s\S]*?\.photo-category-menu\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?left:\s*12px;[\s\S]*?right:\s*12px;/,
  );
});
