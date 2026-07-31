import { render, screen } from "@testing-library/react";
import { HashRouter } from "react-router-dom";
import { AppShell } from "./AppShell";

test("keeps each parent navigation item active on its Task 10 subroute", () => {
  window.location.hash = "#/history/trash";
  const historyView = render(<HashRouter><AppShell><p>回收站</p></AppShell></HashRouter>);
  expect(screen.getByRole("link", { name: "历史" })).toHaveAttribute("aria-current", "page");
  historyView.unmount();

  window.location.hash = "#/settings/templates";
  render(<HashRouter><AppShell><p>模板</p></AppShell></HashRouter>);
  expect(screen.getByRole("link", { name: "设置" })).toHaveAttribute("aria-current", "page");
});
