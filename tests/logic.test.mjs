import assert from "node:assert/strict";
import test from "node:test";
import {
  blocksToMarkdown,
  mergeFlowingParagraphs,
  safeBaseName,
} from "../src/lib/markdown.ts";

function paragraph(markdown, page) {
  return {
    id: `${page}-${markdown}`,
    kind: "paragraph",
    markdown,
    page,
    confidence: 0.9,
  };
}

test("assembles clean Markdown and safe export names", () => {
  assert.equal(
    blocksToMarkdown([
      paragraph(" First paragraph ", 1),
      paragraph("", 1),
      paragraph("Second paragraph", 1),
    ]),
    "First paragraph\n\nSecond paragraph\n",
  );
  assert.equal(safeBaseName("A Résumé / Trial?.PDF"), "A-Resume-Trial");
  assert.equal(safeBaseName("💾.pdf"), "converted-document");
});

test("joins flowing paragraphs across pages without losing confidence", () => {
  const blocks = mergeFlowingParagraphs([
    paragraph("The finding contin-", 1),
    { ...paragraph("ues on the next page.", 2), confidence: 0.62 },
  ]);

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].markdown, "The finding continues on the next page.");
  assert.equal(blocks[0].confidence, 0.62);
});
