"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Clipboard,
  Columns2,
  Download,
  FileArchive,
  FileText,
  GripVertical,
  Image as ImageIcon,
  ListPlus,
  LockKeyhole,
  RefreshCw,
  ScanText,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  Suspense,
  lazy,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { blocksToMarkdown, safeBaseName } from "@/src/lib/markdown";
import {
  PasswordRequiredError,
  type BlockKind,
  type ConvertedDocument,
  type ConversionProgress,
  type DocumentBlock,
} from "@/src/lib/types";

const MarkdownPreview = lazy(() => import("./MarkdownPreview"));

const BLOCK_TYPES: Array<{ value: BlockKind; label: string }> = [
  { value: "heading", label: "Heading" },
  { value: "paragraph", label: "Paragraph" },
  { value: "list", label: "List" },
  { value: "table", label: "Table" },
  { value: "figure", label: "Figure" },
  { value: "equation", label: "Equation" },
  { value: "footnote", label: "Footnote" },
];

const FEATURES = [
  { icon: Columns2, label: "Two-column order" },
  { icon: ScanText, label: "Scanned PDF OCR" },
  { icon: Table2, label: "Markdown tables" },
  { icon: ImageIcon, label: "Figures + captions" },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.88) return "High confidence";
  if (confidence >= 0.76) return "Review suggested";
  return "Needs review";
}

function AppMark() {
  return (
    <span className="app-mark" aria-hidden="true">
      <FileText size={18} strokeWidth={2.2} />
      <span>MD</span>
    </span>
  );
}

function Header({ onReset }: { onReset?: () => void }) {
  return (
    <header className="site-header">
      <a
        className="brand"
        href="#main-content"
        onClick={(event) => {
          if (!onReset) return;
          event.preventDefault();
          onReset();
        }}
      >
        <AppMark />
        <span>
          PDF2MD <strong>Converter</strong>
        </span>
      </a>
      <div className="header-actions">
        <span className="local-pill">
          <ShieldCheck size={15} />
          100% local
        </span>
        <a
          className="icon-link"
          href="#how-title"
          aria-label="How PDF conversion works"
        >
          <CircleHelp size={19} />
        </a>
      </div>
    </header>
  );
}

