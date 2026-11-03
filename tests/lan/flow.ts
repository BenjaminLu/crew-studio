// Two real Studios on two ports, introduced to each other and taken through the whole relay (docs/units/lan-relay.md):
// A dispatches → B takes with B's own workflow → A assigns → B runs (stub provider, OS sandbox on) → B hands the result
// back → A refines → B takes → A assigns → B runs → B hands back → A marks it done. Shared by the two-port demo
// (scripts/lan-pair-demo.ts) and the automated suite (tests/lan-relay.ts); every step goes through the same HTTP
// routes the board uses. The short code is confirmed automatically here only: each side types the code the other
// side's screen shows, read from the other Studio's own API.
import { freePort } from "../boot.mjs";
import { bootStudio, type Studio } from "../acceptance/studio";
import { drive } from "../acceptance/drive";
import { join } from "node:path";
import { createHash } from "node:crypto";
/** What the page sends with an approval of a dispatch or a refinement: the hash of the exact prompt it showed. */
export const seenOf = (prompt: string) => createHash("sha256").update(`lan-seen\0${prompt ?? ""}`).digest("hex");

export type Pair = { A: Studio; B: Studio; lanA: number; lanB: number; keyA: string; keyB: string; close: () => Promise<void> };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function until<T>(what: string, f: () => Promise<T | null | undefined | false>, ms = 60_000): Promise<T> {
  const t0 = Date.now(); let last: unknown = null;
  while (Date.now() - t0 < ms) { try { const v = await f(); if (v) return v as T; } catch (e) { last = e; } await sleep(150); }
  throw new Error(`timed out waiting for ${what}${last ? `: ${(last as any)?.message ?? last}` : ""}`);
}
export const must = async (r: Promise<{ status: number; body: any }>, what: string) => { const x = await r; if (x.status !== 200) throw new Error(`${what}: HTTP ${x.status} ${JSON.stringify(x.body).slice(0, 400)}`); return x.body; };

/** Two Studios, each with its own temporary data folder, the OS sandbox on, its peer listener on a loopback port of its own. */
export async function bootPair(o: { examples?: boolean } = {}): Promise<Pair> {
  const [lanA, lanB] = [await freePort() as number, await freePort() as number];
  const lan = (port: number) => ({ CREW_LAN_BIND: "127.0.0.1", CREW_LAN_PEER_PORT: String(port), CREW_LAN_ALLOW_LOOPBACK: "1", CREW_LAN_MDNS: "0" });
  const [A, B] = await Promise.all([bootStudio("lan-a", { env: lan(lanA), examples: o.examples ?? false }), bootStudio("lan-b", { env: lan(lanB), examples: o.examples ?? false })]);
  // board-to-board work is off until the captain turns it on (it makes the identity); then it opens in the background
  for (const s of [A, B]) await must(s.api("/api/lan/enable", {}), `turn ${s.name}'s board-to-board work on`);
  for (const s of [A, B]) await until(`${s.name}'s relay to open`, async () => (await s.api("/api/lan")).status === 200, 120_000);
  for (const [s, n] of [[A, "Studio A"], [B, "Studio B"]] as const) await must(s.api("/api/lan/settings", { enabled: true, name: n }), `turn ${n}'s listener on`);
  const keyA = (await must(A.api("/api/lan"), "A view")).me.key, keyB = (await must(B.api("/api/lan"), "B view")).me.key;
  return { A, B, lanA, lanB, keyA, keyB, close: async () => { await Promise.all([A.close(), B.close()]); } };
}

/** Code work is based on a commit of the dispatcher's project: B's copy of the project must hold it (two clones of one
 *  project do; the test's two sandbox repositories are made apart, so B fetches A's history first). */
export function shareBase(p: Pair) {
  const a = join(p.A.data, "demo-repo"), b = join(p.B.data, "demo-repo");
  const r = Bun.spawnSync(["git", "-C", b, "fetch", "-q", "--no-tags", a, "+refs/heads/main:refs/remotes/peer-a/main"], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`B could not fetch A's sandbox history: ${r.stderr.toString().slice(0, 300)}`);
}
export const patchHash = (patch: string) => createHash("sha256").update(patch).digest("hex");

