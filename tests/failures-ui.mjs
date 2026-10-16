// The failure card of every class, rendered by the shared card component (public/scard.js) from real engine cards
// (tests/failures.ts --emit), in en and zh-TW: its class, code, exact message, what to fix and where, backoff,
// what changed, log link or why there is none, diagnostics, and exactly the class's actions. A refused Retry shows
// the server's own refusal in the card's language. Screenshots: 1280 light (en, zh-TW) and 390 dark (zh-TW).
//   node tests/failures-ui.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const here = dirname(fileURLToPath(import.meta.url)), root = join(here, "..");
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright").catch(() => { console.error("failures-ui: Playwright not found"); process.exit(2); });
const out = join(mkdtempSync(join(tmpdir(), "crew-failui-")), "cards.json");
const fx = spawnSync("bun", ["tests/failures.ts", "--emit", out], { cwd: root, encoding: "utf8", env: { ...process.env, CREW_LOCAL_UNRESTRICTED: "0" } });
if (fx.status !== 0) { console.error(fx.stdout.slice(-2000), fx.stderr.slice(-2000)); process.exit(1); }
const cards = JSON.parse(readFileSync(out, "utf8"));
const shots = join(root, "tests/out/failures"); mkdirSync(shots, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const WANT = { ask: "answer,park", environment: "fix-retry,park", transient: "retry,park", deterministic: "retry,edit-params,park", scope: "rescope,park", "invalid-input": "edit-params,park", internal: "report,park" };
const CHIP = { ask: ["Question", "提問"], environment: ["Environment", "環境"], scope: ["Scope", "範圍"], transient: ["Transient", "暫時性"], deterministic: ["Deterministic", "確定性"], "invalid-input": ["Invalid input", "輸入無效"], internal: ["Studio bug", "Studio bug"] };
ok(cards.length === 7 && Object.keys(WANT).every((k) => cards.some((c) => c.failure?.class === k)), "the fixture has one real engine card per class", cards.map((c) => c.failure?.class).join(","));
const css = readFileSync(join(root, "public/styles.css"), "utf8"), js = readFileSync(join(root, "public/scard.js"), "utf8");
const browser = await chromium.launch({ headless: true });
try {
  for (const [w, h, scheme, langs] of [[1280, 900, "light", ["en", "zh-TW"]], [390, 844, "dark", ["zh-TW"]]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 1 });
    const p = await ctx.newPage(); const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
    for (const lang of langs) for (const card of cards) {
      const cls = card.failure.class, zh = lang === "zh-TW";
      await p.setContent(`<!doctype html><html lang="${lang}"><head><meta name="viewport" content="width=device-width"><style>${css}</style><style>body{background:var(--bg);color:var(--text);margin:0;padding:16px;font:14px system-ui}</style></head><body><main id="c" style="max-width:860px"></main></body></html>`);
      await p.addScriptTag({ content: js });
      // the answer route: a deterministic Retry with nothing changed is refused, with the engine's own words
      await p.evaluate(({ card }) => { window.posted = []; window.fetch = async (u, o) => { const body = JSON.parse(o?.body || "{}"); window.posted.push(body);
        if (card.failure.class === "deterministic" && body.choice === "retry") return { ok: false, json: async () => ({ error: "Retry refused: nothing changed since the failure (compared: agent, base, budget, head, params, policy, spec, workflow).", refusal: { code: "no-change", en: "Retry refused: nothing changed since the failure (compared: agent, base, budget, head, params, policy, spec, workflow).", "zh-TW": "已拒絕重試：失敗之後沒有任何輸入改變。" } }) };
        return { ok: true, json: async () => ({ ...card, status: "answered", answer: { choice: body.choice, note: body.note, by: "captain" } }) }; };
        window.crewCard.mountCard(document.querySelector("#c"), card, { lang: document.documentElement.lang, inbox: true }); }, { card });
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
        ok(zh ? msg === "已拒絕重試：失敗之後沒有任何輸入改變。" : /^Retry refused: nothing changed/.test(msg ?? ""), `${tag}: a refused Retry shows the refusal in the card's language and the card stays open`, msg);
      }
      if (cls === "internal") ok(v.diag, `${tag}: the kept diagnostics are on the card`);
      ok(!v?.overflow, `${tag}: no horizontal page scroll`);
      const el = p.locator("#c"); await el.screenshot({ path: join(shots, `${cls}-${lang}-${w}-${scheme}.png`) });
    }
    ok(!errors.length, `${w}px ${scheme}: no page errors`, errors.join(" | "));
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(`\nfailures-ui: ${pass} passed, ${fail} failed · screenshots in tests/out/failures/`);
process.exit(fail ? 1 : 0);
