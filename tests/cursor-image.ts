import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The Cursor image job (src/providers/cursor-image.ts) on the strict offline fixture tests/fixture/cursor-agent.mjs, and
// the JPEG decoder it converts with (src/providers/jpeg.ts) against libjpeg's own decodes (tests/fixture/jpeg/*.ppm:
// djpeg -nosmooth -dct float of each .jpg). No real account or vendor request.
//   bun tests/cursor-image.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
process.env.CREW_KEYCHAIN_TOOL = "none";
const { decodeJpeg, jpegToPng } = await import("../src/providers/jpeg");
const { generateCursorImage, cursorImagePermissions, CursorImageFailure } = await import("../src/providers/cursor-image");
const { verifyImagePng } = await import("../src/providers/codex-image");
const { rulesSection } = await import("../src/operating-rules");
import type { ProviderCapability } from "../src/providers/policy";

let passed = 0, failed = 0;
const ok = (v: unknown, n: string, extra = "") => { console.log(`${v ? "ok" : "FAIL"} ${n}${v ? "" : ` ${extra}`}`); v ? passed++ : failed++; };
const JPEG = join(import.meta.dir, "fixture", "jpeg"), FIXTURE = join(import.meta.dir, "fixture", "cursor-agent.mjs");

console.log("the JPEG decoder");
for (const f of readdirSync(JPEG).filter((n) => n.endsWith(".jpg") && existsSync(join(JPEG, n.replace(/\.jpg$/, ".ppm")))).sort()) {
  const ref = readFileSync(join(JPEG, f.replace(/\.jpg$/, ".ppm"))), head = ref.toString("latin1", 0, 20).split(/\s+/), w = Number(head[1]), h = Number(head[2]), gray = head[0] === "P5";
  const raw = ref.subarray(ref.length - w * h * (gray ? 1 : 3)), want = gray ? Uint8Array.from({ length: w * h * 3 }, (_, i) => raw[Math.floor(i / 3)]) : raw;
  const got = decodeJpeg(readFileSync(join(JPEG, f)));
  let max = 0; for (let i = 0; i < want.length; i++) max = Math.max(max, Math.abs(want[i] - got.rgb[i]));
  ok(got.width === w && got.height === h && max <= 3, `${f}: ${w}x${h}, every channel within 3 of libjpeg`, `max ${max}`);
}
{
  const jpeg = readFileSync(join(JPEG, "baseline-420.jpg")), png = jpegToPng(jpeg);
  ok(verifyImagePng(png.png).width === 41 && png.height === 29, "the PNG it writes passes Studio's PNG verification");
  const refused = (bytes: Uint8Array, name: string) => { let e = ""; try { decodeJpeg(bytes); } catch (x: any) { e = x.message; } ok(/^JPEG /.test(e), `${name} is refused`, e); };
  refused(jpeg.subarray(0, 300), "a truncated JPEG");
  refused(Buffer.from("not a jpeg at all"), "a non-JPEG");
  const arith = Buffer.from(jpeg); const sof = arith.indexOf(Buffer.from([0xff, 0xc0])); arith[sof + 1] = 0xc9; refused(arith, "an arithmetic-coded frame");
  const huge = Buffer.from(jpeg); huge.writeUInt16BE(5000, sof + 5); refused(huge, "a frame wider than 4096");
}