/** The introduction: B opens its window, A introduces itself, each side types the code the other side shows. */
export async function introduce(p: Pair, log: (s: string) => void = () => {}, o: { replaces?: string } = {}) {
  await must(p.B.api("/api/lan/intro/open", { minutes: 5 }), "B opens its introduction window");
  const ia = await must(p.A.api("/api/lan/intro/start", { host: "127.0.0.1", port: p.lanB }), "A introduces itself to B");
  const ib = await until("B's side of the introduction", async () => (await must(p.B.api("/api/lan"), "B view")).intros.find((i: any) => i.key === p.keyA));
  log(`引介     A ⇄ B  A 螢幕短碼 ${ia.sas} · B 螢幕短碼 ${ib.sas}${ia.sas === ib.sas ? "（相符）" : "（不符！）"}`);
  await must(p.A.api(`/api/lan/intro/${ia.id}/confirm`, { code: ib.sas, petname: "B 的看板" }), "A confirms the code B shows");
  await must(p.B.api(`/api/lan/intro/${ib.id}/confirm`, { code: ia.sas, petname: "A 的看板", ...(o.replaces ? { replaces: o.replaces } : {}) }), "B confirms the code A shows");
  await must(p.B.api("/api/lan/intro/close", {}), "B closes its window");
  const fa = (await must(p.A.api("/api/lan"), "A")).me.fingerprint, fb = (await must(p.B.api("/api/lan"), "B")).me.fingerprint;
  log(`         A 指紋 ${fa}`); log(`         B 指紋 ${fb}`);
  log(`         雙方都在桌面上確認了短碼，各自用自己的管理金鑰簽了這次引介，對方的身分已加入允許名單`);
}

const item = (s: Studio, kind: string, thread: string) => until(`${s.name}'s inbox item ${kind}`, async () => (await must(s.api("/api/lan"), "view")).items.find((i: any) => i.kind === kind && i.thread === thread && i.state === "open"));
const at = (iso: string) => new Date(iso).toLocaleString("sv-SE"); // this Mac's local time, YYYY-MM-DD HH:MM:SS
/** B's run: answer the documents workflow's acceptance card as B's captain, until it ends. */
async function runOnB(p: Pair, run: string) {
  const d = await drive(p.B, run, async (c) => c.node === "accept" ? { choice: "approve-draft", note: "B 看過草稿，核准" } : { stop: "unscripted" }, { timeoutMs: 120_000 });
  if (d.problems.length) throw new Error(d.problems.join("; "));
  if (d.view.status !== "succeeded") throw new Error(`B's Task ${run} ended ${d.view.status}`);
  return d.view;
}
async function handBack(p: Pair, thread: string) {
  const pre = await must(p.B.api(`/api/lan/threads/${thread}/handback/preview`, {}), "B previews the hand-back");
  if (!pre.ok) throw new Error(`the hand-back gate stopped it: ${JSON.stringify({ secrets: pre.secrets, protected: pre.protectedPaths })}`);
  await must(p.B.api(`/api/lan/threads/${thread}/handback`, { confirm: pre.hash }), "B hands the result back (交回)");
  return pre;
}

