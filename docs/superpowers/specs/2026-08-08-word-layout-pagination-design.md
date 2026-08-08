# Word Report Layout Pagination Design

## Goal

Improve generated 7S DOCX pagination so photo-backed inspection items remain readable and compact, without changing inspection features, report content, or original photo assets.

## Root Cause

`app/src/features/reports/generateDocx.ts` currently marks every group paragraph with `keepNext: true`. A following photo table also contains rows marked `cantSplit: true`. When the combined paragraph and table do not fit in the remaining page area, Word moves the whole group to the next page and leaves the unused area behind. Text-only groups can also be chained unintentionally because they carry `keepNext` even when no table follows.

The current adaptive mode fills the available image width but still assigns every image a fixed 3:4 height. Landscape images therefore consume more vertical space than their source aspect ratio requires.

## Design

### Group binding and pagination

- A group paragraph uses `keepNext` only when the group has at least one photo.
- A section heading uses `keepNext` when the section has groups, keeping the heading with its first item.
- A lightweight pagination estimator tracks the A4 body area while the DOCX children are assembled. It estimates paragraph height from the configured body font, line spacing, content width, and text length; image-table height comes from the actual row image extents.
- When a complete photo-backed group would exceed the current page remainder, the group paragraph receives `pageBreakBefore`. For the first group in a section, the page break is applied to the section heading so the heading and first item remain together.
- In adaptive mode, when the group text fits but the natural photo table does not, the photo placements are scaled down proportionally to the remaining body height before a page break is considered. The same rule applies to a section heading and its first photo-backed group.
- A group larger than one full page is allowed to flow naturally; the estimator does not add an ineffective forced break.
- Image-table rows remain `cantSplit: true`, while the table can continue between rows.

The estimator is intentionally conservative and only controls obvious page-boundary decisions. Word remains responsible for final line wrapping and table pagination. A completely blank-free result is not promised when a complete item block cannot fit in the remaining page area; the important invariant is that the item is moved as a deliberate block rather than by an accidental keep chain.

### Image sizing

- Fixed mode keeps the existing equal-size frame behavior and nonuniform stretch. Images are not cropped and source photos are not modified.
- Adaptive mode uses each photo's source aspect ratio. Landscape images become shorter when they fill a row; extremely tall images are capped at a page-safe height while preserving their aspect ratio and centered placement.
- The existing photo column count and layout mode settings remain unchanged.

## Data Flow

1. `generateDocx` converts each report photo into a prepared DOCX media placeholder.
2. The image-layout helper computes column widths, per-photo transformations, row heights, and total table height.
3. The pagination estimator consumes the same paragraph/table measurements used to assemble children.
4. `docx` serializes paragraphs and tables with only the necessary `keepNext`, `pageBreakBefore`, and `cantSplit` properties.
5. Existing annotation rendering, Word-only JPEG compression, and media replacement run unchanged after skeleton generation.

## Error Handling

- Invalid or missing photo references continue to throw the existing report-generation errors.
- Non-finite or negative font/indentation values continue to use the existing validation paths.
- Layout calculations clamp pixel dimensions to positive integers and do not alter photo media data.

## Verification

- Add XML regressions for photo-group binding, text-only groups, section/item page breaks, adaptive aspect ratios, and adaptive height caps.
- Keep existing fixed-frame and media relationship tests green.
- Run the focused report suite, the full Vitest suite, lint, and the web build.
- Generate a representative DOCX containing long introductory text, multiple photo groups, and mixed portrait/landscape photos. Render it with the available DOCX renderer or LibreOffice/Word if installed and inspect every page.

## Non-Goals

- No new user-facing layout options.
- No changes to inspection sorting, evaluation categories, report wording, original photos, IndexedDB data, or gallery backups.