function UploadView({
  onFile,
  isDragging,
  setIsDragging,
}: {
  onFile: (file: File) => void;
  isDragging: boolean;
  setIsDragging: (value: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const acceptFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) onFile(file);
  };

  return (
    <main className="landing" id="main-content">
      <section className="hero">
        <div className="eyebrow">
          <Sparkles size={14} />
          Built for research papers
        </div>
        <h1>
          Turn dense PDFs into
          <span>clean, editable Markdown.</span>
        </h1>
        <p className="hero-copy">
          Reading order, figures, tables, equations, and references—reconstructed
          on your device, ready for a careful final review.
        </p>

        <div
          className={`dropzone ${isDragging ? "is-dragging" : ""}`}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={(event) => {
            if (event.currentTarget === event.target) setIsDragging(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setIsDragging(false);
            acceptFiles(event.dataTransfer.files);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            onChange={(event) => acceptFiles(event.target.files)}
            aria-label="Choose a PDF file"
          />
          <div className="upload-icon">
            <Upload size={27} strokeWidth={1.8} />
          </div>
          <h2>Drop your PDF here</h2>
          <p>or choose one from your device</p>
          <button
            className="primary-button"
            type="button"
            onClick={() => inputRef.current?.click()}
          >
            Choose PDF
            <ArrowUp size={16} />
          </button>
          <div className="dropzone-note">
            <LockKeyhole size={14} />
            Your file never leaves this device
          </div>
        </div>

        <div className="feature-strip">
          {FEATURES.map(({ icon: Icon, label }) => (
            <div key={label} className="feature-item">
              <Icon size={18} />
              <span>{label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="how-it-works" aria-labelledby="how-title">
        <div className="section-kicker">A calmer conversion workflow</div>
        <h2 id="how-title">From paper to portable text in three steps.</h2>
        <div className="steps">
          <div className="step">
            <span>01</span>
            <ScanText size={23} />
            <h3>Read</h3>
            <p>OCR and layout analysis recover the page without uploading it.</p>
          </div>
          <div className="step">
            <span>02</span>
            <BookOpen size={23} />
            <h3>Review</h3>
            <p>Correct blocks, captions, tables, and order in a focused editor.</p>
          </div>
          <div className="step">
            <span>03</span>
            <FileArchive size={23} />
            <h3>Export</h3>
            <p>Download one ZIP containing Markdown and extracted figure files.</p>
          </div>
        </div>
      </section>
    </main>
  );
}

function ProcessingView({
  file,
  progress,
  onCancel,
}: {
  file: File;
  progress: ConversionProgress;
  onCancel: () => void;
}) {
  return (
    <main className="processing-shell" id="main-content">
      <section className="processing-card" aria-live="polite">
        <div className="processing-orbit">
          <div className="paper-mini">
            <FileText size={31} />
          </div>
        </div>
        <div className="processing-eyebrow">Processing locally</div>
        <h1>{progress.message}</h1>
        <p>
          Layout analysis and OCR can take a few minutes for image-heavy papers.
          Keep this tab open.
        </p>
        <div className="file-chip">
          <FileText size={18} />
          <span>{file.name}</span>
          <small>{formatBytes(file.size)}</small>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${progress.percent}%` }} />
        </div>
        <div className="progress-meta">
          <span>{progress.percent}% complete</span>
          {progress.total > 0 ? (
            <span>
              Page {Math.max(1, progress.page)} of {progress.total}
            </span>
          ) : null}
        </div>
        <button className="text-button" type="button" onClick={onCancel}>
          Cancel
        </button>
      </section>
    </main>
  );
}

function PasswordDialog({
  incorrect,
  onSubmit,
  onCancel,
}: {
  incorrect: boolean;
  onSubmit: (password: string) => void;
  onCancel: () => void;
}) {
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (window.matchMedia("(pointer: fine)").matches) {
      inputRef.current?.focus();
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onCancel]);

  return (
    <div className="modal-backdrop">
      <form
        className="password-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-dialog-title"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(password);
        }}
      >
        <div className="dialog-icon">
          <LockKeyhole size={23} />
        </div>
        <h2 id="password-dialog-title">Password protected PDF</h2>
        <p>
          {incorrect
            ? "That password did not open the file. Please try again."
            : "Enter the document password. It stays on this device."}
        </p>
        <label>
          PDF password
          <input
            ref={inputRef}
            type="password"
            name="pdf-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />
        </label>
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" type="submit" disabled={!password}>
            Unlock & convert
          </button>
        </div>
      </form>
    </div>
  );
}

function BlockEditor({
  block,
  index,
  count,
  onChange,
  onDelete,
  onMove,
  onDragStart,
  onDrop,
}: {
  block: DocumentBlock;
  index: number;
  count: number;
  onChange: (block: DocumentBlock) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  const needsReview = block.confidence < 0.78;
  return (
    <article
      className={`block-card ${needsReview ? "needs-review" : ""}`}
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
    >
      <div className="block-toolbar">
        <span className="drag-handle" aria-hidden="true">
          <GripVertical size={17} />
        </span>
        <label className="type-select">
          <select
            value={block.kind}
            onChange={(event) =>
              onChange({ ...block, kind: event.target.value as BlockKind })
            }
            aria-label={`Block ${index + 1} type`}
          >
            {BLOCK_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </label>
        <span
          className={`confidence ${needsReview ? "warn" : ""}`}
          title={`${Math.round(block.confidence * 100)}% estimated confidence`}
        >
          {needsReview ? <AlertTriangle size={13} /> : <Check size={13} />}
          {confidenceLabel(block.confidence)}
        </span>
        <span className="page-label">Source p. {block.page}</span>
        <div className="block-actions">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label="Move block up"
          >
            <ArrowUp size={15} />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === count - 1}
            aria-label="Move block down"
          >
            <ArrowDown size={15} />
          </button>
          <button type="button" onClick={onDelete} aria-label="Delete block">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <textarea
        value={block.markdown}
        onChange={(event) =>
          onChange({ ...block, markdown: event.target.value, confidence: 1 })
        }
        rows={Math.min(12, Math.max(3, block.markdown.split("\n").length + 1))}
        spellCheck
        aria-label={`Edit ${block.kind} block ${index + 1}`}
      />
    </article>
  );
}

function EditorView({
  document,
  onReset,
}: {
  document: ConvertedDocument;
  onReset: () => void;
}) {
  const [blocks, setBlocks] = useState(document.blocks);
  const [previewMode, setPreviewMode] = useState<"preview" | "markdown">(
    "preview",
  );
  const [isDownloading, setIsDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const draggedIndex = useRef<number | null>(null);
  const markdown = useMemo(() => blocksToMarkdown(blocks), [blocks]);
  const deferredMarkdown = useDeferredValue(markdown);
  const imageUrls = useMemo(
    () => new Map(document.images.map((image) => [image.filename, image.url])),
    [document.images],
  );

  const updateBlock = useCallback((index: number, block: DocumentBlock) => {
    setBlocks((current) =>
      current.map((value, blockIndex) => (blockIndex === index ? block : value)),
    );
  }, []);

  const moveBlock = useCallback((index: number, direction: -1 | 1) => {
    setBlocks((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const addBlock = () => {
    setBlocks((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        kind: "paragraph",
        markdown: "New paragraph",
        page: document.stats.pages,
        confidence: 1,
      },
    ]);
  };

  const downloadZip = async () => {
    setIsDownloading(true);
    setNotice(null);
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const baseName = safeBaseName(document.sourceName);
      zip.file(`${baseName}.md`, markdown);
      for (const image of document.images) zip.file(image.filename, image.blob);
      const blob = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = `${baseName}.zip`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice({ type: "success", message: "ZIP download started." });
    } catch {
      setNotice({
        type: "error",
        message: "The ZIP could not be created. Try downloading again.",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const copyMarkdown = async () => {
    setNotice(null);
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setNotice({
        type: "error",
        message: "Markdown could not be copied. Select it from the Markdown tab instead.",
      });
    }
  };

  const reviewCount = blocks.filter((block) => block.confidence < 0.78).length;

  return (
    <main className="editor-shell" id="main-content">
      <div className="document-bar">
        <div className="document-title">
          <button
            type="button"
            className="back-button"
            onClick={onReset}
            aria-label="Discard conversion and choose another PDF"
          >
            <X size={17} />
          </button>
          <FileText size={20} />
          <div>
            <strong>{document.sourceName}</strong>
            <span>
              {document.stats.pages} pages · {document.stats.words.toLocaleString()} words
            </span>
          </div>
        </div>
        <div className="document-stats">
          <span>
            <ImageIcon size={15} /> {document.stats.figures} figures
          </span>
          <span>
            <Table2 size={15} /> {document.stats.tables} tables
          </span>
          {document.stats.ocrPages > 0 ? (
            <span>
              <ScanText size={15} /> {document.stats.ocrPages} OCR pages
            </span>
          ) : null}
        </div>
        <button
          className="primary-button download-button"
          type="button"
          onClick={downloadZip}
          disabled={isDownloading}
        >
          {isDownloading ? <RefreshCw className="spin" size={16} /> : <Download size={16} />}
          {isDownloading ? "Creating ZIP…" : "Download ZIP"}
        </button>
      </div>

      {notice ? (
        <div
          className={`editor-notice ${notice.type}`}
          role={notice.type === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <span>{notice.message}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss message"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {reviewCount > 0 ? (
        <div className="review-banner">
          <AlertTriangle size={17} />
          <span>
            {reviewCount} {reviewCount === 1 ? "block needs" : "blocks need"} a
            quick review. Editing a block marks it as checked.
          </span>
          <button
            type="button"
            onClick={() =>
              window.document
                .querySelector(".needs-review")
                ?.scrollIntoView({ behavior: "smooth", block: "center" })
            }
          >
            Review now
          </button>
        </div>
      ) : null}

      <div className="workspace">
        <section className="blocks-pane">
          <div className="pane-heading">
            <div>
              <span className="section-kicker">Document structure</span>
              <h1>Review extracted blocks</h1>
            </div>
            <button className="secondary-button" type="button" onClick={addBlock}>
              <ListPlus size={16} />
              Add block
            </button>
          </div>
          <p className="pane-help">
            Drag blocks into reading order, correct the text, or change a block’s
            type. Page labels are for review only and are not exported.
          </p>
          <div className="block-list">
            {blocks.map((block, index) => (
              <BlockEditor
                key={block.id}
                block={block}
                index={index}
                count={blocks.length}
                onChange={(value) => updateBlock(index, value)}
                onDelete={() => {
                  if (!window.confirm(`Delete block ${index + 1}? This cannot be undone.`)) {
                    return;
                  }
                  setBlocks((current) =>
                    current.filter((_, blockIndex) => blockIndex !== index),
                  );
                }}
                onMove={(direction) => moveBlock(index, direction)}
                onDragStart={() => {
                  draggedIndex.current = index;
                }}
                onDrop={() => {
                  const from = draggedIndex.current;
                  if (from === null || from === index) return;
                  startTransition(() => {
                    setBlocks((current) => {
                      const next = [...current];
                      const [moved] = next.splice(from, 1);
                      next.splice(index, 0, moved);
                      return next;
                    });
                  });
                  draggedIndex.current = null;
                }}
              />
            ))}
            {blocks.length === 0 ? (
              <div className="empty-blocks">
                <FileText size={22} />
                <strong>No document blocks remain</strong>
                <span>Add a block to continue editing or export an empty Markdown file.</span>
              </div>
            ) : null}
          </div>
        </section>

        <aside className="preview-pane">
          <div className="preview-toolbar">
            <div className="preview-tabs" role="tablist" aria-label="Preview format">
              <button
                type="button"
                role="tab"
                aria-selected={previewMode === "preview"}
                className={previewMode === "preview" ? "active" : ""}
                onClick={() => setPreviewMode("preview")}
              >
                Preview
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={previewMode === "markdown"}
                className={previewMode === "markdown" ? "active" : ""}
                onClick={() => setPreviewMode("markdown")}
              >
                Markdown
              </button>
            </div>
            <button
              className="copy-button"
              type="button"
              onClick={copyMarkdown}
            >
              {copied ? <Check size={15} /> : <Clipboard size={15} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <div className="preview-scroll">
            {previewMode === "preview" ? (
              <Suspense fallback={<div className="preview-loading">Preparing preview…</div>}>
                <MarkdownPreview
                  markdown={deferredMarkdown}
                  imageUrls={imageUrls}
                />
              </Suspense>
            ) : (
              <pre className="markdown-source">{deferredMarkdown}</pre>
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}

export function ConverterApp() {
  const [file, setFile] = useState<File | null>(null);
  const [document, setDocument] = useState<ConvertedDocument | null>(null);
  const [progress, setProgress] = useState<ConversionProgress | null>(null);
  const [error, setError] = useState("");
  const [passwordState, setPasswordState] = useState<{
    open: boolean;
    incorrect: boolean;
  }>({ open: false, incorrect: false });
  const [isDragging, setIsDragging] = useState(false);
  const conversionRun = useRef(0);
  const conversionAbort = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    conversionRun.current += 1;
    conversionAbort.current?.abort();
    conversionAbort.current = null;
    if (document) {
      for (const image of document.images) URL.revokeObjectURL(image.url);
    }
    setFile(null);
    setDocument(null);
    setProgress(null);
    setError("");
    setPasswordState({ open: false, incorrect: false });
  }, [document]);

  const discardDocument = useCallback(() => {
    if (
      document &&
      !window.confirm("Discard this conversion and return to the upload screen?")
    ) {
      return;
    }
    reset();
  }, [document, reset]);

  const beginConversion = useCallback(
    async (selectedFile: File, password = "") => {
      if (
        selectedFile.type !== "application/pdf" &&
        !selectedFile.name.toLowerCase().endsWith(".pdf")
      ) {
        setError("Please choose a PDF file.");
        return;
      }
      const run = conversionRun.current + 1;
      conversionRun.current = run;
      conversionAbort.current?.abort();
      const controller = new AbortController();
      conversionAbort.current = controller;
      setFile(selectedFile);
      setError("");
      setDocument(null);
      setPasswordState({ open: false, incorrect: false });
      setProgress({
        phase: "opening",
        page: 0,
        total: 0,
        percent: 1,
        message: "Preparing your document",
      });
      try {
        const { convertPdf } = await import("@/src/lib/pdf-converter");
        const result = await convertPdf(
          selectedFile,
          password,
          (value) => {
            if (conversionRun.current === run) setProgress(value);
          },
          controller.signal,
        );
        if (conversionRun.current !== run) {
          for (const image of result.images) URL.revokeObjectURL(image.url);
          return;
        }
        startTransition(() => {
          setDocument(result);
          setProgress(null);
        });
      } catch (conversionError) {
        if (conversionRun.current !== run) return;
        if (conversionError instanceof PasswordRequiredError) {
          setProgress(null);
          setPasswordState({
            open: true,
            incorrect: conversionError.incorrect,
          });
          return;
        }
        setProgress(null);
        setError(
          conversionError instanceof Error
            ? conversionError.message
            : "This PDF could not be converted.",
        );
      } finally {
        if (conversionAbort.current === controller) {
          conversionAbort.current = null;
        }
      }
    },
    [],
  );

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <Header
        onReset={document ? discardDocument : progress ? reset : undefined}
      />
      {document ? (
        <EditorView document={document} onReset={discardDocument} />
      ) : progress && file ? (
        <ProcessingView file={file} progress={progress} onCancel={reset} />
      ) : (
        <>
          <UploadView
            onFile={(selectedFile) => beginConversion(selectedFile)}
            isDragging={isDragging}
            setIsDragging={setIsDragging}
          />
          {error ? (
            <div className="error-toast" role="alert">
              <AlertTriangle size={17} />
              <span>{error}</span>
              <button type="button" onClick={() => setError("")} aria-label="Dismiss error">
                <X size={15} />
              </button>
            </div>
          ) : null}
        </>
      )}
      {passwordState.open && file ? (
        <PasswordDialog
          incorrect={passwordState.incorrect}
          onCancel={reset}
          onSubmit={(password) => beginConversion(file, password)}
        />
      ) : null}
      <footer className="site-footer">
        <span>
          <LockKeyhole size={13} />
          Local by design
        </span>
        <span className="footer-dot">·</span>
        <span>English academic PDFs</span>
        <span className="footer-dot">·</span>
        <span>Open source · MIT</span>
      </footer>
    </div>
  );
}
