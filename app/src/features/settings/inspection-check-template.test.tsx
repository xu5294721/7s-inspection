import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createAppDependencies } from "../../app/dependencies";
import { createTestDb } from "../../db/database";
import { InspectionCheckTemplateRepository } from "../../db/inspectionCheckTemplateRepository";
import { renderWithRouter } from "../../test/renderWithRouter";

test("adds and saves a custom top-level check category", async () => {
  const user = userEvent.setup();
  const database = createTestDb(`check-template-custom-category-${Date.now()}`);
  const dependencies = createAppDependencies(database);
  renderWithRouter({ database, initialPath: "/settings/check-templates", appProps: { dependencies } });

  await screen.findByRole("heading", { name: "\u68c0\u67e5\u5185\u5bb9\u6a21\u677f" });
  await user.click(screen.getByRole("button", { name: /\u65b0\u589e\u5927\u9879/ }));
  const categoryInputs = screen.getAllByRole("textbox", { name: /\u5927\u9879\u540d\u79f0/ });
  await user.clear(categoryInputs.at(-1)!);
  await user.type(categoryInputs.at(-1)!, "????");
  await user.click(screen.getByRole("button", { name: "\u4fdd\u5b58\u6a21\u677f" }));

  await waitFor(async () => {
    const saved = await new InspectionCheckTemplateRepository(database).get();
    expect(saved.definitions.some((definition) => definition.label === "????")).toBe(true);
  });
});

test("renders template editors as full-width stacked cards on mobile", async () => {
  const database = createTestDb(`check-template-layout-${Date.now()}`);
  const dependencies = createAppDependencies(database);
  renderWithRouter({ database, initialPath: "/settings/check-templates", appProps: { dependencies } });
  const list = await screen.findByTestId("check-template-list");
  expect(list).toHaveClass("check-template-list");
  expect(screen.getByRole("button", { name: /\u65b0\u589e\u5927\u9879/ })).toBeVisible();
});
