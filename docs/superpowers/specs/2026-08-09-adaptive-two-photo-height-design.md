# Adaptive two-photo height design

## Goal

Make a completed inspection item with exactly two photos look fuller in a generated Word report, while opening the review page with the adaptive photo layout selected by default.

## Options considered

1. Raise every row that contains two photos. This would also enlarge the first row of three- and four-photo items, increasing pagination pressure and making multi-photo sections less predictable.
2. Raise only items with exactly two photos. This targets the sparse two-photo pages shown in the review screenshots and preserves the established three- and four-photo layouts. This is the selected option.
3. Keep dimensions but add blank spacing. This does not improve the readability of the photos and merely moves the unused space.

## Design

- In adaptive Word layout, an item with exactly two photos remains a two-column layout with the existing 78 mm frame width.
- Its fixed DOCX frame height increases from 58 mm to 70 mm. The exported copy may be vertically stretched; the original stored image is never modified and images are not cropped.
- One-photo, three-photo, four-photo, and larger adaptive layouts retain their current dimensions and pagination behavior.
- The report review screen resolves a missing inspection-level choice to `adaptive`, irrespective of the template snapshot. A user-selected inspection-level `fixed` or `adaptive` choice remains authoritative and is persisted.
- Immutable historical template versions remain unchanged so that older local backups can still merge without a version conflict.

## Testing and verification

- Add a Word-generation regression that proves two-photo adaptive frames are 78 x 70 mm and three-/four-photo frames remain 78 x 58 mm.
- Add report-model and review-page regressions for the default adaptive mode while retaining an explicit inspection-level override.
- Render representative two-photo, three-photo, and four-photo reports with LibreOffice and inspect the resulting pages.
- Run focused and full tests, lint, web build, Android lint, and Android debug assembly before releasing the next APK.
