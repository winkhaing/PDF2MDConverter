import type { DocumentBlock } from "./types";

const TERMINAL_PUNCTUATION = /[.!?]["')\]]?$/;
const LOWERCASE_START = /^[a-z]/;

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
    .replace(/-+/g, "-");
  return safe || "converted-document";
}
