import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// Native workflows through createRuntime, persisted engine and actual tool routes.
// All sources, artifacts, repositories and provider messages are throwaway fixtures.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agents } from "../src/agent";
import { ArtifactStore } from "../src/artifacts";
import { probeVideo } from "../src/render";
import { createFileOrg } from "../src/fileorg";
import { createM3 } from "../src/m3";
import { Lane } from "../src/recipes";
import { createRuntime } from "../src/runtime";
import { validate,WorkflowDefs } from "../src/runtime/defs";
import {bundledText}from "../src/bundled";
import { StudioLog } from "../src/rawlog";
import { suite, until } from "./rt-harness";
const { ok, end } = suite("non-code-workflows");
const data = process.env.CREW_NATIVE_RESTART_DATA ?? checkedTempDir("crew-native-deliver-"), fm = join(data, "protected-fm"); mkdirSync(fm, { recursive: true });
const log = new StudioLog(join(data, "events.jsonl")), store = new ArtifactStore(data), lane = new Lane(data, store);
const fileorg = createFileOrg({ dataDir: data, refuse: [fm], rules: () => ({ categories: { Text: ["txt"] }, other: "Other" }), gates: () => [{ id: "in", builtin: "fileorg-inside-root" }, { id: "nc", builtin: "fileorg-no-overwrite" }, { id: "cap", builtin: "fileorg-max-moves", args: { max: 10 } }], log, send() {} });
const realVideo = process.env.CREW_NATIVE_REAL_VIDEO === "1";
let port = 0, hold = false, boundedWriteRefused = false, rounds = 0;
const agents = new Agents(data, () => `http://127.0.0.1:${port}`);
let activeAgents = agents;
const artifactHttp = createM3({ dataDir: data, fileAllow: [data], studioUrl: () => `http://127.0.0.1:${port}`, provider: () => fixture, send() {}, allowDrive: () => true });
const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: async req => {
  const t = req.headers.get("x-crew-tool-token") ?? "", u = new URL(req.url);
  if (u.pathname === "/api/tools") return Response.json(activeAgents.toolList(t));
  if (u.pathname.startsWith("/api/tools/")) return Response.json(await activeAgents.callTool(t, decodeURIComponent(u.pathname.slice("/api/tools/".length)), await req.json()));
  if (u.pathname === "/capture") return new Response('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fonts.css"><link rel="stylesheet" href="/styles.css"><link rel="stylesheet" href="/runtime.css"></head><body><main style="max-width:960px;margin:auto;padding:24px"><div id="card"></div></main><script src="/scard.js"></script><script>const q=new URLSearchParams(location.search);document.documentElement.dataset.theme=q.get("theme");fetch("/api/scards/"+q.get("card")).then(r=>r.json()).then(c=>window.crewCard.mountCard(document.getElementById("card"),c,{lang:q.get("lang"),inbox:true}));</script></body></html>', { headers: { "content-type": "text/html" } });
  if (/^\/(?:fonts\.css|styles\.css|runtime\.css|scard\.js)$/.test(u.pathname)) return new Response(Bun.file(join(import.meta.dir, "../public", u.pathname.slice(1))));
  if (u.pathname.startsWith("/fonts/")) { const f = join(import.meta.dir, "../public", u.pathname.slice(1)); if (existsSync(f)) return new Response(Bun.file(f)); }
  const artifact = /^\/api\/native-artifact\/([a-z0-9-]+)\/(\d+)\/(index\.html|doc\.md|film\.html)$/.exec(u.pathname);
  if (artifact) { const file = store.file(artifact[1], Number(artifact[2]), artifact[3]); return file ? new Response(Bun.file(file)) : new Response("not found", { status: 404 }); }
  if (u.pathname === "/api/summary") return Response.json({ tasks: [], pending: [], crew: [], github: null, board: null, flow: null, events: 0, state: data });
  if (u.pathname === "/api/types") return Response.json([]);
  if (/^\/[a-z0-9-]+\.(?:js|css)$/.test(u.pathname) && existsSync(join(import.meta.dir, "../public", u.pathname.slice(1)))) return new Response(Bun.file(join(import.meta.dir, "../public", u.pathname.slice(1))));
  if (u.pathname === "/") return new Response(Bun.file(join(import.meta.dir, "../public/index.html")));
  const artResponse = await artifactHttp.handle(req, u, { kind: "desktop" }, req.method !== "GET"); if (artResponse) return artResponse;
  return await rt.handle(req, u, { kind: "desktop" }, req.method !== "GET") ?? new Response("not found", { status: 404 });
} }); port = srv.port;
// The live R-035 shape: the model rewrote the template's fixed 960x540 #stage as a viewport-sized box.
const r035Film = `<!doctype html><html><head><style>html,body{margin:0}#stage{width:100%;height:100vh;position:relative;overflow:hidden;background:#0f1726;color:#f4f6fb}</style></head><body><div id="stage"><h1>R-035 responsive stage</h1></div><script>const DUR=0.4;let muted=true,startAt=0,ctx=null;function build(){}function schedule(){}function render(t){document.querySelector('h1').style.opacity=String(1-t)}render(0)</script></body></html>`;
const portraitFilm = `<!doctype html><html><head><style>html,body{margin:0}#stage{width:540px;height:960px;background:#0f1726}</style></head><body><div id="stage"><h1>Vertical</h1></div><script>const DUR=0.4;function build(){}function schedule(){}function render(t){}</script></body></html>`;
const noStageFilm = `<!doctype html><html><body><h1>No stage</h1><script>const DUR=0.4;function build(){}function schedule(){}function render(t){}</script></body></html>`;
const fixture: any = { id: "fixture", model: "strict-local", sandboxFree: true, start(system: string, tools: any[], ctx: any) {
  ok(tools.every(t => t.name.startsWith("work_") || ["input_list","input_read"].includes(t.name)), "provider receives only bounded work tools and pinned read-only inputs");
  let interrupted = false;
  return { interrupt() { interrupted = true; }, async *send(text: string) {
    rounds++; while (hold && !interrupted) await Bun.sleep(20);
    if (interrupted) { yield { type: "turnEnd", status: "interrupted" }; return; }
    const format = /DELIVER (\w+)/.exec(text)?.[1], variant = /Variant: (\w+)/.exec(text)?.[1];
    const repaired = /BRIEF for round|Open annotations: \[\{/.test(text);
    const path = format === "document" ? "doc.md" : format === "video" ? "film.html" : "index.html";
    const content = format === "web" && variant === "B" && /FAIL_VARIANT_B/.test(text) && (!repaired || /PERMANENT/.test(text)) ? "No content element" : format === "document" ? repaired ? "# Fixture memo\n\nA repaired memo with a summary. 中文內容。\n" : "No title in the first memo.\n" : format === "video" ? /FIXED_PORTRAIT/.test(text) ? portraitFilm : /R035_STAGE|PHRASE_FILM/.test(text) ? r035Film : /NO_STAGE_FILM/.test(text) ? repaired ? r035Film : noStageFilm : realVideo ? `<html><body style="margin:0"><div id="stage" style="width:320px;height:180px;background:#102030;color:white"><h1>${repaired ? "Revised captions" : "Initial captions"}</h1><div id="moving" style="width:100px;height:50px"></div></div><script>const DUR=0.8;function render(t){document.getElementById('moving').style.background=t<0.4?'rgb(255,0,0)':'rgb(0,0,255)';document.getElementById('moving').style.transform='translateX('+(t*120)+'px)'}render(0)</script></body></html>` : '<html><body><h1>Fixture film</h1></body></html>'  : `<html><body><h1>Variant ${variant}</h1><p>${repaired ? "Repaired" : "Initial"}</p></body></html>`;
    const escape = await fetch(`${ctx.studioUrl}/api/tools/work_write`, { method: "POST", headers: { "content-type": "application/json", "x-crew-tool-token": ctx.token }, body: JSON.stringify({ path: "../escape.txt", content: "must be refused" }) });
    boundedWriteRefused ||= !!(await escape.json()).error;
    const r = await fetch(`${ctx.studioUrl}/api/tools/work_write`, { method: "POST", headers: { "content-type": "application/json", "x-crew-tool-token": ctx.token }, body: JSON.stringify({ path, content }) }); const result = await r.json();
    if (result.error) { yield { type: "turnEnd", status: "error", message: result.error }; return; }
    yield { type: "message", text: `wrote ${path}` }; yield { type: "turnEnd", status: "ok" };
  } };
} };
const deps: any = { dataDir: data, agents, provider: () => fixture, defaultProvider: () => ({ provider: "fixture", model: "strict-local" }), log, send() {}, fmRoot: fm, protectedRoots: [fm], m3: { store, lane, runs: null }, fileorg, docs: {}, studioUrl: () => `http://127.0.0.1:${port}` };
let imageCalls = 0, imageAborted = false, imageRules: any[] = [];
deps.generateImage = async (_prompt: string, authorize: () => void, signal: AbortSignal, _reference?: unknown, rules?: any) => {
  authorize(); if (signal.aborted) throw new Error("cancelled"); imageCalls++; imageRules.push(rules);
  if (_prompt.includes("HOLD_IMAGE")) await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => { imageAborted = true; reject(new Error("cancelled")); }, { once: true }));
  return { bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP437DvPwAH/AM9TriEzAAAAABJRU5ErkJggg==", "base64"), width: 1, height: 1, mime: "image/png", provider: "codex", model: "fixture-image", effort: "low", sha256: "fixture" };
};
// Explicit compatibility fixture; the product no longer seeds this README demo.
new WorkflowDefs(data,()=>[bundledText("workflows/v2/trivial-lane.wf.yaml")!]);
let rt = createRuntime(deps), E = rt.engine;
if (process.env.CREW_NATIVE_RESTART_PHASE === "hold") {
  hold = true; const pending = E.start({ workflow: "documents", params: {}, text: "Restart active draft fixture" });
  await until(() => !!E.get(pending.id)!.nodes.draft?.job, 10000); console.log(`RESTART_READY:${pending.id}`);
  await new Promise(() => {});
}
for (const id of ["documents", "video", "web-prototype", "file-organization", "trivial-lane"]) { const def = rt.defs.get(id); ok(!!def && !validate(def, rt.defs.known).some(p => p.level === "error"), `${id} is a valid bundled native definition`); }
const cancelActive = (id: string) => { if (!["succeeded", "failed", "cancelled"].includes(E.get(id)!.status)) E.cancel(id); };
let captureBrowser: any = null;
const screenshots = process.env.CREW_NATIVE_CAPTURE_DIR;
const capture = async (card: any, label: string) => {
  if (!screenshots || !card) return; mkdirSync(screenshots, { recursive: true });
  if (!captureBrowser) { const { chromium } = await import(process.env.PLAYWRIGHT_MODULE!); captureBrowser = await chromium.launch(); }
  for (const width of [1440, 390, ...(["file-plan-acceptance", "lane-acceptance"].includes(label) ? [320] : [])]) for (const theme of ["light", "dark"]) for (const language of ["en", "zh-TW"]) {
    const context = await captureBrowser.newContext({ viewport: { width, height: 1000 }, colorScheme: theme }); const page = await context.newPage(), errors: string[] = [];
    page.on("pageerror", (e: any) => errors.push(e.message)); await page.goto(`http://127.0.0.1:${port}/capture?card=${card.id}&theme=${theme}&lang=${language}`); await page.waitForSelector(`[data-card-root="${card.id}"]`); await page.evaluate(() => document.fonts.ready);
    ok(!errors.length && await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label} real native card renders without page errors or horizontal overflow at ${width} ${theme} ${language}`);
    if (["refine-escalation", "renderer-capability"].includes(label)) {
      const title = await page.locator(".cc-h b").textContent(), body = await page.locator(".rt-card-body").textContent(), close = await page.locator('[data-option="close"]').textContent();
      ok(title === (language === "zh-TW" ? label === "refine-escalation" ? "產物需要處理" : "MP4 尚未驗證" : label === "refine-escalation" ? "Artifact needs attention" : "MP4 not verified") && close?.trim() === (language === "zh-TW" ? "關閉" : "Close") && (language === "zh-TW" ? /關閉此任務|本機轉檔工具/.test(body ?? "") && !/Checks did not|Install the optional/.test(body ?? "") : /Checks did not|Install the optional/.test(body ?? "")), `${label} selected locale translates title, why, recovery body and Close without English duplicates at ${width} ${theme} ${language}`);
    }
    if (card.detail?.artifactAcceptance?.kind === "artifact") {
      ok(await page.locator('[data-sec="proved"] [data-artifact-proved="true"]').count() > 0 && await page.locator('[data-sec="needs-eye"]').count() === 1 && await page.locator('[data-offered-version]').count() > 0,
        `${label} UI shows signed-check proof, human judgment and exact version pins at ${width} ${theme} ${language}`);
      for (const r of card.detail.artifactAcceptance.offered) { const response = await fetch(`http://127.0.0.1:${port}/af/${r.id}/${r.n}/${r.format === "document" ? "doc.md" : r.format === "video" ? "film.html" : "index.html"}`); const link = card.links.find((l: any) => l.href === `/#/review/${r.id}/${r.n}`); ok(response.ok && !!link && await page.locator(`a[href="${link.href}"]`).count() > 0 && (await fetch(new URL(link.href, `http://127.0.0.1:${port}`))).ok, `${label} visible native review destination and pinned artifact resolve through actual M3 HTTP handler`); }
    }
    if (["file-plan-acceptance", "lane-acceptance"].includes(label)) {
      const task = E.get(card.run)!, expected = label === "file-plan-acceptance" ? [task.ctx.plan.id, task.ctx.plan.hash] : [task.ctx.lane.pin.repo, task.ctx.lane.pin.base, task.ctx.lane.pin.baseCommit, task.ctx.lane.pin.commit];
      await page.locator("details").filter({ has: page.locator(".rt-card-body") }).evaluate((el: HTMLDetailsElement) => { el.open = true; });
      const fit = await page.locator(".rt-card-body").evaluate((el: HTMLElement) => { const r = el.getBoundingClientRect(); const range = document.createRange(); range.selectNodeContents(el); const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range); const selected = selection.toString(); selection.removeAllRanges(); return { width: document.documentElement.scrollWidth, viewport: innerWidth, right: r.right, left: r.left, selected, text: el.textContent, innerWidth: el.clientWidth, scrollWidth: el.scrollWidth }; });
      console.log("EXPANDED_BODY", JSON.stringify({ label, width, theme, language, documentWidth: fit.width, bodyRight: fit.right, clientWidth: fit.innerWidth, scrollWidth: fit.scrollWidth, fullSelection: fit.selected === fit.text }));
      ok(fit.width <= fit.viewport && fit.left >= 0 && fit.right <= fit.viewport && fit.scrollWidth <= fit.innerWidth && fit.selected === fit.text && expected.every((id: string) => fit.selected?.includes(id)), `${label} expanded identity fits document and body viewport with full selectable hash/commit at ${width} ${theme} ${language}`);
      const body = await page.locator(".rt-card-body").textContent(), labels = label === "file-plan-acceptance" ? language === "zh-TW" ? ["套用搬移", "捨棄"] : ["Apply moves", "Discard"] : language === "zh-TW" ? ["本機合併", "關閉"] : ["Merge locally", "Close"];
      ok(expected.every((id: string) => body?.includes(id)) && labels.every(l => card.options.some((o: any) => (language === "zh-TW" ? o.labelZh : o.label) === l)), `${label} expanded real card shows exact persisted identity and selected-language actions at ${width} ${theme} ${language}`);
      ok((await page.locator(".cc-actions [data-option]").allTextContents()).map((x: string) => x.trim()).every((x: string) => labels.includes(x)), `${label} actual buttons use selected language at ${width} ${theme} ${language}`);
    }
    if (width <= 390) ok(await page.locator(".cc-lang button,.cc-actions .btn").evaluateAll((buttons: Element[]) => buttons.every(b => b.getBoundingClientRect().height >= 44)), `${label} phone controls meet the 44 px target`);
    await page.screenshot({ path: join(screenshots, `${label}-${width}-${theme}-${language}.png`), fullPage: true });
    if (label === "document-acceptance") {
      await page.evaluate(async () => { const id = document.querySelector("[data-card-root]")!.getAttribute("data-card-root"); const original = await (await fetch(`/api/scards/${id}`)).json(); for (const detail of [{ offered: [] }, { ...original.detail, done: [null] }]) window.crewCard.mountCard(document.getElementById("card"), { ...original, detail }); });
      await page.evaluate(async () => { const id = document.querySelector("[data-card-root]")!.getAttribute("data-card-root"); const c = await (await fetch(`/api/scards/${id}`)).json(); window.crewCard.mountCard(document.getElementById("card"), { ...c, detail: null, body: "Distinct historical body", sections: { en: { why: "Short why" }, "zh-TW": { why: "簡短原因" } } }, { lang: "zh-TW" }); });
      ok(await page.locator(".rt-card-body").textContent() === "Distinct historical body", "legacy distinct global body survives localized why display");
      const boundedBody = "Paragraph with a long identifier: " + "a".repeat(64) + "\n\n```text\n" + "b".repeat(128) + "\n  indented code\n```";
      await page.evaluate(async (body: string) => { const id = document.querySelector("[data-card-root]")!.getAttribute("data-card-root"); const c = await (await fetch(`/api/scards/${id}`)).json(); window.crewCard.mountCard(document.getElementById("card"), { ...c, detail: null, body, sections: { en: { why: "Distinct why" }, "zh-TW": { why: "不同原因" } } }, { lang: "zh-TW" }); }, boundedBody);
      const legacyFit = await page.locator(".rt-card-body").evaluate((el: HTMLElement) => ({ text: el.textContent, right: el.getBoundingClientRect().right, documentWidth: document.documentElement.scrollWidth, viewport: innerWidth, inner: el.clientWidth, scroll: el.scrollWidth }));
      ok(legacyFit.text === boundedBody && legacyFit.documentWidth <= legacyFit.viewport && legacyFit.right <= legacyFit.viewport && legacyFit.scroll <= legacyFit.inner, `bounded historical paragraph/code body wraps without changing complete text, whitespace or distinct why at ${width} ${theme} ${language}`);
      ok(!errors.length && await page.locator("[data-card-root]").count() === 1, `unknown and malformed historical detail renders plain native card safely at ${width} ${theme} ${language}`);
      ok((await (await fetch(`http://127.0.0.1:${port}/api/scards/${card.id}`)).json()).detail.artifactAcceptance.offered[0].n === card.detail.artifactAcceptance.offered[0].n, "legacy/malformed display fallback never rewrites the persisted version pins");
    }
    if (label === "document-acceptance" && width === 1440 && theme === "light" && language === "en") {
      await page.reload(); await page.waitForSelector('[data-option="approve-draft"]'); await page.click('[data-option="approve-draft"]');
      await page.waitForFunction(() => /tick every intent/.test(document.querySelector('[data-card-msg]')?.textContent ?? ""));
      ok((await (await fetch(`http://127.0.0.1:${port}/api/scards/${card.id}`)).json()).status === "open", "real native approval button refuses unticked intent instead of bypassing permission");
    }
    await context.close();
  }
};

