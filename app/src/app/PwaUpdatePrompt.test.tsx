import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { PwaUpdatePrompt } from "./PwaUpdatePrompt";
import { beginPhotoProcessing } from "./photoProcessingSignal";

test("defers the requested service-worker update until photo processing finishes", async () => {
  const updateServiceWorker = vi.fn().mockResolvedValue(undefined);
  const activity = beginPhotoProcessing();
  try {
    render(
      <PwaUpdatePrompt
        needRefresh
        updateServiceWorker={updateServiceWorker}
      />,
    );

    expect(screen.getByText("发现新版本")).toBeVisible();
    await userEvent.setup().click(screen.getByRole("button", { name: "立即更新" }));
    expect(updateServiceWorker).not.toHaveBeenCalled();

    act(() => activity.release());
    await waitFor(() => expect(updateServiceWorker).toHaveBeenCalledOnce());
    expect(updateServiceWorker).toHaveBeenCalledWith(true);
  } finally {
    act(() => activity.release());
  }
});

test("keeps the update deferred until every photo-processing owner releases", async () => {
  const updateServiceWorker = vi.fn().mockResolvedValue(undefined);
  const first = beginPhotoProcessing();
  const second = beginPhotoProcessing();
  try {
    render(<PwaUpdatePrompt needRefresh updateServiceWorker={updateServiceWorker} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "立即更新" }));

    act(() => first.release());
    expect(updateServiceWorker).not.toHaveBeenCalled();

    act(() => second.release());
    await waitFor(() => expect(updateServiceWorker).toHaveBeenCalledOnce());
  } finally {
    act(() => {
      first.release();
      second.release();
    });
  }
});
