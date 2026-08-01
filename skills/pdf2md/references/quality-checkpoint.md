# Final Markdown continuity checkpoint

Run this checkpoint after initial conversion and before the result screen, Copy action, or ZIP download becomes available. Its purpose is to catch high-confidence reading-order and paragraph-reconstruction failures that remain visible only after the whole document has been assembled.

## 1. Required inputs

Keep the following alive until the checkpoint finishes:

- the initial Markdown candidate;
- paragraph/block provenance mapped to PDF pages and regions;
- the source PDF or a safe page-reload mechanism;
- the initial document style and layout profile;
- structural block types such as heading, paragraph, list, caption, table, equation, metadata, and reference.

Do not close or discard the PDF immediately after the first Markdown string is produced if targeted recovery may need to re-read pages.

## 2. Audit the entire candidate

Parse Markdown into block-aware units. Inspect adjacent prose blocks and suspicious jumps inside prose without treating every newline as a paragraph boundary.

High-confidence warning signals include combinations of:

- a paragraph ending without terminal punctuation followed later by a plausible continuation;
- a conjunction, lowercase token, punctuation fragment, or citation-led clause beginning an unrelated-looking paragraph;
- a sentence whose continuation appears after a figure, table, sidebar, or another column's prose;
- a dangling hyphenated word across blocks;
- a very short orphan fragment that joins grammatically to a nearby open sentence;
- column/page provenance showing that two pieces are sequential in the source flow;
- a sudden topic or capitalization discontinuity consistent with interleaving.

Require multiple supporting signals for automatic repair. A language heuristic alone is not enough.

## 3. Guard against false positives

Exclude or heavily down-weight:

- Markdown headings;
- ordered and unordered list items;
- figure and table captions;
- table rows;
- fenced code and display equations;
- numbered references and bibliography continuations;
- author/affiliation/publication metadata;
- DOI and URL-only lines;
- abbreviations, initials, and intentionally incomplete labels;
- block quotes and callouts;
- paragraphs that end with a valid citation or closing quotation and are otherwise complete.

Do not merge distinct source paragraphs simply because the first lacks a period. Preserve source indentation and spacing evidence.

## 4. Score fragmentation

Use a deterministic weighted score rather than a Boolean pass/fail. For example:

```text
score =
  5 * displaced_continuations +
  4 * cross_column_interleavings +
  3 * open_sentence_orphans +
  2 * dangling_hyphen_fragments +
  1 * weak_suspicious_boundaries
```

Track both the total score and the specific findings. Weight structure damage separately so an apparent prose improvement cannot justify losing a heading, table, figure, equation, or reference entry.

## 5. Targeted recovery procedure

When the initial score exceeds the accepted threshold:

1. Map findings to source pages and include one adjacent page when the fragment may cross a page boundary.
2. Re-extract only those pages with stricter same-baseline run separation.
3. Recompute layout regions and column ordering for those pages without hard-coding the document title or publisher.
4. Preserve superscript citations as inline evidence and reconsider explicit PDF EOL flags against geometry.
5. Reconstruct affected cross-column/cross-page paragraphs.
6. Reinsert recovered blocks into the untouched document model.
7. Produce at least one targeted-recovery candidate.
8. Optionally produce a second conservative candidate that repairs only high-confidence paragraph boundaries in the current Markdown.

Limit retry count and page scope to prevent loops and resource exhaustion.

## 6. Select the safest candidate

Audit all candidates with the same scoring function. Accept a replacement only when:

- its fragmentation score is lower;
- it does not lose non-whitespace source content beyond an explained normalization;
- heading, list, table, figure, equation, and reference counts remain plausible;
- asset links still resolve;
- paragraph count does not collapse abnormally;
- the change does not introduce new high-severity findings.

When scores tie or evidence is ambiguous, keep the more conservative candidate—usually the original.

Record internal diagnostics such as pages retried, findings fixed, score before/after, and reason for candidate selection. Avoid exposing a complex manual-review interface unless requested.

## 7. Gate the user workflow

Use progress stages that reflect real work, for example:

1. Reading PDF
2. Understanding layout
3. Building Markdown and assets
4. Checking paragraph continuity
5. Creating ZIP
6. Complete

Disable Copy, Download ZIP, and the completed result state until stage 4 succeeds or safely retains the best candidate. If conversion fails, provide a clear recoverable error rather than an empty or corrupt ZIP.

## 8. Deterministic test matrix

Create synthetic fixtures for:

- two columns with matched baselines but independent sentences;
- explicit EOL between same-line runs;
- superscript citation followed by a same-line continuation;
- a sentence continuing from the left-column bottom to the right-column top;
- a full-width heading between layout regions;
- a figure/table interrupting one paragraph;
- a sentence continuing to the next page;
- intentional paragraph breaks that must remain separate;
- reference entries and DOI lines that must not trigger prose repair;
- headings, lists, tables, equations, and captions excluded from repair;
- a degraded initial candidate that a targeted page retry improves;
- a repair candidate that looks smoother but loses structure and must be rejected.

Assertions should verify exact ordering and boundaries, not merely the presence of words.

## 9. Real-document validation

Use at least two representative real academic PDFs with different layouts. Keep short known-continuation assertions derived from documents the user is authorized to test.

For each document:

- compare key sections visually with the source PDF;
- search for known cross-column and cross-page continuations;
- confirm captions are not embedded mid-sentence;
- inspect paragraph spacing, table shape, equations, figures, and ordered references;
- record fragmentation score before and after recovery;
- open the ZIP and verify all linked files exist.

Do not bake complete copyrighted documents or large extracted passages into public tests. Use minimal assertions or synthetic equivalents.

## 10. Pseudocode

```text
initial = convert(pdf, normalProfile)
audit0 = auditMarkdown(initial.markdown, initial.provenance)
best = initial

if audit0.requiresRecovery:
    pages = expandToAdjacentPages(audit0.suspiciousPages)
    reread = extractPages(pdf, pages, strictRecoveryProfile)
    targeted = rebuildAffectedRegions(initial, reread)
    conservative = repairHighConfidenceBoundaries(initial)

    for candidate in [targeted, conservative]:
        audit = auditMarkdown(candidate.markdown, candidate.provenance)
        if saferThan(candidate, audit, best):
            best = candidate

zip = package(best.markdown, best.assets)
publishResult(best, zip)
```

Implement `saferThan` with explicit content-preservation and structure-preservation checks, not fragmentation score alone.
