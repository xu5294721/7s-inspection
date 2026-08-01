# Inspection Item List Interaction Design

## Goal

Make the inspection draft list easier to scan and let users choose the next item themselves.

## Design

- Keep the route name as the only visible group heading.
- Remove the area heading layer from the inspection page.
- Render each item as one full-width, accessible button showing the item name and either `未完成` or `已完成`.
- Keep detailed area, device, check-content, and photo information inside the item bottom sheet.
- Clicking `完成本项` closes the current bottom sheet by clearing `activeEntryId`; it never selects another entry automatically.
- Existing completion semantics remain unchanged: an item is complete only when it has at least one check selection and at least one photo.

## Verification

- Add a regression test that proves completion closes the sheet and leaves the next item unopened.
- Add a component test that proves the compact row exposes only the item name and completion status while still opening the item sheet callback.
- Run the focused tests, the full Vitest suite, lint, web build, and Android debug build after implementation.
