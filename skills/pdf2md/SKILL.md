---
name: pdf2md
description: Build, improve, audit, or deploy privacy-first PDF-to-Markdown converters for academic and technical PDFs. Use when a PDF workflow must reconstruct multi-column reading order, preserve paragraphs and document structure, extract tables/figures/equations/references, remove page chrome or watermarks, use local OCR, run a final fragmented-sentence checkpoint, produce ZIP bundles, or verify browser, desktop, and Cloudflare Workers releases.
---

# PDF2MD

## Objective

Create a general, layout-aware conversion pipeline rather than tailoring output to one sample document. Preserve the author's meaning and reading order while producing clean, editable Markdown and linked media files without uploading the source PDF.

## Non-negotiable outcomes

- Process the PDF locally unless the user explicitly authorizes a server-side design.
- Reconstruct reading order from text-block geometry; never sort all text globally by horizontal line.
- Preserve original paragraph boundaries and join only genuine interrupted continuations.
- Remove recurring headers, footers, page numbers, and rotated watermarks.
- Extract raster and vector figures as linked image files.
- Emit real Markdown tables, LaTeX-compatible equations, and numbered references.
- Format figure and table captions consistently as italic and underlined text.
- Run a whole-document continuity audit before enabling the result or download.
- Always provide one ZIP containing the Markdown file and any extracted assets, even when no assets exist.
- Validate behavior on several structurally different PDFs, not only the user's first example.

## Route the work

Read the references according to the task:

- Read [extraction-rules.md](references/extraction-rules.md) before implementing or debugging text extraction, reading order, paragraph reconstruction, OCR, figures, tables, equations, or references.
- Read [quality-checkpoint.md](references/quality-checkpoint.md) before adding the post-conversion audit, retry logic, candidate selection, or tests for fragmented prose.
- Read [security-testing-deployment.md](references/security-testing-deployment.md) before a security review, release, ZIP/download change, public repository update, browser/desktop build, or Cloudflare Workers deployment.

For a full application build or comprehensive audit, read all three references before making changes.

## Workflow

### 1. Inspect before changing

1. Inspect the repository, current extraction pipeline, tests, build configuration, and deployment configuration.
2. Compare each supplied PDF with its converted Markdown and any screenshots.
3. Record failures by class: reading order, paragraph boundaries, page chrome, heading hierarchy, media, tables, equations, references, packaging, UI, privacy, or browser compatibility.
4. Determine whether the failure is general or document-specific. Fix the general rule and add a regression fixture.
5. Preserve unrelated user changes and established behavior that already works.

### 2. Establish privacy and resource boundaries

1. Keep parsing, OCR, image rendering, Markdown creation, and ZIP generation on the user's device.
2. Validate the PDF signature and enforce explicit limits for file size, page count, canvas dimensions, render memory, and OCR work.
3. Bundle required workers and OCR resources locally. Avoid runtime CDNs and silent network fallbacks.
4. Escape untrusted text and keep extracted links inert unless they use a permitted scheme.
5. Show honest privacy wording that matches the actual data flow.

### 3. Build a geometry-first document model

1. Extract text runs with page, coordinates, dimensions, font, direction, rotation, and end-of-line information.
2. Detect repeated page chrome and rotated watermark-like content before constructing prose.
3. Infer the body-font profile, heading signals, columns, sidebars, media regions, and layout transitions per page region.
4. Form lines and blocks within compatible regions. Split same-baseline runs when a real geometric gap or column boundary exists.
5. Treat superscript citations and PDF end-of-line flags as evidence, not absolute boundaries.
6. Order blocks region by region, then reconstruct paragraphs within the inferred reading flow.

### 4. Recover semantic structure

1. Preserve headings consistently using Markdown heading levels based on document-wide visual evidence.
2. Preserve paragraph separation from indentation, vertical spacing, punctuation, font changes, and region boundaries.
3. Join only high-confidence continuations across columns or pages.
4. Keep figure and table blocks independent when they interrupt prose; reconstruct the prose first, then place the media block at its logical anchor.
5. Convert tables to Markdown rows and columns rather than flattening them into sentences.
6. Convert equations to LaTeX when confidently recognized; preserve an image or clearly marked fallback when confidence is insufficient.
7. Convert the reference section to an ordered list while preserving complete citations and DOI/URL text.
8. Use local OCR only for pages or regions with inadequate selectable text, then pass OCR output through the same layout pipeline.

### 5. Run the final continuity checkpoint

1. Assemble the complete Markdown but do not yet expose the finished result or ZIP.
2. Audit the whole file for high-confidence fragmented or displaced sentence continuations.
3. Exclude intentional boundaries such as headings, lists, captions, equations, references, metadata, and DOI lines.
4. Map suspicious fragments back to their source pages and re-read only those pages with stricter separation and recovery ordering.
5. Build repaired candidates, score them against the original candidate, and accept a replacement only when fragmentation decreases without damaging structure.
6. Complete the checkpoint before enabling Copy, Download ZIP, or the final result view.

Follow the complete scoring and retry procedure in [quality-checkpoint.md](references/quality-checkpoint.md).

### 6. Package and present the result

1. Create a stable, sanitized base name.
2. Put the Markdown at the ZIP root and place extracted assets in a predictable relative folder such as `images/`.
3. Use portable relative Markdown links and deterministic, collision-resistant asset names.
4. Generate a ZIP for every successful conversion, including text-only documents.
5. Keep the interface simple: choose or drop a PDF, show meaningful progress, present editable continuous Markdown, offer Copy and Download ZIP, and provide a visible **Convert another PDF** button.
6. Do not add a manual extracted-block review screen unless the user specifically requests it.

### 7. Verify and release

1. Add deterministic synthetic tests for each layout and content rule.
2. Test representative real PDFs with one-column, two-column, mixed-layout, table, vector-figure, equation, and reference content.
3. Compare PDF and Markdown visually, and inspect the ZIP contents and relative links.
4. Run the full automated test suite, lint, production web build, desktop build when supported, dependency audit, and security checks.
5. For a public project, update clear privacy/security documentation, keep CI and code scanning enabled, and verify the live deployment in a clean browser session.
6. Report exactly what changed, what was tested, remaining limitations, repository URL, and deployment URL.

## Decision rules

- Prefer deterministic geometric evidence over document-title or publisher-specific exceptions.
- Use confidence thresholds and conservative fallbacks when intent is ambiguous.
- Never invent missing text, table values, formulas, citations, or figure content.
- Never claim a conversion is correct solely because the application compiled.
- Preserve a previous candidate when a repair is not measurably safer.
- Convert English academic PDFs reliably first; describe unsupported languages or complex scanned documents honestly.

## Completion criteria

Consider the task complete only when the requested implementation or audit is finished, the final continuity checkpoint is connected to the download path, the ZIP is valid, representative regression tests pass, privacy claims match behavior, and the user can repeat the workflow from the documented repository or live application.
