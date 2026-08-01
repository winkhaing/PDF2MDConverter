import assert from "node:assert/strict";
import { access, readFile, stat } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the finished converter", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const contentSecurityPolicy = response.headers.get("content-security-policy") ?? "";
  assert.match(contentSecurityPolicy, /object-src 'none'/);
  const scriptPolicy = contentSecurityPolicy
    .split(";")
    .find((directive) => directive.trim().startsWith("script-src")) ?? "";
  assert.doesNotMatch(scriptPolicy, /'unsafe-inline'/);
  const nonce = contentSecurityPolicy.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce, "HTML responses should authorize their startup scripts with a nonce");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  const html = await response.text();
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)];
  assert.ok(scripts.length > 0);
  assert.ok(
    scripts.every(([, attributes]) => attributes.includes(`nonce="${nonce}"`)),
    "Every startup script should carry the nonce authorized by the CSP",
  );
  assert.match(html, /PDF2MD Converter/);
  assert.match(html, /Choose a PDF/);
  assert.match(html, /Get one complete ZIP/);
  assert.match(html, /Your PDF stays on this device/);
  assert.match(html, /Choose PDF/);
  assert.doesNotMatch(html, /Review extracted blocks|Document structure/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("ships local OCR, desktop, social, and public-project assets", async () => {
  await Promise.all([
    access(new URL("public/ocr/eng.traineddata.gz", root)),
    access(new URL("public/ocr/worker.min.js", root)),
    access(new URL("public/og.png", root)),
    access(new URL("src-tauri/tauri.conf.json", root)),
    access(new URL("src-tauri/capabilities/main.json", root)),
    access(new URL("LICENSE", root)),
    access(new URL("SECURITY.md", root)),
  ]);
  const [packageJson, layout, readme, converterApp] = await Promise.all([
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("README.md", root), "utf8"),
    readFile(new URL("src/components/ConverterApp.tsx", root), "utf8"),
  ]);
  assert.match(packageJson, /"name": "pdf2md-converter"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton|react-markdown|katex/);
  assert.match(layout, /og\.png/);
  assert.match(readme, /processed in the browser or desktop webview/);
  assert.doesNotMatch(
    converterApp,
    /await import\(["'](?:jszip|@\/src\/lib\/pdf-converter)["']\)/,
  );
  assert.match(converterApp, /zip\.file\(`\$\{baseName\}\.md`, markdown\)/);
  assert.match(converterApp, /Download ZIP/);
  assert.doesNotMatch(converterApp, /Download Markdown/);
  await assert.rejects(stat(new URL("dist/client/.DS_Store", root)));
});
