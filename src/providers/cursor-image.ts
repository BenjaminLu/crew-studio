import { openScopedProxy } from "../egress-client";
import { localUnrestricted } from "../local-execution";
// Dedicated image job on Cursor, the counterpart of the Codex image app-server (codex-image.ts), chosen only when the
// image step's member is on Cursor. One `cursor-agent -p` turn in a private root of its own (needs.ts cursorRoot):
// cli-config.json allows only the GenerateImage tool and denies every Shell and Read; Write is not denied, because a
// Write deny also refuses cursor-agent's own save of the generated asset (probed live), so the OS sandbox scopes writes
// instead: the process writes only its private HOME, data dir and tmp, never its workspace or anything else. No MCP
// server is registered. The picture is taken from the tool call's imageData in the stream (never from a file path the
// model names) and converted from JPEG to the PNG every Studio image consumer takes.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { binArgv } from "../host/jsonl";
import { Egress } from "../egress";
import { roundProfile, sandboxInfo } from "../runtime/checks";
import { OPERATING_RULES_HEADING, rulesHash, type RulesSection } from "../operating-rules";
import { verifyImagePng, type CodexImage, type CodexImageReference } from "./codex-image";
import { CURSOR_HOSTS, probeCursor } from "./cursor";
import { jpegToPng } from "./jpeg";
import { cursorLogin } from "./login";
import { cursorNeeds, cursorRoot } from "./needs";
import type { ProviderCapability } from "./policy";
import { probeProcess } from "./probe-process";

const MAX_IMAGE = 16 * 1024 * 1024;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
export type CursorImage = Omit<CodexImage, "provider" | "effort"> & { provider: "cursor"; effort: null };
/** What an image step or the coffee kit gets back: the Codex or the Cursor image job's verified PNG. */
export type StudioImage = CodexImage | CursorImage;
export type CursorImageOptions = {
  contextProfile?: "coffee-kit";
  reference?: CodexImageReference;
  prompt: string; approved: { model: string }; authorize(): void; signal?: AbortSignal;
  /** the captain's operating rules (Studio-wide and project), read by the caller at job start; required, never omitted */
  rules: RulesSection;
  bin?: string; timeoutMs?: number;
  /** Source-owned dependency injection; never populated from a browser request. */
  probe?: (models: string[], bin: string) => ProviderCapability;
};
/** The cli-config.json permissions of a Cursor image job. */
export const cursorImagePermissions = (reference: boolean) => ({ allow: ["GenerateImage(*)", ...(reference ? ["Read(reference.png)"] : [])], deny: ["Shell(*)", "Read(**)"] });
/** The tool kinds an image turn may complete: listing the image tool and generating once. */
const EXPECTED = new Set(["getMcpToolsToolCall", "generateImageToolCall"]);

export class CursorImageFailure extends Error {
  constructor(message: string, readonly cleanupSafe: boolean) { super(message); this.name = "CursorImageFailure"; }
}

function approvedCapability(c: ProviderCapability, model: string) {
  const now = Date.now();
  if (!c || c.provider !== "cursor" || c.available !== true || c.auth !== "verified" || c.quota !== "available" || c.refusal || !Number.isFinite(c.at) || !Number.isFinite(c.expires) || c.at > now || c.expires <= now || c.expires - c.at > 300000 || !Array.isArray(c.models)) throw new Error("Cursor image account capability is unverified");
  if (!c.models.some((m) => m?.id === model)) throw new Error("Cursor image configured model unavailable");
}
const why = (r: any) => String(r?.error?.error ?? r?.error?.errorMessage ?? r?.rejected?.reason ?? r?.permissionDenied?.error ?? "no result").slice(0, 200);

