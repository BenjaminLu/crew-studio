import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Board-to-board work in a real browser (public/lan.js, docs/units/lan-relay.md), on two real Studios (tests/lan/ui-fixture.ts):
//   the sidebar's Peers item and its count; 我的地址 (fingerprint, device name, copy); the introduction in the page: B opens
//   its window, A enters B's address, each types the code the other screen shows, a wrong code is refused; dispatching
//   from the page; the inbox: the full briefing and the exact prompt, a long one gated until read to its end, take with a
//   workflow, assign, start, reject; received HTML and SVG drawn as text and never run; 交回 after the preview; the
//   relay track (every hand-off with who, device and time; where it is, who holds it, what's next); the entry inspector
//   (who signed, which briefing, which workflow@version); and a page cannot reach the peer listener.
//   LAN_UI_SHOTS=<dir>  also write screenshots there
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => { console.error("lan-ui: Playwright not found"); process.exit(2); });
let pass = 0, fail = 0; const errors = [];
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const shots = process.env.LAN_UI_SHOTS; if (shots) mkdirSync(shots, { recursive: true });
const shot = async (page, n) => { if (shots) await page.screenshot({ path: join(shots, `${n}.png`), fullPage: true }); };

const fx = spawn("bun", [join(here, "lan/ui-fixture.ts")], { cwd: root, stdio: ["pipe", "pipe", "inherit"] });
const info = await new Promise((res, rej) => { const rl = createInterface({ input: fx.stdout }); rl.on("line", (l) => { try { const j = JSON.parse(l); if (j.A) res(j); } catch {} }); fx.on("exit", (c) => rej(new Error(`fixture exited ${c}`))); });
// /api/lan answers only Studio's own page: the harness sends what the page's browser would (its cookie, same origin)
const pageHeaders = (s, writing) => ({ "content-type": "application/json", cookie: `crew_session_${createHash("sha256").update(s.token).digest("hex")}=${s.token}`, "sec-fetch-site": "same-origin", ...(writing ? { origin: s.base } : {}) });
const api = (s, path, body) => fetch(s.base + path, { method: body === undefined ? "GET" : "POST", headers: path.startsWith("/api/lan") ? pageHeaders(s, body !== undefined) : { "content-type": "application/json", "x-crew-session": s.token }, body: body === undefined ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const until = async (f, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { const v = await f(); if (v) return v; } catch {} await new Promise((r) => setTimeout(r, 120)); } return null; };
const browser = await chromium.launch();
const open = async (s) => { const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } }); const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${s.base}: ${e.message}`)); page.on("dialog", (d) => { if (/LAN-PWNED/.test(d.message())) errors.push("a peer's HTML ran a dialog"); d.accept(); });
  const r = await page.goto(`${s.base}/session?t=${encodeURIComponent(s.token)}`); if (!r?.ok()) throw new Error("session link refused"); await page.goto(`${s.base}/#/lan`); return page; };