const destinations = async (card: any, label: string) => {
  const offered = card?.detail?.artifactAcceptance?.offered ?? [];
  for (const r of offered) {
    const api = await fetch(`http://127.0.0.1:${port}/api/artifacts/${r.id}`), detail = await api.json();
    ok(api.ok && detail.versions.some((v: any) => v.n === r.n && v.sha256 === r.sha256) && card.links.some((l: any) => l.href === `/#/review/${r.id}/${r.n}`), `${label} actual M3 destination retains offered version and hash`);
    if (captureBrowser) { const page = await captureBrowser.newPage(); await page.goto(`http://127.0.0.1:${port}/#/review/${r.id}/${r.n}`); await page.waitForSelector(".phead h1"); ok((await page.locator(".phead h1").textContent()).includes(`v${r.n}`) && await page.locator("iframe,video,img").count() > 0, `${label} existing artifact renderer opens the actual pinned review`); await page.screenshot({ path: join(screenshots!, `${label}-${r.producer}-destination.png`), fullPage: true }); await page.close(); }
  }
};

const playback = async (r: any, label: string) => {
  if (!realVideo) return;
  if (!captureBrowser) { const { chromium } = await import(process.env.PLAYWRIGHT_MODULE!); captureBrowser = await chromium.launch(); }
  const page = await captureBrowser.newPage(); await page.goto(`http://127.0.0.1:${port}/#/review/${r.id}/${r.n}`); await page.waitForSelector("video");
  const evidence = await page.locator("video").evaluate(async (v: HTMLVideoElement) => {
    v.muted = true; await v.play(); await new Promise(r => setTimeout(r, 200)); const first = v.currentTime; await new Promise(r => setTimeout(r, 250)); const next = v.currentTime; v.pause();
    const canvas = document.createElement("canvas"); canvas.width = v.videoWidth; canvas.height = v.videoHeight; const ctx = canvas.getContext("2d")!;
    const seek = (t: number) => new Promise<void>(r => { v.addEventListener("seeked", () => r(), { once: true }); v.currentTime = t; });
    await seek(0.1); ctx.drawImage(v, 0, 0); const a = canvas.toDataURL(); await seek(0.6); ctx.drawImage(v, 0, 0); const b = canvas.toDataURL();
    return { duration: v.duration, width: v.videoWidth, height: v.videoHeight, first, next, changed: a !== b, src: v.currentSrc };
  });
  ok(evidence.duration >= 0.7 && evidence.width === 1920 && evidence.height === 1080 && evidence.next > evidence.first && evidence.changed && evidence.src.includes(`/af/${r.id}/${r.n}/render.mp4`), `${label} actual native MP4 decodes exactly 1920x1080 and duration, advances playback and changes seeked frames for pinned v${r.n}`);
  console.log("REAL_MP4", JSON.stringify({ artifact: r.id, n: r.n, ...evidence }));
  if (screenshots) await page.screenshot({ path: join(screenshots, `${label}-actual-playback-v${r.n}.png`), fullPage: true }); await page.close();
};

