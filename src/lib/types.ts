export type BlockKind =
  | "heading"
  | "paragraph"
  | "list"
  | "table"
  | "figure"
  | "equation"
  | "footnote";

export interface ExtractedImage {
  filename: string;
  blob: Blob;
  url: string;
  caption: string;
  page: number;
}

export interface DocumentBlock {
  id: string;
  kind: BlockKind;
  markdown: string;
  page: number;
  confidence: number;
  imageFilename?: string;
}

export interface ConversionStats {
  pages: number;
  words: number;
  figures: number;
  tables: number;
  ocrPages: number;
  lowConfidenceBlocks: number;
}

export interface ConvertedDocument {
  sourceName: string;
  title: string;
  blocks: DocumentBlock[];
  images: ExtractedImage[];
  stats: ConversionStats;
}

export interface ConversionProgress {
  phase: "opening" | "reading" | "ocr" | "figures" | "assembling";
  page: number;
  total: number;
  message: string;
  percent: number;
}

export class PasswordRequiredError extends Error {
  constructor(public readonly incorrect = false) {
    super(incorrect ? "The PDF password is incorrect." : "This PDF needs a password.");
    this.name = "PasswordRequiredError";
  }
}
