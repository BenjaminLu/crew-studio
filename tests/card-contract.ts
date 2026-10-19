import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The card contract (retro 2026-10-17, findings 10 and 11; R-044, R-045, R-047, R-048): a card states its
// question in the title, the problem and context in the body, localized options, a note box (or a picker)
// on every option that needs text, and no empty field or internal reason string. engine.card checks every
// card it raises (tests enforce it); a static sweep covers every card a shipped workflow defines; the
// acceptance card needs a readiness check that ran, and a rejection ends the run closed.
//   bun tests/card-contract.ts
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, until, Y } from "./rt-harness";
import { cardContract, TEXT_OPTIONS } from "../src/runtime/card-contract";
import { readinessCause, diagnosedBody } from "../src/runtime/escalation";
import { CARD_KINDS } from "../src/runtime/cards";
import { normalize, validate } from "../src/runtime/defs";
import { parseYaml as parse } from "../src/bundled";
import { installCode } from "../src/domain/code"; import { installDeliver } from "../src/domain/deliver"; import { Projects } from "../src/doors"; import { ArtifactStore } from "../src/artifacts";
const { ok, end } = suite("card-contract");
const root = join(import.meta.dir, "..");
const card = (o: any = {}) => ({ title: { en: "Merge this change?", "zh-TW": "合併這個改動？" }, sections: { en: { why: "Checks passed.", how: "Merge or close." }, "zh-TW": { why: "檢查通過。", how: "合併或關閉。" } },
  body: "", options: [{ id: "merge", label: "Merge", labelZh: "合併" }], ...o });

const originalRecommendation = diagnosedBody({ title: "Choose a scope?", en: { why: "One file is outside scope." }, zh: { why: "有一個檔案不在範圍內。" } }, { by: "firstmate", why: "Permission needed.", zhWhy: "需要權限。", recommendation: "Rescope to include it, or park the Task." });
ok(originalRecommendation.zh?.how?.startsWith("建議原文：") === true && originalRecommendation.zh.how.includes("Rescope to include it"), "an untranslated recommendation is explicitly labeled as original text");

// ---------- the contract itself: each rule refuses the card that broke it ----------
ok(!cardContract(card() as any).length, "a card with a question title, a why, and localized options keeps the contract", JSON.stringify(cardContract(card() as any)));
const old045 = card({ title: { en: "Round is not ready", "zh-TW": "回合尚未就緒" }, sections: { en: { why: "queue.wait_timeout_s must be an explicit integer from 1 to 604800", how: "" }, "zh-TW": { why: "", how: "" } } });
const v045 = cardContract(old045 as any);
ok(v045.some((v) => /names a state, not the question/.test(v)) && v045.some((v) => /internal reason string/.test(v)), "R-045's readiness card (\"Round is not ready\", a policy key as its why) is refused", JSON.stringify(v045));
ok(cardContract(card({ sections: { en: { why: "" }, "zh-TW": { why: "" } }, body: "" }) as any).some((v) => /body is empty/.test(v)), "R-048: a card with an empty body is refused");
ok(cardContract(card({ options: [{ id: "close", label: "Close" }] }) as any).some((v) => /no label \(zh-TW\)/.test(v)), "an option without its zh-TW label is refused");
ok([...TEXT_OPTIONS].every((id) => cardContract(card({ options: [{ id, label: "Do it", labelZh: "做" }] }) as any).some((v) => /opens no note box/.test(v))), "rescope, request changes, revise, another model and answer need a note box", [...TEXT_OPTIONS].join());
ok(!cardContract(card({ options: [{ id: "other-model", label: "Another model", labelZh: "換模型", select: [{ value: "codex", label: "codex" }] }] }) as any).length, "a picker counts as the text an option needs");
ok(cardContract(card({ sections: { en: { why: "Reason: undefined" }, "zh-TW": { why: "原因" } } }) as any).some((v) => /missing value/.test(v)) && cardContract(card({ sections: { en: { why: "x" }, "zh-TW": { why: "null" } } }) as any).some((v) => /missing value/.test(v)),
  "a printed undefined or a bare null is refused");