const waiting = async (id: string, node = "accept") => { await until(() => E.cards.list({ run: id, open: true }).some(c => c.node === node) || ["failed", "succeeded", "cancelled"].includes(E.get(id)!.status), 30000); return E.cards.list({ run: id, open: true }).find(c => c.node === node); };
const imageRun = E.start({ workflow: "images", params: { provider: "codex" }, text: "Pink balloon" });
const imageCard = await waiting(imageRun.id);
ok(!!imageCard && imageCalls === 1 && !E.get(imageRun.id)!.ctx.library, "image generation waits for pinned captain acceptance before publication");
ok(typeof imageRules[0]?.text === "string" && imageRules[0].text.startsWith("# Operating rules (set by the captain)") && /## Studio-wide rules/.test(imageRules[0].text) && /^[0-9a-f]{64}$/.test(imageRules[0].hash ?? ""), "the deliver image step hands the operating rules (with their hash) to the image job");
await destinations(imageCard, "image");
if (imageCard) await E.answer(imageCard.id, { choice: "changes", note: "Make the balloon pinker", by: "fixture captain", aligned: [0] });
const revisedImageCard = await waiting(imageRun.id);
ok(!!revisedImageCard && revisedImageCard.id !== imageCard?.id && E.get(imageRun.id)!.ctx.deliver.draft.n === 2, "image change request creates a new pinned version and acceptance card");
if (revisedImageCard) await E.answer(revisedImageCard.id, { choice: "approve-draft", by: "fixture captain", aligned: [0] });
await until(() => E.get(imageRun.id)!.status === "succeeded", 10000);
ok(!!E.get(imageRun.id)!.ctx.library && store.approved(E.get(imageRun.id)!.ctx.library.artifact)?.n === 2, "approved PNG publishes its exact version to the library");
const refusedImage = E.start({ workflow: "images", params: { provider: "claude" }, text: "Do not switch vendors" });
await until(() => E.get(refusedImage.id)!.status === "failed", 10000);
ok(imageCalls === 2, "explicit non-Codex image provider refuses before generation");
const cancelledImage = E.start({ workflow: "images", params: { provider: "codex" }, text: "HOLD_IMAGE" });
await until(() => imageCalls === 3, 5000); E.cancel(cancelledImage.id);
await until(() => imageAborted, 5000);
ok(!E.get(cancelledImage.id)!.ctx.deliver && !store.get(`out-${cancelledImage.id.toLowerCase()}-draft`) && !E.cards.list({ run: cancelledImage.id, open: true }).length, "cancelled image generation aborts without artifact or acceptance card");
const doc = E.start({ workflow: "documents", params: {}, text: "Write a fixture memo" }); let card = await waiting(doc.id);
ok(!!card && E.get(doc.id)!.nodes.draft.visits === 2, "missing document title triggers automated refinement before any human acceptance", JSON.stringify([E.get(doc.id)!.status, E.get(doc.id)!.error, E.get(doc.id)!.nodes.draft.visits, card?.title, E.events(doc.id).filter((e: any) => /node_done|edge|log|failed|card|node_failed/.test(e.type)).map((e: any) => `${e.type}:${e.summary}`).slice(-14)]));
ok(E.get(doc.id)!.nodes.draft.data.dir.startsWith(join(data, "work") + "/"), "deliver rounds use the sandbox-allowed work area, never the protected run store");
await capture(card, "document-acceptance"); await destinations(card, "document");
const dr = E.get(doc.id)!.ctx.deliver?.draft;
ok(!!dr && store.versions(dr.id).length === 2 && store.version(dr.id, 2)?.parent === 1 && /No title/.test(readFileSync(store.file(dr.id, 1, "doc.md")!, "utf8")), "agent revision creates an immutable version with parent lineage");
ok(E.ledger(doc.id).some(e => e.verdict === "fail" && e.findings.some(f => f.locator?.type === "text")) && E.ledger(doc.id).some(e => e.check === "core/artifact-ready" && e.verdict === "pass"), "native checks retain shared text locators and passing check evidence");
ok(!!card && /Proved by checks:[\s\S]*✓/.test(card.body) && /Needs your eye:[\s\S]*match/.test(card.body), "final acceptance separates proved output checks and intent judgment");
ok(E.get(doc.id)!.steps.filter(s => s.node === "draft").length === 2 && existsSync(join(data, "runs", doc.id, "nodes", "draft", "2")), "actual native rounds and provider transcripts are persisted");
// Waiting-card reload: no live process remains; the new engine takes the persisted state.
await until(() => E.get(doc.id)!.nodes.accept.waiting === "card", 10000);
const cardId = card?.id; rt = createRuntime(deps); E = rt.engine; card = await waiting(doc.id);
ok(card?.id === cardId && card?.detail?.artifactAcceptance?.offered[0].n === 2, "restart keeps the exact waiting acceptance card and offered artifact version");
if (card) await E.answer(card.id, { choice: "approve-draft", by: "fixture captain", aligned: [0] });
await until(() => E.get(doc.id)!.status === "succeeded", 10000);
ok(E.get(doc.id)!.result !== "closed" && E.get(doc.id)!.ctx.library?.version === 2 && E.get(doc.id)!.ctx.exports?.length === 4 && existsSync(join(data, "runs", doc.id, "exports", `${dr.id}-v2.docx`)), "approval publishes only the offered document version and writes all four local exports");
ok(E.get(doc.id)!.ctx.exportWarnings?.some((w: string) => /PDF.*non-Latin/.test(w)), "local PDF export explicitly reports its non-Latin character limitation instead of claiming faithful output");
const web = E.start({ workflow: "web-prototype", params: {}, text: "Design fixture variants" }); const wc = await waiting(web.id); await destinations(wc, "web"); const outputs: any[] = Object.values(E.get(web.id)!.ctx.deliver ?? {});
ok(!!wc && outputs.length === 2 && outputs[0].id !== outputs[1].id && outputs.every(r => store.latest(r.id)?.n === 1), "parallel web producers have isolated artifact identities and version histories");
ok(outputs.some(r => /Variant A/.test(readFileSync(store.file(r.id, r.n, "index.html")!, "utf8"))) && outputs.some(r => /Variant B/.test(readFileSync(store.file(r.id, r.n, "index.html")!, "utf8"))), "parallel providers actually write their different bounded source files");
const wd = rt.defs.get("web-prototype")!; rt.defs.save("web-prototype", { ...wd, base: wd.version, description: "edited fixture version" }, "fixture captain");
ok(E.get(web.id)!.version === 1 && rt.defs.get("web-prototype")!.version === 2, "active native task keeps its pinned definition when a newer version is saved");
if (wc) { await E.answer(wc.id, { choice: "changes", note: "Use repaired wording", by: "fixture captain", aligned: [0] }); const next = await waiting(web.id); ok(next?.id !== wc.id && Object.values(E.get(web.id)!.ctx.deliver).every((r: any) => r.n === 2), "human annotation routes through native production and checks before a new acceptance"); if (next) await E.answer(next.id, { choice: "approve-design-b", by: "fixture captain", aligned: [0] }); }
await until(() => E.get(web.id)!.status === "succeeded", 10000); ok(E.get(web.id)!.ctx.library?.artifact.endsWith("design-b"), "one final card selects and publishes the exact chosen parallel variant");
const badVariant = E.start({ workflow: "web-prototype", params: {}, text: "FAIL_VARIANT_B fix a bad parallel source" }); const badVariantCard = await waiting(badVariant.id);
ok(!!badVariantCard && E.get(badVariant.id)!.nodes["design-b"].visits === 2 && /BRIEF for round/.test(E.get(badVariant.id)!.ctx.lastPrompt?.["design-b"] ?? "") && E.ledger(badVariant.id).some(e => e.verdict === "fail" && e.findings.some(f => f.locator?.type === "web")), "a failing parallel B variant receives the bound machine brief and repairs its own source before final acceptance"); cancelActive(badVariant.id);
if (screenshots) { const permanent = E.start({ workflow: "web-prototype", params: {}, text: "FAIL_VARIANT_B PERMANENT unresolved design fixture" }); const escalation = await waiting(permanent.id, "escalation"); await capture(escalation, "refine-escalation"); cancelActive(permanent.id); }

// Real stored old definition: localization upgrades must not rewrite in-flight or historical cards.
const localDef = rt.defs.get("web-prototype")!, historicalDef = structuredClone(localDef);
// the stored definition predates the card contract (an English-only escalation card): it is kept as is, the contract only logs it
const historicalNode: any = historicalDef.nodes.find(n => n.id === "escalation")!; delete historicalNode.args;
const historicalSpec: any = historicalNode.card = { options: [{ id: "close", label: "Close" }] };
historicalDef.description = "Historical English workflow fixture";
historicalSpec.title = "Artifact needs attention"; historicalSpec.body = "Checks did not converge. Close this task and adjust its intent before trying again.";
process.env.CREW_CARD_CONTRACT = "log";
const oldPinned = rt.defs.save("web-prototype", { ...historicalDef, base: localDef.version }, "fixture captain");
const oldTask = E.start({ workflow: "web-prototype", params: {}, text: "FAIL_VARIANT_B PERMANENT historical English intent" });
rt.defs.save("web-prototype", { ...localDef, base: oldPinned.version }, "fixture captain");
const oldCard = await waiting(oldTask.id, "escalation"); await until(() => E.get(oldTask.id)!.nodes.escalation.waiting === "card", 10000); process.env.CREW_CARD_CONTRACT = "enforce"; const oldSnapshot = readFileSync(join(data, "cards", `${oldCard!.id}.json`), "utf8");
rt = createRuntime(deps); E = rt.engine;
ok(E.get(oldTask.id)!.version === oldPinned.version && E.get(oldTask.id)!.def.nodes.find(n => n.id === "escalation")!.card!.title === "Artifact needs attention" && oldCard?.title["zh-TW"] === "Artifact needs attention" && readFileSync(join(data, "cards", `${oldCard!.id}.json`), "utf8") === oldSnapshot, "localization upgrade and restart preserve real historical English workflow, captain intent and card records without retroactive translation");
cancelActive(oldTask.id);

// Missing renderer is an honest capability escalation; no MP4 approval occurs.
const oldEnv = { ...process.env }; process.env.CREW_RENDER_STUB = "0"; process.env.CREW_NODE_BIN = "/nonexistent/node"; process.env.CREW_FFMPEG = "/nonexistent/ffmpeg";
const film = E.start({ workflow: "video", params: {}, text: "Make fixture film" }); const fc = await waiting(film.id, "capability");
ok(!!fc && E.ledger(film.id).some(e => e.verdict === "fail" && e.findings.some(f => f.class === "renderer-unavailable" && f.locator?.type === "timeline")) && !E.get(film.id)!.ctx.approved, "missing optional renderer fails MP4 verification and raises capability card");
await capture(fc, "renderer-capability");
cancelActive(film.id); Object.assign(process.env, oldEnv); for (const k of Object.keys(process.env)) if (!(k in oldEnv)) delete process.env[k];
// Readiness probes the rendered MP4's exact size: a wrong-size render is a blocking video-size finding
// that sends the film back through the refine loop and never reaches the acceptance card.
const ffmpegBin = Bun.which("ffmpeg"), samples = join(data, "sample-mp4"); mkdirSync(samples, { recursive: true });
const sample = (w: number, h: number) => { const f = join(samples, `${w}x${h}.mp4`); Bun.spawnSync([ffmpegBin ?? "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", `color=c=0x102030:s=${w}x${h}:d=1:r=10`, "-c:v", "libx264", "-pix_fmt", "yuv420p", f]); return f; };
const goodMp4 = sample(1920, 1080), wrongMp4 = sample(1920, 1320), audioMp4 = join(samples, "audio-only.mp4");
Bun.spawnSync([ffmpegBin ?? "ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "sine=d=1", "-c:a", "aac", audioMp4]);
const sizeOf = async (f: string) => { const p = await probeVideo(f); return p.kind === "size" ? `${p.width}x${p.height}` : p.kind; };
ok(!!ffmpegBin && await sizeOf(goodMp4) === "1920x1080" && await sizeOf(wrongMp4) === "1920x1320" && await sizeOf(audioMp4) === "no-video", "fixture MP4 samples have the exact sizes the probe reports (ffmpeg required)");
const classes = (id: string) => E.ledger(id).flatMap(e => e.findings ?? []).map((f: any) => f.class);
const accepted = (id: string) => E.cards.list({ run: id }).some(c => c.node === "accept");
process.env.CREW_RENDER_STUB = "1"; process.env.CREW_RENDER_STUB_MP4 = wrongMp4;
const wrongSize = E.start({ workflow: "video", params: {}, text: "Wrong size fixture film" }); const wrongEnd = await waiting(wrongSize.id, "escalation");
const sizeFindings = E.ledger(wrongSize.id).flatMap(e => e.findings ?? []).filter(f => f.class === "video-size");
ok(!!wrongEnd && sizeFindings.length > 0 && sizeFindings.every(f => f.severity === "blocking" && /1920x1320/.test(f.message)) && E.get(wrongSize.id)!.nodes.draft.visits >= 2 && !accepted(wrongSize.id) && !E.get(wrongSize.id)!.ctx.approved, "a 1920x1320 render is a blocking video-size finding: the refine loop reruns the draft and no acceptance card appears");
cancelActive(wrongSize.id);
process.env.CREW_RENDER_STUB_MP4 = audioMp4;
const audioOnly = E.start({ workflow: "video", params: {}, text: "Audio only fixture film" }); const audioEnd = await waiting(audioOnly.id, "escalation");
ok(!!audioEnd && classes(audioOnly.id).includes("video-stream") && !classes(audioOnly.id).includes("video-size") && !accepted(audioOnly.id), "an MP4 with no video stream is its own video-stream finding, never an acceptance");
cancelActive(audioOnly.id);
// Without ffprobe the size still comes from ffmpeg's own stream listing, so a correct film passes.
const envProbe = process.env.CREW_FFPROBE; process.env.CREW_RENDER_STUB_MP4 = goodMp4; process.env.CREW_FFPROBE = "/nonexistent/ffprobe";
const noProbe = E.start({ workflow: "video", params: {}, text: "No ffprobe fixture film" }); const noProbeCard = await waiting(noProbe.id);
ok(!!noProbeCard && E.get(noProbe.id)!.nodes.draft.visits === 1 && !classes(noProbe.id).length, "with CREW_FFPROBE=/nonexistent the size is read with ffmpeg and a 1920x1080 film reaches acceptance in one round", JSON.stringify(classes(noProbe.id)));
cancelActive(noProbe.id);
// A file no probe can read is a render-layer problem: capability card, never a draft fix.
delete process.env.CREW_RENDER_STUB_MP4;
const unreadable = E.start({ workflow: "video", params: {}, text: "Unreadable render fixture film" }); const unreadableCard = await waiting(unreadable.id, "capability");
ok(!!unreadableCard && E.get(unreadable.id)!.nodes.draft.visits === 1 && classes(unreadable.id).includes("renderer-unavailable") && !classes(unreadable.id).includes("video-stream") && !accepted(unreadable.id), "an MP4 the probe cannot read raises the capability card after one draft round, never a draft fix", JSON.stringify(classes(unreadable.id)));
cancelActive(unreadable.id); process.env.CREW_RENDER_STUB_MP4 = goodMp4;
// With neither tool the size is a capability gap, not a draft fix: no model round is spent on it.
process.env.CREW_FFMPEG = "/nonexistent/ffmpeg";
const noTool = E.start({ workflow: "video", params: {}, text: "No probe tool fixture film" }); const noToolCard = await waiting(noTool.id, "capability");
ok(!!noToolCard && E.get(noTool.id)!.nodes.draft.visits === 1 && classes(noTool.id).includes("renderer-unavailable") && !classes(noTool.id).includes("video-size") && !accepted(noTool.id), "with neither ffprobe nor ffmpeg the size check raises the capability card after one draft round, never a video-size fix", JSON.stringify(classes(noTool.id)));
cancelActive(noTool.id); if (envProbe === undefined) delete process.env.CREW_FFPROBE; else process.env.CREW_FFPROBE = envProbe; delete process.env.CREW_FFMPEG;
// The R-035 film itself through the real renderer: the 16:9 viewport-sized stage is captured whole at exactly 1920x1080.
process.env.CREW_RENDER_STUB = "0"; const r035 = E.start({ workflow: "video", params: {}, text: "R035_STAGE responsive stage film" }); const r035Card = await waiting(r035.id); const r035Ref = E.get(r035.id)!.ctx.deliver?.draft, r035Version = r035Ref && store.version(r035Ref.id, r035Ref.n);
const r035Size = r035Ref && store.file(r035Ref.id, r035Ref.n, "render.mp4") ? await sizeOf(store.file(r035Ref.id, r035Ref.n, "render.mp4")!) : null;
ok(!!r035Card && r035Size === "1920x1080" && r035Version?.render?.orient === "landscape" && !classes(r035.id).includes("video-size"), "the R-035 #stage{width:100%;height:100vh} film renders exactly 1920x1080 and reaches acceptance", JSON.stringify({ r035Size, render: r035Version?.render }));
cancelActive(r035.id);
// Orientation comes only from the stage the film wrote, never from intent words: every phrase below with a
// viewport-following stage renders 1920x1080; only a fixed 540x960 stage renders 1080x1920.
const renderedSize = async (id: string) => { const r = E.get(id)!.ctx.deliver?.draft; const f = r && store.file(r.id, r.n, "render.mp4"); return { size: f ? await sizeOf(f) : null, render: r && store.version(r.id, r.n)?.render }; };
for (const phrase of ["not vertical", "vertical integration", "stories montage", "A portrait of our founder", "Landscape 1920x1080, 9:16 cutdown later", "垂直領域", "橫式影片，不要直式"]) {
  const t = E.start({ workflow: "video", params: {}, text: `PHRASE_FILM ${phrase}` }); const c = await waiting(t.id); const got = await renderedSize(t.id);
  ok(!!c && got.size === "1920x1080" && got.render?.orient === "landscape", `intent "${phrase}" with a responsive stage renders exactly 1920x1080`, JSON.stringify(got)); cancelActive(t.id);
}
const portrait = E.start({ workflow: "video", params: {}, text: "FIXED_PORTRAIT a film" }); const portraitCard = await waiting(portrait.id); const portraitGot = await renderedSize(portrait.id);
ok(!!portraitCard && portraitGot.size === "1080x1920" && portraitGot.render?.orient === "portrait" && portraitGot.render?.notes?.some((n: string) => /portrait: #stage is a fixed 9:16 box/.test(n)) === true, "a fixed 540x960 stage renders exactly 1080x1920 with the portrait note", JSON.stringify(portraitGot));
cancelActive(portrait.id);
const noStage = E.start({ workflow: "video", params: {}, text: "NO_STAGE_FILM film without a stage" }); const noStageCard = await waiting(noStage.id); const noStageFinding = E.ledger(noStage.id).flatMap(e => e.findings ?? []).find((f: any) => f.class === "video-stage");
ok(!!noStageCard && !!noStageFinding && /no #stage/.test(noStageFinding.message) && E.get(noStage.id)!.nodes.draft.visits === 2 && !classes(noStage.id).includes("renderer-unavailable") && !E.cards.list({ run: noStage.id }).some(c => c.node === "capability"), "a film without #stage fails fast as a video-stage finding the draft round fixes, then reaches acceptance", JSON.stringify(classes(noStage.id)));
cancelActive(noStage.id);
process.env.CREW_RENDER_STUB = realVideo ? "0" : "1"; const rendered = E.start({ workflow: "video", params: {}, text: "Render fixture film" }); const rc = await waiting(rendered.id); const rr = E.get(rendered.id)!.ctx.deliver?.draft; await destinations(rc, "video"); await playback(rr, "video");
ok(!!rc && !!store.file(rr.id, rr.n, "render.mp4") && store.version(rr.id, rr.n)?.render?.state === "done", "fixture renderer completion is required before video final acceptance");
if (rc) { await E.answer(rc.id, { choice: "changes", note: "Use repaired captions", by: "fixture captain", aligned: [0] }); const revisedFilmCard = await waiting(rendered.id); const revisedFilm = E.get(rendered.id)!.ctx.deliver.draft; await playback(revisedFilm, "video-revised");
  ok(!!revisedFilmCard && revisedFilm.n === 2 && !!store.file(rr.id, 1, "render.mp4") && !!store.file(revisedFilm.id, 2, "render.mp4") && store.notes(rr.id, 1).some(n => n.kind === "range"), "film range feedback produces a new native agent round and rerenders its pinned version while keeping the prior film version");
  if (revisedFilmCard) await E.answer(revisedFilmCard.id, { choice: "approve-draft", by: "fixture captain", aligned: [0] }); await until(() => E.get(rendered.id)!.status === "succeeded", 10000);
  ok(E.get(rendered.id)!.ctx.library?.version === 2 && E.get(rendered.id)!.steps.filter(s => s.node === "render").length === 2, "only the rechecked rendered film version is approved and native Task history records both renders");
} delete process.env.CREW_RENDER_STUB; delete process.env.CREW_RENDER_STUB_MP4;
hold = true; const cancel = E.start({ workflow: "documents", params: {}, text: "Cancel during provider revision" }); await until(() => !!E.get(cancel.id)!.nodes.draft?.job, 10000); cancelActive(cancel.id); hold = false; await Bun.sleep(200);
ok(E.get(cancel.id)!.status === "cancelled" && !E.get(cancel.id)!.ctx.approved && !E.cards.list({ run: cancel.id, open: true }).length, "native cancellation interrupts owned agent work and produces no approval or open final card");
const folder = join(data, "folder"); mkdirSync(folder); writeFileSync(join(folder, "a.txt"), "fixture"); const files = E.start({ workflow: "file-organization", params: { folder }, text: "Tidy fixture folder" }); const pc = await waiting(files.id, "card"); await capture(pc, "file-plan-acceptance");
ok(!!pc && existsSync(join(folder, "a.txt")) && !existsSync(join(folder, "Text", "a.txt")), "native file organization waits on exact reviewed dry-run plan before mutation");
if (pc) await E.answer(pc.id, { choice: "apply", by: "fixture captain", aligned: [0] }); await until(() => E.get(files.id)!.status === "succeeded", 10000);
ok(existsSync(join(folder, "Text", "a.txt")) && E.get(files.id)!.ctx.applied?.moved === 1 && existsSync(join(data, "fileorg", E.get(files.id)!.ctx.plan.id, "undo.jsonl")), "native file organization applies checked plan and writes undo evidence");
// No folder: a sample folder in Studio's own data, one per Task, kept while that Task is open; a new one clears those of ended Tasks.
{
  const s1 = E.start({ workflow: "file-organization", params: {}, text: "Tidy a sample folder" }); const c1 = await waiting(s1.id, "card"); const f1 = E.get(s1.id)!.ctx.sampleFolder;
  ok(!!c1 && typeof f1 === "string" && f1.includes("/fileorg-samples/S-") && existsSync(join(f1, "meeting-notes.txt")), "a blank folder plans moves in a sample folder Studio made in its own data", String(f1));
  const s2 = E.start({ workflow: "file-organization", params: {}, text: "Tidy another sample folder" }); const c2 = await waiting(s2.id, "card"); const f2 = E.get(s2.id)!.ctx.sampleFolder;
  ok(!!c2 && f2 !== f1 && existsSync(f1) && existsSync(f2), "an open Task keeps its sample folder while another Task makes its own");
  if (c1) await E.answer(c1.id, { choice: "apply", by: "fixture captain", aligned: [0] }); await until(() => E.get(s1.id)!.status === "succeeded", 10000);
  ok(existsSync(join(f1, "Text", "meeting-notes.txt")), "the captain's apply moves the files inside the sample folder", JSON.stringify(E.get(s1.id)!.status));
  const s3 = E.start({ workflow: "file-organization", params: {}, text: "Tidy a third sample folder" }); await waiting(s3.id, "card"); const f3 = E.get(s3.id)!.ctx.sampleFolder;
  ok(!existsSync(f1) && existsSync(f2) && existsSync(f3), "a new sample folder clears the ended Task's, keeps the open Task's", JSON.stringify([existsSync(f1), existsSync(f2), existsSync(f3)]));
  for (const t of [s2, s3]) E.cancel(t.id, "fixture", "sample lifecycle checked");
}
// Crash window: domain apply succeeded after acceptance, before native hook finish.
const replayFolder = join(data, "replay-folder"); mkdirSync(replayFolder); writeFileSync(join(replayFolder, "r.txt"), "replay fixture"); const replay = E.start({ workflow: "file-organization", params: { folder: replayFolder }, text: "Replay applied plan fixture" }); const replayCard = await waiting(replay.id, "card");
await until(() => E.get(replay.id)!.nodes.card.waiting === "card", 10000); E.pause(replay.id);
if (replayCard) await E.answer(replayCard.id, { choice: "apply", by: "fixture captain", aligned: [0] }); const appliedPlan = E.get(replay.id)!.ctx.plan.id; fileorg.apply(appliedPlan);
const undoBefore = readFileSync(join(data, "fileorg", appliedPlan, "undo.jsonl"), "utf8"); rt = createRuntime(deps); E = rt.engine; E.resume(replay.id); await until(() => E.get(replay.id)!.status === "succeeded", 10000);
ok(E.get(replay.id)!.status === "succeeded" && E.get(replay.id)!.ctx.applied?.moved === 1 && readFileSync(join(data, "fileorg", appliedPlan, "undo.jsonl"), "utf8") === undoBefore, "restart after domain moves but before native hook finish reuses the exact pinned applied plan without moving twice or duplicating undo");

for (const changed of ["source", "destination"]) {
  const box = join(data, `stale-move-${changed}`); mkdirSync(box); writeFileSync(join(box, "s.txt"), "initial fixture"); const task = E.start({ workflow: "file-organization", params: { folder: box }, text: `Stale ${changed} move fixture` }); const offered = await waiting(task.id, "card");
  if (changed === "source") writeFileSync(join(box, "s.txt"), "modified source fixture"); else { mkdirSync(join(box, "Text")); writeFileSync(join(box, "Text", "s.txt"), "destination fixture"); }
  if (offered) await E.answer(offered.id, { choice: "apply", by: "fixture captain", aligned: [0] }); await until(() => E.get(task.id)!.status === "failed", 10000);
  ok(!!offered && E.get(task.id)!.status === "failed" && existsSync(join(box, "s.txt")) && (changed !== "destination" || readFileSync(join(box, "Text", "s.txt"), "utf8") === "destination fixture"), `accepted move plan refuses ${changed} changes after review without overwriting or moving the source`);
}

const outside = join(data, "outside"), linked = join(data, "linked"); mkdirSync(outside); mkdirSync(linked); writeFileSync(join(linked, "b.txt"), "safe"); symlinkSync(outside, join(linked, "Text"));
const escape = E.start({ workflow: "file-organization", params: { folder: linked }, text: "Tidy fixture with unsafe destination" }); await until(() => E.get(escape.id)!.status === "failed", 10000);
ok(existsSync(join(linked, "b.txt")) && !existsSync(join(outside, "b.txt")) && E.cards.list({ run: escape.id, open: true }).length === 1 && E.cards.list({ run: escape.id, open: true })[0].kind === "failure" && E.cards.list({ run: escape.id, open: true })[0].id === E.get(escape.id)!.failureCard && E.get(escape.id)!.failure?.code === "invalid-input.params", "unsafe symlink plan fails without touching files outside the chosen folder; its only open card is the typed failure card (invalid-input)", JSON.stringify(E.get(escape.id)!.failure && [E.get(escape.id)!.failure!.code, E.get(escape.id)!.failure!.message]));
// An edited native workflow that never produces an artifact must not get fake readiness.
const emptyDef = rt.defs.get("documents")!; rt.defs.save("documents", { ...emptyDef, base: emptyDef.version, nodes: emptyDef.nodes.map(n => n.id === "draft" ? { id: n.id, kind: "hook", label: "No-output fixture", do: "note" } : n) }, "fixture captain");
const empty = E.start({ workflow: "documents", params: {}, text: "Missing output fixture" }); const emptyCard = await waiting(empty.id, "escalation");
ok(!!emptyCard && E.ledger(empty.id).some(e => e.check === "core/artifact-ready" && e.verdict === "fail" && e.findings.some(f => f.class === "missing-output")) && !E.cards.list({ run: empty.id }).some(c => c.node === "accept"), "native readiness fails with signed missing-output findings when no producer artifact exists; it cannot fall back to a fake pass"); cancelActive(empty.id);

// A stale source and pre-pin legacy acceptance cannot record approval.
const stale = E.start({ workflow: "web-prototype", params: {}, text: "Stale acceptance fixture" }); const sc = await waiting(stale.id);
const sr = E.get(stale.id)!.ctx.deliver["design-a"]; const replace = join(data, "replacement"); mkdirSync(replace); writeFileSync(join(replace, "index.html"), "<main>New external fixture version</main>");
store.addVersion(sr.id, { from: replace, primary: "index.html", createdBy: { kind: "captain" } });
if (sc) await E.answer(sc.id, { choice: "approve-design-a", by: "fixture captain", aligned: [0] });
ok(!E.get(stale.id)!.ctx.approved && store.version(sr.id, sr.n)?.status !== "approved" && store.latest(sr.id)?.status !== "approved", "a stale final card cannot approve its outdated version or a newer unreviewed version"); cancelActive(stale.id);
const legacy = E.start({ workflow: "web-prototype", params: {}, text: "Legacy acceptance fixture" }); const lc = await waiting(legacy.id); await until(() => E.get(legacy.id)!.nodes.accept.waiting === "card", 10000);
if (lc) { const originalOffers = JSON.stringify(lc.detail.artifactAcceptance.offered); lc.detail = null; E.cards.save(lc); rt = createRuntime(deps); E = rt.engine; await E.answer(lc.id, { choice: "approve-design-a", by: "fixture captain", aligned: [0] }); const fresh = await waiting(legacy.id);
  ok(!E.get(legacy.id)!.ctx.approved && fresh?.id !== lc.id && JSON.stringify(fresh?.detail?.artifactAcceptance?.offered) === originalOffers, "legacy in-flight card with no version pins creates a fresh review card without synthesizing approval or rewriting artifact history"); }
cancelActive(legacy.id);
// The deterministic lane uses a real throwaway git repo and a pinned approved image.
const sh = (cwd: string, ...argv: string[]) => { const r = Bun.spawnSync(argv, { cwd, env: { ...process.env, GIT_AUTHOR_NAME: "Fixture", GIT_AUTHOR_EMAIL: "fixture@example.invalid", GIT_COMMITTER_NAME: "Fixture", GIT_COMMITTER_EMAIL: "fixture@example.invalid" }, stdout: "pipe", stderr: "pipe" }); if (r.exitCode) throw new Error(r.stderr.toString()); return r.stdout.toString().trim(); };
const repo = join(data, "lane-repo"); mkdirSync(repo); assertTempRepo(repo); sh(repo, "git", "init", "-q", "-b", "main"); writeFileSync(join(repo, "README.md"), "# Fixture repository\n"); sh(repo, "git", "add", "README.md"); sh(repo, "git", "commit", "-qm", "fixture base"); const before = sh(repo, "git", "rev-parse", "HEAD"); const registered = lane.addRepo({ path: repo, name: "fixture-lane" });
const img = join(data, "image"); mkdirSync(img); writeFileSync(join(img, "banner.svg"), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>'); store.create({ id: "fixture-image", title: "Fixture image", type: "image", source: "file", entry: "banner.svg" }); store.addVersion("fixture-image", { from: img, primary: "banner.svg", createdBy: { kind: "captain" } }); store.approve("fixture-image", 1, "fixture captain");
const lr = E.start({ workflow: "trivial-lane", params: { artifact: "fixture-image", repo: registered.id }, text: "Add fixture banner" }); const mc = await waiting(lr.id, "merge-card"); await capture(mc, "lane-acceptance");
ok(!!mc && sh(repo, "git", "rev-parse", "HEAD") === before && lane.card(E.get(lr.id)!.ctx.lane?.id)?.checks.every(c => c.ok !== false), "native trivial lane prepares a real checked local branch and waits before merging");
ok(E.ledger(lr.id).some(e => e.check === "core/lane-ready" && e.verdict === "pass" && e.version === "1.0.0" && e.proves.includes(0)) && E.doneLines(E.get(lr.id)!).some(l => l.proved), "trivial lane uses signed versioned readiness evidence with a proved done line");
if (mc) await E.answer(mc.id, { choice: "merge", by: "fixture captain", aligned: [0] }); await until(() => E.get(lr.id)!.status === "succeeded", 10000);
ok(sh(repo, "git", "rev-parse", "HEAD") !== before && /assets\/fixture-image.svg/.test(readFileSync(join(repo, "README.md"), "utf8")) && !sh(repo, "git", "remote"), "captain's lane answer merges only the pinned image into the local README with no remote");
const repo2 = join(data, "lane-stale-repo"); mkdirSync(repo2); assertTempRepo(repo2); sh(repo2, "git", "init", "-q", "-b", "main"); writeFileSync(join(repo2, "README.md"), "# Stale fixture repository\n"); sh(repo2, "git", "add", "README.md"); sh(repo2, "git", "commit", "-qm", "fixture base"); const registered2 = lane.addRepo({ path: repo2, name: "stale-fixture-lane" });
const lr2 = E.start({ workflow: "trivial-lane", params: { artifact: "fixture-image", repo: registered2.id }, text: "Stale image fixture" }); const mc2 = await waiting(lr2.id, "merge-card");
ok(!!mc2, "stale lane fixture reaches a real merge card");
if (mc2) { store.addVersion("fixture-image", { from: img, primary: "banner.svg", createdBy: { kind: "captain" } }); store.approve("fixture-image", 2, "fixture captain"); const headBefore = sh(repo2, "git", "rev-parse", "HEAD"); await E.answer(mc2.id, { choice: "merge", by: "fixture captain", aligned: [0] }); await until(() => E.get(lr2.id)!.status === "failed", 10000); ok(E.get(lr2.id)!.status === "failed" && sh(repo2, "git", "rev-parse", "HEAD") === headBefore, "lane refuses a changed approved image between recipe and merge"); }

// Native acceptance retains its offered recipe identity even if the backing card is replaced.
for (const mutation of ["branch", "backing-card", "legacy-context", "side-effect-replay", "false-merged-record"]) {
  const target = join(data, `native-pin-${mutation}`); mkdirSync(target); assertTempRepo(target); sh(target, "git", "init", "-q", "-b", "main"); writeFileSync(join(target, "README.md"), "# Native pin fixture\n"); sh(target, "git", "add", "README.md"); sh(target, "git", "commit", "-qm", "base"); const registered = lane.addRepo({ path: target, name: `native-${mutation}` });
  const task = E.start({ workflow: "trivial-lane", params: { artifact: "fixture-image", repo: registered.id }, text: "Pinned native lane fixture" }); const offer = await waiting(task.id, "merge-card"); await until(() => E.get(task.id)!.nodes["merge-card"].waiting === "card", 10000);
  const pinned = E.get(task.id)!.ctx.lane, backing = lane.card(pinned.id)!;
  if (mutation === "false-merged-record") { backing.state = "merged"; writeFileSync(join(data, "lane", `${backing.id}.json`), JSON.stringify(backing)); }
  else if (mutation === "legacy-context") { delete pinned.pin; E.pause(task.id); }
  else if (mutation === "side-effect-replay") { E.pause(task.id); }
  else { const changed = sh(target, "git", "commit-tree", `${backing.commit}^{tree}`, "-p", backing.commit!, "-m", "unreviewed native branch"); sh(target, "git", "update-ref", `refs/heads/${backing.branch}`, changed);
    if (mutation === "backing-card") { backing.commit = changed; if (backing.pin) backing.pin.commit = changed; writeFileSync(join(data, "lane", `${backing.id}.json`), JSON.stringify(backing)); } }
  const before = sh(target, "git", "rev-parse", "main"); if (offer) await E.answer(offer.id, { choice: "merge", by: "fixture captain", aligned: [0] });
  if (mutation === "side-effect-replay") { await lane.merge(backing.id, "fixture captain"); const records = readFileSync(join(data, "repo-refs.jsonl"), "utf8"); rt = createRuntime(deps); E = rt.engine; E.resume(task.id); await until(() => E.get(task.id)!.status === "succeeded", 10000);
    ok(E.get(task.id)!.ctx.merged?.head === backing.commit && sh(target, "git", "rev-parse", "main") === backing.commit && readFileSync(join(data, "repo-refs.jsonl"), "utf8") === records, "native replay of a completed pinned lane side effect reports actual head without another merge record");
  } else { if (mutation === "legacy-context") { rt = createRuntime(deps); E = rt.engine; E.resume(task.id); } await until(() => E.get(task.id)!.status === "failed", 10000);
    ok(!!offer && E.get(task.id)!.status === "failed" && !E.get(task.id)!.ctx.merged && sh(target, "git", "rev-parse", "main") === before, `native ${mutation} identity mutation refuses the accepted stale recipe without base mutation or recorded merge`); }
}

// Kill only the fixture process we started, then recover its active native round.
const restartData = checkedTempDir("crew-native-restart-");
const child = Bun.spawn([process.execPath, import.meta.path], { cwd: join(import.meta.dir, ".."), env: { ...process.env, CREW_NATIVE_RESTART_DATA: restartData, CREW_NATIVE_RESTART_PHASE: "hold" }, stdout: "pipe", stderr: "pipe" });
let childText = ""; const reader = (async () => { for await (const chunk of child.stdout as any) childText += Buffer.from(chunk).toString(); })();
const ready = await until(() => /RESTART_READY:R-/.test(childText), 15000); child.kill("SIGKILL"); await child.exited; await reader;
ok(ready, "restart fixture persisted an active owned provider round before its process stopped");
const recoveredStore = new ArtifactStore(restartData), recoveredAgents = new Agents(restartData, () => `http://127.0.0.1:${port}`); activeAgents = recoveredAgents;
const restored = createRuntime({ ...deps, dataDir: restartData, agents: recoveredAgents, m3: { store: recoveredStore, lane: new Lane(restartData, recoveredStore), runs: null } }); const resumedId = /RESTART_READY:(R-\d+)/.exec(childText)?.[1];
if (resumedId) { await until(() => restored.engine.cards.list({ run: resumedId, open: true }).some(c => c.node === "accept"), 30000); const resumed = restored.engine.get(resumedId)!;
  ok(resumed.recovered > 0 && resumed.steps.some(s => s.state === "interrupted") && resumed.nodes.draft.visits === 2 && recoveredStore.versions(resumed.ctx.deliver?.draft?.id).length === 2 && !resumed.ctx.approved,
    "active-work restart replays the interrupted native round, retains genuine refinement versions and reaches one final card without duplicate publication"); restored.engine.cancel(resumedId); }
activeAgents = agents;

ok(boundedWriteRefused && !existsSync(join(data, "runs", "escape.txt")) && rounds > 5, "fixture rounds exercise bounded tools and refuse writes outside their work folders (in-process fixture has no OS subprocess)");
if (captureBrowser) await captureBrowser.close();
srv.stop(true); end();
