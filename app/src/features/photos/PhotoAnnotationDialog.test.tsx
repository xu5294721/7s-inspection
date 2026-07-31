import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, vi } from "vitest";
import { useState } from "react";
import { makePhoto } from "../../test/fixtures";
import { PhotoAnnotationDialog } from "./PhotoAnnotationDialog";

beforeEach(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:annotation-photo"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

function drawEllipse() {
  const canvas = screen.getByLabelText("照片标注画布");
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 200,
    bottom: 100,
    width: 200,
    height: 100,
    toJSON: () => ({}),
  });
  fireEvent.pointerDown(canvas, { clientX: 20, clientY: 10, pointerId: 1 });
  fireEvent.pointerMove(canvas, { clientX: 120, clientY: 60, pointerId: 1 });
  fireEvent.pointerUp(canvas, { clientX: 120, clientY: 60, pointerId: 1 });
}

test("saves normalized annotation coordinates", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<PhotoAnnotationDialog photo={makePhoto()} onCancel={vi.fn()} onSave={onSave} />);

  await user.click(screen.getByRole("button", { name: "椭圆工具" }));
  drawEllipse();
  await user.click(screen.getByRole("button", { name: "保存标注" }));

  const shapes = JSON.parse(onSave.mock.calls[0][0]);
  expect(shapes).toEqual([{
    type: "ellipse",
    x: 0.1,
    y: 0.1,
    width: 0.5,
    height: 0.5,
    color: "#d12f2f",
  }]);
});

test("supports arrow, text, undo, and clear", async () => {
  const user = userEvent.setup();
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(<PhotoAnnotationDialog photo={makePhoto()} onCancel={vi.fn()} onSave={onSave} />);

  await user.click(screen.getByRole("button", { name: "箭头工具" }));
  drawEllipse();
  await user.click(screen.getByRole("button", { name: "文字工具" }));
  await user.type(screen.getByRole("textbox", { name: "标注文字" }), "此处清理");
  fireEvent.pointerDown(screen.getByLabelText("照片标注画布"), {
    clientX: 100,
    clientY: 50,
    pointerId: 2,
  });
  expect(screen.getByText("2个标注")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "撤销标注" }));
  expect(screen.getByText("1个标注")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "清空标注" }));
  expect(screen.getByText("0个标注")).toBeVisible();
});

test("cancel leaves the photo unchanged", async () => {
  const user = userEvent.setup();
  const onCancel = vi.fn();
  const onSave = vi.fn();
  render(<PhotoAnnotationDialog photo={makePhoto()} onCancel={onCancel} onSave={onSave} />);

  await user.click(screen.getByRole("button", { name: "椭圆工具" }));
  drawEllipse();
  await user.click(screen.getByRole("button", { name: "取消标注" }));

  expect(onCancel).toHaveBeenCalledOnce();
  expect(onSave).not.toHaveBeenCalled();
});

test("traps focus, closes on Escape, and restores focus to the opener", async () => {
  const user = userEvent.setup();

  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button type="button" onClick={() => setOpen(true)}>打开照片标注</button>
        {open ? (
          <PhotoAnnotationDialog
            photo={makePhoto()}
            onCancel={() => setOpen(false)}
            onSave={vi.fn().mockResolvedValue(undefined)}
          />
        ) : null}
      </>
    );
  }

  render(<Harness />);
  const opener = screen.getByRole("button", { name: "打开照片标注" });
  await user.click(opener);
  const cancel = screen.getByRole("button", { name: "取消标注" });
  const save = screen.getByRole("button", { name: "保存标注" });
  expect(cancel).toHaveFocus();

  await user.tab({ shift: true });
  expect(save).toHaveFocus();
  await user.tab();
  expect(cancel).toHaveFocus();

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog", { name: "照片标注" })).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});
