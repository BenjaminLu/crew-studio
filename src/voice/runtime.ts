// The local voice's runtime: Node plus Studio's own pinned sherpa-onnx-node in ~/.crew-studio/tools/voice, the way the
// renderer's Playwright lives in ~/.crew-studio/tools. Studio never loads the native addon itself (bun --compile cannot
// embed a .node) and never requires one from anywhere else on the Mac. The install is pinned twice: npm installs exact
// versions, and Studio accepts the result only when npm's lock records the pinned registry integrity of both packages.
//   CREW_VOICE_TOOLS  the runtime folder (tests: a temp folder)
//   CREW_NODE_BIN     the Node to run it with (as the renderer)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { renderEnv } from "../render";
import sidecarSrc from "./sidecar.cjs" with { type: "text" };
import fetchSrc from "./fetch-model.cjs" with { type: "text" };
import manifest from "./kokoro-manifest.json";

export const SHERPA_VERSION = "1.13.8";
/** npm's registry integrity of each pinned package (npm view <pkg>@1.13.8 dist.integrity) */
export const SHERPA_PINS: Record<string, string> = {
  "sherpa-onnx-node": "sha512-MsDMBdhLFTZ1GwvcGSSQhnS7g/EA8OMH6IYysCVUOM7j8Icty9KRc0E6YT1A5fWBsZwRfKOeh88QC95aRvS8ag==",
  "sherpa-onnx-darwin-arm64": "sha512-FPNgJMgnWVl/KhRTIhG3KL3A4Om63Rn4YKXc9/uHY7SzLcvqLJLc/h7UBWJwduXvv7K18t5NpxHR6XgXn4sjWw==",
  "sherpa-onnx-darwin-x64": "sha512-7BLRpjM6w4f9W46/nmkmq8lEKUayhebvcpslCVQ+6QN2uReYlZEMDZlSpXMjme+hUFrPfRz8P3UNq8ep/4d19g==",
};
export const platformPackage = (arch = process.arch) => `sherpa-onnx-darwin-${arch === "x64" ? "x64" : "arm64"}`;
export const voiceTools = () => process.env.CREW_VOICE_TOOLS || join(homedir(), ".crew-studio", "tools", "voice");
/** the version of Studio's sidecar protocol and narration rules: part of every clip's cache key */
export const SIDECAR_PROTOCOL = 1;

/** Studio's own scripts (the sidecar, the model download and its manifest) in the runtime folder, rewritten when they differ */
export function ensureScripts(dir = voiceTools()) {
  try { mkdirSync(dir, { recursive: true });
    for (const [name, text] of [["sidecar.cjs", sidecarSrc], ["fetch-model.cjs", fetchSrc], ["kokoro-manifest.json", JSON.stringify(manifest)]] as [string, string][]) {
      const f = join(dir, name); let now = ""; try { now = readFileSync(f, "utf8"); } catch {}
      if (now !== text) writeFileSync(f, text, { mode: 0o644 }); }
    return true; } catch { return false; }
}

export type RuntimeState = { ok: boolean; node: string | null; dir: string; version: string | null; why: string | null };
/** Node is found, sherpa-onnx-node and its platform package are installed at the pinned version with the pinned integrity */
export function runtimeState(dir = voiceTools()): RuntimeState {
  const node = renderEnv().node;
  const base = { node, dir, version: null as string | null };
  if (!node) return { ...base, ok: false, why: "Node.js is not installed" };
  const pkgDir = join(dir, "node_modules", "sherpa-onnx-node");
  if (!existsSync(join(pkgDir, "package.json"))) return { ...base, ok: false, why: "sherpa-onnx-node is not installed" };
  let version: string | null = null; try { version = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8")).version ?? null; } catch {}
  if (version !== SHERPA_VERSION) return { ...base, version, ok: false, why: `sherpa-onnx-node ${version ?? "?"} is installed, Studio pins ${SHERPA_VERSION}` };
  let lock: any = null; try { lock = JSON.parse(readFileSync(join(dir, "node_modules", ".package-lock.json"), "utf8")); } catch {}
  const plat = platformPackage();
  for (const name of ["sherpa-onnx-node", plat]) {
    const e = lock?.packages?.[`node_modules/${name}`];
    if (!e) return { ...base, version, ok: false, why: `${name} is not installed` };
    if (e.version !== SHERPA_VERSION || e.integrity !== SHERPA_PINS[name]) return { ...base, version, ok: false, why: `${name} is not the pinned build (${e.version ?? "?"}, integrity ${String(e.integrity ?? "none").slice(0, 16)}…)` };
  }
  if (!existsSync(join(dir, "node_modules", plat, "sherpa-onnx.node"))) return { ...base, version, ok: false, why: `${plat} has no sherpa-onnx.node` };
  return { ...base, version, ok: true, why: null };
}

/** the install Doctor runs on the captain's click: exact versions, no install scripts, into the runtime folder only */
export const installCommand = (arch = process.arch) => `mkdir -p ~/.crew-studio/tools/voice && npm install --prefix ~/.crew-studio/tools/voice --save-exact --ignore-scripts --no-audit --no-fund sherpa-onnx-node@${SHERPA_VERSION} ${platformPackage(arch)}@${SHERPA_VERSION}`;
export const downloadCommand = () => "node ~/.crew-studio/tools/voice/fetch-model.cjs";
