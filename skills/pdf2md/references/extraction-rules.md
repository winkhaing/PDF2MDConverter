# Layout-aware extraction rules

Use these rules to implement or debug the conversion engine. Treat thresholds as tunable ratios derived from the current page and body-font profile, not universal pixel constants.

## 1. Build an evidence-rich intermediate model

Represent each text run with at least:

- page index and source item index;
- text and normalized text;
- bounding box, baseline, width, height, and transform;
- font name, size, weight/style hints, and writing direction;
- rotation and explicit PDF end-of-line status;
- links or annotations associated with the region;
- confidence and origin (`pdf-text` or `ocr`).

Keep provenance through lines, blocks, paragraphs, and final Markdown so the quality checkpoint can map a suspicious fragment back to its page.

## 2. Normalize without erasing evidence

- Normalize whitespace and Unicode punctuation conservatively.
- Join discretionary line-end hyphenation only when the next token is a plausible word continuation. Preserve true compound words.
- Preserve superscript/subscript information long enough to identify citations and formulas.
- Detect rotation before any line grouping.
- Never discard coordinates immediately after text extraction.

## 3. Remove page chrome and watermarks

Detect page chrome statistically across pages:

1. Normalize candidate strings while masking changing page numbers, issue numbers, and dates.
2. Find strings or geometric bands repeated at similar top or bottom positions across enough pages.
3. Remove recurring headers and footers only when both repetition and page-edge position support the decision.
4. Detect standalone page numbers by position, small size, and sequence.
5. Detect watermark candidates from large rotation, unusual scale/opacity where available, broad central coverage, and repetition.
6. Preserve a real heading or footnote when repetition evidence is weak.

Examples such as a journal's recurring report label belong to page chrome; a same-looking section title occurring once does not.

## 4. Infer page regions before reading order

Estimate the main body width and common body font from dominant text density. Segment the page vertically where the number or positions of columns change.

Possible region types include:

- full-width title or abstract;
- one-column body;
- two- or three-column body;
- sidebar/highlights panel;
- figure or table area;
- footnote/reference area.

Do not assign one column model to an entire page when the top, middle, and bottom have different layouts. Order regions from top to bottom, then order columns inside each region.

## 5. Form lines correctly

Group runs into a line only when their baselines, writing direction, font scale, and region membership are compatible.

Split same-baseline runs when any strong boundary exists:

- a gap substantially larger than normal word spacing;
- runs fall on opposite sides of a detected column gutter;
- an explicit line-end marker coincides with a genuine geometric gap;
- the page region changes;
- a media boundary separates the runs.

Do not split solely because a superscript citation has an end-of-line flag. A superscript reference can occur within a continuous sentence on the same line.

Do not merge left- and right-column text merely because their baselines match. This is the central defense against horizontally interleaved two-column prose.

## 6. Order columns and continuation blocks

Cluster line starts and extents within each region to infer columns. Use column gutters, overlap, alignment, and density rather than fixed halves of the page.

Default order for a conventional two-column region:

1. read the left column from top to bottom;
2. continue at the top of the right column;
3. move to the next lower or full-width region.

Before accepting a column transition, compare the last left-column block with the first right-column block for sentence continuation. Citations, lowercase starts, conjunctions, and missing terminal punctuation may support continuation. A later block merely sharing a baseline does not.

Handle abstract-plus-highlights pages by isolating the sidebar. Do not splice highlight bullets into the abstract or author metadata.

## 7. Reconstruct paragraphs conservatively

Use several signals together:

- indentation relative to neighboring lines;
- vertical gap normalized to line height;
- terminal punctuation;
- capitalization and syntactic continuation;
- font/style changes;
- list markers;
- region, column, and page transitions;
- captions or media boundaries.

Join wrapped lines inside a paragraph with spaces. Preserve a blank line between distinct source paragraphs.

Allow cross-column and cross-page joining only when the first block is syntactically open and the next block is a plausible continuation. Examples include a lowercase start, a citation followed by a continuing clause, or a word broken at the boundary.

Reject the join when the next block is a heading, new list item, caption, table row, equation, reference entry, metadata line, or an independently complete paragraph.

