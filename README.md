# PDF2MD Converter

PDF2MD Converter turns English academic PDFs into editable Markdown without
uploading the document. It runs in current desktop browsers and as an offline
macOS or Windows application.

## What it handles

- two-column reading order reconstructed as one continuous Markdown flow
- scanned and image-only PDFs using bundled English OCR
- paragraphs continued across page boundaries
- repeated headers, footers, and page numbers removed
- figures extracted into an `images/` folder and paired with captions
- tables converted to Markdown (or editable Markdown source for correction)
- mathematical symbols converted to LaTeX blocks
- headings, lists, emphasis, links, footnotes, and references retained
- password-protected PDFs
- a block editor for reordering, correcting, retyping, or removing content
- a ZIP export containing one `.md` document and its figure files

## Privacy

PDF content is processed in the browser or desktop webview. The app has no
upload API, analytics, account system, or document storage. OCR language data
and processing code are bundled with the app.

## Development

Requirements:

- Node.js 22.13 or newer
- Rust (only for desktop packaging)

Install and run the web app:

```bash
npm install
npm run dev
```

Build and verify:

```bash
npm run lint
npm test
npm run desktop:build
```

Run the desktop application:

```bash
npm run desktop dev
```

Create a local desktop bundle:

```bash
npm run desktop build
```

Unsigned macOS and Windows installers are built automatically by GitHub Actions
when a version tag beginning with `v` is pushed.

## Accuracy notes

PDF is a page-painting format rather than a semantic document format. The
converter uses deterministic layout heuristics and OCR, then marks uncertain
blocks for review. Complicated merged-cell tables, multi-panel figures,
specialized mathematical notation, and unusual page layouts may need manual
correction. Representative papers are the best way to improve these heuristics.

## License

[MIT](LICENSE)
