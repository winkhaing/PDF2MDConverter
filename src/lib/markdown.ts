import type { DocumentBlock } from "./types";

const TERMINAL_PUNCTUATION = /[.!?]["')\]]?$/;
const LOWERCASE_START = /^[a-z]/;
const SOFT_SENTENCE_END = /(?:[,;:–—-]|\b(?:and|as|at|because|between|but|by|for|from|in|including|of|on|or|that|than|the|to|which|while|with))\s*["')\]]?$/i;

export interface MarkdownFlowIssue {
  before: number;
  after: number;
  reason: "open-sentence" | "interrupted-sentence";
  score: number;
}

export interface MarkdownFlowAudit {
  issues: MarkdownFlowIssue[];
  score: number;
}

const SUPPORTED_INLINE_TAGS = [
  "<u>",
  "</u>",
  "<em>",
  "</em>",
  "<sup>",
  "</sup>",
  "<sub>",
  "</sub>",
];

function stripSupportedInlineMarkup(markdown: string): string {
  let plain = "";
  for (let index = 0; index < markdown.length; index += 1) {
    const remainder = markdown.slice(index).toLowerCase();
    const supportedTag = SUPPORTED_INLINE_TAGS.find((tag) =>
      remainder.startsWith(tag),
    );
    if (supportedTag) {
      plain += " ";
      index += supportedTag.length - 1;
      continue;
    }
    plain += markdown[index];
  }
  return plain;
}

function plainMarkdownText(markdown: string): string {
  return stripSupportedInlineMarkup(markdown)
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[#>*+-]+\s*/gm, "")
    .replace(/\\([\[\]`*_\\])/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function markdownChunkKind(chunk: string): "prose" | "media" | "boundary" {
  const clean = chunk.trim();
  const plain = plainMarkdownText(clean);
  if (
    /^!\[[^\]]*\]\([^)]*\)/.test(clean) ||
    /^<u><em>(?:figure|fig\.?|table)\b/i.test(clean) ||
    /^\|.*\|/m.test(clean)
  ) {
    return "media";
  }
  if (
    /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\$\$|\[\^\d+\]:)/m.test(clean) ||
    /^(?:accepted|copyright|corresponding author|doi\b|https?:\/\/|published online|received|www\.)/i.test(plain)
  ) {
    return "boundary";
  }
  return plain ? "prose" : "boundary";
}

export function paragraphContinuationStrength(
  leftMarkdown: string,
  rightMarkdown: string,
): number {
  const left = plainMarkdownText(leftMarkdown);
  const right = plainMarkdownText(rightMarkdown);
  if (!left || !right) return 0;

  const terminal = TERMINAL_PUNCTUATION.test(left);
  const lowercaseStart = LOWERCASE_START.test(right);
  const leftWords = left.split(/\s+/).length;
  const rightWords = right.split(/\s+/).length;
  let score = terminal ? -3 : 2;
  if (lowercaseStart) score += 3;
  if (!terminal && SOFT_SENTENCE_END.test(left)) score += 3;
  if (!terminal && leftWords <= 8) score += 1;
  if (!terminal && rightWords <= 8) score += 1;
  return Math.max(0, score);
}

export function inspectMarkdownFlow(markdown: string): MarkdownFlowAudit {
  const chunks = markdown
    .trim()
    .split(/\n{2,}/)
    .map((value, index) => ({ value: value.trim(), index }))
    .filter((chunk) => chunk.value);
  const issues: MarkdownFlowIssue[] = [];
  let previousProse: { value: string; index: number } | null = null;
  let crossedMedia = false;

  for (const chunk of chunks) {
    const kind = markdownChunkKind(chunk.value);
    if (kind === "media") {
      if (previousProse) crossedMedia = true;
      continue;
    }
    if (kind === "boundary") {
      previousProse = null;
      crossedMedia = false;
      continue;
    }
    if (previousProse) {
      const score = paragraphContinuationStrength(
        previousProse.value,
        chunk.value,
      );
      if (score >= 5) {
        issues.push({
          before: previousProse.index,
          after: chunk.index,
          reason: crossedMedia ? "interrupted-sentence" : "open-sentence",
          score,
        });
      }
    }
    previousProse = chunk;
    crossedMedia = false;
  }

  return {
    issues,
    score: issues.reduce((total, issue) => total + issue.score, 0),
  };
}

export function blocksToMarkdown(blocks: DocumentBlock[]): string {
  return blocks
    .map((block) => block.markdown.trim())
    .filter(Boolean)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .concat("\n");
}

export function mergeFlowingParagraphs(
  blocks: DocumentBlock[],
): DocumentBlock[] {
  const merged: DocumentBlock[] = [];

  for (const block of blocks) {
    const previous = merged.at(-1);
    const canJoin =
      previous?.kind === "paragraph" &&
      block.kind === "paragraph" &&
      previous.page !== block.page &&
      !TERMINAL_PUNCTUATION.test(previous.markdown.trim()) &&
      LOWERCASE_START.test(block.markdown.trim());

    if (!canJoin || !previous) {
      merged.push(block);
      continue;
    }

    const left = previous.markdown.trimEnd();
    const right = block.markdown.trimStart();
    previous.markdown = left.endsWith("-")
      ? `${left.slice(0, -1)}${right}`
      : `${left} ${right}`;
    previous.confidence = Math.min(previous.confidence, block.confidence);
  }

  return merged;
}

export function safeBaseName(filename: string): string {
  const withoutExtension = filename.replace(/\.pdf$/i, "");
  const safe = withoutExtension
    .normalize("NFKD")
    .replace(/[^\w\s.-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120)
    .replace(/[. -]+$/g, "");
  return safe || "converted-document";
}
