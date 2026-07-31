import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { PhotoCaptureButtons } from "./PhotoCaptureButtons";

test("opens the rear camera with an image-only input", async () => {
  const user = userEvent.setup();
  const onFilesSelected = vi.fn();
  render(<PhotoCaptureButtons onFilesSelected={onFilesSelected} />);

  const button = screen.getByRole("button", { name: "拍照" });
  const input = screen.getByLabelText("拍照文件");

  expect(input).toHaveAttribute("accept", "image/*");
  expect(input).toHaveAttribute("capture", "environment");
  expect(input).not.toHaveAttribute("multiple");
  await user.upload(input, new File(["photo"], "camera.jpg", { type: "image/jpeg" }));
  expect(onFilesSelected).toHaveBeenCalledWith([expect.any(File)], "camera");
  expect(button).toBeVisible();
});

test("selects multiple gallery images without a capture attribute", async () => {
  const user = userEvent.setup();
  const onFilesSelected = vi.fn();
  render(<PhotoCaptureButtons onFilesSelected={onFilesSelected} />);

  const button = screen.getByRole("button", { name: "从相册选择" });
  const input = screen.getByLabelText("相册文件");
  const files = [
    new File(["first"], "first.jpg", { type: "image/jpeg" }),
    new File(["second"], "second.png", { type: "image/png" }),
  ];

  expect(input).toHaveAttribute("accept", "image/*");
  expect(input).toHaveAttribute("multiple");
  expect(input).not.toHaveAttribute("capture");
  await user.upload(input, files);
  expect(onFilesSelected).toHaveBeenCalledWith(files, "gallery");
  expect(button).toBeVisible();
});
