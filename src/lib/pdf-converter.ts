import { mergeFlowingParagraphs, safeBaseName } from "./markdown";
import {
  PasswordRequiredError,
  type BlockKind,
  type ConvertedDocument,
  type ConversionProgress,
  type DocumentBlock,
  type ExtractedImage,
} from "./types";
import type { PDFPageProxy } from "pdfjs-dist";

interface TextLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  fontName: string;
  page: number;
}

interface RawPage {
  page: number;
  width: number;
  height: number;
  lines: TextLine[];
  canvas: HTMLCanvasElement;
  annotations: Array<{ text: string; url: string }>;
  usedOcr: boolean;
}

type ProgressHandler = (progress: ConversionProgress) => void;

const HEADER_FOOTER_ZONE = 0.11;
const CAPTION_PATTERN = /^(?:figure|fig\.)\s*\d+[.:)]?\s*/i;
const TABLE_CAPTION_PATTERN = /^table\s*\d+[.:)]?\s*/i;
const LIST_PATTERN = /^(?:[-•▪◦]|\d+[.)]|[a-z][.)])\s+/i;
const PAGE_NUMBER_PATTERN = /^(?:page\s*)?\d+(?:\s*(?:of|\/)\s*\d+)?$/i;
const REFERENCE_PATTERN = /^(?:references|bibliography)$/i;
const MATH_SYMBOL_PATTERN = /[=∑∫√±≤≥≈∞α-ωΑ-Ω^_]/g;

function normalizeRepeatedLine(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function median(values: number[]): number {
  if (!values.length) return 12;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("Conversion cancelled.", "AbortError");
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("The browser could not encode an extracted figure."));
    }, "image/png");
  });
}

function textItemsToLines(
  items: Array<Record<string, unknown>>,
  viewport: { transform: number[]; width: number; height: number },
  pdfjs: {
    Util: { transform: (a: number[], b: number[]) => number[] };
  },
  pageNumber: number,
): TextLine[] {
  const runs: Array<{
    text: string;
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
    fontName: string;
  }> = [];

  for (const item of items) {
    if (typeof item.str !== "string" || !item.str.trim()) continue;
    const transform = pdfjs.Util.transform(
      viewport.transform,
      item.transform as number[],
    );
    const fontSize = Math.max(
      7,
      Math.hypot(transform[2] ?? 0, transform[3] ?? 0),
    );
    runs.push({
      text: item.str,
      x: transform[4],
      y: transform[5] - fontSize,
      width: Math.max(1, Number(item.width ?? 0) * 1.6),
      height: fontSize,
      fontSize,
      fontName: String(item.fontName ?? ""),
    });
  }

  runs.sort((a, b) => a.y - b.y || a.x - b.x);
  const grouped: typeof runs[] = [];

  for (const run of runs) {
    const current = grouped.at(-1);
    const tolerance = Math.max(3, run.fontSize * 0.38);
    if (!current || Math.abs(current[0].y - run.y) > tolerance) {
      grouped.push([run]);
    } else {
      current.push(run);
    }
  }

  return grouped.map((group) => {
    group.sort((a, b) => a.x - b.x);
    const fontSize = median(group.map((run) => run.fontSize));
    let text = "";
    let right = group[0].x;

    for (const run of group) {
      const gap = run.x - right;
      if (text && gap > Math.max(9, fontSize * 1.15)) text += "   ";
      else if (text && gap > Math.max(2.5, fontSize * 0.22)) text += " ";
      text += run.text;
      right = Math.max(right, run.x + run.width);
    }

    const x = Math.min(...group.map((run) => run.x));
    const maxX = Math.max(...group.map((run) => run.x + run.width));
    return {
      text: text.replace(/ {4,}/g, "   ").trim(),
      x,
      y: median(group.map((run) => run.y)),
      width: maxX - x,
      height: Math.max(...group.map((run) => run.height)),
      fontSize,
      fontName: group.map((run) => run.fontName).join(" "),
      page: pageNumber,
    };
  });
}

