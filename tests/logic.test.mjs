import assert from "node:assert/strict";
import test from "node:test";
import {
  blocksToMarkdown,
  mergeFlowingParagraphs,
  safeBaseName,
} from "../src/lib/markdown.ts";
import {
  linesToBlocks,
  orderLines,
  textItemsToLines,
} from "../src/lib/pdf-converter.ts";

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

test("separates text runs that share a baseline but belong to different columns", () => {
  const lines = textItemsToLines(
    [
      {
        str: "Objectives: Value-based healthcare aims to improve outcomes",
        transform: [12, 0, 0, 12, 53, 250],
        width: 200,
        fontName: "Body",
      },
      {
        str: "Highlights",
        transform: [12, 0, 0, 12, 407, 250],
        width: 45,
        fontName: "Bold",
      },
    ],
    { transform: [1, 0, 0, 1, 0, 0], width: 612, height: 792 },
    { Util: { transform: (_viewport, item) => item } },
    1,
  );

  assert.equal(lines.length, 2);
  assert.equal(lines[0].text, "Objectives: Value-based healthcare aims to improve outcomes");
  assert.equal(lines[1].text, "Highlights");
});

function textLine(text, x, y, width, fontSize = 10) {
  return {
    text,
    x,
    y,
    width,
    height: fontSize,
    fontSize,
    fontName: "Body",
    page: 1,
  };
}

function mixedLayoutLines() {
  return [
    textLine("A B S T R A C T", 53, 220, 70, 13),
    textLine("Objectives: Value-based healthcare aims to improve patient outcomes", 53, 240, 335),
    textLine("relative to the costs of delivering care; yet, its implementation", 53, 250, 335),
    textLine("has evolved separately from the methodological rigor of health economics", 53, 260, 335),
    textLine("and outcomes research (HEOR). This ISPOR Special Task Force report", 53, 270, 335),
    textLine("Methods: A mixed-methods approach combined a targeted review.", 53, 292, 335),
    textLine("Highlights", 407, 240, 60, 12),
    textLine("• Value-based healthcare (VBHC) and health economics", 407, 260, 132),
    textLine("and outcomes research (HEOR) have evolved largely", 416, 270, 123),
    textLine("independently. Despite advances in both fields.", 416, 280, 123),
    textLine("Introduction", 53, 500, 70, 13),
    textLine("Around the world, healthcare systems are facing challenges", 53, 520, 245),
    textLine("in addressing ever-increasing spending and is characterized by", 53, 530, 245),
    textLine("healthcare delivery should center patient outcomes", 312, 520, 245),
    textLine("over the costs needed to deliver care.", 312, 530, 245),
  ];
}

test("orders an abstract with a sidebar before the two-column article body", () => {
  const ordered = orderLines(mixedLayoutLines(), 612, 792).map((line) => line.text);

  assert.ok(ordered.indexOf("Methods: A mixed-methods approach combined a targeted review.") < ordered.indexOf("Highlights"));
  assert.ok(ordered.indexOf("independently. Despite advances in both fields.") < ordered.indexOf("Introduction"));
  assert.ok(ordered.indexOf("in addressing ever-increasing spending and is characterized by") < ordered.indexOf("healthcare delivery should center patient outcomes"));
});

test("reconstructs continuous paragraphs and sidebar bullets without horizontal mixing", () => {
  const blocks = linesToBlocks([
    {
      page: 1,
      width: 612,
      height: 792,
      lines: mixedLayoutLines(),
      canvas: {},
      annotations: [],
      usedOcr: false,
    },
  ]);
  const markdown = blocksToMarkdown(blocks);

  assert.match(
    markdown,
    /Objectives: Value-based healthcare aims to improve patient outcomes relative to the costs of delivering care; yet, its implementation has evolved separately from the methodological rigor of health economics and outcomes research \(HEOR\)\. This ISPOR Special Task Force report/,
  );
  assert.match(
    markdown,
    /- Value-based healthcare \(VBHC\) and health economics and outcomes research \(HEOR\) have evolved largely independently\. Despite advances in both fields\./,
  );
  assert.match(
    markdown,
    /is characterized by healthcare delivery should center patient outcomes/,
  );
  assert.doesNotMatch(markdown, /patient outcomes Highlights/);
});

test("keeps annotations from interrupting a paragraph that continues on the next page", () => {
  const blocks = linesToBlocks([
    {
      page: 1,
      width: 612,
      height: 792,
      lines: [textLine("HEOR considers effectiveness, cost, and health-related", 312, 700, 245)],
      canvas: {},
      annotations: [{ text: "Journal", url: "https://example.com/article" }],
      usedOcr: false,
    },
    {
      page: 2,
      width: 612,
      height: 792,
      lines: [{ ...textLine("quality of life to equip decision makers.", 53, 80, 245), page: 2 }],
      canvas: {},
      annotations: [],
      usedOcr: false,
    },
  ]);
  const markdown = blocksToMarkdown(blocks);

  assert.match(
    markdown,
    /health-related quality of life to equip decision makers\./,
  );
  assert.ok(markdown.indexOf("quality of life") < markdown.indexOf("https://example.com/article"));
});