ok(cardContract(card({ sections: { en: { why: "ProviderRefusal: deterministic.check at run (src/runtime/engine.ts:12)" }, "zh-TW": { why: "x" } } }) as any).some((v) => /internal reason/.test(v)), "an exception class, a failure code or a stack line is refused");
ok(cardContract(card({ options: [] }) as any).some((v) => /no option/.test(v)) && cardContract(card({ title: { en: "", "zh-TW": "" } }) as any).some((v) => /title is empty/.test(v)), "no option, or no title, is refused");

// ---------- readiness: every refusal reason maps to a plain cause and an exact action; provider verification is Firstmate's first ----------
const reasons = ["dependency R-12 has no verified merge evidence", "scope held by R-9", "global capacity is full", "admission deadline passed", "role skill worker changed since staffing approval", "staffing approval missing for code-firstmate",
  "historical scope pin mismatch", "queue.wait_timeout_s must be an explicit integer from 1 to 604800", "configured model gpt-9 effort xhigh unverified", "provider capability identity or freshness unavailable: codex", "something else entirely"];
const causes = reasons.map((r) => [r, readinessCause(r)] as const);
ok(causes.every(([r, c]) => c.en.cause && c.en.action && c.zh.cause && c.zh.action && !c.en.cause.includes(r) && !cardContract(card({ title: { en: `Round cannot start: ${c.en.short}. Prepare again or close?`, "zh-TW": `回合無法開始：${c.zh.short}。` }, sections: { en: { why: c.en.cause, how: c.en.action }, "zh-TW": { why: c.zh.cause, how: c.zh.action } } }) as any).length),
  "each readiness reason becomes a plain cause and an exact action in both languages, keeping the contract", JSON.stringify(causes.map(([r, c]) => [r, c.en.short])));