function orderLines(lines: TextLine[], pageWidth: number): TextLine[] {
  if (lines.length < 8) {
    return [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
  }

  const middle = pageWidth / 2;
  const gutter = pageWidth * 0.055;
  const left = lines.filter((line) => line.x + line.width < middle - gutter);
  const right = lines.filter((line) => line.x > middle + gutter);
  const twoColumns =
    left.length >= lines.length * 0.24 && right.length >= lines.length * 0.24;
  if (!twoColumns) return [...lines].sort((a, b) => a.y - b.y || a.x - b.x);

  const fullWidth = lines
    .filter(
      (line) =>
        line.x < middle - gutter &&
        line.x + line.width > middle + gutter,
    )
    .sort((a, b) => a.y - b.y);
  const ordered: TextLine[] = [];
  let regionTop = -Infinity;

  for (const separator of [...fullWidth, null]) {
    const regionBottom = separator?.y ?? Infinity;
    const region = lines.filter(
      (line) =>
        line.y >= regionTop &&
        line.y < regionBottom &&
        !fullWidth.includes(line),
    );
    ordered.push(
      ...region
        .filter((line) => line.x < middle)
        .sort((a, b) => a.y - b.y || a.x - b.x),
      ...region
        .filter((line) => line.x >= middle)
        .sort((a, b) => a.y - b.y || a.x - b.x),
    );
    if (separator) {
      ordered.push(separator);
      regionTop = separator.y + separator.height * 0.5;
    }
  }
  return ordered;
}

function removeHeadersAndFooters(pages: RawPage[]): RawPage[] {
  if (pages.length < 2) {
    return pages.map((page) => ({
      ...page,
      lines: page.lines.filter(
        (line) => !PAGE_NUMBER_PATTERN.test(line.text.trim()),
      ),
    }));
  }

  const counts = new Map<string, number>();
  for (const page of pages) {
    const unique = new Set(
      page.lines
        .filter(
          (line) =>
            line.y < page.height * HEADER_FOOTER_ZONE ||
            line.y > page.height * (1 - HEADER_FOOTER_ZONE),
        )
        .map((line) => normalizeRepeatedLine(line.text))
        .filter(Boolean),
    );
    for (const value of unique) counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const repeated = new Set(
    [...counts.entries()]
      .filter(([, count]) => count >= Math.max(2, Math.ceil(pages.length * 0.5)))
      .map(([value]) => value),
  );

  return pages.map((page) => ({
    ...page,
    lines: page.lines.filter((line) => {
      const isMarginLine =
        line.y < page.height * HEADER_FOOTER_ZONE ||
        line.y > page.height * (1 - HEADER_FOOTER_ZONE);
      if (!isMarginLine) return true;
      return (
        !repeated.has(normalizeRepeatedLine(line.text)) &&
        !PAGE_NUMBER_PATTERN.test(line.text.trim())
      );
    }),
  }));
}

function splitTableRow(text: string): string[] {
  return text
    .split(/\s{2,}|\t+/)
    .map((cell) => cell.trim().replace(/\|/g, "\\|"))
    .filter(Boolean);
}

function looksLikeTable(lines: TextLine[], startIndex: number): number {
  let count = 0;
  for (
    let index = startIndex;
    index < Math.min(lines.length, startIndex + 12);
    index += 1
  ) {
    if (splitTableRow(lines[index].text).length >= 2) count += 1;
    else if (count >= 2) break;
    else return 0;
  }
  return count;
}

function tableMarkdown(lines: TextLine[]): string {
  const rows = lines.map((line) => splitTableRow(line.text));
  const columnCount = Math.max(...rows.map((row) => row.length), 1);
  const normalized = rows.map((row) => [
    ...row,
    ...Array(Math.max(0, columnCount - row.length)).fill(""),
  ]);
  return [
    `| ${normalized[0].join(" | ")} |`,
    `| ${Array(columnCount).fill("---").join(" | ")} |`,
    ...normalized.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

function unicodeMathToLatex(text: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/∑/g, "\\sum "],
    [/∫/g, "\\int "],
    [/√/g, "\\sqrt{}"],
    [/±/g, "\\pm "],
    [/≤/g, "\\le "],
    [/≥/g, "\\ge "],
    [/≈/g, "\\approx "],
    [/∞/g, "\\infty "],
    [/×/g, "\\times "],
    [/α/g, "\\alpha "],
    [/β/g, "\\beta "],
    [/γ/g, "\\gamma "],
    [/δ/g, "\\delta "],
    [/θ/g, "\\theta "],
    [/λ/g, "\\lambda "],
    [/μ/g, "\\mu "],
    [/π/g, "\\pi "],
    [/σ/g, "\\sigma "],
  ];
  return replacements.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    text,
  );
}

function classifyLine(
  line: TextLine,
  bodyFontSize: number,
  isNearBottom: boolean,
): BlockKind {
  const text = line.text.trim();
  const mathMatches = text.match(MATH_SYMBOL_PATTERN)?.length ?? 0;
  if (
    mathMatches >= 2 &&
    mathMatches / Math.max(1, text.replace(/\s/g, "").length) > 0.08
  ) {
    return "equation";
  }
  if (CAPTION_PATTERN.test(text)) return "figure";
  if (TABLE_CAPTION_PATTERN.test(text)) return "table";
  if (LIST_PATTERN.test(text)) return "list";
  if (
    isNearBottom &&
    line.fontSize < bodyFontSize * 0.86 &&
    /^(?:\d+|[*†‡])\s*/.test(text)
  ) {
    return "footnote";
  }
  if (
    line.fontSize > bodyFontSize * 1.26 ||
    REFERENCE_PATTERN.test(text) ||
    (text.length < 90 &&
      /^[A-Z\d][A-Z\d\s,:/&()-]+$/.test(text) &&
      text.split(/\s+/).length < 12)
  ) {
    return "heading";
  }
  return "paragraph";
}

function linesToBlocks(pages: RawPage[]): DocumentBlock[] {
  const bodyFontSize = median(
    pages.flatMap((page) => page.lines.map((line) => line.fontSize)),
  );
  const blocks: DocumentBlock[] = [];
  let footnoteNumber = 1;

  for (const page of pages) {
    const lines = orderLines(page.lines, page.width);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const tableRowCount = looksLikeTable(lines, index);
      if (tableRowCount >= 2) {
        blocks.push({
          id: crypto.randomUUID(),
          kind: "table",
          markdown: tableMarkdown(lines.slice(index, index + tableRowCount)),
          page: page.page,
          confidence: page.usedOcr ? 0.64 : 0.82,
        });
        index += tableRowCount - 1;
        continue;
      }

      const kind = classifyLine(
        line,
        bodyFontSize,
        line.y > page.height * 0.8,
      );
      let markdown = line.text.trim();
      if (kind === "heading") {
        markdown = `${line.fontSize > bodyFontSize * 1.7 ? "#" : "##"} ${markdown}`;
      } else if (kind === "equation") {
        markdown = `$$\n${unicodeMathToLatex(markdown)}\n$$`;
      } else if (kind === "footnote") {
        markdown = `[^${footnoteNumber}]: ${markdown.replace(/^(?:\d+|[*†‡])\s*/, "")}`;
        footnoteNumber += 1;
      } else if (kind === "list") {
        markdown = markdown.replace(LIST_PATTERN, "- ");
      } else if (kind === "paragraph") {
        const isBold = /bold|black|heavy/i.test(line.fontName);
        const isItalic = /italic|oblique/i.test(line.fontName);
        if (isBold && isItalic) markdown = `***${markdown}***`;
        else if (isBold) markdown = `**${markdown}**`;
        else if (isItalic) markdown = `*${markdown}*`;
      }

      const previous = blocks.at(-1);
      const previousLine = lines[index - 1];
      const verticalGap = previousLine ? line.y - previousLine.y : Infinity;
      const canMerge =
        previous?.kind === "paragraph" &&
        kind === "paragraph" &&
        previous.page === page.page &&
        verticalGap >= -bodyFontSize * 0.15 &&
        verticalGap < bodyFontSize * 1.9;
      if (canMerge && previous) {
        previous.markdown = previous.markdown.endsWith("-")
          ? `${previous.markdown.slice(0, -1)}${markdown}`
          : `${previous.markdown} ${markdown}`;
        continue;
      }

      blocks.push({
        id: crypto.randomUUID(),
        kind,
        markdown,
        page: page.page,
        confidence: page.usedOcr ? 0.69 : kind === "equation" ? 0.72 : 0.91,
      });
    }

    for (const annotation of page.annotations) {
      if (!blocks.some((block) => block.markdown.includes(annotation.url))) {
        blocks.push({
          id: crypto.randomUUID(),
          kind: "paragraph",
          markdown: `[${annotation.text || annotation.url}](${annotation.url})`,
          page: page.page,
          confidence: 0.95,
        });
      }
    }
  }
  return mergeFlowingParagraphs(blocks);
}

