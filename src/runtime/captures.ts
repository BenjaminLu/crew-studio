// Serving the app captures a run made (a domain check makes them): data/runs/<run>/captures/<head>/(before|after)/<page>.(html|png).
// The pages are code a round wrote, so an HTML page is served sandboxed: no script, no request out, an opaque origin.
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

export const CAPTURE_PATH = /^\/api\/wruns\/(R-\d+)\/captures\/([0-9a-f]{7,40})\/(before|after)\/([\w.-]+\.(?:html|png))$/;
export const PAGE_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";
export function captureResponse(runDir: string, head: string, side: string, file: string): Response {
  const root = join(runDir, "captures"); const f = join(root, head, side, file);
  if (!existsSync(f) || !realpathSync(f).startsWith(realpathSync(root) + "/")) return new Response("not found", { status: 404 });
  const png = file.endsWith(".png");
  return new Response(Bun.file(f), { headers: { "content-type": png ? "image/png" : "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff",
    "content-security-policy": png ? "default-src 'none'" : PAGE_CSP } });
}
