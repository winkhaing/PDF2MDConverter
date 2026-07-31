"use client";

import {
  AlertTriangle,
  Check,
  Clipboard,
  Download,
  FileArchive,
  FileText,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";
import JSZip from "jszip";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { blocksToMarkdown, safeBaseName } from "@/src/lib/markdown";
import { convertPdf } from "@/src/lib/pdf-converter";
import {
  PasswordRequiredError,
  type ConvertedDocument,
  type ConversionProgress,
} from "@/src/lib/types";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function AppMark() {
  return (
    <span className="app-mark" aria-hidden="true">
      <FileText size={18} strokeWidth={2.2} />
      <span>MD</span>
    </span>
  );
}

function Header() {
  return (
    <header className="site-header">
      <a className="brand" href="#main-content" translate="no">
        <AppMark />
        <span>PDF2MD</span>
      </a>
      <span className="local-pill">
        <ShieldCheck size={15} aria-hidden="true" />
        Private & local
      </span>
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
    <main className="simple-page" id="main-content">
      <section className="upload-panel">
        <span className="eyebrow">PDF to Markdown</span>
        <h1>Choose a PDF.<br />Get one Markdown file.</h1>
        <p className="intro-copy">
          The document is converted on this device. Nothing is uploaded.
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
            name="pdf-file"
            accept="application/pdf,.pdf"
            onChange={(event) => acceptFiles(event.target.files)}
            aria-label="Choose a PDF file"
          />
          <span className="upload-icon" aria-hidden="true">
            <Upload size={25} aria-hidden="true" />
          </span>
          <h2>Drop your PDF here</h2>
          <p>or select it from your device</p>
          <button
            className="primary-button"
            type="button"
            onClick={() => inputRef.current?.click()}
          >
            Choose PDF
          </button>
          <span className="privacy-note">
            <LockKeyhole size={13} aria-hidden="true" />
            Your PDF stays on this device
          </span>
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
    <main className="simple-page" id="main-content">
      <section className="processing-card" aria-live="polite">
        <RefreshCw className="spin processing-icon" size={34} aria-hidden="true" />
        <span className="eyebrow">Converting locally</span>
        <h1>{progress.message.replace(/[.…]+$/, "")}…</h1>
        <div className="file-chip">
          <FileText size={17} aria-hidden="true" />
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
          <span>{progress.percent}%</span>
          {progress.total > 0 ? (
            <span>Page {Math.max(1, progress.page)} of {progress.total}</span>
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
    if (window.matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
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
        <LockKeyhole className="dialog-icon" size={24} aria-hidden="true" />
        <h2 id="password-dialog-title">Password required</h2>
        <p>
          {incorrect
            ? "That password did not open the PDF. Please try again."
            : "Enter the PDF password. It stays on this device."}
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
            Convert PDF
          </button>
        </div>
      </form>
    </div>
  );
}

function ResultView({
  document,
  onReset,
}: {
  document: ConvertedDocument;
  onReset: () => void;
}) {
  const initialMarkdown = useMemo(() => blocksToMarkdown(document.blocks), [document.blocks]);
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [isDownloading, setIsDownloading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const hasImages = document.images.length > 0;
  const normalizedTitle = document.title.trim();
  const displayTitle = /[\p{L}\p{N}].*[\p{L}\p{N}]/u.test(normalizedTitle)
    ? normalizedTitle
    : safeBaseName(document.sourceName);

  useEffect(() => {
    const warnAboutUnsavedEdits = (event: BeforeUnloadEvent) => {
      if (markdown === initialMarkdown) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnAboutUnsavedEdits);
    return () => window.removeEventListener("beforeunload", warnAboutUnsavedEdits);
  }, [initialMarkdown, markdown]);

  const downloadResult = async () => {
    setIsDownloading(true);
    setNotice(null);
    try {
      const baseName = safeBaseName(document.sourceName);
      let blob: Blob;
      let filename: string;

      if (hasImages) {
        const zip = new JSZip();
        zip.file(`${baseName}.md`, markdown);
        for (const image of document.images) zip.file(image.filename, image.blob);
        blob = await zip.generateAsync({
          type: "blob",
          compression: "DEFLATE",
          compressionOptions: { level: 6 },
        });
        filename = `${baseName}.zip`;
      } else {
        blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
        filename = `${baseName}.md`;
      }

      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice({ type: "success", message: "Download started." });
    } catch {
      setNotice({ type: "error", message: "Download failed. Please try again." });
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
        message: "Copy failed. You can select the Markdown text directly below.",
      });
    }
  };

  return (
    <main className="result-page" id="main-content">
      <section className="result-card">
        <div className="result-header">
          <div className="result-heading">
            <span className="complete-mark"><Check size={17} aria-hidden="true" /></span>
            <div>
              <span className="eyebrow">Conversion complete</span>
              <h1>{displayTitle}</h1>
              <p>
                {document.stats.pages} pages · {document.stats.words.toLocaleString()} words
                {hasImages ? ` · ${document.images.length} images` : ""}
              </p>
            </div>
          </div>
          <div className="result-actions">
            <button className="secondary-button" type="button" onClick={copyMarkdown}>
              {copied ? <Check size={15} aria-hidden="true" /> : <Clipboard size={15} aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={downloadResult}
              disabled={isDownloading}
            >
              {isDownloading ? <RefreshCw className="spin" size={15} aria-hidden="true" /> : hasImages ? <FileArchive size={15} aria-hidden="true" /> : <Download size={15} aria-hidden="true" />}
              {isDownloading ? "Preparing…" : hasImages ? "Download ZIP" : "Download Markdown"}
            </button>
          </div>
        </div>

        {notice ? (
          <div className={`result-notice ${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>
            <span>{notice.message}</span>
            <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <div className="output-heading">
          <label htmlFor="markdown-output">Markdown</label>
          <span>Edit the text here if needed before downloading.</span>
        </div>
        <textarea
          id="markdown-output"
          className="markdown-output"
          value={markdown}
          onChange={(event) => setMarkdown(event.target.value)}
          spellCheck
        />
        <button className="convert-another" type="button" onClick={onReset}>
          Convert another PDF
        </button>
      </section>
    </main>
  );
}

export function ConverterApp() {
  const [file, setFile] = useState<File | null>(null);
  const [document, setDocument] = useState<ConvertedDocument | null>(null);
  const [progress, setProgress] = useState<ConversionProgress | null>(null);
  const [error, setError] = useState("");
  const [passwordState, setPasswordState] = useState({ open: false, incorrect: false });
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
    if (document && !window.confirm("Discard this conversion and choose another PDF?")) return;
    reset();
  }, [document, reset]);

  const beginConversion = useCallback(async (selectedFile: File, password = "") => {
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
    setProgress({ phase: "opening", page: 0, total: 0, percent: 1, message: "Opening PDF" });

    try {
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
      setDocument(result);
      setProgress(null);
    } catch (conversionError) {
      if (conversionRun.current !== run) return;
      if (conversionError instanceof PasswordRequiredError) {
        setProgress(null);
        setPasswordState({ open: true, incorrect: conversionError.incorrect });
        return;
      }
      setProgress(null);
      setError(
        conversionError instanceof Error
          ? conversionError.message
          : "This PDF could not be converted. Please try another file.",
      );
    } finally {
      if (conversionAbort.current === controller) conversionAbort.current = null;
    }
  }, []);

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <Header />
      {document ? (
        <ResultView document={document} onReset={discardDocument} />
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
              <AlertTriangle size={17} aria-hidden="true" />
              <span>{error}</span>
              <button type="button" onClick={() => setError("")} aria-label="Dismiss error">
                <X size={15} aria-hidden="true" />
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
        <LockKeyhole size={12} aria-hidden="true" /> Local conversion · English PDFs
      </footer>
    </div>
  );
}
