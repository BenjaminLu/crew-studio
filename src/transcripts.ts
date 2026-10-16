// Transcripts: for every agent invocation, exactly what it was asked (the
// prompt and the brief it was bound to), what it did (the transcript) and what
// it reported. firstmate's crew rounds, the firstmate main session and
// Studio's own agent nodes. Read only; every text passes redact() first; a
// phone gets a summary unless the Mac allows more. See docs/units/transcripts.md.
//   GET  /api/crew/<actor>/invocation            prompt (raw + sections + brief binding), identity, attempt
//   GET  /api/crew/<actor>/transcript?after=N    stream entries after byte N, and the next offset
//   GET  /api/firstmate/history?before=N         one page of the main session, newest last
//   GET  /api/node-runs, /api/node-runs/<run>/<node>/<round>[/transcript?after=N]
//   GET|POST /api/transcripts/settings           { phoneRaw }  (POST: desktop only)
import { closeSync, existsSync, fstatSync, openSync, readFileSync, readSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactJSON, redactText } from "./secure";

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/; // an actor, run, node or round: no dots, no slashes
const RESULT_MAX = 50_000, HISTORY_PAGE = 40;

// ---------- redaction: the one registry in src/secure.ts ----------
/** Hide credentials in a text (src/secure.ts redactText). */
export const redact = (s: string): string => redactText(s);
const red = (v: unknown): any => redactJSON(v);

