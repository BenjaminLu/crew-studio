// The failure card of every class, rendered by the shared card component (public/scard.js) from real engine cards
// served by the real card API (tests/failures-ui-server.ts → runtime/index.ts /api/scards), in en and zh-TW: its class, code, exact message, what to fix and where, backoff,
// what changed, log link or why there is none, diagnostics, and exactly the class's actions. A refused Retry shows
// the server's own refusal in the card's language. Screenshots: 1280 light (en, zh-TW) and 390 dark (zh-TW).
//   node tests/failures-ui.mjs
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => { console.error("failures-ui: Playwright not found"); process.exit(2); });
// the real runtime and its card API, with one engine-raised failure card per class
const server = spawn("bun", ["tests/failures-ui-server.ts"], { cwd: root, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CREW_LOCAL_UNRESTRICTED: "0" } });
let serverOut = ""; server.stderr.on("data", (d) => (serverOut += d));
const ready = await new Promise((res, rej) => { let buf = ""; const t = setTimeout(() => rej(new Error("server did not start: " + serverOut.slice(-2000))), 60000);
  server.stdout.on("data", (d) => { buf += d; const m = /READY (\d+) (.*)\n/.exec(buf); if (m) { clearTimeout(t); res({ port: Number(m[1]), cards: JSON.parse(m[2]) }); } });
  server.on("exit", (code) => { clearTimeout(t); rej(new Error(`server exited ${code}: ${serverOut.slice(-2000)}`)); }); });