console.log("the Cursor image job");
const KEY = "crsr_acceptance" + "0".repeat(49); // the fixture's key shape; not a credential
const cap = (): ProviderCapability => ({ provider: "cursor", available: true, auth: "verified", quota: "available", at: Date.now(), expires: Date.now() + 30000, models: [{ id: "composer-2.5", efforts: [] }] });
const base = { rules: rulesSection("IMAGE-RULE-7: never start a sign-in flow", "", null), approved: { model: "composer-2.5" }, bin: FIXTURE, authorize() {}, probe: () => cap(), timeoutMs: 20000 };
const roots = () => readdirSync("/tmp").filter((n) => n.startsWith("crc.")).sort().join();
const before = roots();
async function refuses(mode: string, extra: Record<string, unknown> = {}, want?: RegExp) {
  let error = "";
  try { await generateCursorImage({ ...base, prompt: `a coffee cup CURSOR-IMAGE:${mode}`, ...extra } as any); }
  catch (e: any) { error = e.message; ok(e instanceof CursorImageFailure && e.cleanupSafe === true, `${mode}: the refusal carries a verified cleanup receipt`); }
  ok(!!error && (!want || want.test(error)), `${mode}: refused without an image`, error);
  return error;
}
process.env.CURSOR_API_KEY = KEY;
try {
  const perms = cursorImagePermissions(false);
  ok(JSON.stringify(perms) === JSON.stringify({ allow: ["GenerateImage(*)"], deny: ["Shell(*)", "Read(**)"] }), "the image turn allows only GenerateImage and denies every Shell and Read (no Write deny: it refuses saving the image)", JSON.stringify(perms));
  const refPerms = cursorImagePermissions(true), home = (await import("node:os")).homedir();
  ok(refPerms.deny.includes("Shell(*)") && !refPerms.deny.includes("Read(**)") && [".codex", ".ssh", ".config"].every((d) => refPerms.deny.includes(`Read(${join(home, d)}/**)`)),
    "with a reference.png no Read(**) deny hides it (cursor-agent checks denies first); the secret folders are denied by name", JSON.stringify(refPerms).slice(0, 300));
  const image = await generateCursorImage({ ...base, prompt: "a red coffee cup on white" });
  const want = jpegToPng(readFileSync(join(JPEG, "cursor-image.jpg"))).png;
  ok(image.provider === "cursor" && image.model === "composer-2.5" && image.effort === null && image.mime === "image/png" && image.width === 64 && image.height === 64, "the job returns a 64x64 PNG from Cursor on the approved model", JSON.stringify({ ...image, bytes: image.bytes.length }));
  ok(image.bytes.equals(want) && image.sha256 === createHash("sha256").update(want).digest("hex"), "the PNG is the tool call's imageData (the fixture's JPEG), converted");
  ok(image.operatingRules === base.rules.hash, "the job hands the operating rules to cursor-agent (AGENTS.md) and returns their hash");
  const denied = await generateCursorImage({ ...base, prompt: "a cup CURSOR-IMAGE:denied" });
  ok(denied.sha256 === image.sha256, "a shell call the permissions denied does not stop the image");
  const escaped = await generateCursorImage({ ...base, prompt: "a cup CURSOR-IMAGE:escape" });
  ok(escaped.sha256 === image.sha256 && !readdirSync("/private/tmp").some((n) => n.startsWith("crew-cursor-image-escape-")), "the OS sandbox keeps the process out of its workspace, its private root and /private/tmp (the fixture's writes there all fail)");
  const refined = await generateCursorImage({ ...base, prompt: "keep the cup, warmer light", reference: { bytes: image.bytes, sha256: image.sha256 } });
  ok(refined.sha256 === image.sha256, "a redraw hands the previous PNG in as reference.png, readable by that file alone");
  await refuses("success", { reference: { bytes: image.bytes, sha256: "0".repeat(64) } }, /reference hash differs/);
  await refuses("refused", {}, /generation refused/);
  await refuses("duplicate", {}, /duplicated/);
  await refuses("edit", {}, /unexpected tool: editToolCall/);
  await refuses("fail", {}, /turn failed/);
  await refuses("success", { rules: undefined }, /operating rules missing/);
  await refuses("success", { rules: { ...base.rules, text: "forged" } }, /operating rules missing/);
  await refuses("success", { probe: () => ({ ...cap(), auth: "missing", refusal: "missing-login" }) }, /capability is unverified/);
  await refuses("success", { approved: { model: "gpt-image" } }, /model unavailable/);
  await refuses("success", { prompt: "x".repeat(16001) }, /request invalid/);
  const coffee = await generateCursorImage({ ...base, prompt: "coffee " + "context ".repeat(3000), contextProfile: "coffee-kit" });
  ok(coffee.sha256 === image.sha256, "the coffee kit's complete evidence fits beyond the generic 16 KB cap");
  const aborted = new AbortController(); aborted.abort(); let probes = 0;
  await refuses("success", { signal: aborted.signal, probe: () => { probes++; return cap(); } }, /cancelled/);
  ok(probes === 0, "a cancelled owner neither probes nor launches");
  delete process.env.CURSOR_API_KEY;
  await refuses("success", {}, /login unavailable/);
  ok(roots() === before, "every private root is removed after the job", `${before} -> ${roots()}`);
} finally { delete process.env.CURSOR_API_KEY; }
console.log(`cursor-image: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