// ---------- the prompt ----------
export type Section = { kind: string; label: string; text: string; binding?: Binding | null };
export type Binding = { record: string; round: number; head: string; time: string | null; file: string | null; carried: string | null };
const KINDS: [RegExp, string, string][] = [
  [/^#\s+(worker|reviewer|designer|firstmate|planner)\b/i, "skill", "Role skill"],
  [/^#\s+approved spec pin/i, "spec", "Spec pin"],
  [/^#\s+(complete round inputs|design section anchors|approved conventions)/i, "inputs", "Pinned inputs"],
  [/^#\s+your task/i, "task", "Task"],
  [/^#\s+approved local brief/i, "brief", "Brief"],
  [/^#\s+context pack/i, "context", "CI and review inputs"],
  [/^#\s+local review history/i, "history", "Review history"],
  [/^#\s+(this is not the first round|the door|fix the whole class|rounds?\b)/i, "round", "Round notes"],
];
/** Split a prompt at its level-1 headings (outside code fences). The pieces join back to the exact text. */
export function sections(text: string): Section[] {
  const out: Section[] = [];
  let cur: Section = { kind: "dispatch", label: "Dispatch", text: "" };
  let fence = false;
  for (const line of text.split(/(?<=\n)/)) {
    if (/^```/.test(line)) fence = !fence;
    const k = !fence && /^# \S/.test(line) ? KINDS.find(([re]) => re.test(line)) : undefined;
    // a brief carries its own headings ("# T-307 fix round 1"): only a known section ends it
    if (!fence && /^# \S/.test(line) && !(cur.kind === "brief" && !k)) {
      if (cur.text) out.push(cur);
      cur = { kind: k?.[1] ?? "other", label: k?.[2] ?? line.replace(/^#\s+/, "").trim().slice(0, 60), text: "" };
      // a skill's front matter (--- name: … ---) sits just before its heading: keep it with the skill
      const prev = out.at(-1);
      if (k?.[1] === "skill" && prev) { const m = /(\n?---\nname:[\s\S]*?\n---\n\s*)$/.exec(prev.text); if (m) { prev.text = prev.text.slice(0, -m[1].length); cur.text = m[1]; if (!prev.text) out.pop(); } }
    }
    cur.text += line;
  }
  if (cur.text) out.push(cur);
  // later blocks of the same kind keep their own label: "Role skill (2)"
  const seen = new Map<string, number>();
  for (const s of out) { const n = (seen.get(s.kind) ?? 0) + 1; seen.set(s.kind, n); if (n > 1 && s.kind !== "other") s.label += ` (${n})`; }
  return out;
}

/** Which evidence record (and brief file) a brief section came from, with the round and head it is bound to. */
export function briefBinding(stateDir: string, project: string | null, task: string | null, sectionText: string): Binding | null {
  if (!task || !NAME.test(task)) return null;
  const body = sectionText.replace(/^#[^\n]*\n+/, "");
  const carried = /^Written for head (\w+); carried to (\w+)[^\n]*\n/.exec(body);
  const text = carried ? body.slice(carried[0].length) : body;
  const dirs = [project && NAME.test(project) ? join(stateDir, "evidence", project, task) : null, join(stateDir, "evidence", task)].filter(Boolean) as string[];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => /^\d+-[\w-]+\.json$/.test(f)).sort().reverse();
    for (const f of files) {
      let r: any; try { r = JSON.parse(readFileSync(join(dir, f), "utf8")); } catch { continue; }
      if (r?.kind !== "brief" || typeof r.text !== "string" || !r.text.trim() || !text.startsWith(r.text.trim())) continue;
      let file: string | null = null;
      try { for (const b of readdirSync(join(stateDir, "briefs")).filter((x) => x.endsWith(".md"))) { if (readFileSync(join(stateDir, "briefs", b), "utf8").trim() === r.text.trim()) { file = `briefs/${b}`; break; } } } catch {}
      return { record: join(dir.slice(stateDir.length + 1), f), round: Number(r.round), head: String(r.head ?? ""), time: r.time ?? null, file,
        carried: carried ? `written for ${carried[1]}, carried to ${carried[2]}` : null };
    }
  }
  return null;
}

// ---------- streams ----------
export type Entry = { kind: "text" | "tool" | "toolResult" | "result" | "error" | "system" | "fm"; t: string | null; text?: string; name?: string; args?: unknown;
  id?: string; toolId?: string; body?: string; size?: number; truncated?: boolean; isError?: boolean };
/** Read complete lines from byte `after`; parse them into entries. `next` never passes a half-written line. */
export function readStream(file: string, after = 0): { entries: Entry[]; next: number; size: number } {
  let fd = -1;
  try {
    fd = openSync(file, "r");
    const size = fstatSync(fd).size;
    if (after > size || after < 0) after = 0;
    const len = Math.min(size - after, 16 << 20);
    const b = Buffer.alloc(len); const n = readSync(fd, b, 0, len, after);
    const end = b.subarray(0, n).lastIndexOf(10) + 1;
    const text = b.subarray(0, end).toString("utf8");
    return { entries: parseLines(text.split("\n")), next: after + end, size };
  } catch { return { entries: [], next: after, size: 0 }; } finally { if (fd >= 0) closeSync(fd); }
}
const resultText = (c: any): string => typeof c === "string" ? c : Array.isArray(c) ? c.map((x) => (typeof x?.text === "string" ? x.text : x?.type === "image" ? "[image]" : JSON.stringify(x))).join("\n") : JSON.stringify(c ?? "");
/** A provider's final message is often in the stream twice (its streamed text, then the whole message), and a long
 *  one also as pieces flushed while it streamed (src/agent.ts roundRecord before the fix). Adjacent text entries that
 *  are the same text, or that together start (or make up) the next text, are shown once: as that next text. */
export function collapseTexts(es: Entry[]): Entry[] {
  const out: Entry[] = [];
  let run: Entry[] = []; // the text entries just before this one, with nothing between them
  for (const e of es) {
    if (e.kind !== "text") { out.push(e); run = []; continue; }
    const text = e.text ?? "";
    const prev = run.at(-1);
    if (prev && prev.text === text) continue; // the same message again
    // the pieces are the last few texts of the run: the longest tail of it that joins to a strict start of this text
    // (walked from the end, and only while the pieces fit in this text: the cost stays bounded by its length)
    let tail = "", from = -1;
    for (let j = run.length - 1; j >= 0; j--) {
      tail = (run[j].text ?? "") + tail;
      if (tail.length > text.length) break;
      if (tail && text.startsWith(tail)) from = j;
    }
    if (from >= 0) { const n = run.length - from; out.splice(out.length - n, n); run = run.slice(0, from); }
    out.push(e); run.push(e);
  }
  return out;
}
export function parseLines(lines: string[]): Entry[] { return collapseTexts(parseLinesRaw(lines)); }
function parseLinesRaw(lines: string[]): Entry[] {
  const out: Entry[] = [];
  let t: string | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (line[0] !== "{") { out.push({ kind: line.startsWith("[fm]") ? "fm" : "system", t, text: redact(line.replace(/^\[fm\]\s*/, "").slice(0, 2000)) }); continue; }
    let o: any; try { o = JSON.parse(line); } catch { continue; }
    if (typeof o.timestamp === "string") t = o.timestamp;
    if (typeof o.ts === "string") t = o.ts;
    // Studio's round record (docs/units/round-record.md): {ts, type: message|tool_call|tool_result|status}
    if (o.type === "message" && typeof o.text === "string") { if (o.text.trim()) out.push({ kind: "text", t, text: redact(o.text) }); continue; }
    if (o.type === "tool_call") { out.push({ kind: "tool", t, id: String(o.id ?? ""), name: String(o.name ?? "tool"), args: red(o.args ?? {}) }); continue; }
    if (o.type === "tool_result") { const full = redact(typeof o.result === "string" ? o.result : JSON.stringify(o.result ?? "")); out.push({ kind: "toolResult", t, toolId: String(o.id ?? ""), body: full.slice(0, RESULT_MAX), size: full.length, truncated: full.length > RESULT_MAX, isError: !!o.error }); continue; }
    if (o.type === "status") { out.push({ kind: o.error || o.status === "failed" ? "error" : "system", t, text: redact([o.status, o.error, o.message].filter(Boolean).join(" · ")) }); continue; }
    if (o.parent_tool_use_id) continue;
    if (o.type === "assistant") {
      for (const c of o.message?.content ?? []) {
        if (c.type === "text" && c.text?.trim()) out.push({ kind: "text", t, text: redact(c.text) });
        else if (c.type === "tool_use") out.push({ kind: "tool", t, id: String(c.id), name: String(c.name), args: red(c.input ?? {}) });
      }
    } else if (o.type === "user") {
      const content = o.message?.content;
      for (const c of Array.isArray(content) ? content : []) if (c.type === "tool_result") {
        const full = redact(resultText(c.content));
        out.push({ kind: "toolResult", t, toolId: String(c.tool_use_id), body: full.slice(0, RESULT_MAX), size: full.length, truncated: full.length > RESULT_MAX, isError: !!c.is_error });
      }
    } else if (o.type === "result") {
      out.push({ kind: o.is_error ? "error" : "result", t, text: redact(String(o.result ?? o.subtype ?? "")) });
    } else if (o.type === "system" && o.subtype === "init") {
      out.push({ kind: "system", t, text: `session started · ${o.model ?? ""}`.trim() });
    } else if (o.type === "system" && o.subtype === "task_started" && o.description) {
      out.push({ kind: "system", t, text: redact(`task: ${o.description}`) });
    } else if (o.type === "item.completed" || o.msg?.type) { // codex exec --json
      const it = o.item ?? o.msg ?? {};
      if (it.type === "command_execution" || it.command) out.push({ kind: "tool", t, id: String(it.id ?? ""), name: "shell", args: red({ command: it.command }) },
        ...(it.aggregated_output ? [{ kind: "toolResult" as const, t, toolId: String(it.id ?? ""), body: redact(String(it.aggregated_output)).slice(0, RESULT_MAX), size: String(it.aggregated_output).length, truncated: String(it.aggregated_output).length > RESULT_MAX }] : []));
      else if (it.text || it.message) out.push({ kind: "text", t, text: redact(String(it.text ?? it.message)) });
    }
  }
  return out;
}

// ---------- the main session, read backwards ----------
export type Turn = { role: "captain" | "firstmate" | "tool"; t: string | null; text: string; tools?: { name: string; args: unknown }[]; results?: { toolId: string; body: string; size: number; truncated: boolean }[] };
export function historyPage(file: string, before?: number, limit = HISTORY_PAGE): { entries: Turn[]; cursor: number; atStart: boolean; size: number } {
  let fd = -1;
  try {
    fd = openSync(file, "r");
    const size = fstatSync(fd).size;
    const end = before == null || !(before >= 0) || before > size ? size : before;
    const turns: Turn[] = [];
    let cursor = end, pos = end, buf = Buffer.alloc(0), full = false;
    while (!full && pos > 0) {
      const len = Math.min(pos, 1 << 20); pos -= len;
      const b = Buffer.alloc(len); readSync(fd, b, 0, len, pos);
      buf = Buffer.concat([b, buf]);
      let start = 0;
      if (pos > 0) { const nl = buf.indexOf(10); if (nl < 0) continue; start = nl + 1; } // the first line may be cut: keep it for the next read
      const lines = buf.subarray(start).toString("utf8").split("\n");
      const starts: number[] = []; let at = pos + start;
      for (const l of lines) { starts.push(at); at += Buffer.byteLength(l) + 1; }
      for (let i = lines.length - 1; i >= 0; i--) {
        if (starts[i] >= cursor) continue; // at or after the cursor: already read (or the empty piece after the last newline)
        const t = lines[i].trim() ? turnOf(lines[i]) : null;
        if (t) { if (turns.length >= limit) { full = true; break; } turns.unshift(t); }
        cursor = starts[i];
      }
      buf = buf.subarray(0, start);
    }
    return { entries: turns, cursor, atStart: cursor <= 0, size };
  } catch { return { entries: [], cursor: 0, atStart: true, size: 0 }; } finally { if (fd >= 0) closeSync(fd); }
}
function turnOf(line: string): Turn | null {
  let o: any; try { o = JSON.parse(line); } catch { return null; }
  if (o.isSidechain || (o.type !== "user" && o.type !== "assistant")) return null;
  const t = typeof o.timestamp === "string" ? o.timestamp : null;
  const c = o.message?.content;
  if (o.type === "user") {
    if (typeof c === "string") return /^<(local-command|command-name|system)/.test(c) ? null : { role: "captain", t, text: redact(c) };
    const texts = (c ?? []).filter((x: any) => x.type === "text").map((x: any) => x.text).join("\n");
    const results = (c ?? []).filter((x: any) => x.type === "tool_result").map((x: any) => { const full = redact(resultText(x.content)); return { toolId: String(x.tool_use_id), body: full.slice(0, 4000), size: full.length, truncated: full.length > 4000 }; });
    if (results.length) return { role: "tool", t, text: "", results };
    return texts.trim() ? { role: "captain", t, text: redact(texts) } : null;
  }
  const text = (c ?? []).filter((x: any) => x.type === "text").map((x: any) => x.text).join("\n");
  const tools = (c ?? []).filter((x: any) => x.type === "tool_use").map((x: any) => ({ name: String(x.name), args: red(x.input ?? {}) }));
  return text.trim() || tools.length ? { role: "firstmate", t, text: redact(text), tools } : null;
}

/** A round record's prompt: its front-matter header (run, node, round, head, brief, ledger, …) and the exact body sent. */
export function recordPrompt(text: string) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  const header: Record<string, unknown> = {};
  if (m) for (const l of m[1].split("\n")) { const k = /^([\w-]+):\s?(.*)$/.exec(l); if (!k) continue; try { header[k[1]] = JSON.parse(k[2]); } catch { header[k[1]] = k[2]; } }
  const body = m ? text.slice(m[0].length) : text;
  const v = promptView(body, () => null);
  const head = typeof header.head === "string" ? header.head : "";
  const hdr: Section = { kind: "header", label: "Round record", text: redact(m ? m[0] : ""),
    binding: m ? { record: String(header.brief ?? ""), round: Number(header.round ?? 0), head, time: typeof header.sent === "string" ? header.sent : null, file: null, carried: null } : null };
  return { raw: redact(text), bytes: Buffer.byteLength(text), header: red(header), body: v.raw, sections: m ? [hdr, ...v.sections] : v.sections };
}

// ---------- a node round's invocations: attempts and hops (agent.ts roundRecord names) ----------
export const INVOCATION = /^prompt(\.attempt([1-9]\d*))?(\.hop([1-9]\d*))?\.md$/;
const suffixOf = (name: string) => name.slice("prompt".length, -".md".length);
export function invocations(d: string): { name: string; attempt: number; hop: number }[] {
  let files: string[] = []; try { files = readdirSync(d); } catch {}
  return files.map((f) => { const m = INVOCATION.exec(f); return m ? { name: f, attempt: Number(m[2] ?? 1), hop: Number(m[4] ?? 0) } : null })
    .filter(Boolean).sort((a, b) => a!.attempt - b!.attempt || a!.hop - b!.hop) as { name: string; attempt: number; hop: number }[];
}
/** The report an invocation wrote: its own report<sfx>.json, else report.json when it names that prompt (or names none and this is the first). */
function invocationReport(d: string, name: string): any {
  const sfx = suffixOf(name);
  const parse = (t: string | null) => { if (t == null) return null; try { return redactJSON(JSON.parse(t)); } catch { return { said: redactText(t) }; } };
  if (sfx) { const own = parse(readText(join(d, `report${sfx}.json`))); if (own) return own; }
  const shared = parse(readText(join(d, "report.json")));
  if (shared) { const owner = typeof shared.prompt === "string" ? shared.prompt : "prompt.md"; return owner === name ? shared : null; }
  if (!sfx) { const t = ["report.md", "report.txt"].map((f) => readText(join(d, f))).find((x) => x != null); if (t != null) return { said: redactText(t) }; }
  return null;
}
/** One invocation's transcript, read incrementally. Its own stream<sfx>.jsonl when it exists (cursor: a byte
 *  offset); else its segment of the shared stream.jsonl, from its "started" status to the next one (cursor:
 *  "<byte offset>|<the invocation that owns the stream at that offset>"). Each read takes at most 16 MiB of
 *  complete lines; the next poll continues from the cursor. */
export function invocationStream(d: string, name: string, after: string | number | null): { entries: Entry[]; next: string | number; size: number } {
  const sfx = suffixOf(name);
  if (sfx && existsSync(join(d, `stream${sfx}.jsonl`))) return readStream(join(d, `stream${sfx}.jsonl`), Number(String(after ?? 0).split("|")[0]) || 0);
  const [o, w] = String(after ?? "0").split("|");
  let offset = Math.max(0, Number(o) || 0), owner = w && INVOCATION.test(w) ? w : "prompt.md";
  const file = join(d, "stream.jsonl");
  let fd = -1;
  try {
    fd = openSync(file, "r");
    const size = fstatSync(fd).size;
    if (offset > size) { offset = 0; owner = "prompt.md"; }
    const len = Math.min(size - offset, 16 << 20);
    const b = Buffer.alloc(len); const n = readSync(fd, b, 0, len, offset);
    const end = b.subarray(0, n).lastIndexOf(10) + 1;
    const mine: string[] = [];
    for (const line of b.subarray(0, end).toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      if (line.includes('"started"')) { try { const x = JSON.parse(line); if (x?.type === "status" && x.status === "started" && typeof x.prompt === "string" && INVOCATION.test(x.prompt)) owner = x.prompt; } catch {} }
      if (owner === name) mine.push(line);
    }
    return { entries: parseLines(mine), next: `${offset + end}|${owner}`, size };
  } catch { return { entries: [], next: `${offset}|${owner}`, size: 0 }; } finally { if (fd >= 0) closeSync(fd); }
}

// ---------- routes ----------
type Who = { kind: string };
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const readText = (f: string) => { try { return readFileSync(f, "utf8"); } catch { return null; } };
function newestAttempt(base: string): string | null {
  let best: string | null = null, m = -1;
  try { for (const n of readdirSync(base)) { const p = join(base, n); const log = existsSync(join(p, "cli.log")) ? join(p, "cli.log") : existsSync(join(p, "prompt.md")) ? join(p, "prompt.md") : null; if (!log) continue; const t = statSync(log).mtimeMs; if (t > m) { m = t; best = n; } } } catch {}
  return best;
}
const promptView = (raw: string, bind: (s: Section) => Binding | null) => { const r = redact(raw); return { raw: r, bytes: Buffer.byteLength(raw), sections: sections(r).map((s) => (s.kind === "brief" ? { ...s, binding: bind(s) } : s)) }; };
const summarize = (p: { bytes: number; sections: Section[] }) => ({ bytes: p.bytes, sections: p.sections.map((s) => ({ kind: s.kind, label: s.label, bytes: Buffer.byteLength(s.text), binding: s.binding ? { round: s.binding.round, head: s.binding.head.slice(0, 7) } : undefined })) });

export function createTranscripts(o: { stateDir: string; dataDir: string; sessionFile: () => string | null }) {
  const settingsFile = join(o.dataDir, "transcripts.json");
  const settings = (): { phoneRaw: boolean } => { try { return { phoneRaw: JSON.parse(readFileSync(settingsFile, "utf8")).phoneRaw === true }; } catch { return { phoneRaw: false }; } };
  const raw = (who: Who) => who.kind !== "phone" || settings().phoneRaw;
  const runDir = (actor: string) => join(o.stateDir, "runs", actor);
  const nodeDir = (run: string, node: string, round: string) => join(o.dataDir, "runs", run, "nodes", node, round);

  /** A crew round runs while its process lives and it has not written a result since it started. */
  const crewLive = (base: string) => {
    let pid = 0; try { pid = Number(JSON.parse(readFileSync(join(base, "process.json"), "utf8")).pid); } catch {}
    if (!(pid > 1)) return false;
    try { process.kill(pid, 0); } catch (e: any) { if (e?.code !== "EPERM") return false; }
    const mt = (f: string) => { try { return statSync(join(base, f)).mtimeMs; } catch { return 0; } };
    return !(mt("last-result.json") && mt("last-result.json") >= mt("process.json"));
  };
  /** A node round is live while the engine works on it (data/runs/<run>/run.json): the run is active, and its node
   *  is running this round, or is pending and queued to retry it (between attempts and hand-offs no file says so). */
  const nodeActive = (run: string, node: string, round: string) => {
    let r: any = null; try { r = JSON.parse(readFileSync(join(o.dataDir, "runs", run, "run.json"), "utf8")); } catch { return false; }
    if (!["queued", "running", "waiting", "paused"].includes(String(r?.status ?? ""))) return false;
    const n = r?.nodes?.[node]; const v = Number(round);
    if (!n || !Number.isInteger(v)) return false;
    if (n.state === "running") return Number(n.visits) === v;
    if (n.state === "pending") return Array.isArray(r.queue) && r.queue.includes(node) && Number(n.visits) + 1 === v;
    return false;
  };

  async function handle(req: Request, url: URL, who: Who, writing: boolean): Promise<Response | null> {
    const p = url.pathname;
    if (p === "/api/transcripts/settings") {
      if (!writing) return json(settings());
      if (who.kind === "phone") return json({ error: "do this on the Mac", code: "desktopOnly" }, 403);
      let b: any = {}; try { b = await req.json(); } catch {}
      writeFileSync(settingsFile, JSON.stringify({ phoneRaw: b?.phoneRaw === true }, null, 2), { mode: 0o600 });
      return json(settings());
    }
    if (writing) return null;
    const after = Math.max(0, Number(url.searchParams.get("after") ?? 0) || 0);
    let m = /^\/api\/crew\/([^/]+)\/(invocation|transcript|report)$/.exec(p);
    if (m) {
      const actor = decodeURIComponent(m[1]);
      if (!NAME.test(actor) || !existsSync(join(runDir(actor), "identity.json"))) return json({ error: "no such crew round" }, 404);
      const base = runDir(actor);
      const identity = (() => { try { return JSON.parse(readFileSync(join(base, "identity.json"), "utf8")); } catch { return {}; } })();
      const attempt = newestAttempt(base);
      const dir = attempt ? join(base, attempt) : null;
      if (m[2] === "invocation") {
        const text = dir ? readText(join(dir, "prompt.md")) : null;
        const prompt = text == null ? null : promptView(text, (s) => briefBinding(o.stateDir, identity.project ?? null, identity.task ?? null, s.text));
        const attempts = (() => { try { return readdirSync(base).filter((n) => existsSync(join(base, n, "prompt.md")) || existsSync(join(base, n, "cli.log"))).sort(); } catch { return []; } })();
        const head = { actor, identity: { role: identity.role, task: identity.task, round: identity.round, attempt: identity.attempt, vendor: identity.vendor, model: identity.model_requested ?? identity.model, project: identity.project },
          attempt, attempts, report: !!dir && existsSync(join(dir, "final.txt")), pinnedPrompt: existsSync(join(base, "pinned-prompt.md")) };
        if (!prompt) return json({ ...head, prompt: null });
        return json(raw(who) ? { ...head, prompt } : { ...head, prompt: null, summary: summarize(prompt), phone: true });
      }
      if (m[2] === "report") { const t = dir ? readText(join(dir, "final.txt")) : null; return t == null ? json({ error: "no final report for that round" }, 404) : json({ actor, attempt, text: redact(t) }); }
      const log = dir ? (existsSync(join(dir, "cli.log")) ? join(dir, "cli.log") : join(dir, "run.log")) : null;
      // the offset belongs to one attempt's file: a newer attempt starts again at 0
      const asked = url.searchParams.get("attempt");
      const reset = !!asked && asked !== attempt;
      const r = log ? readStream(log, reset ? 0 : after) : { entries: [], next: 0, size: 0 };
      const live = crewLive(base);
      return json(raw(who) ? { ...r, attempt, reset, live } : { entries: [], next: r.next, size: r.size, attempt, reset, live, summary: { entries: r.entries.length, tools: r.entries.filter((e) => e.kind === "tool").length }, phone: true });
    }
    if (p === "/api/firstmate/history") {
      const file = o.sessionFile();
      if (!file || !existsSync(file)) return json({ entries: [], cursor: 0, atStart: true, file: null });
      const before = url.searchParams.has("before") ? Number(url.searchParams.get("before")) : undefined;
      const page = historyPage(file, before);
      return json(raw(who) ? { ...page, file: file.split("/").pop() } : { entries: [], cursor: page.cursor, atStart: page.atStart, summary: { turns: page.entries.length, bytes: page.size }, phone: true });
    }
    if (p === "/api/node-runs") {
      const root = join(o.dataDir, "runs"), out: any[] = [];
      try {
        for (const run of readdirSync(root)) { if (!NAME.test(run)) continue; const nodes = join(root, run, "nodes"); if (!existsSync(nodes)) continue;
          for (const node of readdirSync(nodes)) { if (!NAME.test(node)) continue;
            for (const round of readdirSync(join(nodes, node))) { if (!NAME.test(round)) continue; const d = join(nodes, node, round);
              let mtime = 0; try { mtime = statSync(d).mtimeMs; } catch {}
              out.push({ run, node, round, prompt: existsSync(join(d, "prompt.md")), stream: existsSync(join(d, "stream.jsonl")), report: ["report.md", "report.txt", "report.json"].some((f) => existsSync(join(d, f))), updated: new Date(mtime).toISOString() }); } } }
      } catch {}
      return json(out.sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 200));
    }
    m = /^\/api\/node-runs\/([^/]+)\/([^/]+)\/([^/]+)(\/transcript)?$/.exec(p);
    if (m) {
      const [run, node, round] = [m[1], m[2], m[3]].map(decodeURIComponent);
      if (![run, node, round].every((x) => NAME.test(x))) return json({ error: "bad name" }, 400);
      const d = nodeDir(run, node, round);
      if (!existsSync(d)) return json({ error: "no such node run" }, 404);
      // every invocation of the round: retries (.attempt<k>) and hand-offs (.hop<n>), in order
      const invs = invocations(d);
      const newest = invs.at(-1)?.name ?? "prompt.md";
      const want = url.searchParams.get("prompt") ?? newest;
      if (!INVOCATION.test(want)) return json({ error: "bad prompt name" }, 400);
      if (invs.length && !invs.some((x) => x.name === want)) return json({ error: "no such attempt or hop" }, 404);
      if (m[4]) {
        const r = invocationStream(d, want, url.searchParams.get("after"));
        const live = nodeActive(run, node, round);
        return json(raw(who) ? { ...r, live, newest, promptName: want } : { entries: [], next: r.next, live, newest, summary: { entries: r.entries.length }, phone: true });
      }
      const text = readText(join(d, want));
      const prompt = text == null ? null : recordPrompt(text);
      const sfx = suffixOf(want);
      const system = readText(join(d, `system${sfx}.md`));
      const report = invocationReport(d, want);
      return json(raw(who) ? { run, node, round, invocations: invs, prompts: invs.map((x) => x.name), newest, promptName: want, prompt, system: system == null ? null : redact(system), report }
        : { run, node, round, invocations: invs, prompts: invs.map((x) => x.name), newest, promptName: want, prompt: null, summary: prompt ? summarize(prompt) : null, report: report ? { status: report.status, tools: report.tools } : null, phone: true });
    }
    return null;
  }
  return { handle, settings };
}
