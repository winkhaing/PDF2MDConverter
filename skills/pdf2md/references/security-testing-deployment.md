# Security, testing, packaging, and deployment

Use this checklist for implementation reviews and releases of a public PDF-to-Markdown application.

## 1. Privacy architecture

Prefer a static or edge-served client application in which the browser performs:

- PDF parsing and rendering;
- local OCR;
- reading-order reconstruction;
- image generation;
- Markdown assembly;
- final continuity audit;
- ZIP creation.

Do not add uploads, analytics, crash reporting, remote fonts, runtime CDNs, or external AI calls without explicit user consent and corresponding documentation. Verify privacy claims from network behavior, not source comments alone.

For desktop packaging, keep the same local-processing guarantee and restrict shell, filesystem, and network permissions to the minimum required.

## 2. Untrusted-input protections

Treat every PDF field as attacker-controlled.

- Verify the `%PDF-` signature in addition to file extension and MIME type.
- Enforce documented file-size and page-count limits before expensive work.
- Cap rendered canvas area, scale, total pixels, image dimensions, and estimated memory.
- Bound OCR pages, concurrency, worker lifetime, and retry count.
- Cancel work when the user selects another file or leaves the workflow.
- Catch parser/render/OCR failures per page and clean up object URLs, canvases, workers, and large buffers.
- Sanitize filenames and prevent `../`, absolute paths, control characters, or collisions inside ZIPs.
- Escape Markdown metacharacters and raw HTML where untrusted text could become active content.

## 3. Link and annotation safety

PDF annotations can contain hostile schemes or credential-bearing URLs.

- Allow only necessary `http:` and `https:` URLs.
- Allow `mailto:` only after removing credentials and validating the address form.
- Reject `javascript:`, `data:`, `file:`, custom schemes, protocol-relative URLs, and URLs containing embedded credentials.
- Render links as inert Markdown text when validation fails.
- Add `noopener`/`noreferrer` to any live preview link opened in a new context.

Do not execute embedded JavaScript, actions, attachments, forms, or launch instructions from a PDF.

## 4. Web security headers

Set strict production headers at the serving layer. Adapt exact sources to the bundled application, but start from:

```text
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data:;
  worker-src 'self' blob:;
  font-src 'self';
  connect-src 'self';
  object-src 'none';
  base-uri 'none';
  frame-ancestors 'none';
  form-action 'self'
```

Also configure:

- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- a restrictive `Permissions-Policy`
- `Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy` where compatible
- HSTS on the final HTTPS host when managed safely

Avoid `unsafe-eval`; bundle PDF/OCR workers locally and test worker loading under the actual CSP.

## 5. ZIP contract

Create a ZIP for every successful conversion.

Recommended layout:

```text
document-name.zip
├── document-name.md
└── images/
    ├── figure-01-page-03.png
    └── equation-01-page-06.png
```

For a document without assets, include only the Markdown file but still return the ZIP.

- Use relative POSIX paths in Markdown and ZIP entries.
- Keep names deterministic, sanitized, and unique.
- Validate CRC/readability by reopening the generated archive in tests.
- Assert that every Markdown asset link resolves to exactly one ZIP entry.
- Revoke download object URLs after a safe delay or when superseded.

## 6. Product and accessibility checks

Keep the workflow understandable without technical knowledge:

- support button selection and drag-and-drop;
- make the actual file input keyboard accessible;
- show file constraints before selection;
- announce progress and errors accessibly;
- avoid text hidden behind images or controls;
- test narrow, normal desktop, and large screens;
- use sufficient contrast and visible focus states;
- label Copy, Download ZIP, and **Convert another PDF** clearly;
- do not claim completion before the final continuity audit ends.

Test the production build in Safari as well as a Chromium browser, especially PDF worker imports, file input behavior, object URLs, ZIP generation, and APIs such as modern array helpers. Transpile or polyfill unsupported APIs rather than assuming all deployed browsers match the development environment.

## 7. Automated test layers

Maintain these layers:

1. **Unit tests:** geometry, line splitting, columns, paragraph joins, captions, tables, references, formulas, filename/link sanitization, and audit scoring.
2. **Synthetic document tests:** deterministic PDFs or extracted-run fixtures for all important layouts and interruptions.
3. **Integration tests:** conversion state machine, targeted retry, ZIP creation, asset links, cancellation, errors, and download gating.
4. **Real-document regression tests:** authorized representative PDFs with minimal exact assertions and visual inspection.
5. **Browser tests:** file chooser, drag/drop, progress, Copy, ZIP download, Convert another PDF, CSP/worker loading, and Safari compatibility.
6. **Desktop tests:** production desktop build and local file workflow when desktop support is claimed.
7. **Security tests:** malicious filenames, hostile annotations, oversized pages, zip-slip attempts, malformed PDFs, dependency audit, and static analysis.

Run lint, type checking, all tests, production build, dependency audit, and desktop build before release. Treat warnings that affect correctness, privacy, or compatibility as failures.

## 8. Public repository checklist

- Keep the repository free of PDFs or extracted text the user cannot redistribute.
- Exclude credentials, account identifiers, `.env` files, local caches, OCR downloads generated at build time, and deployment state.
- Include license, privacy model, supported scope, limitations, build/test commands, and deployment instructions.
- Add representative application screenshots with no sensitive document data.
- Enable continuous integration and code scanning such as CodeQL.
- Review dependency licenses and audit results.
- Commit generated lockfiles needed for reproducible installs.
- Ensure the default branch is green before calling the release complete.

## 9. Cloudflare Workers deployment

For a static client hosted by a Worker:

1. Build the production assets locally.
2. Configure the Worker to serve only the intended asset directory with SPA fallback if needed.
3. Apply security headers to HTML, scripts, workers, OCR resources, and downloads as appropriate.
4. Set the Worker name explicitly and check it does not conflict with another deployment.
5. Deploy using the authenticated account selected by the user.
6. Open the live URL, hard refresh, and inspect network requests and console errors.
7. Perform a real PDF conversion and open the downloaded ZIP.
8. Check the previous URL behavior if a Worker was renamed; remove or redirect the old deployment only with authorization.

Workers.dev hostnames follow:

```text
https://<worker-name>.<account-subdomain>.workers.dev/
```

Changing the first label generally means renaming the Worker. Changing the account subdomain is an account-level action and can affect other Workers, so confirm scope before doing it.

## 10. Release evidence

Provide an evidence-based handoff:

- commit and branch pushed;
- CI and security checks passing;
- exact test/build/audit results;
- live URL and repository URL;
- verified browser(s) and one real conversion result;
- known limitations, such as language scope, scanned handwriting, or highly irregular tables;
- confirmation that conversion remains local and that the ZIP always includes the Markdown result.

Do not report a deployment as successful from the CLI response alone. Verify the public page and its conversion workflow.
