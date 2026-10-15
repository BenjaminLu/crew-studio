// Which layout a workflow version shows in the editor: the auto layout (public/graph-layout.js) until someone
// drags a node, then the dragged positions (kept by POST /api/wf/<id>/layout). "Tidy layout" goes back to auto.
// A version with a layout file from before this record (no entry here) opens in manual mode, its positions kept.
//   GET  /api/graph-layout/<id>/v<N>   { mode: "auto" | "manual" }
//   POST /api/graph-layout/<id>/v<N>   { mode }   (a write: the session guard applies, as to every write)
// Kept in data/graph-layout.json (Studio's own data; nothing of firstmate).
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function createGraphMode(dataDir: string) {
  const file = join(dataDir, "graph-layout.json");
  const read = (): Record<string, string> => { try { const o = JSON.parse(readFileSync(file, "utf8")); return o && typeof o === "object" ? o : {}; } catch { return {}; } };
  // a version dragged before this record existed (data/workflows/<id>/layout-v<N>.json, written by POST /api/wf/<id>/layout) keeps its positions
  const legacy = (id: string, v: number) => { try { return Object.keys(JSON.parse(readFileSync(join(dataDir, "workflows", id, `layout-v${v}.json`), "utf8")) || {}).length > 0; } catch { return false; } };
  const modeOf = (id: string, v: number): "auto" | "manual" => { const r = read()[`${id}@v${v}`]; return r === "auto" || r === "manual" ? r : legacy(id, v) ? "manual" : "auto"; };
  async function handle(req: Request, url: URL, writing: boolean): Promise<Response | null> {
    const m = /^\/api\/graph-layout\/([a-z0-9-]+)\/v(\d+)$/.exec(url.pathname);
    if (!m) return null;
    const key = `${m[1]}@v${Number(m[2])}`;
    if (!writing) return json({ mode: modeOf(m[1], Number(m[2])) });
    let b: any = {}; try { b = await req.json(); } catch {}
    if (b?.mode !== "auto" && b?.mode !== "manual") return json({ error: "mode is auto or manual" }, 400);
    const all = read(); all[key] = b.mode; // explicit, so "Tidy layout" also wins over an old saved layout
    writeFileSync(file + ".tmp", JSON.stringify(all, null, 1)); renameSync(file + ".tmp", file);
    return json({ mode: b.mode });
  }
  return { handle, mode: modeOf };
}