## 8. Identify headings consistently

Build a document-wide style inventory. Infer heading levels from a combination of font size, weight, color when exposed by the renderer, spacing, alignment, numbering, and recurrence.

- Map visually equivalent headings to the same Markdown level.
- Do not decide heading level from color alone.
- Treat short yellow or highlighted section labels consistently when their typographic and spacing pattern recurs.
- Avoid converting running headers into headings.
- Preserve the document title as the top-level heading when identifiable.

## 9. Separate interrupted prose from media

When a figure or table lies between two pieces of one paragraph:

1. detect the media/caption block independently;
2. test whether the prose before and after it forms a continuous sentence;
3. reconstruct the prose paragraph without inserting the caption mid-sentence;
4. place the figure or table and its caption after the completed paragraph or at the closest logical anchor.

Format captions consistently, for example:

```markdown
<u><em>Figure 1. Components of the intervention.</em></u>
```

Use the same form for table titles unless the project defines an equivalent consistent convention.

## 10. Extract figures and assets

- Extract embedded raster images when usable.
- Render vector drawing regions to PNG at sufficient scale rather than omitting them.
- Exclude page backgrounds, decorative rules, tiny icons, and repeated logos unless meaningful.
- Crop to the detected figure bounds and avoid covering or clipping nearby text.
- Store assets under a relative folder such as `images/` and link them from Markdown.
- Use deterministic names such as `figure-03-page-07.png`; resolve collisions safely.
- Include meaningful alt text when a caption is available. Do not invent a visual interpretation.

## 11. Convert tables structurally

1. Detect table regions from aligned rows/columns, ruling lines, repeated x positions, and caption cues.
2. Assign cells by geometry before linearizing text.
3. Preserve header rows and cell line breaks where practical.
4. Emit a Markdown table when the grid is representable.
5. For merged cells or layouts Markdown cannot express, use safe HTML or a table image plus clearly separated extracted text; never flatten the grid into an ordinary paragraph without warning.
6. Keep footnotes and the table caption outside the cell grid.

## 12. Convert equations without fabricating notation

- Retain superscripts, subscripts, mathematical glyphs, and relative positions while analyzing a formula region.
- Emit inline `$...$` or display `$$...$$` LaTeX only when the notation can be reconstructed confidently.
- Preserve equation numbers separately.
- When confidence is low, link a cropped formula image and optionally include a plainly labeled best-effort transcription.
- Add tests for fractions, Greek letters, summations/integrals, matrices, and numbered display equations when those capabilities are claimed.

## 13. Preserve references as references

Detect the reference section from its heading and repeated numbered-entry pattern. Reconstruct each citation across wrapped lines and columns before emitting it.

```markdown
1. First complete reference.
2. Second complete reference with DOI.
```

- Preserve original numbering when present.
- Do not convert references to unordered bullets.
- Do not split one reference into multiple items because of a page or column break.
- Keep DOI and URL text intact and escaped safely.
- Avoid joining consecutive references when a number marker is missing from one extracted line; use indentation and bibliography syntax as supporting evidence.

## 14. Use OCR as a regional fallback

Trigger OCR when selectable text coverage is too low or visibly corrupt. Prefer page- or region-level fallback rather than OCRing the whole document unconditionally.

- Render at a controlled resolution and memory budget.
- Run OCR locally with bundled language data.
- Convert OCR boxes into the same run model used for PDF text.
- Apply the same column, paragraph, chrome, and continuity rules.
- Mark low-confidence output internally and avoid silently inventing characters.

## 15. Common failure patterns to test

- left and right columns interleaved line by line;
- abstract text followed by sidebar bullets before the abstract is complete;
- continuation after a superscript citation moved to another column;
- an explicit PDF EOL splitting a same-line sentence;
- a figure caption injected into the middle of a sentence;
- paragraphs merged into one wall of text;
- headings emitted as body text or running headers emitted as headings;
- table cells flattened into prose;
- vector figures omitted;
- references emitted as bullets or fragmented entries;
- rotated watermarks retained;
- cross-page sentences left broken or joined to an unrelated heading.
