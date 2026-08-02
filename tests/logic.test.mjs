import assert from "node:assert/strict";
import test from "node:test";
import {
  blocksToMarkdown,
  inspectMarkdownFlow,
  mergeFlowingParagraphs,
  paragraphContinuationStrength,
  safeBaseName,
} from "../src/lib/markdown.ts";
import {
  figureCropBounds,
  hasPdfSignature,
  linesToBlocks,
  MAX_PDF_FILE_BYTES,
  orderLines,
  removeHeadersAndFooters,
  textItemsToLines,
  validatePdfFile,
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
  assert.equal(safeBaseName(`${"a".repeat(200)}.pdf`).length, 120);
});

test("rejects unsafe file sizes and spoofed PDF signatures", () => {
  assert.equal(
    validatePdfFile({ name: "paper.pdf", type: "application/pdf", size: 42 }),
    null,
  );
  assert.match(
    validatePdfFile({
      name: "paper.pdf",
      type: "application/pdf",
      size: MAX_PDF_FILE_BYTES + 1,
    }) ?? "",
    /100 MB safety limit/,
  );
  assert.match(
    validatePdfFile({ name: "paper.txt", type: "text/plain", size: 42 }) ?? "",
    /choose a PDF/i,
  );
  assert.equal(hasPdfSignature(new TextEncoder().encode("%PDF-1.7")), true);
  assert.equal(hasPdfSignature(new TextEncoder().encode("not a PDF")), false);
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

test("audits the complete Markdown for interrupted sentence fragments", () => {
  const audit = inspectMarkdownFlow([
    "Based on the responses we",
    "<u><em>Figure 1. Components of VBHC interventions.</em></u>",
    "refined the recommendations for implementation.",
  ].join("\n\n"));

  assert.equal(audit.issues.length, 1);
  assert.equal(audit.issues[0].reason, "interrupted-sentence");
  assert.ok(audit.score >= 5);

  const tableAudit = inspectMarkdownFlow([
    "The evidence review found",
    "<u><em>Table 1. Included studies.</em></u>",
    "| Study | Result |\n| --- | --- |\n| Trial A | Benefit |",
    "that the intervention improved outcomes.",
  ].join("\n\n"));
  assert.equal(tableAudit.issues[0]?.reason, "interrupted-sentence");
});

test("does not flag intentional paragraph and section boundaries", () => {
  const audit = inspectMarkdownFlow([
    "The first paragraph is complete.",
    "The second paragraph starts a separate idea.",
    "## Results",
    "The analysis found a clinically important difference.",
    "- Prespecified subgroup analysis",
    "Published Online: April 8, 2026",
    "[doi:https://doi.org/10.1016/example](https://doi.org/10.1016/example)",
  ].join("\n\n"));

  assert.deepEqual(audit, { issues: [], score: 0 });
});

test("preserves literal angle-bracket notation during continuity checks", () => {
  assert.equal(
    paragraphContinuationStrength("Return Array<string>.", "Next section"),
    0,
  );
  assert.equal(
    paragraphContinuationStrength(
      'Use <span title="a > b">text</span>.',
      "Next section",
    ),
    0,
  );
  assert.equal(
    paragraphContinuationStrength(
      "<u><em>Figure 1.</em></u>",
      "Next section",
    ),
    0,
  );
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

test("uses explicit PDF line endings before ordering justified columns", () => {
  const lines = textItemsToLines(
    [
      {
        str: "Norway (highest",
        transform: [12, 0, 0, 12, 53, 250],
        width: 60,
        fontName: "Body",
      },
      {
        str: " participation >60%),",
        transform: [12, 0, 0, 12, 151, 250],
        width: 82,
        fontName: "Body",
        hasEOL: true,
      },
      {
        str: "Poland (lowest participation 33%)",
        transform: [12, 0, 0, 12, 330, 250],
        width: 120,
        fontName: "Body",
      },
    ],
    { transform: [1, 0, 0, 1, 0, 0], width: 612, height: 792 },
    { Util: { transform: (_viewport, item) => item } },
    1,
  );

  assert.deepEqual(lines.map((line) => line.text), [
    "Norway (highest participation >60%),",
    "Poland (lowest participation 33%)",
  ]);
});

test("keeps a same-line continuation after a superscript citation", () => {
  const lines = textItemsToLines(
    [
      {
        str: "needed for its successful application.",
        transform: [12, 0, 0, 12, 53, 250],
        width: 95,
        fontName: "Body",
      },
      {
        str: "4",
        transform: [8, 0, 0, 8, 206, 246.5],
        width: 3,
        fontName: "Body",
        hasEOL: true,
      },
      {
        str: "Others, such as the European Commission",
        transform: [12, 0, 0, 12, 214, 250],
        width: 120,
        fontName: "Body",
      },
    ],
    { transform: [1, 0, 0, 1, 0, 0], width: 612, height: 792 },
    { Util: { transform: (_viewport, item) => item } },
    1,
  );

  assert.equal(lines.length, 1);
  assert.match(lines[0].text, /application\. ?4 Others, such as the European Commission/);
});

test("does not merge rotated watermark runs into horizontal prose", () => {
  const lines = textItemsToLines(
    [
      {
        str: "The evidence remains indirect.",
        transform: [12, 0, 0, 12, 53, 250],
        width: 130,
        fontName: "Body",
      },
      {
        str: "Protected by copyright",
        transform: [0, 12, -12, 0, 400, 250],
        width: 90,
        fontName: "Watermark",
      },
    ],
    { transform: [1, 0, 0, 1, 0, 0], width: 612, height: 792 },
    { Util: { transform: (_viewport, item) => item } },
    1,
  );
  const cleaned = removeHeadersAndFooters([
    rawPage(1, lines),
  ]);

  assert.deepEqual(cleaned[0].lines.map((line) => line.text), [
    "The evidence remains indirect.",
  ]);
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

test("keeps extracted Markdown inert and drops unsafe annotation URLs", () => {
  const markdown = blocksToMarkdown(linesToBlocks([
    {
      page: 1,
      width: 612,
      height: 792,
      lines: [
        textLine(
          "Summary <script>alert(1)</script> [click](javascript:alert(2))",
          53,
          130,
          300,
        ),
      ],
      canvas: {},
      annotations: [
        { text: "Safe [journal]", url: "https://example.com/paper" },
        { text: "Unsafe", url: "javascript:alert(3)" },
        { text: "Credential URL", url: "https://user:pass@example.com/" },
      ],
      usedOcr: false,
    },
  ]));

  assert.doesNotMatch(markdown, /<script>|(?<!\\)\]\(javascript:/i);
  assert.match(markdown, /&lt;script>alert\(1\)&lt;\/script>/);
  assert.match(markdown, /\\\[click\\\]\(javascript:alert\(2\)\)/);
  assert.match(markdown, /\[Safe \\\[journal\\\]\]\(<https:\/\/example\.com\/paper>\)/);
  assert.doesNotMatch(markdown, /javascript:alert\(3\)|user:pass/);
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

test("removes alternating page headers and rotated watermark text", () => {
  const pages = removeHeadersAndFooters([
    rawPage(1, [
      textLine("CORE GRADE: OVERVIEW", 50, 20, 180),
      textLine("First article paragraph.", 50, 130, 220),
      { ...textLine("BMJ", 590, 300, 30), angle: 90 },
    ]),
    rawPage(2, [
      textLine("RESEARCH METHODS", 50, 20, 170),
      textLine("Second article paragraph.", 50, 130, 220),
    ]),
    rawPage(3, [
      textLine("CORE GRADE: OVERVIEW", 50, 20, 180),
      textLine("Third article paragraph.", 50, 130, 220),
    ]),
    rawPage(4, [
      textLine("RESEARCH METHODS", 50, 20, 170),
      textLine("Fourth article paragraph.", 50, 130, 220),
    ]),
  ]);

  assert.deepEqual(
    pages.flatMap((page) => page.lines.map((line) => line.text)),
    [
      "First article paragraph.",
      "Second article paragraph.",
      "Third article paragraph.",
      "Fourth article paragraph.",
    ],
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

test("second-pass reconstruction joins a high-confidence fragmented sentence", () => {
  const page = rawPage(1, [
    textLine("The intervention improves", 53, 300, 240),
    textLine("patient outcomes across settings.", 53, 350, 240),
  ]);
  const firstPass = blocksToMarkdown(linesToBlocks([page]));
  const recovered = blocksToMarkdown(linesToBlocks([page], {
    recoveryMode: true,
  }));

  assert.match(firstPass, /improves\n\npatient outcomes/);
  assert.match(recovered, /improves patient outcomes across settings\./);
  assert.doesNotMatch(recovered, /improves\n\npatient outcomes/);
});

test("second-pass reconstruction preserves real paragraph separation", () => {
  const recovered = blocksToMarkdown(linesToBlocks([
    rawPage(1, [
      textLine("The first paragraph is complete.", 53, 300, 240),
      textLine("The second paragraph starts a separate idea.", 53, 350, 240),
    ]),
  ], { recoveryMode: true }));

  assert.match(recovered, /complete\.\n\nThe second paragraph/);
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
  assert.match(markdown, /<u><em>Figure 1\. Components of VBHC interventions\.<\/em><\/u>/);
});

test("converts recommendation rows into a Markdown table", () => {
  const markdown = blocksToMarkdown(linesToBlocks([
    rawPage(1, [
      textLine("Table 1. Recommendations.", 53, 120, 220),
      textLine("(1) Use outcomes that matter to patients.", 53, 145, 300),
      textLine("(2) Compare A | B, <unsafe>, and C\\D.", 53, 160, 300),
      textLine("Conclusions", 53, 200, 80, 12),
    ]),
  ]));

  assert.match(markdown, /\| No\. \| Recommendation \|/);
  assert.match(markdown, /\| 1 \| Use outcomes that matter to patients\. \|/);
  assert.match(markdown, /\| 2 \| Compare A \\\| B, &lt;unsafe>, and C\\\\D\. \|/);
  assert.match(markdown, /<u><em>Table 1\. Recommendations\.<\/em><\/u>/);
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

test("detects an unlabeled bibliography and keeps embedded numbers in their entry", () => {
  const markdown = blocksToMarkdown(linesToBlocks([
    rawPage(1, [
      textLine("Earlier article text begins here", 53, 120, 250),
      textLine("and continues as normal prose", 53, 135, 250),
      textLine("with enough body lines to establish", 53, 150, 250),
      textLine("the article's dominant text size", 53, 165, 250),
      textLine("before its bibliography begins.", 53, 180, 250),
    ]),
    rawPage(2, [
      { ...textLine("1  First article by Smith et al. 2024.", 53, 600, 250, 8), page: 2 },
      { ...textLine("2  Second article included 120 randomised trials.", 53, 620, 280, 8), page: 2 },
      { ...textLine("3  Third article. doi:10.1000/example.", 53, 640, 250, 8), page: 2 },
    ]),
  ]));

  assert.match(markdown, /## REFERENCES/);
  assert.match(markdown, /2\. Second article included 120 randomised trials\./);
  assert.doesNotMatch(markdown, /^120\. /m);
});

test("uses positioned text fragments to preserve table columns", () => {
  const tableLine = (text, y, parts) => ({
    ...textLine(text, parts[0].x, y, 250, 10),
    parts,
  });
  const markdown = blocksToMarkdown(linesToBlocks([
    rawPage(1, [
      textLine("Table 1 | Trial outcomes", 53, 100, 220, 10),
      tableLine("OutcomeStudy result", 125, [
        { text: "Outcome", x: 53, width: 42 },
        { text: "Study result", x: 220, width: 65 },
      ]),
      tableLine("MortalityLower risk", 140, [
        { text: "Mortality", x: 53, width: 48 },
        { text: "Lower risk", x: 220, width: 55 },
      ]),
      textLine("Conclusion", 53, 190, 75, 13),
    ]),
  ]));

  assert.match(markdown, /\| Outcome \| Study result \|/);
  assert.match(markdown, /\| Mortality \| Lower risk \|/);
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

test("crops a large vector figure above its caption", () => {
  const caption = textLine("Fig 2 | Core GRADE workflow", 53, 560, 260);
  const page = rawPage(1, [
    textLine("Body paragraph before the figure area.", 53, 80, 250),
    textLine("Vector diagram label", 120, 250, 180, 18),
    caption,
    textLine("Following article paragraph after the caption.", 53, 600, 280),
  ], 600, 800);
  const bounds = figureCropBounds(page, page.lines[2]);

  assert.ok(bounds);
  assert.ok(bounds.y < caption.y * 2);
  assert.ok(bounds.y + bounds.height < caption.y * 2);
});

test("extracts a column-sized vector figure without removing the adjacent article column", () => {
  const caption = textLine("Fig 1 | Two types of indirectness", 45, 300, 260, 10);
  const page = rawPage(1, [
    { ...textLine("Indirectness", 130, 100, 75, 10), fontName: "Diagram" },
    { ...textLine("Indirect comparisons", 75, 145, 110, 10), fontName: "Diagram" },
    { ...textLine("Target PICO", 210, 180, 70, 10), fontName: "Diagram" },
    { ...textLine("Network meta-analysis", 95, 245, 130, 10), fontName: "Diagram" },
    caption,
    textLine("The adjacent article column remains readable and complete.", 335, 105, 230),
    textLine("It continues beside the vector diagram without being cropped.", 335, 120, 230),
    textLine("A third line establishes the separate body column.", 335, 135, 230),
    textLine("A fourth line keeps the body font dominant.", 335, 150, 230),
    textLine("A fifth line completes this synthetic article section.", 335, 165, 230),
  ], 600, 800);
  const markdown = blocksToMarkdown(linesToBlocks([page]));
  const bounds = figureCropBounds(page, page.lines[4]);

  assert.ok(bounds);
  assert.ok(bounds.width < page.canvas.width * 0.65);
  assert.doesNotMatch(markdown, /Network meta-analysis/);
  assert.match(markdown, /adjacent article column remains readable/);
});

test("converts positioned formula scripts and symbols to display LaTeX", () => {
  const formula = {
    ...textLine("E = mc2", 170, 230, 120, 16),
    fontName: "Math",
    parts: [
      { text: "E", x: 170, y: 230, width: 12, fontSize: 16 },
      { text: "=", x: 194, y: 230, width: 12, fontSize: 16 },
      { text: "mc", x: 218, y: 230, width: 24, fontSize: 16 },
      { text: "2", x: 242, y: 224, width: 7, fontSize: 9 },
    ],
  };
  const markdown = blocksToMarkdown(linesToBlocks([
    rawPage(1, [
      textLine("A normal article paragraph begins here", 53, 120, 260),
      textLine("and continues on another body line", 53, 135, 260),
      textLine("so the body type can be identified", 53, 150, 260),
      textLine("before the displayed formula appears", 53, 165, 260),
      textLine("within the scientific manuscript.", 53, 180, 260),
      formula,
    ]),
  ]));

  assert.match(markdown, /\$\$\nE = mc\^\{2\}\n\$\$/);
});
