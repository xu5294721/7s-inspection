import { render, screen } from "@testing-library/react";
import { App } from "./App";

test("renders the 7S inspection title", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "7S巡检" })).toBeVisible();
});
