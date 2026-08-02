# Security policy

## Supported version

Security fixes are applied to the latest commit on the `main` branch.

## Reporting a vulnerability

Please use the repository's **Security → Report a vulnerability** form to send
a private GitHub security advisory. Do not include exploit details, malicious
documents, passwords, personal information, or unpublished research in a
public issue.

Include the affected web or desktop version, operating system and browser,
reproduction steps, and a minimal non-sensitive test document when possible.

## Security and privacy boundaries

- PDF bytes, passwords, OCR results, Markdown, and extracted images remain in
  the browser or desktop webview. The application has no document upload API.
- PDFs are untrusted input. Size, page-count, canvas-memory, URL-scheme, and
  Markdown-output controls reduce risk but cannot eliminate vulnerabilities in
  browser engines, PDF.js, OCR, or other dependencies.
- The desktop application exposes no custom native commands to the webview and
  uses a restrictive Content Security Policy.
- Keep browsers, system webviews, and desktop builds updated. Do not use this
  tool as a malware scanner or as a substitute for reviewing the source PDF.
- Cloudflare observability, invocation-log persistence, and trace persistence
  are disabled in the committed Worker configuration. Cloudflare still handles
  ordinary HTTPS connection metadata at its edge, but PDF content is processed
  only on the user's device.

## Deployment credentials

Use a dedicated Cloudflare API token scoped to the PDF2MD account and limited
to the minimum Worker-script edit permission required by Wrangler. Supply it
through `CLOUDFLARE_API_TOKEN` from a password manager or protected CI secret.
Do not commit tokens, use a broad global API key, or reuse a personal token
across unrelated projects. Rotate the token after suspected exposure and
remove obsolete Wrangler login sessions when the scoped token is working.
