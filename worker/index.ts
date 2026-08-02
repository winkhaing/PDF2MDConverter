/** Cloudflare Worker entry point for the vinext-starter template. */
import handler from "vinext/server/app-router-entry";

interface Env {
  ASSETS: Fetcher;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

function createContentSecurityPolicy(nonce?: string): string {
  return [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self' data:",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' blob: data:",
    "manifest-src 'self'",
    "object-src 'none'",
    `script-src 'self'${nonce ? ` 'nonce-${nonce}'` : ""} 'wasm-unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    "worker-src 'self' blob:",
  ].join("; ");
}

function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

async function withSecurityHeaders(response: Response, request: Request): Promise<Response> {
  const contentType = response.headers.get("content-type") ?? "";
  const nonce = /^text\/html\b/i.test(contentType) ? createNonce() : undefined;
  const secured = nonce
    ? new Response(
        (await response.text()).replace(/<script(?=[\s>])/g, `<script nonce="${nonce}"`),
        {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        },
      )
    : new Response(response.body, response);
  secured.headers.set("Content-Security-Policy", createContentSecurityPolicy(nonce));
  secured.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  secured.headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
  secured.headers.set("Referrer-Policy", "no-referrer");
  secured.headers.set("X-Content-Type-Options", "nosniff");
  secured.headers.set("X-Frame-Options", "DENY");
  if (new URL(request.url).protocol === "https:") {
    secured.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains",
    );
  }
  return secured;
}

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (new URL(request.url).pathname === "/_vinext/image") {
      return await withSecurityHeaders(
        new Response("Not found", { status: 404 }),
        request,
      );
    }
    return await withSecurityHeaders(await handler.fetch(request, env, ctx), request);
  },
};

export default worker;