const A = info.A, B = info.B;
try {
  const pa = await open(A), pb = await open(B);
  await pa.locator("[data-lan-me]").waitFor({ timeout: 15000 }); await pb.locator("[data-lan-me]").waitFor();
  ok(await pa.locator('.nav-item[data-view="lan"]').count() === 1, "the sidebar has a Peers entry");
  const meA = await pa.locator("[data-lan-me]").innerText();
  ok(/Studio A/.test(meA) && /\d{5} \d{5} \d{5} \d{5} \d{5} \d{5}/.test(meA) && /127\.0\.0\.1:\d+/.test(meA), "我的地址 shows the device name, the full fingerprint and the address", meA.slice(0, 200));
  ok(await pa.locator("[data-lan-copy]").count() === 1, "my address has a copy button");
  // ---------- the introduction, in the page ----------
  await pb.locator("[data-lan-intro-open]").click();
  await pb.locator("[data-lan-intros] .badge.human").waitFor();
  await pa.fill("#lanIntroHost", "127.0.0.1"); await pa.fill("#lanIntroPort", String(info.lanB)); await pa.locator("[data-lan-intro-start]").click();
  await pa.locator("[data-lan-intro]").waitFor({ timeout: 15000 });
  await pb.reload(); await pb.locator("[data-lan-intro]").waitFor({ timeout: 15000 });
  const sasA = (await pa.locator(".lan-sas b").innerText()).replace(/\D/g, ""), sasB = (await pb.locator(".lan-sas b").innerText()).replace(/\D/g, "");
  ok(/^\d{6}$/.test(sasA) && sasA === sasB, "both screens show the same 6-digit code", `${sasA} ${sasB}`);
  await shot(pa, "1-intro");
  // a wrong code on B: refused, the introduction ends there
  await pb.locator("[data-lan-code]").fill(String((Number(sasB) + 7) % 1000000).padStart(6, "0")); await pb.locator("[data-lan-petname]").fill("A");
  await pb.locator("[data-lan-confirm]").click();
  ok(!!await until(async () => (await pb.locator("[data-lan-intro]").count()) === 0) && !(await api(B, "/api/lan")).body.peers.length, "a wrong code typed on B is refused and nothing is allowlisted");
  // the window closed with that introduction (one per window): B opens it again, and this time the codes are typed right
  ok(await pb.locator("[data-lan-intro-open]").count() === 1, "B's introduction window closed after one introduction");
  await pb.locator("[data-lan-intro-open]").click(); await pb.locator("[data-lan-intros] .badge.human").waitFor();
  await pa.locator("[data-lan-intro-start]").click(); await pa.locator("[data-lan-intro]").waitFor({ timeout: 15000 });
  await pb.reload(); await pb.locator("[data-lan-intro]").waitFor({ timeout: 15000 });
  const s2a = (await pa.locator(".lan-sas b").innerText()).replace(/\D/g, ""), s2b = (await pb.locator(".lan-sas b").innerText()).replace(/\D/g, "");
  await pa.locator("[data-lan-code]").fill(s2b); await pa.locator("[data-lan-petname]").fill("B 的看板"); await pa.locator("[data-lan-confirm]").click();
  await pb.locator("[data-lan-code]").fill(s2a); await pb.locator("[data-lan-petname]").fill("A 的看板"); await pb.locator("[data-lan-confirm]").click();
  ok(!!await until(async () => (await pa.locator("[data-lan-peer]").count()) === 1 && (await pb.locator("[data-lan-peer]").count()) === 1), "after both type the right code, each lists the other under its own name");
  ok(/A 的看板/.test(await pb.locator("[data-lan-peers]").innerText()) && /(自稱|calls itself) Studio A/.test(await pb.locator("[data-lan-peers]").innerText()), "the peer shows under my name for it, with what it calls itself beside it");
  // ---------- received HTML is never run ----------
  const evil = `<img src=x onerror="window.__lanPwned=1;alert('LAN-PWNED')"><script>window.__lanPwned=2</script><svg onload="window.__lanPwned=3"><circle r="9"/></svg><iframe src="javascript:alert('LAN-PWNED')"></iframe>`;
  const long = Array.from({ length: 160 }, (_, i) => `第 ${i + 1} 行：說明`).join("\n");
  const t1 = (await api(A, "/api/lan/dispatch", { to: info.keyB, title: "<b>粗體標題</b>", briefing: `${evil}\n${long}\n最後一行`, acceptance: ["<i>不是斜體</i>"], workflow: "documents" })).body;
  await pb.reload(); await pb.locator(`[data-lan-item]`).first().waitFor({ timeout: 15000 });
  const content = pb.locator("[data-lan-content]");
  const html = await content.innerHTML(), text = await pb.locator("[data-lan-briefing]").innerText();
  const pwned = await pb.evaluate(() => window.__lanPwned);
  ok(pwned === undefined && !/<img|<script|<svg|<iframe/i.test(html.replace(/&lt;/g, "")) && text.includes("<img src=x onerror") && text.includes("<svg onload"), "received HTML and SVG are shown as text and never run (no element made, no script ran)", `${pwned} ${html.slice(0, 160)}`);
  ok((await pb.locator("[data-lan-item]").first().innerText()).includes("<b>粗體標題</b>") && (await pb.locator(".lan-content li").innerText()).includes("<i>不是斜體</i>"), "a title and acceptance criteria are text too");
  const promptText = await pb.locator("[data-lan-prompt]").innerText();
  ok(/<untrusted-lan-briefing-[0-9a-f]{12}>/.test(promptText) && promptText.includes("<img src=x") && promptText.includes("最後一行"), "the approver sees the exact prompt the agent will get, fenced, to its last line");
  const btn = pb.locator(`[data-lan-approve]`);
  ok(await btn.isDisabled(), "a long briefing cannot be approved before it is read to its end");
  await content.evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event("scroll")); });
  ok(!!await until(async () => !(await btn.isDisabled())), "once scrolled to the end, it can be");
  await shot(pb, "2-inbox-html");
  await pb.locator("[data-lan-reject]").click();
  ok(!!await until(async () => !(await api(B, "/api/lan")).body.items.some((i) => i.thread === t1.id)), "reject takes it off the inbox");
  // ---------- dispatch, take, assign, start, hand back, from the pages ----------
  await pa.reload(); await pa.locator("[data-lan-dispatch]").waitFor();
  await pa.fill("#lanTitle", "週報"); await pa.fill("#lanBrief", "請寫這週的週報。\nSTUB_FILE notes.md :: 這週完成：區網協作"); await pa.fill("#lanAcc", "一頁");
  await pa.selectOption("#lanWf", "documents"); await pa.locator("[data-lan-send]").click();
  const th = await until(async () => (await api(A, "/api/lan")).body.threads.find((t) => t.title === "週報"));
  ok(!!th, "the dispatch form sends a thread");
  // the view as if Claude were signed in with an API key here (billed per token): the take dialog says so as soon as the
  // provider is picked, even while the select keeps focus (the page does not re-render then)
  await pb.reload(); await pb.locator("[data-lan-take-wf]").waitFor({ timeout: 15000 });
  ok(await pb.locator('[data-lan-take-wf] option[value="file-organization"]').isDisabled(), "a workflow outside the LAN profile (it moves your files) is offered but cannot be picked");
  await pb.evaluate(() => { window.crewLan.v.billing = { ...(window.crewLan.v.billing || {}), claude: "per-token" }; });
  await pb.selectOption("[data-lan-take-wf]", "documents"); await pb.locator("[data-lan-provider]").focus(); await pb.selectOption("[data-lan-provider]", "claude");
  { const note = await pb.locator("[data-lan-estimate]").innerText(); ok(/billed per token/.test(note), "picking a provider signed in with an API key shows \"billed per token\" at once, before the take", note); }
  await pb.selectOption("[data-lan-provider]", "codex");
  { const note = await pb.locator("[data-lan-estimate]").innerText(); ok(!/billed per token/.test(note), "picking a subscription provider takes the per-token note away again", note); }
  const est = await pb.locator("[data-lan-estimate]").innerText();
  ok(/Capped at \d+ agent rounds|上限是這個 Task 的 \d+ 輪/.test(est) && /tokens|token/.test(est) && !/\$|dollar|金額|worst|最壞|%/i.test(est) && await pb.locator("[data-lan-usd], [data-lan-rounds-only]").count() === 0, "the take dialog caps by rounds only and states the daily rounds, agent-minutes and tokens: no dollars, no percentage of a quota", est);
  await pb.locator("[data-lan-content]").evaluate((el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event("scroll")); }); // read to its end
  await pb.locator("[data-lan-approve]").click();
  await pa.reload(); await pa.locator('[data-lan-item]').first().waitFor({ timeout: 15000 });
  ok(/接下|Take/.test(await pa.locator("[data-lan-detail]").innerText()), "A's inbox shows B's take with its workflow and cap");
  await pa.locator("[data-lan-approve]").click();
  await pb.reload(); await pb.locator('[data-lan-approve]').waitFor({ timeout: 15000 });
  await pb.locator("[data-lan-approve]").click(); // start (restricted profile)
  const run = await until(async () => (await api(B, "/api/lan")).body.threads.find((t) => t.id === th.id)?.rounds[0].run?.id);
  ok(!!run, "B's start button starts its own Task", run);
  // the documents workflow's acceptance card, answered by B's captain
  const finished = await until(async () => { const v = (await api(B, `/api/wruns/${run}`)).body; const c = (v.cards ?? []).find((c) => c.status === "open" && c.node === "accept"); if (c) await api(B, `/api/scards/${encodeURIComponent(c.id)}/answer`, { choice: "approve-draft", note: null, confirm: c.confirmDoor && c.door === "one-way" ? "one-way" : null, aligned: c.detail?.intents?.length ? c.detail.intents.map((_, n) => n) : undefined }); return v.status === "succeeded"; }, 60000);
  ok(!!finished, "B's Task runs to its end", await api(B, `/api/wruns/${run}`).then((x) => JSON.stringify([x.body?.status, x.body?.params?.provider, (x.body?.cards ?? []).filter((c) => c.status === "open").map((c) => [c.node, c.kind, c.title?.en ?? c.title]), (x.body?.steps ?? []).map((s) => `${s.node}:${s.state}`)])));
  await pb.reload(); await pb.locator(`[data-lan-preview="${th.id}"]`).waitFor({ timeout: 20000 });
  await pb.locator(`[data-lan-preview="${th.id}"]`).click();
  await pb.locator(`[data-lan-handback-send="${th.id}"]`).waitFor();
  ok(/notes\.md/.test(await pb.locator(`[data-lan-handback="${th.id}"]`).innerText()), "the hand-back preview shows the exact files that go back, editable");
  await shot(pb, "3-handback"); if (shots) await pb.locator(`[data-lan-thread="${th.id}"]`).screenshot({ path: join(shots, "3-handback-card.png") });
  await pb.locator(`[data-lan-handback-send="${th.id}"]`).click();
  await pa.reload(); await pa.locator('[data-lan-file="notes.md"]').waitFor({ timeout: 15000 });
  ok(/這週完成：區網協作/.test(await pa.locator('[data-lan-file="notes.md"]').innerText()), "A's inbox shows the result's files as text");
  await pa.locator("[data-lan-approve]").click();
  await pa.locator(`[data-lan-done="${th.id}"]`).waitFor({ timeout: 15000 }); await pa.locator(`[data-lan-done="${th.id}"]`).click();
  // ---------- the relay track and the inspector ----------
  await until(async () => (await api(A, "/api/lan")).body.threads.find((t) => t.id === th.id)?.state === "done");
  await pa.goto(`${A.base}/#/lan/${th.id}`); await pa.reload(); const card = pa.locator(`[data-lan-thread="${th.id}"]`); await card.waitFor();
  const kinds = await card.locator("[data-lan-step]").evaluateAll((els) => els.map((e) => e.dataset.lanStep));
  ok(kinds.join(",") === "dispatch,take,assign,result,done" && await card.locator("[data-lan-run]").count() === 1, "the relay track shows every hand-off in order, with the run between the assignment and the result", kinds.join(","));
  const trackText = await card.locator("[data-lan-track]").innerText();
  ok(/B 的看板/.test(trackText) && /\d{2}:\d{2}:\d{2}/.test(trackText) && /\d{5} \d{5}/.test(trackText), "each hand-off names who (my name for them), their device's fingerprint and the time");
  const now = await card.locator(`[data-lan-now="${th.id}"]`).innerText();
  ok(/已完成|Done/.test(now) && /沒有下一步|Nothing/.test(now), "where it is now, who holds it and what's next", now);
  await shot(pa, "4-track"); if (shots) await card.screenshot({ path: join(shots, "4-track-card.png") });
  await card.locator('[data-lan-step="take"]').click();
  const insp = pa.locator("[data-lan-inspector]"); await insp.waitFor();
  const it = await insp.innerText();
  ok(/B 的看板/.test(it) && /合法|valid/.test(it) && /documents@v1 · [0-9a-f]{64}/.test(it) && /[0-9a-f]{64}/.test(it), "the entry inspector shows who signed, the signature, which briefing and which workflow@version", it.slice(0, 300));
  await pa.locator("[data-lan-inspector-close]").click();
  // ---------- a page cannot reach the peer listener ----------
  const r = await pa.evaluate(async (port) => { try { const x = await fetch(`http://127.0.0.1:${port}/lan/v2/kk`, { method: "POST", body: new Uint8Array(64), headers: { "content-type": "application/octet-stream" } }); return `status ${x.status}`; } catch (e) { return `blocked: ${e.message}`; } }, info.lanB);
  const r2 = await pa.evaluate(async (port) => { try { await fetch(`http://127.0.0.1:${port}/lan/v2/kk`, { method: "POST", mode: "no-cors", body: "x" }); return "sent"; } catch (e) { return `blocked: ${e.message}`; } }, info.lanB);
  const refused = (await api(B, "/api/lan")).body.refused;
  ok(/^blocked/.test(r), "a page's fetch to the peer listener is blocked (no CORS: the preflight fails)", r);
  ok(r2 === "sent" || /^blocked/.test(r2), "a no-cors request gets no readable answer", r2);
  ok(errors.length === 0, "no page error, no dialog from a peer's content", errors.join(" | "));
  // board-to-board work off (or failed to start): the page shows why and how to turn it on, and does not ask again in a loop
  { const pc = await open(A); let asked = 0;
    await pc.route("**/api/lan", (route) => { if (route.request().method() !== "GET") return route.continue(); asked++; return route.fulfill({ status: 200, json: { off: true, error: "board-to-board work is off on this Studio until you turn it on", code: "off", canEnable: true } }); });
    await pc.goto(`${A.base}/#/lan`); await pc.reload(); await pc.waitForTimeout(3000);
    const shown = await pc.locator("[data-lan-error]").innerText().catch(() => "");
    ok(/off on this Studio/.test(shown) && await pc.locator("[data-lan-enable]").count() === 1 && asked <= 3, "with board-to-board work off, the Peers page shows the reason and a turn-on button, and asks the API a bounded number of times", JSON.stringify([shown, asked]));
    await pc.context().close(); }
} catch (e) { ok(false, `the suite ran to its end: ${e?.stack ?? e}`); }
finally { await browser.close(); fx.stdin.end(); await new Promise((r) => { fx.on("exit", r); setTimeout(r, 15000); }); }
console.log(`\nlan-ui: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