async function runCursorImage(input: CursorImageOptions): Promise<CursorImage> {
  const o = { ...input, approved: input.approved && { ...input.approved } };
  if (o.reference && (!Buffer.isBuffer(o.reference.bytes) || o.reference.bytes.length > MAX_IMAGE || typeof o.reference.sha256 !== "string")) throw new Error("Cursor image reference invalid");
  const reference = o.reference ? { bytes: Buffer.from(o.reference.bytes), sha256: o.reference.sha256 } : undefined;
  if (reference) { verifyImagePng(reference.bytes); if (createHash("sha256").update(reference.bytes).digest("hex") !== reference.sha256) throw new Error("Cursor image reference hash differs"); }
  const guard = () => { if (o.signal?.aborted) throw new Error("Cursor image cancelled"); o.authorize(); };
  guard();
  if (!o.rules || typeof o.rules.text !== "string" || !o.rules.text.startsWith(OPERATING_RULES_HEADING) || rulesHash(o.rules.text) !== o.rules.hash) throw new Error("Cursor image operating rules missing");
  if (typeof o.prompt !== "string" || !o.prompt.trim() || Buffer.byteLength(o.prompt) > (o.contextProfile === "coffee-kit" ? 262144 : 16000) || !o.approved || typeof o.approved.model !== "string" || !MODEL.test(o.approved.model)) throw new Error("Cursor image request invalid");
  const timeout = o.timeoutMs ?? 180000;
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 240000) throw new Error("Cursor image deadline invalid");
  if (!sandboxInfo().ok && !localUnrestricted()) throw new Error("Cursor image needs the OS sandbox");
  const bin = o.bin ?? process.env.CREW_CURSOR_BIN ?? "cursor-agent", model = o.approved.model;
  approvedCapability((o.probe ?? probeCursor)([model], bin), model); guard();
  const root = cursorRoot(), home = join(root, "h"), work = join(root, "w"), data = join(root, "d"), temp = join(root, "t");
  mkdirSync(temp, { mode: 0o700 });
  const needs = cursorNeeds(bin, CURSOR_HOSTS);
  const egress = new Egress(); let lease: Awaited<ReturnType<typeof openScopedProxy>> | null = null;
  let proc: ReturnType<typeof probeProcess> | undefined; let clean = true, timer: ReturnType<typeof setTimeout> | undefined;
  let failure: Error | null = null, failTurn: (e: Error) => void = () => {};
  const stop = (e: Error) => { failure ??= e; failTurn(e); proc?.kill(); };
  const abort = () => stop(new Error("Cursor image cancelled"));
  try {
    const login = cursorLogin(); if (!login.ok) throw new Error("Cursor image login unavailable"); guard();
    if (!localUnrestricted()) { await egress.start(); guard(); lease = await openScopedProxy(egress, needs.hosts); guard(); }
    writeFileSync(join(home, ".config", "cursor", "cli-config.json"), JSON.stringify({ version: 1, permissions: cursorImagePermissions(!!reference) }), { mode: 0o600 });
    writeFileSync(join(work, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: {} }), { mode: 0o600 });
    writeFileSync(join(work, "AGENTS.md"), "Generate exactly one requested image with the GenerateImage tool only. No shell, web, file reading or writing, other tools, delegated tasks or permissions. Return the generated image, not a promise or instructions.\n\n" + o.rules.text, { mode: 0o600 });
    if (reference) writeFileSync(join(work, "reference.png"), reference.bytes, { mode: 0o600 });
    // writes: the private HOME, the data dir (where cursor-agent saves the asset) and tmp; the workspace stays read-only
    const profile = join(temp, "image.sb"); writeFileSync(profile, roundProfile({ cwd: work, tmp: temp, writes: [home, data], reads: needs.reads, proxyPort: lease?.port ?? 1, toolPort: 1 }));
    const proxy = lease?.url ?? "";
    const env: Record<string, string> = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: home, TMPDIR: temp, LANG: "en_US.UTF-8", ...login.env, XDG_CONFIG_HOME: join(home, ".config"), CURSOR_DATA_DIR: data, AGENT_CLI_CREDENTIAL_STORE: "memory", HTTPS_PROXY: proxy, HTTP_PROXY: proxy, https_proxy: proxy, http_proxy: proxy, ALL_PROXY: proxy, all_proxy: proxy, NO_PROXY: "", no_proxy: "" };
    if (localUnrestricted()) for (const key of ["HTTPS_PROXY", "HTTP_PROXY", "https_proxy", "http_proxy", "ALL_PROXY", "all_proxy"]) delete env[key];
    const text = `Generate exactly one image with the GenerateImage tool${reference ? ', using reference.png in the workspace as its reference image (referenceImagePaths: ["reference.png"])' : ""}. ${o.prompt}`;
    const args = ["-p", "--output-format", "stream-json", "--trust", "--sandbox", "disabled", "--workspace", work, "--model", model, text];
    let imageData: string | null = null, terminal = false, complete: () => void = () => {};
    const finished = new Promise<void>((resolve, reject) => { complete = resolve; failTurn = reject; }); finished.catch(() => {});
    proc = probeProcess(localUnrestricted() ? binArgv(bin, args) : ["/usr/bin/sandbox-exec", "-f", profile, ...binArgv(bin, args)], work, env, (m: any) => {
      if (terminal) return;
      if (m?.type === "tool_call" && m.subtype === "completed") {
        const kind = Object.keys(m.tool_call ?? {})[0] ?? "", result = m.tool_call?.[kind]?.result;
        if (kind === "generateImageToolCall") {
          const data = result?.success?.imageData;
          if (imageData !== null) stop(new Error("Cursor image generation duplicated"));
          else if (typeof data !== "string" || !data) stop(new Error(`Cursor image generation refused: ${why(result)}`));
          else imageData = data;
        } else if (!EXPECTED.has(kind) && result?.success) stop(new Error("Cursor image unexpected tool: " + (/^[A-Za-z]{1,48}$/.test(kind) ? kind : "unsupported")));
      } else if (m?.type === "result") {
        if (m.is_error || m.subtype !== "success") { stop(new Error(`Cursor image turn failed: ${String(m.result ?? "").slice(0, 200)}`)); return; }
        terminal = true; complete();
      }
    }, { timeoutMs: timeout, bytes: 48 * 1024 * 1024, lineBytes: 32 * 1024 * 1024 });
    proc.exited.then(() => { if (!terminal) stop(new Error("Cursor image process stopped before verified completion")); }, () => stop(new Error("Cursor image process cleanup unavailable")));
    o.signal?.addEventListener("abort", abort, { once: true }); guard();
    timer = setTimeout(() => stop(new Error("Cursor image deadline expired")), timeout);
    await finished; guard(); if (failure) throw failure;
    await proc.stop(); clean = true; guard(); if (failure) throw failure; if (proc.output().failure) throw new Error("Cursor image protocol limit or deadline exceeded");
    const b64 = imageData as string | null;
    if (!b64 || b64.length > Math.ceil(MAX_IMAGE * 4 / 3) + 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(b64)) throw new Error("Cursor image bytes unavailable");
    const raw = Buffer.from(b64, "base64");
    // cursor-agent saves a JPEG; a PNG is taken as is
    const bytes = raw[0] === 0x89 && raw[1] === 0x50 ? raw : jpegToPng(raw).png;
    const size = verifyImagePng(bytes); guard();
    return { bytes, ...size, mime: "image/png", sha256: createHash("sha256").update(bytes).digest("hex"), provider: "cursor", model, effort: null, operatingRules: o.rules.hash };
  } finally {
    clearTimeout(timer); o.signal?.removeEventListener("abort", abort);
    try { if (proc) await proc.stop(); } catch { clean = false; }
    lease?.close(); egress.stop();
    if (clean) rmSync(root, { recursive: true, force: true }); else throw new CursorImageFailure("Cursor image teardown unverified; private root retained", false);
  }
}

/** Verified process cleanup receipt for native queue and credential callers (as generateCodexImage). */
export async function generateCursorImage(options: CursorImageOptions): Promise<CursorImage> {
  try { return await runCursorImage(options); }
  catch (error) {
    if (error instanceof CursorImageFailure) throw error;
    throw new CursorImageFailure(error instanceof Error ? error.message : "Cursor image refused", true);
  }
}
