import userEvent from "@testing-library/user-event";
import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { makeInspection, makePhotoGroup } from "../../test/fixtures";
import { InspectionEntrySummary } from "./InspectionEntrySummary";

test("renders a compact item summary and opens the item editor", async () => {
  const user = userEvent.setup();
  const entry = makeInspection().entries[0];
  const onOpen = vi.fn();

  render(<InspectionEntrySummary entry={entry} groups={[]} onOpen={onOpen} />);

  const opener = screen.getByRole("button", { name: /焊机间/ });
  expect(opener).toHaveAttribute("data-photo-count", "0");
  expect(opener).toHaveAttribute("data-complete", "false");
  expect(opener).toHaveTextContent(entry.itemSnapshot.routeName);
  expect(opener).toHaveTextContent("未完成");
  expect(opener).not.toHaveTextContent(entry.itemSnapshot.part);
  expect(opener).not.toHaveTextContent(entry.itemSnapshot.area);

  await user.click(opener);

  expect(onOpen).toHaveBeenCalledWith(entry.id);
});

test("shows compact context when duplicate route names need disambiguation", () => {
  const entry = makeInspection().entries[0];

  render(<InspectionEntrySummary entry={entry} groups={[]} onOpen={vi.fn()} showContext />);

  const opener = screen.getByRole("button", { name: /焊机间/ });
  expect(opener).toHaveTextContent(`${entry.itemSnapshot.area} · ${entry.itemSnapshot.device}`);
});

test("marks an empty evaluation group as complete without a photo", () => {
  const entry = makeInspection().entries[0]!;
  const group = makePhotoGroup({ photoIds: [] });
  render(<InspectionEntrySummary entry={entry} groups={[group]} onOpen={vi.fn()} />);

  const opener = screen.getByRole("button", { name: /焊机间/ });
  expect(opener).toHaveAttribute("data-photo-count", "0");
  expect(opener).toHaveAttribute("data-complete", "true");
  expect(opener).toHaveTextContent("已完成");
});