/** The whole relay. Returns the thread id and what each side saw. */
export async function relay(p: Pair, log: (s: string) => void = () => {}) {
  const t0 = Date.now(), stamp = () => `+${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`;
  const step = (who: string, what: string) => log(`${stamp()}  ${who.padEnd(6)} ${what}`);
  const wf = (await must(p.B.api("/api/lan/workflows"), "B's workflows")).workflows.find((w: any) => w.id === "documents");
  if (!wf?.eligible) throw new Error(`B's documents workflow is not eligible: ${JSON.stringify(wf)}`);
  // 1. A dispatches
  const t = await must(p.A.api("/api/lan/dispatch", { to: p.keyB, title: "新同事的上線清單", briefing: "請寫一頁新同事上線清單：帳號、權限、第一週要做的事。\nSTUB_FILE notes.md :: 第 1 輪：上線清單草稿（帳號、權限、第一週）",
    acceptance: ["一頁以內", "用繁體中文"], workflow: "documents" }), "A dispatches");
  step("A → B", `dispatch  thread ${t.id} · briefing ${t.rounds[0].briefing.hash.slice(0, 12)} · 建議流程 documents@v${t.suggested.version} (${t.suggested.defHash.slice(0, 12)})`);
  // 2. B takes with its own workflow
  const d1 = await item(p.B, "dispatch", t.id);
  step("B", `收件匣   dispatch 來自 ${d1.from.name}（${d1.from.short}）· 看到完整 briefing ${d1.briefing.length} 字與 agent 會拿到的 prompt`);
  await must(p.B.api(`/api/lan/items/${d1.id}/approve`, { seen: seenOf(d1.prompt), workflow: "documents", provider: "codex", roundsOnly: true, rounds: 6 }), "B takes with documents");
  step("B → A", `take      用 B 自己的 documents@v${wf.version} (${wf.defHash.slice(0, 12)}) · 上限 6 輪（codex 不回報花費：只限輪數）`);
  // 3. A assigns
  const k1 = await item(p.A, "take", t.id);
  await must(p.A.api(`/api/lan/items/${k1.id}/approve`, {}), "A assigns");
  step("A → B", `assign    指派給 ${k1.from.name}（完整公鑰 ${k1.from.key.slice(0, 16)}…）`);
  // 4. B runs
  const a1 = await item(p.B, "assign", t.id);
  const v1 = await must(p.B.api(`/api/lan/items/${a1.id}/approve`, {}), "B starts the run");
  const run1 = v1.rounds[0].run.id;
  step("B", `run       ${run1} 在 B 上開跑（受限 profile：OS sandbox、只連 provider、不能 push/PR/merge、測試不能開監聽、不能寫 CI/hooks/設定檔）`);
  const view1 = await runOnB(p, run1);
  step("B", `run       ${run1} 跑完：${view1.status}${view1.result ? ` / ${view1.result}` : ""}`);
  // 5. B hands back
  const h1 = await handBack(p, t.id);
  step("B → A", `result    交回 ${h1.files.length} 個檔案 ${h1.bytes} bytes（secret 掃描 0 筆、受保護路徑 0 筆）· output ${h1.hash.slice(0, 12)}`);
  const r1 = await item(p.A, "result", t.id);
  await must(p.A.api(`/api/lan/items/${r1.id}/approve`, {}), "A accepts the result");
  step("A", `收件匣   result 來自 ${r1.from.name}：${r1.files.map((f: any) => f.path).join(", ")} · ${r1.checks.summary.split(" (")[0]}${r1.flags.length ? ` · 標記 ${r1.flags.join(",")}` : ""}`);
  // 6. A refines
  await must(p.A.api(`/api/lan/threads/${t.id}/refine`, { briefing: "加一節資安：密碼管理員與兩步驟驗證。\nSTUB_FILE notes.md :: 第 2 輪：加上資安一節（密碼管理員、兩步驟驗證）", note: "第二輪" }), "A refines");
  step("A → B", "refine    第 2 輪 briefing：加一節資安");
  const f2 = await item(p.B, "refine", t.id);
  await must(p.B.api(`/api/lan/items/${f2.id}/approve`, { seen: seenOf(f2.prompt), workflow: "documents", provider: "codex", roundsOnly: true, rounds: 6 }), "B takes round 2");
  step("B → A", `take      第 2 輪，仍用 B 的 documents@v${wf.version}`);
  const k2 = await item(p.A, "take", t.id);
  await must(p.A.api(`/api/lan/items/${k2.id}/approve`, {}), "A assigns round 2");
  step("A → B", "assign    第 2 輪指派");
  const a2 = await item(p.B, "assign", t.id);
  const v2 = await must(p.B.api(`/api/lan/items/${a2.id}/approve`, {}), "B starts round 2");
  const run2 = v2.rounds[1].run.id;
  step("B", `run       ${run2} 開跑`);
  await runOnB(p, run2);
  step("B", `run       ${run2} 跑完`);
  const h2 = await handBack(p, t.id);
  step("B → A", `result    第 2 輪交回 ${h2.files.length} 個檔案 · output ${h2.hash.slice(0, 12)}`);
  const r2 = await item(p.A, "result", t.id);
  await must(p.A.api(`/api/lan/items/${r2.id}/approve`, {}), "A accepts round 2");
  const notes = r2.files.find((f: any) => f.path === "notes.md")?.text.trim() ?? "";
  step("A", `收件匣   第 2 輪 result：notes.md 「${notes}」`);
  // 7. A marks it done
  await must(p.A.api(`/api/lan/threads/${t.id}/done`, {}), "A marks it done");
  step("A → B", "done      結案");
  const dn = await item(p.B, "done", t.id);
  await must(p.B.api(`/api/lan/items/${dn.id}/approve`, {}), "B acknowledges done");
  const ta = await must(p.A.api(`/api/lan/threads/${t.id}`), "A's thread"), tb = await must(p.B.api(`/api/lan/threads/${t.id}`), "B's thread");
  step("A,B", `thread    A 看到：${ta.now.where.zh}；B 看到：${tb.now.where.zh}`);
  log("");
  log("交接軌跡（A 的看板，依序）：");
  for (const s of ta.steps) log(`  ${at(s.at)}  r${s.round}  ${s.kind.padEnd(8)} ${s.who.name.padEnd(6)} ${s.who.fp.slice(0, 11)}  ${s.entry.slice(0, 12)}${s.delivered === false ? "  (未送達)" : ""}`);
  return { thread: t.id, runs: [run1, run2], a: ta, b: tb, notes, results: [r1, r2] };
}