ok(causes.filter(([, c]) => c.provider).map(([r]) => r).join("|") === "configured model gpt-9 effort xhigh unverified|provider capability identity or freshness unavailable: codex", "only provider verification (model, login, quota) goes to Firstmate first");
const dg = diagnosedBody({ title: "Stuck?", en: { why: "lint failed twice", how: "rescope" }, zh: { why: "lint 兩次失敗", how: "調整" }, options: [] } as any, { by: "firstmate", why: "the style guide and the rule disagree", recommendation: "drop the rule" });
ok(/What is stuck: lint failed twice/.test(dg.body!) && /Firstmate's diagnosis: the style guide/.test(dg.body!) && /Recommended: drop the rule/.test(dg.body!), "a diagnosed card says what is stuck, why, and the recommendation");

// ---------- the static sweep: every card a shipped workflow defines keeps the contract ----------
const shipped: [string, any][] = [];
for (const f of readdirSync(join(root, "workflows/v2")).filter((f) => f.endsWith(".wf.yaml"))) shipped.push([`workflows/v2/${f}`, parse(readFileSync(join(root, "workflows/v2", f), "utf8"))]);
for (const pack of readdirSync(join(root, "packs"))) { let fs: string[] = []; try { fs = readdirSync(join(root, "packs", pack, "workflows")); } catch {} for (const f of fs.filter((f) => /\.ya?ml$/.test(f))) shipped.push([`packs/${pack}/workflows/${f}`, parse(readFileSync(join(root, "packs", pack, "workflows", f), "utf8"))]); }
const loc = (v: any, l: string) => (v && typeof v === "object" ? v[l] ?? "" : v ?? "");
const staticCards = shipped.flatMap(([f, d]) => (d.nodes ?? []).filter((n: any) => n.kind === "card" && !n.args?.mode && !n.args?.body_from).map((n: any) => [f, n] as const));
const staticBad = staticCards.map(([f, n]) => [`${f}#${n.id}`, cardContract({ title: { en: loc(n.card?.title, "en") || n.label, "zh-TW": loc(n.card?.title, "zh-TW") || n.label }, sections: { en: { why: loc(n.card?.body, "en") }, "zh-TW": { why: loc(n.card?.body, "zh-TW") } } as any, body: loc(n.card?.body, "en"), options: n.card?.options ?? [] } as any)] as const).filter(([, v]) => v.length);
ok(staticCards.length >= 1 && !staticBad.length, `every static card in the shipped workflows keeps the contract (${staticCards.length} cards)`, JSON.stringify(staticBad));
// every card kind a shipped workflow names is a known kind, and every body or mode it names is installed by a domain
const kinds = new Set(shipped.flatMap(([, d]) => (d.nodes ?? []).filter((n: any) => n.kind === "card").map((n: any) => n.args?.card_kind ?? "question")));
ok([...kinds].every((k) => (CARD_KINDS as readonly string[]).includes(k)), `every card kind the shipped workflows use is a known card kind (${[...kinds].join(", ")})`);
const bodyNames = new Set(shipped.flatMap(([, d]) => (d.nodes ?? []).filter((n: any) => n.kind === "card" && n.args?.body_from).map((n: any) => n.args.body_from)));
const HB = await harness([]); installCode(HB.engine, { dataDir: HB.data, projects: new Projects(HB.data) }); installDeliver(HB.engine, { dataDir: HB.data, artifacts: new ArtifactStore(HB.data), lane: null, fileorg: null, docs: null });
const { installPackGenesis } = await import("../src/pack-genesis"); try { installPackGenesis(HB.engine, { dataDir: HB.data, artifacts: new ArtifactStore(HB.data) } as any); } catch {}
ok([...bodyNames].every((b) => typeof HB.engine.cardBodies[b] === "function"), `every card body a shipped workflow names is installed (${[...bodyNames].join(", ")})`, JSON.stringify([...bodyNames].filter((b) => typeof HB.engine.cardBodies[b] !== "function")));
// the artifact workflows' escalation and capability cards, built from a stopped refine loop
for (const wf of ["web-prototype", "video", "documents"]) {
  const d = shipped.find(([f]) => f === `workflows/v2/${wf}.wf.yaml`)![1]; const def = normalize(d);
  const x = (node: string) => ({ node: def.nodes.find((n: any) => n.id === node), run: { id: "R-1", title: "Coffee page", text: "Coffee page", def, nodes: { "design-a": { visits: 5 }, draft: { visits: 5 } }, steps: [] },
    ctx: { refine: { refine: { history: [{ outcome: "cap" }] } }, briefs: { "design-a": { items: [{ check: "core/artifact-ready", message: "page has no content element" }] }, draft: { items: [{ check: "core/artifact-ready", message: "document needs a title" }] } } }, rn: { visits: 1 } } as any);
  for (const node of ["escalation", "capability"]) { const b = await HB.engine.cardBodies[def.nodes.find((n: any) => n.id === node)!.args!.body_from](x(node)) as any;
    const v = cardContract({ title: { en: b.title, "zh-TW": b.zhTitle }, sections: { en: b.en, "zh-TW": b.zh }, body: b.body, options: b.options } as any);
    ok(!v.length && (node !== "escalation" || (/core\/artifact-ready/.test(b.en.why) && ["retry", "changes", "close"].every((id) => b.options.some((o: any) => o.id === id)) && b.options.find((o: any) => o.id === "changes").note)),
      `${wf} ${node} card keeps the contract${node === "escalation" ? ", names the failing check, and offers one more round, revise with a note, or close" : ""}`, JSON.stringify([v, b.en.why, b.options]));
    const outs = def.edges.filter((e: any) => e.from === node).map((e: any) => e.when).join("|").split("|");
    ok(b.options.every((o: any) => outs.includes(o.id)), `${wf} ${node}: every option has an edge`, JSON.stringify(outs)); }
  ok(def.nodes.find((n: any) => n.id === "escalation")!.args!.firstmate_first === true, `${wf}'s escalation goes to Firstmate first`);
}
HB.stop();

// b2's captain-only "keep the same crew" staffing card (src/firstmate-staffing.ts) is a permission card: never Firstmate-decidable
{ const { Engine } = await import("../src/runtime/engine"); const src = readFileSync(join(root, "src/firstmate-staffing.ts"), "utf8");
  ok(Engine.CAPTAIN_KINDS.includes("permission") && /engine\.card\(x,'permission',\{captainOnly:true,title:from\?`Workflow updated — keep the same crew/.test(src), "the keep-the-same-crew card is a captain-only permission card, which never goes to Firstmate"); }

// ---------- engine.card enforces the contract (tests run with CREW_CARD_CONTRACT=enforce) ----------
{ const H = await harness([Y({ id: "bad", name: "bad card", version: 1, roles: [], nodes: [{ id: "q", kind: "card", label: "Ship?", card: { title: { en: "Ship it?", "zh-TW": "出貨？" }, body: { en: "Ready.", "zh-TW": "好了。" }, options: [{ id: "rescope", label: "Rescope" }] }, x: 0, y: 0 }, { id: "done", kind: "hook", label: "Done", x: 1, y: 0 }], edges: [["q", "done", "rescope"]] }),
    Y({ id: "good", name: "good card", version: 1, roles: [], nodes: [{ id: "q", kind: "card", label: "Ship?", card: { title: { en: "Ship it?", "zh-TW": "出貨？" }, body: { en: "Ready.", "zh-TW": "好了。" }, options: [{ id: "ship", label: "Ship", labelZh: "出貨" }] }, x: 0, y: 0 }, { id: "done", kind: "hook", label: "Done", x: 1, y: 0 }], edges: [["q", "done", "ship"]] })]);
  ok(process.env.CREW_CARD_CONTRACT === "enforce", "tests run with the card contract enforced (tests/lib/isolated-env.mjs)");
  const bad = H.engine.start({ workflow: "bad", text: "x" }); await until(() => H.engine.get(bad.id)!.status !== "running" && !H.engine.busy(bad.id));
  const bc = H.engine.cards.list({ run: bad.id });
  ok(H.engine.get(bad.id)!.status !== "waiting" && bc.every((c) => c.status !== "open" || c.kind === "failure") && bc.some((c) => c.kind === "question" && c.status === "cancelled") && /card contract/.test(H.engine.events(bad.id).map((e: any) => e.summary ?? e.error ?? "").join(" ")), "a card that breaks the contract is refused in tests: it is withdrawn, and the run fails saying why", JSON.stringify([H.engine.get(bad.id)!.status, bc.map((c) => c.status)]));
  const good = H.engine.start({ workflow: "good", text: "x" }); await until(() => H.engine.cards.list({ run: good.id, open: true }).length === 1);
  ok(true, "a card that keeps the contract is raised");
  process.env.CREW_CARD_CONTRACT = "log"; const logged = H.engine.start({ workflow: "bad", text: "x" }); await until(() => H.engine.cards.list({ run: logged.id, open: true }).length === 1);
  ok(H.engine.events(logged.id).some((e: any) => e.type === "log" && /card contract: .*opens no note box/.test(e.summary)), "outside tests the same card is raised and the violation is logged on the run");
  process.env.CREW_CARD_CONTRACT = "enforce"; H.stop(); }

// ---------- finding 11: an acceptance card needs a readiness check that ran; a rejection ends the run closed ----------
{ const acceptOnly = normalize({ id: "acc", name: "acc", version: 1, roles: [{ id: "w", label: "Writer", skill: "x" }], nodes: [{ id: "write", kind: "agent", label: "Write", role: "w", mode: "deliver", args: { format: "document" }, x: 0, y: 0 },
  { id: "accept", kind: "card", label: "Accept", args: { mode: "deliver-accept", card_kind: "acceptance" }, x: 1, y: 0 }, { id: "done", kind: "hook", label: "Done", x: 2, y: 0 }, { id: "closed", kind: "hook", label: "Closed", x: 2, y: 1 }],
  edges: [["write", "accept"], ["accept", "done", "approved"], ["accept", "write", "changes"], ["accept", "closed", "rejected"]] });
  ok(validate(acceptOnly).some((p) => p.level === "error" && /readiness check/.test(p.text)), "R-047's shape (an acceptance card with no check before it) fails workflow validation");
  for (const wf of ["web-prototype", "video", "documents", "images"]) ok(!validate(normalize(shipped.find(([f]) => f === `workflows/v2/${wf}.wf.yaml`)![1])).some((p) => p.level === "error"), `the shipped ${wf} workflow passes it`);
  // a drafted workflow gets the readiness check in front of its acceptance card, and the R-044 cards gain their note boxes
  const { WorkflowDrafts } = await import("../src/workflow-drafts"); const { WorkflowDefs } = await import("../src/runtime/defs");
  const dd = join(HB.data, "drafts-data"); mkdirSync(dd, { recursive: true }); const defs = new WorkflowDefs(dd, () => []); defs.known = (ref: string) => /^core\//.test(ref); const drafts = new WorkflowDrafts(dd, defs);
  const draft = (cards: any) => ({ goal: "A website", workflow: { name: "Site", roles: [{ id: "designer", label: "Designer", skill: "bundled:workflows/skills/v2/designer.md", seat: "maker" }], nodes: [
    { id: "confirm-brief", kind: "card", label: "Confirm", card: cards.confirm }, { id: "approve-design", kind: "card", label: "Approve design", card: cards.approve },
    { id: "make-a", kind: "agent", label: "Make A", role: "designer", mode: "deliver", args: { format: "web", variant: "A" } }, { id: "make-b", kind: "agent", label: "Make B", role: "designer", mode: "deliver", args: { format: "web", variant: "B" } },
    { id: "final", kind: "card", label: "Accept", accept: true }, { id: "done", kind: "hook", label: "Done" }, { id: "closed", kind: "hook", label: "Closed" }],
    edges: [{ from: "confirm-brief", to: "approve-design", when: "confirm" }, { from: "approve-design", to: "make-a", when: "approve" }, { from: "approve-design", to: "make-b", when: "approve" }, { from: "approve-design", to: "make-a", when: "revise" },
      { from: "make-a", to: "final" }, { from: "make-b", to: "final" }, { from: "final", to: "done", when: "approved" }, { from: "final", to: "make-a", when: "changes" }, { from: "final", to: "closed", when: "rejected" }] } });
  const r044 = { confirm: { title: "确认网站用途、标题和视觉风格？", body: "这三项由船长提供，确认后才交给设计角色。", options: [{ id: "confirm", label: "确认，开始设计" }] }, approve: { title: "核准设计方向？", body: "核准后才开始制作网页。", options: [{ id: "approve", label: "核准，开始制作" }, { id: "revise", label: "需修改" }] } };
  let refused = ""; try { drafts.preview(draft(r044)); } catch (e: any) { refused = e.message; }
  ok(/asks the captain for values; name them in card.ask/.test(refused), "R-044's \"the captain provides these three\" card without a field is refused by the draft gate", refused);
  const def = drafts.preview(draft({ ...r044, confirm: { ...r044.confirm, ask: "用途、標題與視覺風格" } }));
  const confirm = def.nodes.find((n) => n.id === "confirm-brief")!, approve = def.nodes.find((n) => n.id === "approve-design")!;
  ok(confirm.card!.options![0].note === true && (confirm.card!.options![0] as any).noteLabel === "用途、標題與視覺風格" && approve.card!.options!.find((o) => o.id === "revise")!.note === true && approve.card!.options!.every((o: any) => o.labelZh),
    "with card.ask the confirm card opens a note box for the values; revise always opens one; every option has its zh-TW label", JSON.stringify([confirm.card, approve.card]));
  const check = def.nodes.find((n) => n.kind === "check");
  ok(!!check && check.checks?.[0]?.use === "core/artifact-ready" && def.edges.filter((e) => e.to === "final").every((e) => e.from === check.id) && ["make-a", "make-b"].every((m) => def.edges.some((e) => e.from === m && e.to === check.id)) && !validate(def).some((p) => p.level === "error"),
    "the drafted acceptance card gets a readiness check in front of it, and the graph validates", JSON.stringify([check, def.edges]));
  const noBody: any = draft({ ...r044, confirm: { ...r044.confirm, ask: "用途" } }); noBody.workflow.nodes[1].card = { title: "Approve?", options: [{ id: "approve", label: "Approve" }] }; let nb = ""; try { drafts.preview(noBody); } catch (e: any) { nb = e.message; }
  ok(/needs a body|body/.test(nb), "a drafted card without a body is refused", nb); }

// a rejection at the acceptance card ends the run closed, even when its end hook names no result (R-047)
{ const H = await harness([Y({ id: "accept-close", name: "accept close", version: 1, roles: [], nodes: [{ id: "seed", kind: "hook", label: "Seed", do: "seed", x: 0, y: 0 },
    { id: "ready", kind: "check", label: "Readiness", checks: [{ use: "core/artifact-ready", proves: [0] }], args: { producer: "all" }, x: 1, y: 0 },
    { id: "accept", kind: "card", label: "Accept", args: { mode: "deliver-accept", card_kind: "acceptance" }, x: 2, y: 0 }, { id: "done", kind: "hook", label: "Done", x: 3, y: 0 }, { id: "closed", kind: "hook", label: "Closed", x: 3, y: 1 }],
    edges: [["seed", "ready"], ["ready", "accept", "pass"], ["ready", "accept", "fail"], ["accept", "done", "approved"], ["accept", "ready", "changes"], ["accept", "closed", "rejected"]] })], { checkRoots: [join(root, "packs/core/checks")] });
  const store = new ArtifactStore(H.data); installDeliver(H.engine, { dataDir: H.data, artifacts: store, lane: null, fileorg: null, docs: null });
  H.engine.actions.seed = (x: any) => { const dir = join(H.data, "seed"); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, "doc.md"), "# Memo\n\nA memo with real content for the captain.\n");
    const id = "out-memo"; if (!store.get(id)) store.create({ id, title: "Memo", type: "doc", source: "md", entry: "doc.md" });
    const v = store.addVersion(id, { from: dir, primary: "doc.md", createdBy: { kind: "agent", provider: "stub", model: "x", run: x.run.id } as any, source: { run: x.run.id } as any });
    (x.ctx.deliver ??= {}).draft = { id, n: v.n, sha256: v.sha256, format: "document", producer: "draft" }; x.ctx.head = v.sha256; x.ctx.spec = { done: ["Every delivered source passes its deterministic readiness check", "The content matches the captain's intent"] }; return "ok"; };
  const r = H.engine.start({ workflow: "accept-close", text: "a memo" }); await until(() => H.engine.cards.list({ run: r.id, open: true }).length === 1 && !H.engine.busy(r.id));
  const c = H.engine.cards.list({ run: r.id, open: true })[0];
  ok(!!c && !/Proved by checks:\nNone/.test(c.body) && /Proved by checks:\n✓ Every delivered source/.test(c.body) && /core\/artifact-ready ran/.test(c.sections.en.why), "the acceptance card names the readiness check that ran and what it proved", JSON.stringify([c?.body, c?.sections.en.why]));
  ok(c.ste?.verdict === "pass", "an English captain intent is displayed as original text and does not masquerade as a zh-TW translation", JSON.stringify(c.ste));
  ok(c.sections.en.intent === "a memo" && c.sections["zh-TW"].intent.includes("a memo") && /原文/.test(c.sections["zh-TW"].intent), "the original intent remains intact and is labeled as original text in the Chinese card");
  await H.engine.answer(c.id, { choice: "reject", by: "captain" }); await until(() => H.engine.get(r.id)!.status === "succeeded");
  ok(H.engine.get(r.id)!.result === "closed", "a rejected acceptance ends the run closed, not done, although the end hook names no result", String(H.engine.get(r.id)!.result));
  H.stop(); }

end();
