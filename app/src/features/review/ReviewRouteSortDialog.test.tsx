import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { ReviewRouteSortDialog } from "./ReviewRouteSortDialog";

test("accepts a legacy route order without general routes and saves all categories", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <ReviewRouteSortDialog
      routeNamesByCategory={{ good: ["油缸"], reminder: [], assessment: [] }}
      onSave={onSave}
      onCancel={vi.fn()}
    />,
  );

  expect(screen.getByRole("region", { name: "一般表现" })).toHaveTextContent("暂无已拍照项点");
  await userEvent.setup().click(screen.getByRole("button", { name: "保存排序" }));

  expect(onSave).toHaveBeenCalledWith({
    good: ["油缸"],
    general: [],
    reminder: [],
    assessment: [],
  });
});