async function renderPage(page: PDFPageProxy, scale = 1.6) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas rendering is unavailable in this browser.");
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return { canvas, viewport };
}

async function ocrCanvas(
  canvas: HTMLCanvasElement,
  onProgress: (value: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const { createWorker, OEM } = await import("tesseract.js");
  const base = new URL("./ocr/", window.location.href).href;
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: `${base}worker.min.js`,
    corePath: `${base}tesseract-core-simd-lstm.wasm.js`,
    langPath: base,
    gzip: true,
    workerBlobURL: false,
    logger: (message) => {
      if (message.status === "recognizing text") onProgress(message.progress);
    },
  });
  let aborted = false;
  const stopWorker = () => {
    aborted = true;
    void worker.terminate();
  };
  signal?.addEventListener("abort", stopWorker, { once: true });
  try {
    const result = await worker.recognize(canvas);
    throwIfAborted(signal);
    return result.data.text;
  } catch (error) {
    if (aborted) throw new DOMException("Conversion cancelled.", "AbortError");
    throw error;
  } finally {
    signal?.removeEventListener("abort", stopWorker);
    if (!aborted) await worker.terminate();
  }
}

function ocrTextToLines(
  text: string,
  pageNumber: number,
  width: number,
  height: number,
): TextLine[] {
  const values = text
    .split(/\n+/)
    .map((value) => value.trim())
    .filter(Boolean);
  return values.map((value, index) => ({
    text: value,
    x: width * 0.08,
    y: height * (0.08 + (index / Math.max(1, values.length)) * 0.84),
    width: width * 0.84,
    height: 16,
    fontSize: 16,
    fontName: "OCR",
    page: pageNumber,
  }));
}

