import { isPrefixedBrowserUuid } from "./ids";

test("recognizes only the requested prefix followed by a UUID v4", () => {
  expect(isPrefixedBrowserUuid(
    "temporary-entry-00000000-0000-4000-8000-000000000001",
    "temporary-entry",
  )).toBe(true);
  expect(isPrefixedBrowserUuid("temporary-entry-", "temporary-entry")).toBe(false);
  expect(isPrefixedBrowserUuid("temporary-entry-not-a-uuid", "temporary-entry")).toBe(false);
  expect(isPrefixedBrowserUuid(
    "temporary-entry-00000000-0000-1000-8000-000000000001",
    "temporary-entry",
  )).toBe(false);
  expect(isPrefixedBrowserUuid(
    "temporary-entry-00000000-0000-4000-7000-000000000001",
    "temporary-entry",
  )).toBe(false);
  expect(isPrefixedBrowserUuid(
    "temporary-item-00000000-0000-4000-8000-000000000001",
    "temporary-entry",
  )).toBe(false);
});