const base = `http://127.0.0.1:${ready.port}`, cards = ready.cards;
const shots = join(root, "tests/out/failures"); mkdirSync(shots, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const WANT = { ask: "answer,park", environment: "fix-retry,park", transient: "retry,park", deterministic: "retry,edit-params,park", scope: "rescope,park", "invalid-input": "edit-params,park", internal: "report,park" };
const CHIP = { ask: ["Question", "提問"], environment: ["Environment", "環境"], scope: ["Scope", "範圍"], transient: ["Transient", "暫時性"], deterministic: ["Deterministic", "確定性"], "invalid-input": ["Invalid input", "輸入無效"], internal: ["Studio bug", "Studio bug"] };
ok(cards.length === 7 && Object.keys(WANT).every((k) => cards.some((c) => c.failure?.class === k)), "the fixture has one real engine card per class", cards.map((c) => c.failure?.class).join(","));
const browser = await chromium.launch({ headless: true });
try {
  for (const [w, h, scheme, langs] of [[1280, 900, "light", ["en", "zh-TW"]], [390, 844, "dark", ["zh-TW"]]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1 });
    const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
    for (const lang of langs) for (const card of cards) {
      const cls = card.failure.class, zh = lang === "zh-TW";
      await p.goto(`${base}/?card=${encodeURIComponent(card.id)}&lang=${lang}`); await p.waitForFunction(() => window.mounted === true && !!document.querySelector("[data-failure-class]"));
      const tag = `${cls}/${lang}/${w}`;
      const v = await p.evaluate(() => { const f = document.querySelector("[data-failure-class]"); return f && { cls: f.dataset.failureClass, code: f.dataset.failureCode, chip: f.querySelector("[data-failure-chip]")?.textContent, message: f.querySelector("[data-failure-message]")?.textContent,
        fix: f.querySelector('[data-failure-field="fix"]')?.textContent ?? null, where: f.querySelector('[data-failure-field="where"]')?.textContent ?? null, backoff: f.querySelector("[data-failure-backoff]")?.textContent ?? null,
        changed: f.querySelector("[data-failure-changed]")?.textContent ?? null, log: f.querySelector("[data-failure-log]")?.textContent ?? "", diag: !!f.querySelector("[data-failure-diagnostics]"),
        options: [...document.querySelectorAll("[data-option]")].map((b) => b.dataset.option).join(","), labels: [...document.querySelectorAll("[data-option]")].map((b) => b.textContent),
        how: document.querySelector('[data-sec="how"]')?.textContent ?? "", overflow: document.documentElement.scrollWidth > window.innerWidth + 1 }; });
      ok(!!v && v.cls === cls && v.code === card.failure.code && v.chip === CHIP[cls][zh ? 1 : 0], `${tag}: the card shows its class chip and typed code`, JSON.stringify(v && [v.cls, v.code, v.chip]));
      ok(v?.message === card.failure.message, `${tag}: the exact (sanitized) message is shown`);
      ok(v?.options === WANT[cls] && v.labels.every((l, i) => l === (zh ? card.options[i].labelZh || card.options[i].label : card.options[i].label)), `${tag}: exactly the class's actions, Park included, labelled in the card's language`, JSON.stringify([v?.options, v?.labels]));
      ok(v?.how === (zh ? "怎麼做" : "How") + card.sections[lang].how, `${tag}: the next action is spelled out in ${lang}`, v?.how);
      ok(/log|日誌/i.test(v?.log ?? ""), `${tag}: the log link, or why there is none, is shown`, v?.log);
      if (cls === "environment") ok(!!v.fix && !!v.where && (zh ? /\.crew\/gates\.json/.test(v.where) : /\.crew\/gates\.json/.test(v.where)), `${tag}: what to fix and where`, JSON.stringify([v.fix, v.where]));
      if (cls === "transient") ok(zh ? /第 1 次重試/.test(v.backoff) : /Retry 1: waits/.test(v.backoff ?? ""), `${tag}: the backoff is shown`, v.backoff);
      if (cls === "deterministic") {
        ok(zh ? /目前沒有任何輸入改變/.test(v.changed ?? "") : /Nothing changed yet/.test(v.changed ?? ""), `${tag}: what changed since the failure (nothing yet) is shown`, v.changed);
        await p.locator('[data-option="retry"]').click(); await p.waitForTimeout(60);
        const msg = await p.evaluate(() => document.querySelector("[data-card-msg]")?.textContent);
        const still = await (await fetch(`${base}/api/scards/${card.id}`)).json();
        ok((zh ? /^已拒絕重試：失敗之後沒有任何輸入改變（比對了：agent, base, budget, head, params, policy, spec, workflow）/.test(msg ?? "") : /^Retry refused: nothing changed since the failure \(compared: agent, base, budget, head, params, policy, spec, workflow\)/.test(msg ?? "")) && still.status === "open",
          `${tag}: the real answer route refuses Retry with the compared inputs, in the card's language, and the card stays open`, msg);
      }
      if (cls === "internal") ok(v.diag, `${tag}: the kept diagnostics are on the card`);
      ok(!v?.overflow, `${tag}: no horizontal page scroll`);
      const el = p.locator("#c"); await el.screenshot({ path: join(shots, `${cls}-${lang}-${w}-${scheme}.png`) });
    }
    ok(!errors.length, `${w}px ${scheme}: no page errors`, errors.join(" | "));
    await ctx.close();
  }
  // the real route takes an answer: Answer and continue on the ask card runs the step again and the task finishes
  { const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage(); const ask = cards.find((c) => c.failure.class === "ask");
    await p.goto(`${base}/?card=${ask.id}&lang=zh-TW`); await p.waitForFunction(() => window.mounted === true);
    await p.fill("[data-card-note]", "日圓沒有小數位"); await p.locator('[data-option="answer"]').click();
    let after = null; for (let i = 0; i < 50 && after?.status !== "answered"; i++) { await p.waitForTimeout(100); after = await (await fetch(`${base}/api/scards/${ask.id}`)).json(); }
    ok(after?.status === "answered" && after.answer?.note === "日圓沒有小數位" && await p.locator("[data-card-answered]").count() === 1, "ask/zh-TW: Answer and continue goes through the real route and the card shows it answered", JSON.stringify(after?.answer));
    await ctx.close(); }
} finally { await browser.close(); server.kill("SIGTERM"); }
console.log(`\nfailures-ui: ${pass} passed, ${fail} failed · screenshots in tests/out/failures/`);
process.exit(fail ? 1 : 0);