async function extractFigures(
  pages: RawPage[],
  onProgress: ProgressHandler,
  signal?: AbortSignal,
): Promise<ExtractedImage[]> {
  const images: ExtractedImage[] = [];
  let figureNumber = 1;

  for (const page of pages) {
    throwIfAborted(signal);
    const captions = page.lines.filter((line) => CAPTION_PATTERN.test(line.text));
    for (const caption of captions) {
      const canvasScale = page.canvas.height / page.height;
      const captionTop = Math.max(1, Math.floor(caption.y * canvasScale));
      const nearestTextAbove = page.lines
        .filter(
          (line) =>
            line.y < caption.y &&
            line.y > caption.y - page.height * 0.48 &&
            !CAPTION_PATTERN.test(line.text),
        )
        .sort((a, b) => b.y - a.y)[0];
      const estimatedTop = nearestTextAbove
        ? Math.floor(
            (nearestTextAbove.y + nearestTextAbove.height * 1.8) * canvasScale,
          )
        : Math.floor(captionTop - page.canvas.height * 0.36);
      const top = Math.max(
        Math.floor(page.canvas.height * 0.04),
        Math.min(captionTop - 40, estimatedTop),
      );
      const height = captionTop - top - 8;
      if (height < 80) continue;

      const horizontalPadding = Math.floor(page.canvas.width * 0.055);
      const crop = document.createElement("canvas");
      crop.width = page.canvas.width - horizontalPadding * 2;
      crop.height = height;
      const context = crop.getContext("2d");
      if (!context) continue;
      context.drawImage(
        page.canvas,
        horizontalPadding,
        top,
        crop.width,
        height,
        0,
        0,
        crop.width,
        height,
      );
      const blob = await canvasToBlob(crop);
      const filename = `images/figure-${String(figureNumber).padStart(3, "0")}.png`;
      images.push({
        filename,
        blob,
        url: URL.createObjectURL(blob),
        caption: caption.text,
        page: page.page,
      });
      figureNumber += 1;
    }

    onProgress({
      phase: "figures",
      page: page.page,
      total: pages.length,
      percent: 76 + Math.round((page.page / pages.length) * 12),
      message: `Checking figures on page ${page.page}`,
    });
    await yieldToBrowser();
  }
  return images;
}

function attachFigures(
  blocks: DocumentBlock[],
  images: ExtractedImage[],
): DocumentBlock[] {
  const imageByPageAndCaption = new Map(
    images.map((image) => [
      `${image.page}:${normalizeRepeatedLine(image.caption)}`,
      image,
    ]),
  );
  return blocks.map((block) => {
    if (block.kind !== "figure") return block;
    const image = imageByPageAndCaption.get(
      `${block.page}:${normalizeRepeatedLine(block.markdown)}`,
    );
    if (!image) return block;
    const alt = block.markdown.replace(CAPTION_PATTERN, "").trim() || "Figure";
    return {
      ...block,
      markdown: `![${alt}](${image.filename})\n\n*${block.markdown}*`,
      imageFilename: image.filename,
      confidence: Math.min(block.confidence, 0.82),
    };
  });
}

