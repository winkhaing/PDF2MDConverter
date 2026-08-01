import assert from "node:assert/strict";
import test from "node:test";
import {
  blocksToMarkdown,
  mergeFlowingParagraphs,
  safeBaseName,
} from "../src/lib/markdown.ts";
import {
  figureCropBounds,
  linesToBlocks,
  orderLines,
  removeHeadersAndFooters,
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

function rawPage(page, lines, width = 612, height = 792) {
  return {
    page,
    width,
    height,
    lines: lines.map((line) => ({ ...line, page })),
    canvas: { width: width * 2, height: height * 2 },
    annotations: [],
    usedOcr: false,
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

test("removes journal headers, footers, and bare page numbers", () => {
  const pages = removeHeadersAndFooters([
    rawPage(1, [
      textLine("ISPOR REPORT 1143", 50, 20, 130),
      textLine("Useful article text.", 50, 130, 220),
      textLine("1143", 520, 770, 30),
    ]),
    rawPage(2, [
      textLine("1144 VALUE IN HEALTH JULY 2026", 50, 20, 220),
      textLine("More useful article text.", 50, 130, 220),
      textLine("1144", 50, 770, 30),
    ]),
  ]);

  assert.deepEqual(
    pages.flatMap((page) => page.lines.map((line) => line.text)),
    ["Useful article text.", "More useful article text."],
  );
});

test("keeps original first-line indentation as a paragraph break", () => {
  const markdown = blocksToMarkdown(linesToBlocks([
    rawPage(1, [
      textLine("The first paragraph has a complete thought.", 53, 120, 240),
      textLine("A new indented paragraph begins here", 65, 142, 230),
      textLine("and continues from the normal margin.", 53, 154, 240),
    ]),
  ]));

  assert.match(
    markdown,
    /complete thought\.\n\nA new indented paragraph begins here and continues/,
  );
});

test("moves a figure after the paragraph it interrupted", () => {
  const markdown = blocksToMarkdown(linesToBlocks([
    rawPage(1, [
      textLine("Based on the responses we", 53, 120, 220),
      textLine("Figure 1. Components of VBHC interventions.", 53, 180, 330),
      textLine("refined the recommendations for implementation.", 53, 240, 280),
    ]),
  ]));

  assert.ok(
    markdown.indexOf("Based on the responses we refined") <
      markdown.indexOf("Figure 1."),
  );
});

test("converts recommendation rows into a Markdown table", () => {
  const markdown = blocksToMarkdown(linesToBlocks([
    rawPage(1, [
      textLine("Table 1. Recommendations.", 53, 120, 220),
      textLine("(1) Use outcomes that matter to patients.", 53, 145, 300),
      textLine("(2) Measure costs across the care cycle.", 53, 160, 300),
      textLine("Conclusions", 53, 200, 80, 12),
    ]),
  ]));

  assert.match(markdown, /\| No\. \| Recommendation \|/);
  assert.match(markdown, /\| 1 \| Use outcomes that matter to patients\. \|/);
  assert.match(markdown, /\| 2 \| Measure costs across the care cycle\. \|/);
});

test("preserves bibliography numbering and joins wrapped URLs", () => {
  const markdown = blocksToMarkdown(linesToBlocks([
    rawPage(1, [
      textLine("References", 53, 100, 90, 13),
      textLine("1. First article. https://", 53, 125, 230),
      textLine("example.org/article", 53, 138, 180),
      textLine("2. Second article.", 53, 160, 180),
    ]),
  ]));

  assert.match(markdown, /1\. First article\. https:\/\/example\.org\/article/);
  assert.match(markdown, /2\. Second article\./);
  assert.doesNotMatch(markdown, /- First article/);
});

test("crops a figure below its caption and stops before following text", () => {
  const caption = textLine("Figure 1. Components of VBHC.", 53, 100, 260);
  const page = rawPage(1, [
    caption,
    textLine("Caption continuation", 53, 112, 220),
    textLine("Following body paragraph.", 53, 320, 250),
  ], 600, 800);
  const bounds = figureCropBounds(page, page.lines[0]);

  assert.ok(bounds);
  assert.ok(bounds.y > 220);
  assert.ok(bounds.y + bounds.height < 640);
});
