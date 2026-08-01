import { mergeFlowingParagraphs, safeBaseName } from "./markdown.ts";
import {
  PasswordRequiredError,
  type BlockKind,
  type ConvertedDocument,
  type ConversionProgress,
  type DocumentBlock,
  type ExtractedImage,
} from "./types.ts";
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
  angle?: number;
  scriptBaseline?: number;
  sourceX?: number;
  parts?: Array<{
    text: string;
    x: number;
    y: number;
    width: number;
    fontSize: number;
  }>;
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
const CAPTION_PATTERN = /^(?:figure|fig\.?)\s*\d+\s*[.:)|]\s*/i;
const TABLE_CAPTION_PATTERN = /^table\s*\d+\s*[.:)|]\s*/i;
const LIST_PATTERN = /^(?:[-•▪◦]|\(\d+\)|\d+[.)]|[a-z][.)])\s+/i;
const ORDERED_LIST_PATTERN = /^(?:\((\d+)\)|(\d+)[.)])\s+/;
const REFERENCE_ENTRY_PATTERN = /^(\d{1,3})(?:[.)]|\s+)\s*/;
const REFERENCE_CONTINUATION_ENTRY_PATTERN = /^(\d{1,3})(?:[.)]|\s+)\s*/;
const TABLE_RECOMMENDATION_PATTERN = /^\((\d+)\)\s+/;
const PAGE_NUMBER_PATTERN = /^(?:page\s*)?\d+(?:\s*(?:of|\/)\s*\d+)?$/i;
const REFERENCE_PATTERN = /^(?:references|bibliography)$/i;
const MATH_SYMBOL_PATTERN = /[=≠∑∫√±≤≥≈∞×÷→↔α-ωΑ-Ω^_]/g;
const STRONG_FORMULA_PATTERN = /(?:\s[=≠≤≥≈±×÷→↔]\s|[∑∫√∞]|\b[a-zA-Z]\s*=\s*[^,;]+)/;
const LEGAL_FOOTER_PATTERN = /(?:see front matter|copyright|published by elsevier)/i;
const DECORATIVE_GLYPH_PATTERN = /^[■□▪◆●]+$/;
const JOURNAL_HEADER_PATTERN = /^(?:(?:\d+\s+)?value in health(?:\s+july\s+\d{4})?|ispor report(?:\s+\d+)?|july\s+\d{4})$/i;
const FRONT_MATTER_NOISE_PATTERN = /(?:contents lists available at sciencedirect\.com|journal homepage:)/i;
const TERMINAL_PUNCTUATION = /[.!?]["')\]]?$/;
const WRAPPED_HEADING_END_PATTERN = /(?:-|\b(?:and|for|from|in|of|the|to|with))$/i;

function normalizeRepeatedLine(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeRepeatedPhrase(text: string): string {
  const clean = text.trim();
  if (clean.length < 12 || clean.length % 2 !== 0) return clean;
  const middle = clean.length / 2;
  return clean.slice(0, middle) === clean.slice(middle)
    ? clean.slice(0, middle).trim()
    : clean;
}

function escapeInlineHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function mediaTitleMarkdown(text: string): string {
  return `<u><em>${escapeInlineHtml(text.trim())}</em></u>`;
}

function plainMediaTitle(markdown: string): string {
  return markdown
    .replace(/<\/?(?:u|em)>/gi, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

function fontKey(line: TextLine): string {
  return line.fontName.trim().split(/\s+/)[0] || "unknown";
}

function isHorizontal(line: TextLine): boolean {
  const angle = Math.abs(line.angle ?? 0) % 180;
  return angle < 12 || angle > 168;
}

function joinWrappedText(left: string, right: string): string {
  const cleanLeft = left.trimEnd();
  const cleanRight = right.trimStart();
  const endsInsideUrl = /(?:https?:\/\/|www\.)\S*$/i.test(cleanLeft);
  const beginsWithProse = /^(?:accessed|available|published|retrieved)\b/i.test(
    cleanRight,
  );
  const trailingToken = cleanLeft.match(/([A-Za-z]+)-$/)?.[1] ?? "";
  const keepsLexicalHyphen =
    /^[A-Z]/.test(cleanRight) || /^(?:non|pre|post|co|re|cost|health|patient|value)$/i.test(trailingToken);
  return endsInsideUrl && !beginsWithProse
    ? `${cleanLeft.replace(/-$/, "")}${cleanRight}`
    : cleanLeft.endsWith("-")
      ? keepsLexicalHyphen
        ? `${cleanLeft}${cleanRight}`
        : `${cleanLeft.slice(0, -1)}${cleanRight}`
    : `${cleanLeft} ${cleanRight}`;
}

function annotationText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (value && typeof value === "object") {
    const candidate = value as { str?: unknown };
    if (typeof candidate.str === "string") return candidate.str.trim();
  }
  return "";
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

function orientationDistance(left: number, right: number): number {
  const difference = Math.abs(left - right) % 180;
  return Math.min(difference, 180 - difference);
}

export function textItemsToLines(
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
    angle: number;
    hasEOL: boolean;
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
    const angle = Math.atan2(transform[1] ?? 0, transform[0] ?? 1) * 180 / Math.PI;
    runs.push({
      text: item.str,
      x: transform[4],
      y: transform[5] - fontSize,
      width: Math.max(1, Number(item.width ?? 0) * 1.6),
      height: fontSize,
      fontSize,
      fontName: String(item.fontName ?? ""),
      angle,
      hasEOL: item.hasEOL === true,
    });
  }

  runs.sort((a, b) => a.y - b.y || a.x - b.x);
  const grouped: typeof runs[] = [];

  for (const run of runs) {
    const current = grouped.at(-1);
    const tolerance = Math.max(3, run.fontSize * 0.38);
    const currentAngle = current
      ? median(current.map((value) => value.angle))
      : run.angle;
    if (
      !current ||
      Math.abs(current[0].y - run.y) > tolerance ||
      orientationDistance(currentAngle, run.angle) > 12
    ) {
      grouped.push([run]);
    } else {
      current.push(run);
    }
  }

  return grouped.flatMap((group) => {
    group.sort((a, b) => a.x - b.x);
    const fontSize = median(group.map((run) => run.fontSize));
    const columnGapThreshold = Math.max(8, Math.min(16, fontSize * 0.9));
    const segments: typeof runs[] = [];

    for (const run of group) {
      const current = segments.at(-1);
      const right = current
        ? Math.max(...current.map((value) => value.x + value.width))
        : -Infinity;
      const currentText = current?.map((value) => value.text).join("").trim() ?? "";
      const markerCanJoin =
        /^(?:\d{1,3}[.)]?|[-•▪◦])$/.test(currentText) &&
        run.x - right < fontSize * 2;
      const previousRun = current?.at(-1);
      const explicitLineEnd = previousRun?.hasEOL === true;
      const unusuallyLargeGap =
        run.x - right > Math.max(columnGapThreshold, fontSize * 2.2);
      const currentFontSize = current
        ? median(current.map((value) => value.fontSize))
        : run.fontSize;
      const mixedLayoutScale =
        current &&
        Math.max(currentFontSize, run.fontSize) /
          Math.max(1, Math.min(currentFontSize, run.fontSize)) > 1.35 &&
        run.x - right > Math.min(currentFontSize, run.fontSize) * 0.5;
      if (
        !current ||
        ((explicitLineEnd || unusuallyLargeGap || mixedLayoutScale) &&
          !markerCanJoin)
      ) {
        segments.push([run]);
      } else {
        current.push(run);
      }
    }

    return segments.map((segment) => {
      let text = "";
      let right = segment[0].x;
      for (const run of segment) {
        const gap = run.x - right;
        if (
          text &&
          !/\s$/.test(text) &&
          !/^\s/.test(run.text) &&
          gap > Math.max(0.6, fontSize * 0.055)
        ) {
          text += " ";
        }
        text += run.text;
        right = Math.max(right, run.x + run.width);
      }

      const x = Math.min(...segment.map((run) => run.x));
      const maxX = Math.max(...segment.map((run) => run.x + run.width));
      return {
        text: dedupeRepeatedPhrase(text.replace(/\s+/g, " ").trim()),
        x,
        y: median(segment.map((run) => run.y)),
        width: maxX - x,
        height: Math.max(...segment.map((run) => run.height)),
        fontSize: median(segment.map((run) => run.fontSize)),
        fontName: segment.map((run) => run.fontName).join(" "),
        page: pageNumber,
        angle: median(segment.map((run) => run.angle)),
        parts: segment.map((run) => ({
          text: run.text,
          x: run.x,
          y: run.y,
          width: run.width,
          fontSize: run.fontSize,
        })),
      };
    });
  });
}

function medianNearbyRightColumnStart(
  lines: TextLine[],
  middle: number,
  y: number,
  direction: "above" | "below",
  maxDistance: number,
): number | null {
  const starts = lines
    .filter((line) => {
      const distance = direction === "above" ? y - line.y : line.y - y;
      return line.x >= middle && distance >= 0 && distance <= maxDistance;
    })
    .sort((a, b) => Math.abs(a.y - y) - Math.abs(b.y - y))
    .slice(0, 6)
    .map((line) => line.x);
  return starts.length >= 2 ? median(starts) : null;
}

interface LayoutTransition {
  y: number;
  splitX: number;
}

export function layoutTransitions(
  lines: TextLine[],
  pageWidth: number,
  pageHeight: number,
): LayoutTransition[] {
  const middle = pageWidth / 2;
  const bodyFontSize = median(lines.map((line) => line.fontSize));
  const maxDistance = pageHeight * 0.36;
  return lines
    .filter(
      (line) =>
        line.x < pageWidth * 0.2 &&
        line.width < pageWidth * 0.38 &&
        line.text.length < 80 &&
        line.fontSize > bodyFontSize * 1.12,
    )
    .map((line) => {
      const above = medianNearbyRightColumnStart(
        lines,
        middle,
        line.y,
        "above",
        maxDistance,
      );
      const below = medianNearbyRightColumnStart(
        lines,
        middle,
        line.y,
        "below",
        maxDistance,
      );
      if (
        above !== null &&
        below !== null &&
        above > pageWidth * 0.64 &&
        below < pageWidth * 0.62 &&
        above - below > pageWidth * 0.09
      ) {
        return {
          y: line.y - Math.max(1, line.height * 0.25),
          splitX: (above + below) / 2,
        };
      }
      return null;
    })
    .filter((transition): transition is LayoutTransition => transition !== null);
}

function columnStarts(lines: TextLine[], pageWidth: number): number[] {
  const candidates = lines
    .filter(
      (line) =>
        line.text.length > 8 &&
        line.width < pageWidth * 0.65 &&
        !CAPTION_PATTERN.test(line.text) &&
        !TABLE_CAPTION_PATTERN.test(line.text),
    )
    .map((line) => line.x)
    .sort((a, b) => a - b);
  if (candidates.length < 4) return [];

  const tolerance = pageWidth * 0.055;
  const clusters: Array<{ values: number[]; center: number }> = [];
  for (const value of candidates) {
    const cluster = clusters.find(
      (candidate) => Math.abs(candidate.center - value) <= tolerance,
    );
    if (cluster) {
      cluster.values.push(value);
      cluster.center = median(cluster.values);
    } else {
      clusters.push({ values: [value], center: value });
    }
  }

  const minimumCount = Math.max(2, Math.floor(candidates.length * 0.055));
  const starts = clusters
    .filter((cluster) => cluster.values.length >= minimumCount)
    .sort((a, b) => a.center - b.center)
    .map((cluster) => Math.min(...cluster.values));
  return starts.filter(
    (value, index) => index === 0 || value - starts[index - 1] > pageWidth * 0.13,
  );
}

function nearestColumnIndex(line: TextLine, starts: number[]): number {
  if (!starts.length) return 0;
  let closest = 0;
  for (let index = 1; index < starts.length; index += 1) {
    if (Math.abs(line.x - starts[index]) < Math.abs(line.x - starts[closest])) {
      closest = index;
    }
  }
  return closest;
}

function orderRegion(lines: TextLine[], pageWidth: number): TextLine[] {
  const sorted = [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
  if (sorted.length < 4) return sorted;
  const starts = columnStarts(sorted, pageWidth);
  if (starts.length < 2) return sorted;

  const columns = starts.map(() => [] as TextLine[]);
  for (const line of sorted) {
    columns[nearestColumnIndex(line, starts)].push(line);
  }
  const populated = columns.filter(
    (column) => column.length >= Math.max(2, sorted.length * 0.08),
  );
  if (populated.length < 2) return sorted;
  return populated.flatMap((column) =>
    column.sort((a, b) => a.y - b.y || a.x - b.x),
  );
}

export function orderLines(
  lines: TextLine[],
  pageWidth: number,
  pageHeight = Math.max(...lines.map((line) => line.y + line.height), 1),
): TextLine[] {
  if (lines.length < 8) {
    return [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
  }

  const segments: TextLine[][] = [];
  let remaining = [...lines];
  for (const transition of layoutTransitions(
    lines,
    pageWidth,
    pageHeight,
  ).sort((a, b) => a.y - b.y)) {
    const before = remaining.filter(
      (line) => line.y < transition.y || line.x >= transition.splitX,
    );
    if (before.length) segments.push(before);
    const beforeSet = new Set(before);
    remaining = remaining.filter((line) => !beforeSet.has(line));
  }
  if (remaining.length) segments.push(remaining);

  return segments.flatMap((segment) => orderLineSegment(segment, pageWidth));
}

function orderLineSegment(
  lines: TextLine[],
  pageWidth: number,
): TextLine[] {
  if (lines.length < 4) {
    return [...lines].sort((a, b) => a.y - b.y || a.x - b.x);
  }

  const fullWidth = lines
    .filter(
      (line) =>
        (line.width >= pageWidth * 0.49 &&
          line.x < pageWidth * 0.3 &&
          line.x + line.width > pageWidth * 0.72) ||
        ((CAPTION_PATTERN.test(line.text) || TABLE_CAPTION_PATTERN.test(line.text)) &&
          line.width >= pageWidth * 0.58),
    )
    .sort((a, b) => a.y - b.y);
  const fullWidthSet = new Set(fullWidth);
  const events = fullWidth.map((line) => ({ y: line.y, line }));
  const ordered: TextLine[] = [];
  let regionTop = -Infinity;

  for (const event of [...events, null]) {
    const regionBottom = event?.y ?? Infinity;
    const region = lines.filter(
      (line) =>
        line.y >= regionTop &&
        line.y < regionBottom &&
        !fullWidthSet.has(line),
    );
    ordered.push(...orderRegion(region, pageWidth));
    if (event) {
      ordered.push(event.line);
      regionTop = event.line.y + event.line.height * 0.5;
    }
  }
  return ordered;
}

function isDocumentChrome(line: TextLine): boolean {
  const text = line.text.trim();
  return (
    !isHorizontal(line) ||
    JOURNAL_HEADER_PATTERN.test(text) ||
    FRONT_MATTER_NOISE_PATTERN.test(text) ||
    LEGAL_FOOTER_PATTERN.test(text) ||
    DECORATIVE_GLYPH_PATTERN.test(text)
  );
}

export function removeHeadersAndFooters(pages: RawPage[]): RawPage[] {
  if (pages.length < 2) {
    return pages.map((page) => ({
      ...page,
      lines: page.lines.filter((line) => {
        const isMarginLine =
          line.y < page.height * HEADER_FOOTER_ZONE ||
          line.y > page.height * (1 - HEADER_FOOTER_ZONE);
        return !isDocumentChrome(line) &&
          !(isMarginLine && PAGE_NUMBER_PATTERN.test(line.text.trim()));
      }),
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
      .filter(([, count]) => count >= Math.max(2, Math.ceil(pages.length * 0.3)))
      .map(([value]) => value),
  );

  return pages.map((page) => ({
    ...page,
    lines: page.lines.filter((line) => {
      if (isDocumentChrome(line)) return false;
      const isMarginLine =
        line.y < page.height * HEADER_FOOTER_ZONE ||
        line.y > page.height * (1 - HEADER_FOOTER_ZONE);
      if (isMarginLine && PAGE_NUMBER_PATTERN.test(line.text.trim())) return false;
      if (!isMarginLine) return true;
      return !repeated.has(normalizeRepeatedLine(line.text));
    }),
  }));
}

interface DocumentProfile {
  bodyFontName: string;
  bodyFontSize: number;
  headingFonts: Set<string>;
}

interface FigureRegion {
  caption: TextLine;
  captionBottom: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface TableRegion {
  caption: TextLine;
  captionBottom: number;
  top: number;
  bottom: number;
  lines: TextLine[];
}

export function buildDocumentProfile(pages: RawPage[]): DocumentProfile {
  const stats = new Map<
    string,
    { chars: number; lengths: number[]; sizes: number[]; terminal: number; lines: TextLine[] }
  >();
  for (const page of pages) {
    for (const line of page.lines) {
      if (!isHorizontal(line) || CAPTION_PATTERN.test(line.text) || TABLE_CAPTION_PATTERN.test(line.text)) {
        continue;
      }
      const key = fontKey(line);
      const stat = stats.get(key) ?? {
        chars: 0,
        lengths: [],
        sizes: [],
        terminal: 0,
        lines: [],
      };
      stat.chars += line.text.length;
      stat.lengths.push(line.text.length);
      stat.sizes.push(line.fontSize);
      stat.terminal += TERMINAL_PUNCTUATION.test(line.text.trim()) ? 1 : 0;
      stat.lines.push(line);
      stats.set(key, stat);
    }
  }

  const rankedFonts = [...stats.entries()].sort((a, b) => b[1].chars - a[1].chars);
  const bodyEntry = rankedFonts.find(([, stat]) => stat.lines.length >= 5) ?? rankedFonts[0];
  const bodyFontName = bodyEntry?.[0] ?? "unknown";
  const bodyFontSize = median(bodyEntry?.[1].sizes ?? pages.flatMap((page) => page.lines.map((line) => line.fontSize)));

  const headingFonts = new Set<string>();
  for (const [key, stat] of stats) {
    if (key === bodyFontName || stat.lines.length < 2 || stat.lines.length > 90) continue;
    const size = median(stat.sizes);
    const averageLength = stat.chars / stat.lines.length;
    const terminalRatio = stat.terminal / stat.lines.length;
    let longestRun = 1;
    const byPage = Map.groupBy(stat.lines, (line) => line.page);
    for (const pageLines of byPage.values()) {
      const sorted = [...pageLines].sort((a, b) => a.y - b.y || a.x - b.x);
      let run = 1;
      for (let index = 1; index < sorted.length; index += 1) {
        const previous = sorted[index - 1];
        const current = sorted[index];
        if (
          Math.abs(current.x - previous.x) < bodyFontSize * 1.2 &&
          current.y - previous.y > 0 &&
          current.y - previous.y < Math.max(current.fontSize, previous.fontSize) * 1.7
        ) {
          run += 1;
          longestRun = Math.max(longestRun, run);
        } else {
          run = 1;
        }
      }
    }
    if (
      size >= bodyFontSize * 0.9 &&
      averageLength < 95 &&
      terminalRatio < 0.4 &&
      longestRun <= 3
    ) {
      headingFonts.add(key);
    }
  }
  return { bodyFontName, bodyFontSize, headingFonts };
}

function captionExtent(
  page: Pick<RawPage, "width" | "lines">,
  caption: TextLine,
  bodyFontSize: number,
): { bottom: number; lines: TextLine[]; text: string } {
  const continuations: TextLine[] = [caption];
  let bottom = caption.y + caption.height;
  const below = page.lines
    .filter((line) => line !== caption && line.y > caption.y)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  for (const line of below) {
    const gap = line.y - bottom;
    if (
      gap >= -bodyFontSize * 0.25 &&
      gap < bodyFontSize * 1.3 &&
      Math.abs(line.x - caption.x) < page.width * 0.12 &&
      fontKey(line) === fontKey(caption) &&
      Math.abs(line.fontSize - caption.fontSize) < Math.max(0.7, caption.fontSize * 0.065) &&
      !CAPTION_PATTERN.test(line.text) &&
      !TABLE_CAPTION_PATTERN.test(line.text)
    ) {
      continuations.push(line);
      bottom = Math.max(bottom, line.y + line.height);
      continue;
    }
    if (gap >= bodyFontSize * 1.3) break;
  }
  return {
    bottom,
    lines: continuations,
    text: continuations.reduce((value, line, index) =>
      index === 0 ? line.text : joinWrappedText(value, line.text), ""),
  };
}

function isBodyLine(line: TextLine, profile: DocumentProfile, pageWidth: number): boolean {
  return (
    fontKey(line) === profile.bodyFontName &&
    Math.abs(line.fontSize - profile.bodyFontSize) < profile.bodyFontSize * 0.22 &&
    line.text.length > 22 &&
    line.width > pageWidth * 0.16 &&
    line.width < pageWidth * 0.56
  );
}

function isLikelyArticleBodyLine(
  line: TextLine,
  profile: DocumentProfile,
  pageWidth: number,
): boolean {
  return (
    Math.abs(line.fontSize - profile.bodyFontSize) < profile.bodyFontSize * 0.24 &&
    line.text.length > 28 &&
    line.width > pageWidth * 0.22 &&
    line.width < pageWidth * 0.56
  );
}

function directionalFigureCluster(
  page: RawPage,
  caption: TextLine,
  profile: DocumentProfile,
  direction: "above" | "below",
): TextLine[] {
  const extent = captionExtent(page, caption, profile.bodyFontSize);
  const captionCenter = caption.x + caption.width / 2;
  const searchLeft = captionCenter < page.width * 0.4
    ? page.width * 0.035
    : captionCenter > page.width * 0.6
      ? page.width * 0.4
      : page.width * 0.035;
  const searchRight = captionCenter < page.width * 0.4
    ? page.width * 0.6
    : captionCenter > page.width * 0.6
      ? page.width * 0.965
      : page.width * 0.965;
  const candidates = page.lines
    .filter((line) => {
      if (extent.lines.includes(line) || !isHorizontal(line)) return false;
      const centerX = line.x + line.width / 2;
      if (centerX < searchLeft || centerX > searchRight) return false;
      return direction === "above"
        ? line.y + line.height < caption.y
        : line.y > extent.bottom;
    })
    .sort((a, b) =>
      direction === "above"
        ? b.y - a.y || a.x - b.x
        : a.y - b.y || a.x - b.x,
    );
  const maximumGap = Math.max(
    profile.bodyFontSize * 4.35,
    page.height * 0.07,
  );
  const cluster: TextLine[] = [];
  let edge = direction === "above" ? caption.y : extent.bottom;

  for (const line of candidates) {
    const gap = direction === "above"
      ? edge - (line.y + line.height)
      : line.y - edge;
    if (!cluster.length && gap > maximumGap * 1.6) return [];
    if (cluster.length && gap > maximumGap) break;
    cluster.push(line);
    edge = direction === "above"
      ? Math.min(edge, line.y)
      : Math.max(edge, line.y + line.height);
    if (
      Math.max(...cluster.map((candidate) => candidate.y + candidate.height)) -
        Math.min(...cluster.map((candidate) => candidate.y)) >
      page.height * 0.68
    ) {
      break;
    }
  }
  return cluster;
}

function figureClusterScore(lines: TextLine[], pageWidth: number): number {
  if (lines.length < 3) return 0;
  const xClusters: number[] = [];
  for (const line of [...lines].sort((a, b) => a.x - b.x)) {
    if (!xClusters.some((value) => Math.abs(value - line.x) < pageWidth * 0.035)) {
      xClusters.push(line.x);
    }
  }
  const shortRatio = lines.filter((line) => line.width < pageWidth * 0.22).length / lines.length;
  const horizontalSpread =
    (Math.max(...lines.map((line) => line.x + line.width)) -
      Math.min(...lines.map((line) => line.x))) /
    pageWidth;
  const diagramLike = xClusters.length >= 3 && shortRatio >= 0.34;
  return diagramLike
    ? lines.length + xClusters.length * 4 + shortRatio * 18 + horizontalSpread * 12
    : 0;
}

function detectFigureRegions(page: RawPage, profile: DocumentProfile): FigureRegion[] {
  const bodyLines = page.lines.filter((line) => isBodyLine(line, profile, page.width));
  return page.lines
    .filter((line) => CAPTION_PATTERN.test(line.text))
    .map((caption) => {
      const extent = captionExtent(page, caption, profile.bodyFontSize);
      const aboveCluster = directionalFigureCluster(page, caption, profile, "above");
      const belowCluster = directionalFigureCluster(page, caption, profile, "below");
      const aboveScore = figureClusterScore(aboveCluster, page.width);
      const belowScore = figureClusterScore(belowCluster, page.width);
      const previousBody = bodyLines
        .filter((line) => line.y + line.height < caption.y - profile.bodyFontSize * 0.4)
        .sort((a, b) => b.y - a.y)[0];
      const nextBody = bodyLines
        .filter((line) => line.y > extent.bottom + profile.bodyFontSize * 0.4)
        .sort((a, b) => a.y - b.y)[0];
      const priorBoundary = previousBody
        ? previousBody.y + previousBody.height
        : page.height * 0.075;
      const nextBoundary = nextBody?.y ?? page.height * 0.94;
      const beforeSpace = caption.y - priorBoundary;
      const afterSpace = nextBoundary - extent.bottom;
      const figureIsAbove = aboveScore || belowScore
        ? aboveScore >= belowScore
        : caption.y > page.height * 0.72 || beforeSpace > afterSpace * 1.15;
      const padding = profile.bodyFontSize * 0.65;
      const selectedCluster = figureIsAbove ? aboveCluster : belowCluster;
      const selectedScore = figureIsAbove ? aboveScore : belowScore;
      let top = figureIsAbove
        ? Math.max(page.height * 0.07, priorBoundary + padding)
        : extent.bottom + padding;
      let bottom = figureIsAbove
        ? caption.y - padding
        : Math.min(page.height * 0.95, nextBoundary - padding);
      if (selectedScore && selectedCluster.length) {
        const clusterTop = Math.max(
          page.height * 0.07,
          Math.min(...selectedCluster.map((line) => line.y)) - padding * 0.7,
        );
        const clusterBottom = Math.min(
          page.height * 0.95,
          Math.max(...selectedCluster.map((line) => line.y + line.height)) + padding * 0.45,
        );
        const boundedClusterTop = figureIsAbove
          ? clusterTop
          : Math.max(clusterTop, extent.bottom + padding * 0.25);
        const boundedClusterBottom = figureIsAbove
          ? Math.min(clusterBottom, caption.y - padding * 0.25)
          : clusterBottom;
        const clusterBodyLines = page.lines.filter((line) => {
          const centerY = line.y + line.height / 2;
          return centerY > boundedClusterTop && centerY < boundedClusterBottom &&
            isLikelyArticleBodyLine(line, profile, page.width);
        });
        const captionCenter = caption.x + caption.width / 2;
        const hasOppositeBodyColumn = captionCenter < page.width * 0.48
          ? clusterBodyLines.filter((line) => line.x > page.width * 0.54).length >= 3
          : captionCenter > page.width * 0.52
            ? clusterBodyLines.filter(
                (line) => line.x + line.width < page.width * 0.46,
              ).length >= 3
            : false;
        if (bottom - top < page.height * 0.055 || hasOppositeBodyColumn) {
          top = boundedClusterTop;
          bottom = boundedClusterBottom;
        }
      }
      if (bottom - top < page.height * 0.035) {
        if (figureIsAbove) top = Math.max(page.height * 0.07, caption.y - page.height * 0.16);
        else bottom = Math.min(page.height * 0.95, extent.bottom + page.height * 0.16);
      }

      let left = page.width * 0.055;
      let right = page.width * 0.945;
      const verticalBodyLines = page.lines.filter((line) => {
        const centerY = line.y + line.height / 2;
        return centerY > top && centerY < bottom &&
          isLikelyArticleBodyLine(line, profile, page.width);
      });
      const captionCenter = caption.x + caption.width / 2;
      if (captionCenter < page.width * 0.48) {
        const opposite = verticalBodyLines.filter((line) => line.x > page.width * 0.54);
        if (opposite.length >= 3) {
          right = Math.min(right, Math.min(...opposite.map((line) => line.x)) - padding);
        }
      } else if (captionCenter > page.width * 0.52) {
        const opposite = verticalBodyLines.filter(
          (line) => line.x + line.width < page.width * 0.46,
        );
        if (opposite.length >= 3) {
          left = Math.max(
            left,
            Math.max(...opposite.map((line) => line.x + line.width)) + padding,
          );
        }
      }
      return { caption, captionBottom: extent.bottom, left, right, top, bottom };
    });
}

function detectTableRegions(page: RawPage, profile: DocumentProfile): TableRegion[] {
  return page.lines
    .filter((line) => TABLE_CAPTION_PATTERN.test(line.text))
    .map((caption) => {
      const extent = captionExtent(page, caption, profile.bodyFontSize);
      const candidates = page.lines
        .filter(
          (line) =>
            line.y > extent.bottom - profile.bodyFontSize * 0.2 &&
            line.y < page.height * 0.96 &&
            !extent.lines.includes(line),
        )
        .sort((a, b) => a.y - b.y || a.x - b.x);
      const rows: TextLine[][] = [];
      for (const line of candidates) {
        const current = rows.at(-1);
        if (!current || Math.abs(current[0].y - line.y) > profile.bodyFontSize * 0.42) {
          rows.push([line]);
        } else {
          current.push(line);
        }
      }
      const selected: TextLine[][] = [];
      let previousBottom = extent.bottom;
      for (const row of rows) {
        if (
          selected.length >= 2 &&
          row[0].y - previousBottom > profile.bodyFontSize * 2.35
        ) {
          break;
        }
        if (row.some((line) => CAPTION_PATTERN.test(line.text) || TABLE_CAPTION_PATTERN.test(line.text))) {
          break;
        }
        selected.push(row);
        previousBottom = Math.max(...row.map((line) => line.y + line.height));
      }
      const lines = selected.flat();
      return {
        caption,
        captionBottom: extent.bottom,
        top: extent.bottom,
        bottom: lines.length
          ? Math.max(...lines.map((line) => line.y + line.height))
          : extent.bottom,
        lines,
      };
    })
    .filter((region) => region.lines.length >= 2);
}

function tableFragments(lines: TextLine[]): TextLine[] {
  return lines.flatMap((line) => {
    if (!line.parts?.length) return [line];
    const fragments: TextLine[] = [];
    let sourceX = line.parts[0].x;
    let right = line.parts[0].x;
    for (const part of [...line.parts].sort((a, b) => a.x - b.x)) {
      if (part.x - right > Math.max(2.5, line.fontSize * 0.22)) {
        sourceX = part.x;
      }
      fragments.push({
        ...line,
        text: part.text,
        x: part.x,
        width: part.width,
        fontSize: part.fontSize,
        scriptBaseline: part.y + part.fontSize,
        sourceX,
        parts: undefined,
      });
      right = Math.max(right, part.x + part.width);
    }
    return fragments;
  });
}

function clusterTableColumns(lines: TextLine[], pageWidth: number): number[] {
  const clusters: Array<{ values: number[]; center: number; rowBands: Set<number> }> = [];
  const tolerance = pageWidth * 0.022;
  for (const line of tableFragments(lines).sort((a, b) => a.x - b.x)) {
    const startX = line.sourceX ?? line.x;
    const cluster = clusters.find((candidate) => Math.abs(candidate.center - startX) < tolerance);
    const rowBand = Math.round(line.y / Math.max(4, pageWidth * 0.008));
    if (cluster) {
      cluster.values.push(startX);
      cluster.rowBands.add(rowBand);
      cluster.center = median(cluster.values);
    } else {
      clusters.push({ values: [startX], center: startX, rowBands: new Set([rowBand]) });
    }
  }
  const ranked = clusters
    .filter((cluster) => cluster.rowBands.size >= 2)
    .sort((a, b) => b.rowBands.size - a.rowBands.size)
    .slice(0, 8)
    .sort((a, b) => a.center - b.center);
  const starts: number[] = [];
  for (const cluster of ranked) {
    if (!starts.length || cluster.center - starts.at(-1)! > pageWidth * 0.07) {
      starts.push(Math.min(...cluster.values));
    }
  }
  return starts.length >= 2 ? starts : [];
}

function horizontalTableRules(page: RawPage, region: TableRegion): number[] {
  if (typeof page.canvas?.getContext !== "function") return [];
  const context = page.canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [];
  const scaleX = page.canvas.width / page.width;
  const scaleY = page.canvas.height / page.height;
  const xMin = Math.max(0, Math.floor(Math.min(...region.lines.map((line) => line.x)) * scaleX));
  const xMax = Math.min(
    page.canvas.width,
    Math.ceil(Math.max(...region.lines.map((line) => line.x + line.width)) * scaleX),
  );
  const yMin = Math.max(0, Math.floor(region.top * scaleY));
  const yMax = Math.min(page.canvas.height, Math.ceil(region.bottom * scaleY));
  if (xMax - xMin < 100 || yMax - yMin < 20) return [];
  const pixels = context.getImageData(xMin, yMin, xMax - xMin, yMax - yMin);
  const width = pixels.width;
  const darkRows: number[] = [];
  for (let y = 0; y < pixels.height; y += 1) {
    let dark = 0;
    for (let x = 0; x < width; x += 2) {
      const offset = (y * width + x) * 4;
      const luminance =
        pixels.data[offset] * 0.2126 +
        pixels.data[offset + 1] * 0.7152 +
        pixels.data[offset + 2] * 0.0722;
      if (luminance < 125) dark += 1;
    }
    if (dark > width * 0.18) darkRows.push(y);
  }
  const groups: number[][] = [];
  for (const value of darkRows) {
    const current = groups.at(-1);
    if (!current || value - current.at(-1)! > 1) groups.push([value]);
    else current.push(value);
  }
  return groups.map((group) => (yMin + median(group)) / scaleY);
}

function geometricTableMarkdown(
  page: RawPage,
  region: TableRegion,
  caption: string,
  bodyFontSize: number,
): string {
  const starts = clusterTableColumns(region.lines, page.width);
  if (starts.length < 2) {
    return `${mediaTitleMarkdown(caption)}\n\n${region.lines.map((line) => line.text).join(" ")}`;
  }
  const rules = horizontalTableRules(page, region)
    .filter((value) => value > region.top && value < region.bottom)
    .sort((a, b) => a - b);
  const boundaries = [region.top, ...rules, region.bottom]
    .filter((value, index, values) => index === 0 || value - values[index - 1] > bodyFontSize * 0.35);
  const rowGroups: TextLine[][] = [];
  if (boundaries.length >= 3) {
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const group = region.lines.filter((line) => {
        const center = line.y + line.height / 2;
        return center >= boundaries[index] && center < boundaries[index + 1];
      });
      if (group.length) rowGroups.push(group);
    }
  } else {
    for (const line of [...region.lines].sort((a, b) => a.y - b.y || a.x - b.x)) {
      const current = rowGroups.at(-1);
      if (!current || Math.abs(current[0].y - line.y) > bodyFontSize * 0.45) {
        rowGroups.push([line]);
      } else {
        current.push(line);
      }
    }
  }

  const rows = rowGroups.map((group) => {
    const cells = Array(starts.length).fill("") as string[];
    const cellRight = Array(starts.length).fill(-Infinity) as number[];
    const fragments = tableFragments(group);
    for (const line of [...fragments].sort((a, b) => a.y - b.y || a.x - b.x)) {
      let column = 0;
      for (let index = 1; index < starts.length; index += 1) {
        if ((line.sourceX ?? line.x) >= (starts[index - 1] + starts[index]) / 2) column = index;
      }
      const touchesPrevious = line.x - cellRight[column] < bodyFontSize * 0.12;
      const fragmentText = scriptedTableFragment(line, fragments, bodyFontSize);
      cells[column] = cells[column]
        ? touchesPrevious
          ? `${cells[column]}${fragmentText}`
          : joinWrappedText(cells[column], fragmentText)
        : fragmentText;
      cellRight[column] = Math.max(cellRight[column], line.x + line.width);
    }
    return cells.map(escapedTableCell);
  }).filter((row) => row.some(Boolean));
  if (!rows.length) return mediaTitleMarkdown(caption);
  return [
    mediaTitleMarkdown(caption),
    "",
    `| ${rows[0].join(" | ")} |`,
    `| ${rows[0].map(() => "---").join(" | ")} |`,
    ...rows.slice(1).map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

const SUPERSCRIPT_CHARACTERS: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "+": "⁺",
  "-": "⁻",
  "=": "⁼",
  "(": "⁽",
  ")": "⁾",
};

const SUBSCRIPT_CHARACTERS: Record<string, string> = {
  "0": "₀",
  "1": "₁",
  "2": "₂",
  "3": "₃",
  "4": "₄",
  "5": "₅",
  "6": "₆",
  "7": "₇",
  "8": "₈",
  "9": "₉",
  "+": "₊",
  "-": "₋",
  "=": "₌",
  "(": "₍",
  ")": "₎",
};

function scriptCharacters(
  text: string,
  characters: Record<string, string>,
  tag: "sup" | "sub",
): string {
  const clean = text.trim();
  const converted = [...clean].map((character) => characters[character] ?? "").join("");
  const suffix = /\s$/.test(text) ? " " : "";
  return (converted.length === clean.length
    ? converted
    : `<${tag}>${clean.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</${tag}>`) + suffix;
}

function scriptedTableFragment(
  line: TextLine,
  group: TextLine[],
  bodyFontSize: number,
): string {
  if (line.fontSize >= bodyFontSize * 0.76 || line.text.trim().length > 8) {
    return line.text;
  }
  const baseline = line.scriptBaseline ?? line.y + line.fontSize;
  const peerBaselines = group
    .filter(
      (candidate) =>
        candidate !== line &&
        candidate.fontSize > line.fontSize * 1.25 &&
        Math.abs(candidate.y - line.y) < bodyFontSize * 0.9,
    )
    .map((candidate) => candidate.scriptBaseline ?? candidate.y + candidate.fontSize);
  if (!peerBaselines.length) return line.text;
  const peerBaseline = median(peerBaselines);
  if (baseline < peerBaseline - bodyFontSize * 0.12) {
    return scriptCharacters(line.text, SUPERSCRIPT_CHARACTERS, "sup");
  }
  if (baseline > peerBaseline + bodyFontSize * 0.12) {
    return scriptCharacters(line.text, SUBSCRIPT_CHARACTERS, "sub");
  }
  return line.text;
}

function escapedTableCell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

function recommendationTableMarkdown(
  caption: string,
  lines: TextLine[],
): string | null {
  const rows: Array<{ number: string; text: string }> = [];
  for (const line of lines) {
    const match = line.text.match(TABLE_RECOMMENDATION_PATTERN);
    if (match) {
      rows.push({
        number: match[1],
        text: line.text.replace(TABLE_RECOMMENDATION_PATTERN, "").trim(),
      });
    } else if (rows.length) {
      const current = rows.at(-1)!;
      current.text = joinWrappedText(current.text, line.text);
    }
  }
  if (rows.length < 2) return null;
  return [
    mediaTitleMarkdown(caption),
    "",
    "| No. | Recommendation |",
    "| ---: | --- |",
    ...rows.map(
      (row) => `| ${row.number} | ${escapedTableCell(row.text)} |`,
    ),
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
    [/≠/g, "\\ne "],
    [/≈/g, "\\approx "],
    [/∞/g, "\\infty "],
    [/×/g, "\\times "],
    [/÷/g, "\\div "],
    [/→/g, "\\to "],
    [/↔/g, "\\leftrightarrow "],
    [/α/g, "\\alpha "],
    [/β/g, "\\beta "],
    [/γ/g, "\\gamma "],
    [/δ/g, "\\delta "],
    [/ε/g, "\\epsilon "],
    [/η/g, "\\eta "],
    [/θ/g, "\\theta "],
    [/κ/g, "\\kappa "],
    [/λ/g, "\\lambda "],
    [/μ/g, "\\mu "],
    [/ν/g, "\\nu "],
    [/π/g, "\\pi "],
    [/ρ/g, "\\rho "],
    [/σ/g, "\\sigma "],
    [/τ/g, "\\tau "],
    [/φ/g, "\\phi "],
    [/χ/g, "\\chi "],
    [/ω/g, "\\omega "],
    [/²/g, "^{2}"],
    [/³/g, "^{3}"],
    [/¹/g, "^{1}"],
    [/₀/g, "_{0}"],
    [/₁/g, "_{1}"],
    [/₂/g, "_{2}"],
    [/₃/g, "_{3}"],
    [/₄/g, "_{4}"],
    [/₅/g, "_{5}"],
    [/₆/g, "_{6}"],
    [/₇/g, "_{7}"],
    [/₈/g, "_{8}"],
    [/₉/g, "_{9}"],
  ];
  return replacements.reduce(
    (value, [pattern, replacement]) => value.replace(pattern, replacement),
    text,
  ).replace(/\s+/g, " ").trim();
}

function formulaToLatex(line: TextLine): string {
  const parts = line.parts?.length
    ? [...line.parts].sort((a, b) => a.x - b.x)
    : null;
  if (!parts) return unicodeMathToLatex(line.text);
  const largestSize = Math.max(...parts.map((part) => part.fontSize));
  const baseParts = parts.filter((part) => part.fontSize >= largestSize * 0.84);
  const baseBaseline = median(baseParts.map((part) => part.y + part.fontSize));
  let markdown = "";
  let right = parts[0].x;
  for (const part of parts) {
    const baseline = part.y + part.fontSize;
    const isSmall = part.fontSize < largestSize * 0.82;
    const converted = unicodeMathToLatex(part.text);
    const gap = part.x - right;
    if (isSmall && baseline < baseBaseline - largestSize * 0.12) {
      markdown += `^{${converted}}`;
    } else if (isSmall && baseline > baseBaseline + largestSize * 0.12) {
      markdown += `_{${converted}}`;
    } else {
      if (markdown && gap > largestSize * 0.18) markdown += " ";
      markdown += converted;
    }
    right = Math.max(right, part.x + part.width);
  }
  return markdown.replace(/\s+/g, " ").trim();
}

function classifyLine(
  line: TextLine,
  profile: DocumentProfile,
  isNearBottom: boolean,
  isTitle: boolean,
): BlockKind {
  const text = line.text.trim();
  const mathMatches = text.match(MATH_SYMBOL_PATTERN)?.length ?? 0;
  if (CAPTION_PATTERN.test(text)) return "figure";
  if (TABLE_CAPTION_PATTERN.test(text)) return "table";
  if (LIST_PATTERN.test(text)) return "list";
  const proseWords = text.match(/\b[A-Za-z]{3,}\b/g)?.length ?? 0;
  if (
    text.length < 180 &&
    STRONG_FORMULA_PATTERN.test(text) &&
    (mathMatches >= 2 || proseWords <= 5) &&
    !/(?:https?:\/\/|\bdoi\b)/i.test(text)
  ) {
    return "equation";
  }
  if (
    isNearBottom &&
    line.fontSize < profile.bodyFontSize * 0.86 &&
    /^(?:\d+|[*†‡])\s*/.test(text)
  ) {
    return "footnote";
  }
  if (
    isTitle ||
    (profile.headingFonts.has(fontKey(line)) &&
      line.fontSize >= profile.bodyFontSize * 0.86 &&
      text.length < 180 &&
      text.split(/\s+/).length < 26 &&
      !TERMINAL_PUNCTUATION.test(text)) ||
    REFERENCE_PATTERN.test(text) ||
    (line.fontSize >= profile.bodyFontSize * 0.95 &&
      text.length < 90 &&
      /^[A-Z\d][A-Z\d\s,:/&()-]+$/.test(text) &&
      (text.length >= 7 || text.split(/\s+/).length >= 2) &&
      text.split(/\s+/).length < 12)
  ) {
    return "heading";
  }
  return "paragraph";
}

function headingMarkdown(
  text: string,
  fontSize: number,
  bodyFontSize: number,
  isTitle: boolean,
) {
  const level = isTitle
    ? "#"
    : fontSize > bodyFontSize * 1.18 || /^A\s+B\s+S\s+T\s+R\s+A\s+C\s+T$/i.test(text)
      ? "##"
      : "###";
  return `${level} ${text}`;
}

function columnBaselineX(
  lines: TextLine[],
  line: TextLine,
  pageWidth: number,
): number {
  const starts = columnStarts(lines, pageWidth);
  return starts[nearestColumnIndex(line, starts)] ?? line.x;
}

function mergeInterruptedMedia(blocks: DocumentBlock[]): DocumentBlock[] {
  const result: DocumentBlock[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const before = blocks[index];
    let cursor = index + 1;
    const media: DocumentBlock[] = [];
    while (cursor < blocks.length) {
      const candidate = blocks[cursor];
      if (candidate.kind === "figure" || candidate.kind === "table") {
        media.push(candidate);
        cursor += 1;
        continue;
      }
      if (
        media.length &&
        candidate.kind === "paragraph" &&
        /^Note\b/i.test(candidate.markdown.trim())
      ) {
        media.push(candidate);
        cursor += 1;
        continue;
      }
      break;
    }
    const after = blocks[cursor];
    if (
      before?.kind === "paragraph" &&
      media.some((block) => block.kind === "figure" || block.kind === "table") &&
      after?.kind === "paragraph" &&
      !TERMINAL_PUNCTUATION.test(before.markdown.trim()) &&
      /^[a-z]/.test(after.markdown.trim())
    ) {
      result.push({
        ...before,
        markdown: joinWrappedText(before.markdown, after.markdown),
        confidence: Math.min(before.confidence, after.confidence),
      });
      result.push(...media);
      index = cursor;
      continue;
    }
    result.push(before);
  }
  return result;
}

export function linesToBlocks(pages: RawPage[]): DocumentBlock[] {
  const profile = buildDocumentProfile(pages);
  const bodyFontSize = profile.bodyFontSize;
  const blocks: DocumentBlock[] = [];
  const annotationBlocks: DocumentBlock[] = [];
  let footnoteNumber = 1;
  let inReferences = false;
  let lastReferenceNumber = 0;
  const firstPage = pages[0];
  const titleCandidate = firstPage?.lines
    .filter(
      (line) =>
        isHorizontal(line) &&
        line.y < firstPage.height * 0.3 &&
        line.x < firstPage.width * 0.42 &&
        line.width > firstPage.width * 0.25 &&
        line.text.length > 12,
    )
    .sort((a, b) => b.fontSize - a.fontSize || a.y - b.y)[0];

  for (const page of pages) {
    const figureRegions = detectFigureRegions(page, profile);
    const tableRegions = detectTableRegions(page, profile);
    const lines = orderLines(
      page.lines.filter((line) => {
        const insideFigure = figureRegions.some(
          (region) =>
            line !== region.caption &&
            line.x + line.width / 2 > region.left &&
            line.x + line.width / 2 < region.right &&
            line.y + line.height / 2 > region.top &&
            line.y + line.height / 2 < region.bottom,
        );
        const insideTable = tableRegions.some((region) => region.lines.includes(line));
        const tableCaptionContinuation = tableRegions.some(
          (region) =>
            line !== region.caption &&
            line.y > region.caption.y &&
            line.y + line.height <= region.captionBottom + bodyFontSize * 0.2 &&
            Math.abs(line.x - region.caption.x) < page.width * 0.12,
        );
        const figureCaptionContinuation = figureRegions.some(
          (region) =>
            line !== region.caption &&
            line.y > region.caption.y &&
            line.y + line.height <= region.captionBottom + bodyFontSize * 0.2 &&
            Math.abs(line.x - region.caption.x) < page.width * 0.12,
        );
        return !insideFigure && !insideTable && !tableCaptionContinuation &&
          !figureCaptionContinuation;
      }),
      page.width,
      page.height,
    );
    const starts = columnStarts(lines, page.width);

    const looksLikeReferenceStart = (index: number): boolean => {
      const match = lines[index]?.text.match(REFERENCE_ENTRY_PATTERN);
      if (
        !match ||
        Number(match[1]) !== 1 ||
        page.page < Math.ceil(pages.length * 0.55) ||
        lines[index].fontSize > bodyFontSize * 0.96
      ) {
        return false;
      }
      const lookahead = lines.slice(index, index + 45);
      const hasSecondEntry = lookahead.some((line) =>
        Number(line.text.match(REFERENCE_ENTRY_PATTERN)?.[1]) === 2,
      );
      const citationText = lookahead.map((line) => line.text).join(" ");
      return hasSecondEntry && /(?:\bet al\b|\bdoi\b|https?:\/\/|\b20\d{2}\b)/i.test(citationText);
    };

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const text = line.text.trim();

      const explicitReferenceHeading = REFERENCE_PATTERN.test(text);
      const automaticReferenceStart = !inReferences && looksLikeReferenceStart(index);
      if (explicitReferenceHeading && inReferences) continue;
      if (explicitReferenceHeading || automaticReferenceStart) {
        const automaticStart = !explicitReferenceHeading;
        inReferences = true;
        lastReferenceNumber = 0;
        blocks.push({
          id: crypto.randomUUID(),
          kind: "heading",
          markdown: "## REFERENCES",
          page: page.page,
          confidence: page.usedOcr ? 0.69 : 0.96,
        });
        if (!automaticStart) continue;
      }

      if (inReferences) {
        const entry = text.match(REFERENCE_CONTINUATION_ENTRY_PATTERN);
        const entryNumber = Number(entry?.[1] ?? 0);
        if (entry && entryNumber === lastReferenceNumber + 1) {
          lastReferenceNumber = entryNumber;
          blocks.push({
            id: crypto.randomUUID(),
            kind: "list",
            markdown: `${entry[1]}. ${text.replace(REFERENCE_CONTINUATION_ENTRY_PATTERN, "").trim()}`,
            page: page.page,
            confidence: page.usedOcr ? 0.67 : 0.92,
          });
          continue;
        }
        const stopsReferences = /^(?:supplementary information|appendix|acknowledg(?:e)?ments?|author contributions?|funding|conflicts? of interest)\b/i.test(text);
        if (!stopsReferences) {
          const previous = blocks.at(-1);
          if (previous?.kind === "list") {
            previous.markdown = joinWrappedText(previous.markdown, text);
            previous.confidence = Math.min(
              previous.confidence,
              page.usedOcr ? 0.67 : 0.92,
            );
          }
          continue;
        }
        inReferences = false;
        lastReferenceNumber = 0;
      }

      if (CAPTION_PATTERN.test(text)) {
        const caption = captionExtent(page, line, bodyFontSize).text;
        blocks.push({
          id: crypto.randomUUID(),
          kind: "figure",
          markdown: mediaTitleMarkdown(caption),
          page: page.page,
          confidence: page.usedOcr ? 0.62 : 0.86,
        });
        continue;
      }

      if (TABLE_CAPTION_PATTERN.test(text)) {
        const region = tableRegions.find((candidate) => candidate.caption === line);
        const caption = captionExtent(page, line, bodyFontSize).text;
        const structured = recommendationTableMarkdown(
          caption,
          region?.lines ?? [],
        );
        blocks.push({
          id: crypto.randomUUID(),
          kind: "table",
          markdown: structured ?? (region
            ? geometricTableMarkdown(page, region, caption, bodyFontSize)
            : mediaTitleMarkdown(caption)),
          page: page.page,
          confidence: page.usedOcr ? 0.62 : 0.86,
        });
        continue;
      }

      const isTitle = line === titleCandidate;
      const kind = classifyLine(
        line,
        profile,
        line.y > page.height * 0.8,
        isTitle,
      );
      let markdown = text;
      if (kind === "heading") {
        markdown = headingMarkdown(markdown, line.fontSize, bodyFontSize, isTitle);
      } else if (kind === "equation") {
        markdown = `$$\n${formulaToLatex(line)}\n$$`;
      } else if (kind === "footnote") {
        markdown = `[^${footnoteNumber}]: ${markdown.replace(/^(?:\d+|[*†‡])\s*/, "")}`;
        footnoteNumber += 1;
      } else if (kind === "list") {
        const ordered = markdown.match(ORDERED_LIST_PATTERN);
        markdown = ordered
          ? `${ordered[1] ?? ordered[2]}. ${markdown.replace(ORDERED_LIST_PATTERN, "")}`
          : markdown.replace(LIST_PATTERN, "- ");
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
      const isNearbyContinuation =
        previous?.page === page.page &&
        verticalGap >= -bodyFontSize * 0.15 &&
        verticalGap < Math.max(
          bodyFontSize * 1.2,
          Math.max(line.fontSize, previousLine?.fontSize ?? 0) * 1.4,
        );
      const sameColumn =
        previousLine &&
        nearestColumnIndex(previousLine, starts) === nearestColumnIndex(line, starts);
      const baselineX = columnBaselineX(
        lines,
        line,
        page.width,
      );
      const startsIndentedParagraph =
        Boolean(sameColumn) &&
        verticalGap > 0 &&
        line.x - baselineX > bodyFontSize * 0.65 &&
        previousLine.x - baselineX < bodyFontSize * 0.4;

      const canContinueEquation =
        previous?.kind === "equation" &&
        kind === "equation" &&
        previous.page === page.page &&
        verticalGap >= -bodyFontSize * 0.2 &&
        verticalGap < bodyFontSize * 2.4;
      if (canContinueEquation && previous) {
        const continuation = markdown.replace(/^\$\$\n?|\n?\$\$$/g, "").trim();
        previous.markdown = previous.markdown.replace(/\n?\$\$$/, ` \\\\\n${continuation}\n$$`);
        previous.confidence = Math.min(
          previous.confidence,
          page.usedOcr ? 0.64 : 0.84,
        );
        continue;
      }

      const canContinueCaption =
        previous?.kind === "figure" &&
        kind === "paragraph" &&
        isNearbyContinuation &&
        !startsIndentedParagraph;
      if (canContinueCaption && previous) {
        previous.markdown = joinWrappedText(previous.markdown, markdown);
        continue;
      }

      const canContinueWrappedHeading =
        previous?.kind === "heading" &&
        kind === "heading" &&
        previous.page === page.page &&
        verticalGap >= -bodyFontSize * 0.15 &&
        verticalGap < bodyFontSize * 3 &&
        (WRAPPED_HEADING_END_PATTERN.test(previous.markdown.trim()) ||
          /^[a-z]/.test(markdown.replace(/^#+\s*/, "")) ||
          (previous.markdown.startsWith("# ") && fontKey(previousLine) === fontKey(line)));
      if (canContinueWrappedHeading && previous) {
        const continuation = markdown.replace(/^#+\s*/, "");
        previous.markdown = previous.markdown.endsWith("-")
          ? `${previous.markdown}${continuation}`
          : `${previous.markdown} ${continuation}`;
        continue;
      }

      const canMerge =
        previous?.kind === "paragraph" &&
        kind === "paragraph" &&
        isNearbyContinuation &&
        !startsIndentedParagraph;
      if (canMerge && previous) {
        previous.markdown = joinWrappedText(previous.markdown, markdown);
        continue;
      }
      const canContinueAcrossColumn =
        previous?.kind === "paragraph" &&
        kind === "paragraph" &&
        previous.page === page.page &&
        previousLine &&
        line.x > previousLine.x + page.width * 0.18 &&
        line.y < previousLine.y - bodyFontSize * 0.45 &&
        !TERMINAL_PUNCTUATION.test(previousLine.text.trim()) &&
        /^[a-z]/.test(line.text.trim());
      if (canContinueAcrossColumn && previous) {
        previous.markdown = joinWrappedText(previous.markdown, markdown);
        continue;
      }
      const canContinueList =
        previous?.kind === "list" &&
        kind === "paragraph" &&
        ((isNearbyContinuation &&
          previousLine &&
          line.x >= previousLine.x - bodyFontSize * 0.5) ||
          (previous.page !== page.page && /^[a-z]/.test(line.text.trim())));
      if (canContinueList && previous) {
        previous.markdown = joinWrappedText(previous.markdown, markdown);
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
      if (!annotation.text.trim()) continue;
      if (!blocks.some((block) => block.markdown.includes(annotation.url))) {
        annotationBlocks.push({
          id: crypto.randomUUID(),
          kind: "paragraph",
          markdown: `[${annotation.text || annotation.url}](${annotation.url})`,
          page: page.page,
          confidence: 0.95,
        });
      }
    }
  }
  return [
    ...mergeInterruptedMedia(mergeFlowingParagraphs(blocks)),
    ...annotationBlocks,
  ];
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

export function figureCropBounds(
  page: Pick<RawPage, "width" | "height" | "lines" | "canvas">,
  caption: TextLine,
  suppliedProfile?: DocumentProfile,
): { x: number; y: number; width: number; height: number } | null {
  const profile = suppliedProfile ?? buildDocumentProfile([{
    ...page,
    page: caption.page,
    annotations: [],
    usedOcr: false,
  } as RawPage]);
  const region = detectFigureRegions(page as RawPage, profile).find(
    (candidate) => candidate.caption === caption,
  );
  if (!region) return null;
  const scaleX = page.canvas.width / page.width;
  const scaleY = page.canvas.height / page.height;
  const x = Math.max(0, Math.floor(region.left * scaleX));
  const y = Math.max(0, Math.ceil(region.top * scaleY));
  const right = Math.min(page.canvas.width, Math.ceil(region.right * scaleX));
  const bottom = Math.min(page.canvas.height, Math.floor(region.bottom * scaleY));
  const width = right - x;
  const height = bottom - y;
  if (width < 100 || height < 40) return null;
  return { x, y, width, height };
}

async function extractFigures(
  pages: RawPage[],
  onProgress: ProgressHandler,
  signal?: AbortSignal,
): Promise<ExtractedImage[]> {
  const images: ExtractedImage[] = [];
  let figureNumber = 1;
  const profile = buildDocumentProfile(pages);

  for (const page of pages) {
    throwIfAborted(signal);
    const captions = page.lines.filter((line) => CAPTION_PATTERN.test(line.text));
    for (const caption of captions) {
      const bounds = figureCropBounds(page, caption, profile);
      if (!bounds) continue;
      const crop = document.createElement("canvas");
      crop.width = bounds.width;
      crop.height = bounds.height;
      const context = crop.getContext("2d");
      if (!context) continue;
      context.drawImage(
        page.canvas,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        0,
        0,
        bounds.width,
        bounds.height,
      );
      const blob = await canvasToBlob(crop);
      const filename = `images/figure-${String(figureNumber).padStart(3, "0")}.png`;
      images.push({
        filename,
        blob,
        url: URL.createObjectURL(blob),
        caption: captionExtent(page, caption, profile.bodyFontSize).text,
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
  return blocks.map((block) => {
    if (block.kind !== "figure") return block;
    const plainTitle = plainMediaTitle(block.markdown);
    const normalizedBlock = normalizeRepeatedLine(plainTitle);
    const image = images.find(
      (candidate) =>
        candidate.page === block.page &&
        normalizedBlock.startsWith(normalizeRepeatedLine(candidate.caption)),
    );
    if (!image) return block;
    const alt = plainTitle.replace(CAPTION_PATTERN, "").trim() || "Figure";
    return {
      ...block,
      markdown: `![${alt}](${image.filename})\n\n${block.markdown}`,
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
          text:
            annotationText(annotation.titleObj) ||
            annotationText(annotation.contentsObj),
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