export async function convertPdf(
  file: File,
  password: string,
  onProgress: ProgressHandler,
  signal?: AbortSignal,
): Promise<ConvertedDocument> {
  throwIfAborted(signal);
  onProgress({
    phase: "opening",
    page: 0,
    total: 0,
    percent: 2,
    message: "Opening PDF locally",
  });

  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "./pdf.worker.min.mjs",
    window.location.href,
  ).href;

  const bytes = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({
    data: bytes,
    password: password || undefined,
    useSystemFonts: true,
  });
  let pdf;
  try {
    pdf = await loadingTask.promise;
  } catch (error) {
    await loadingTask.destroy();
    const maybeError = error as { name?: string; code?: number };
    if (
      maybeError.name === "PasswordException" ||
      maybeError.code === pdfjs.PasswordResponses?.NEED_PASSWORD ||
      maybeError.code === pdfjs.PasswordResponses?.INCORRECT_PASSWORD
    ) {
      throw new PasswordRequiredError(
        maybeError.code === pdfjs.PasswordResponses?.INCORRECT_PASSWORD,
      );
    }
    throw error;
  }

  const rawPages: RawPage[] = [];
  let ocrPages = 0;

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    throwIfAborted(signal);
    onProgress({
      phase: "reading",
      page: pageNumber,
      total: pdf.numPages,
      percent: 5 + Math.round(((pageNumber - 1) / pdf.numPages) * 62),
      message: `Reading page ${pageNumber} of ${pdf.numPages}`,
    });
    const page = await pdf.getPage(pageNumber);
    const [{ canvas, viewport }, textContent, annotations] = await Promise.all([
      renderPage(page),
      page.getTextContent(),
      page.getAnnotations({ intent: "display" }),
    ]);
    let lines = textItemsToLines(
      textContent.items as Array<Record<string, unknown>>,
      viewport,
      pdfjs,
      pageNumber,
    );
    let usedOcr = false;
    const selectableCharacters = lines.reduce(
      (total, line) => total + line.text.length,
      0,
    );

    if (selectableCharacters < 40) {
      usedOcr = true;
      ocrPages += 1;
      onProgress({
        phase: "ocr",
        page: pageNumber,
        total: pdf.numPages,
        percent: 7 + Math.round(((pageNumber - 1) / pdf.numPages) * 62),
        message: `Running English OCR on page ${pageNumber}`,
      });
      const ocrText = await ocrCanvas(canvas, (ocrProgress) => {
        onProgress({
          phase: "ocr",
          page: pageNumber,
          total: pdf.numPages,
          percent:
            7 +
            Math.round(
              ((pageNumber - 1 + ocrProgress) / pdf.numPages) * 62,
            ),
          message: `Recognizing page ${pageNumber} · ${Math.round(ocrProgress * 100)}%`,
        });
      }, signal);
      lines = ocrTextToLines(
        ocrText,
        pageNumber,
        viewport.width,
        viewport.height,
      );
    }

    rawPages.push({
      page: pageNumber,
      width: viewport.width,
      height: viewport.height,
      lines,
      canvas,
      usedOcr,
      annotations: (annotations as Array<Record<string, unknown>>)
        .filter((annotation) => typeof annotation.url === "string")
        .map((annotation) => ({
          text: String(annotation.titleObj ?? annotation.contentsObj ?? ""),
          url: String(annotation.url),
        })),
    });
    await yieldToBrowser();
    }

  const cleanedPages = removeHeadersAndFooters(rawPages);
  const images = await extractFigures(cleanedPages, onProgress, signal);
  throwIfAborted(signal);
  onProgress({
    phase: "assembling",
    page: pdf.numPages,
    total: pdf.numPages,
    percent: 92,
    message: "Reconstructing reading order",
  });
  let blocks = linesToBlocks(cleanedPages);
  blocks = attachFigures(blocks, images);
  const titleBlock = blocks.find((block) => block.kind === "heading");
  const title =
    titleBlock?.markdown.replace(/^#+\s*/, "").trim() || safeBaseName(file.name);
  const wordCount = blocks.reduce(
    (total, block) =>
      total + block.markdown.split(/\s+/).filter(Boolean).length,
    0,
  );

  onProgress({
    phase: "assembling",
    page: pdf.numPages,
    total: pdf.numPages,
    percent: 100,
    message: "Ready to review",
  });

  return {
    sourceName: file.name,
    title,
    blocks,
    images,
    stats: {
      pages: pdf.numPages,
      words: wordCount,
      figures: images.length,
      tables: blocks.filter((block) => block.kind === "table").length,
      ocrPages,
      lowConfidenceBlocks: blocks.filter((block) => block.confidence < 0.78)
        .length,
    },
  };
  } finally {
    await loadingTask.destroy();
  }
}