/** A code workflow across the two Studios: B takes it with its own code-firstmate on its registered project (approved
 *  crew), the Task runs in its own worktree on a lan-untrusted/ branch and ends ready on that local branch (no push, no
 *  pull request, no merge), B hands back one patch, and A applies it to its own project on a branch of its own. */
export async function codeRelay(p: Pair, log: (s: string) => void = () => {}) {
  const { STEPS } = await import("../acceptance/steps");
  await STEPS["staffing-code"]({ s: p.B, vars: { project: "sandbox" }, firstmate: async () => [] } as any);
  const step = (who: string, what: string) => log(`  ${who.padEnd(6)} ${what}`);
  const briefing = "請在 lib/ 加一個打九折的函式，並附上測試。\nSTUB_FILE lib/discount.ts :: export const discount = (p: number) => Math.round(p * 90) / 100;\\n\nSTUB_FILE test/discount.test.ts :: import { test, expect } from 'bun:test';\\ntest('ten percent off', async () => { expect(await Bun.file(new URL('../lib/discount.ts', import.meta.url)).exists()).toBe(true); const { discount } = await import('../lib/discount'); expect(discount(100)).toBe(90); });\\n";
  shareBase(p);
  const t = await must(p.A.api("/api/lan/dispatch", { to: p.keyB, title: "九折函式", briefing, acceptance: ["附測試"], workflow: "code-firstmate", project: "sandbox" }), "A dispatches code work on its sandbox project");
  step("A → B", `dispatch  thread ${t.id} · 建議流程 code-firstmate@v${t.suggested.version}`);
  const d = await item(p.B, "dispatch", t.id);
  await must(p.B.api(`/api/lan/items/${d.id}/approve`, { seen: seenOf(d.prompt), workflow: "code-firstmate", project: "sandbox", provider: "codex", roundsOnly: true, rounds: 40 }), "B takes with code-firstmate");
  step("B → A", "take      用 B 自己的 code-firstmate，在 B 的 sandbox 專案（已核准 crew）");
  const k = await item(p.A, "take", t.id); await must(p.A.api(`/api/lan/items/${k.id}/approve`, {}), "A assigns");
  step("A → B", "assign");
  const a = await item(p.B, "assign", t.id); const v = await must(p.B.api(`/api/lan/items/${a.id}/approve`, {}), "B starts");
  const run = v.rounds[0].run.id;
  const dv = await drive(p.B, run, async (c) => c.node === "dispatch" ? { choice: "dispatch" } : { stop: "unscripted" }, { timeoutMs: 240_000 });
  if (dv.problems.length || dv.view.status !== "succeeded") throw new Error(`B's code Task ${run} ended ${dv.view?.status}: ${dv.problems.join("; ")} ${JSON.stringify((dv.view?.steps ?? []).map((s: any) => `${s.node}:${s.state}${s.error ? `(${String(s.error).slice(0, 160)})` : ""}`))}`);
  step("B", `run       ${run}：${dv.view.result}（在 lan-untrusted/ 分支上就緒，沒有 push、PR、merge）`);
  const pre = await must(p.B.api(`/api/lan/threads/${t.id}/handback/preview`, {}), "B previews the patch");
  if (!pre.ok) throw new Error(`the hand-back gate stopped the code result: ${JSON.stringify({ secrets: pre.secrets, protected: pre.protectedPaths })}`);
  await must(p.B.api(`/api/lan/threads/${t.id}/handback`, { confirm: pre.hash }), "B hands the patch back");
  step("B → A", `result    交回 changes.patch ${pre.bytes} bytes`);
  const r = await item(p.A, "result", t.id); await must(p.A.api(`/api/lan/items/${r.id}/approve`, {}), "A accepts");
  const th = await must(p.A.api(`/api/lan/threads/${t.id}`), "A's thread"), patch = th.rounds.at(-1).result.patch as string;
  const applied = await must(p.A.api(`/api/lan/threads/${t.id}/apply`, { project: "sandbox", seen: patchHash(patch) }), "A applies the patch it read");
  step("A", `apply     套用到 A 的 sandbox 專案分支 ${applied.branch}（${applied.files.join(", ")}）`);
  await must(p.A.api(`/api/lan/threads/${t.id}/done`, {}), "A marks it done");
  step("A → B", "done      結案");
  const dn = await item(p.B, "done", t.id); await must(p.B.api(`/api/lan/items/${dn.id}/approve`, {}), "B acknowledges");
  return { thread: t.id, run, view: dv.view, patch: pre.files.find((f: any) => f.path === "changes.patch")?.text ?? "", applied };
}
