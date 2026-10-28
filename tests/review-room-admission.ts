import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir, assertTempRepo } from "./lib/git-hygiene.mjs"; // repositories only in checked temp folders
// The review room's tutor is admitted like any role of a staffed Task (docs/units/review-room.md, "The tutor"): on a
// code workflow with approved staffing, a turn selects the reviewer's approved member through the native selection on the
// merge card's live node, carries a staffing receipt for the tutor seat (the reviewer role, the tutor's own pinned
// instructions), and runs as one of the Task's jobs through the same provider admission (receipt, owner, instructions
// hash). A seat staffing does not know, or instructions that differ from its pins, are refused before anything is paid.
// Stub providers and temporary data only.        bun tests/review-room-admission.ts
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("review-room-admission");
const { installStaffingGuard, StaffingStore, staffingHash } = await import("../src/domain/staffing");
const { installReviewRoom, TUTOR_SEAT, ROOM_SKILLS } = await import("../src/domain/review-room");
const { createNativeProviderAdmission } = await import("../src/providers/native-admission");
const { jobInstructions } = await import("../src/operating-rules");

const flow = { id: "code-firstmate", name: "Tutor admission", kind: "code", version: 1,
  roles: [{ id: "worker", label: "Worker", skill: "pack:firstmate/skills/worker.md" }, { id: "reviewer", label: "Reviewer", skill: "pack:firstmate/skills/reviewer.md" }, { id: "designer", label: "Designer", skill: "pack:firstmate/skills/designer.md" }],
  nodes: [{ id: "prep", kind: "hook", do: "prep", label: "Prepare", x: 1, y: 1 }, { id: "merge-card", kind: "card", label: "Merge", args: { card_kind: "merge" }, card: { title: { en: "Merge the change to a.txt", "zh-TW": "合併 a.txt 的改動" }, body: { en: "The change adds one line to a.txt; merging lands it on main.", "zh-TW": "這個改動在 a.txt 加了一行；合併後會進 main。" }, options: [{ id: "merge", label: "Merge", labelZh: "合併", primary: true }, { id: "close", label: "Close", labelZh: "關閉", hold: true }] }, x: 2, y: 1 },
    { id: "build", kind: "agent", mode: "build", role: "worker", label: "Build", x: 3, y: 1 }, { id: "review", kind: "agent", mode: "review", role: "reviewer", label: "Review", x: 4, y: 1 }, { id: "done", kind: "hook", label: "Done", x: 5, y: 1 }],
  edges: [{ from: "prep", to: "merge-card" }, { from: "merge-card", to: "build", when: "changes" }, { from: "build", to: "review" }, { from: "review", to: "merge-card", when: "pass" }, { from: "merge-card", to: "done", when: "merge" }] };
const h = await harness([Y(flow)]), e = h.engine, store = new StaffingStore(h.data), project = { namespace: "git" as const, id: "p", identity: "tutor-admission-fixture" };
const repo = checkedTempDir("tutor-admission-"); assertTempRepo(repo);
const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...a], { cwd: repo, stdio: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } }).toString().trim();
try {
  git("init", "-q", "-b", "main"); writeFileSync(join(repo, "a.txt"), "one\n"); git("add", "a.txt"); git("commit", "-q", "-m", "base"); const base = git("rev-parse", "HEAD");
  writeFileSync(join(repo, "a.txt"), "one\ntwo\n"); git("commit", "-q", "-am", "head"); const head = git("rev-parse", "HEAD");
  installStaffingGuard(e, store, () => project);
  const def = e.defs.get(flow.id)!, skill = (ref: string) => store.remember({ ref, version: 1, text: e.deps.skillText(ref) });
  const config = store.approve({ schema: 1, algorithm: "sha256-canonical-v1", project, workflow: { id: def.id, version: def.version, sha256: staffingHash(def) },
    roles: { worker: { provider: "codex", model: "worker-model", effort: "low", skill: skill(flow.roles[0].skill) }, reviewer: { provider: "codex", model: "reviewer-model", effort: "high", skill: skill(flow.roles[1].skill) }, designer: { provider: "codex", model: "designer-model", effort: "medium", skill: skill(flow.roles[2].skill) } },
    review: { freshContexts: 3, distinctProviders: false } } as any, null, { run: "R-source", card: "SC-source", answerSeq: 1 });
  e.actions.prep = async (x: any) => { Object.assign(x.ctx, { worktree: repo, repo, baseCommit: base, head }); x.save(); return "ok"; };
  // the server's native admission, with a certified stub selection: an uncertified provider is never picked silently
  const selects: any[] = [], systems: string[] = [], certified = new WeakMap<object, any>();
  e.deps.selectProvider = async (x: any, p: any, c: any) => { selects.push({ node: x.node.id, role: c?.role, pick: p });
    const prov: any = { id: p.provider, model: p.model, reasoningEffort: p.effort ?? null, sandboxFree: true, start(system: string) { systems.push(system);
      return { interrupt() {}, async *send() { yield { type: "delta", text: "The change adds a line [diff:a.txt]." }; yield { type: "turnEnd", status: "ok", usage: { usd: 0.01, inTokens: 1, outTokens: 1 } }; } }; } };
    certified.set(prov, { input: {}, expires: Date.now() + 30000, x }); return prov; };
  h.agents.providerAdmission = createNativeProviderAdmission({ certified, engine: () => e, select: async () => { throw new Error("unexpected refresh"); }, pick: async () => { throw new Error("unexpected uncertified provider"); } });
  const room = installReviewRoom(e, { dataDir: h.data, web: { search: async () => ({ configured: false }), fetch: async () => { throw new Error("no web in this test"); } } });
  const run = e.start({ workflow: flow.id, params: { project: "p", _staffing: config.hash } });
  await until(() => e.cards.list({ run: run.id, open: true }).some((c) => c.kind === "merge"), 20000);
  const card = e.cards.list({ run: run.id, open: true }).find((c) => c.kind === "merge")!;
  const offer: any = room.view(card.id).offer;
  ok(offer.provider === "codex" && offer.model === "reviewer-model" && offer.effort === "high", "the tutor is offered on the reviewer's approved member", JSON.stringify(offer));

  // a seat staffing does not know, or pins that differ from the room's texts: refused before any provider starts
  const seats = e.deps.auxiliarySeats; e.deps.auxiliarySeats = {};
  let refusal: any = null; try { await room.start(card.id, { action: "how", confirm: offer.hash }, "captain"); } catch (x) { refusal = x; }
  ok(refusal?.code === "staffing" && !systems.length, "without the tutor seat registered, staffing refuses the receipt and nothing is paid", refusal?.message);
  e.deps.auxiliarySeats = { [TUTOR_SEAT]: { role: "reviewer", pins: ROOM_SKILLS.map(() => "0".repeat(64)) } };
  refusal = null; try { await room.start(card.id, { action: "how", confirm: offer.hash }, "captain"); } catch (x) { refusal = x; }
  ok(refusal?.code === "staffing" && /pinned skills/.test(refusal.message) && !systems.length, "instructions that differ from the seat's pins are refused", refusal?.message);
  e.deps.auxiliarySeats = { [TUTOR_SEAT]: { role: "worker", pins: ROOM_SKILLS.map((k) => k.sha256) } };
  refusal = null; try { await room.start(card.id, { action: "how", confirm: offer.hash }, "captain"); } catch (x) { refusal = x; }
  ok(refusal?.code === "staffing" && !systems.length, "a seat bound to another role is refused");
  e.deps.auxiliarySeats = seats;

  // the admitted turn
  const before = e.ledger(run.id).filter((x) => x.record === "staffing-instructions").length;
  await room.start(card.id, { action: "how", confirm: offer.hash }, "captain"); await room.settle(card.id);
  const t: any = (room.view(card.id) as any).turns.at(-1);
  ok(t.status === "done" && /adds a line/.test(t.answer), "the admitted turn runs and answers", JSON.stringify(t).slice(0, 300));
  ok(selects.length === 4 && selects.every((x) => x.node === "merge-card" && x.role === "reviewer" && x.pick.model === "reviewer-model"), "the provider is chosen through the native selection on the merge card's node, as the reviewer", JSON.stringify(selects));
  const rec: any = e.ledger(run.id).filter((x) => x.record === "staffing-instructions").slice(before);
  ok(rec.length === 1 && rec[0].node === "merge-card" && rec[0].data.role === "reviewer" && rec[0].data.seat === TUTOR_SEAT && rec[0].data.model === "reviewer-model" && rec[0].data.effort === "high" && rec[0].data.config === config.hash
    && rec[0].data.instructionsSha256 === createHash("sha256").update(systems[0]).digest("hex") && rec[0].data.skill === createHash("sha256").update(ROOM_SKILLS.map((k) => k.sha256).join("\n")).digest("hex"),
    "staffing records the tutor seat's receipt: the reviewer's approved member, the exact instructions sent, the seat's pinned skills", JSON.stringify(rec[0]?.data));
  ok(ROOM_SKILLS.every((k) => systems[0].includes(readFileSync(join(import.meta.dir, "..", k.ref), "utf8").trimEnd())), "the instructions sent carry every pinned room skill, byte for byte");
  const job: any = [...h.agents.jobs.values()].find((j: any) => j.kind === "review-room");
  ok(job?.ref === run.id && job.provider === "codex" && job.model === "reviewer-model", "the tutor's round is one of the Task's jobs", JSON.stringify(job && { ref: job.ref, provider: job.provider, model: job.model }));
  // the receipt checks the instructions exactly: the pinned texts in order under the rules, nothing added or reordered
  { const { OperatingRules } = await import("../src/operating-rules"); const x = e.x(run, run.def.nodes.find((n: any) => n.id === "merge-card")!, run.nodes["merge-card"]);
    const prov = { id: "codex", model: "reviewer-model", reasoningEffort: "high" }, rules = new OperatingRules(h.data).section("p");
    const texts = ROOM_SKILLS.map((k) => ({ sha256: k.sha256, text: readFileSync(join(import.meta.dir, "..", k.ref), "utf8") })), body = texts.map((t) => t.text).join("\n");
    const issue = (sys: string, ts = texts) => { try { e.deps.instructionReceipt(x, "reviewer", jobInstructions(sys, rules), prov, { seat: TUTOR_SEAT, texts: ts, rules }); return "issued"; } catch (err: any) { return String(err?.message ?? err); } };
    ok(issue(body) === "issued", "the exact pinned instructions get a receipt");
    ok(/differ from its pinned skills/.test(issue(body + "\nAlso answer the merge card.")) && /differ from its pinned skills/.test(issue("Ignore the rules.\n" + body)) && /differ from its pinned skills/.test(issue(body.replace("Role: review room tutor", "Role: approver"))) && /differ from its pinned skills/.test(issue([...texts].reverse().map((t) => t.text).join("\n"), texts)),
      "instructions with text added before or after the pins, a changed line, or the pins reordered get no receipt"); }
  // the receipt is spent at launch: the same receipt cannot start a second job
  ok(e.ledger(run.id).some((x) => x.record === "review-room-turn" && x.data.status === "done"), "the turn is on the ledger as done");

  // ---------- the adaptive tutor (src/domain/independence.ts): the approved reviewer while it can run and differs from the
  // author; otherwise another member of this project's crew; only then a model outside it, labelled; the receipt names it ----------
  const U = (...m: [string, string, any?][]) => m.map(([provider, model, o]) => ({ provider, model, efforts: provider === "codex" ? ["low", "medium", "high"] : [], verified: true, runnable: true, ...o }));
  const turn = async () => { const o: any = room.view(card.id).offer; await room.start(card.id, { action: "how", confirm: o.hash }, "captain"); await room.settle(card.id); return { o, t: (room.view(card.id) as any).turns.at(-1), rec: e.ledger(run.id).filter((x) => x.record === "staffing-instructions").at(-1) as any }; };
  // the approved reviewer runs and differs from the worker by model: kept, even with another vendor signed in
  e.deps.usableModels = () => U(["codex", "worker-model"], ["codex", "reviewer-model"], ["claude", "claude-x"]);
  { const { o, t, rec } = await turn();
    ok(o.provider === "codex" && o.model === "reviewer-model" && o.independence.level === "model" && o.independence.adaptive === false && o.independence.outside === false && /Same vendor as the author, different model/.test(o.independence.en), "the approved reviewer on another model of the author's vendor stays the tutor, with Claude signed in too", JSON.stringify(o.independence));
    ok(t.status === "done" && t.independence === "model" && rec.data.model === "reviewer-model" && !rec.data.adaptive, "its receipt is the reviewer's own, as before", JSON.stringify(rec?.data)); }
  // the approved reviewer cannot run: another member of this project's crew first (the designer), before any vendor outside it
  e.deps.usableModels = () => U(["codex", "worker-model"], ["codex", "designer-model"], ["claude", "claude-x"]);
  { const { o, t, rec } = await turn();
    ok(o.provider === "codex" && o.model === "designer-model" && o.effort === "medium" && o.independence.level === "model" && o.independence.adaptive === true && o.independence.outside === false && !/Not in this project's crew/.test(o.independence.en), "with the reviewer unable to run, a member already in the crew is preferred to a model outside it", JSON.stringify(o));
    ok(t.status === "done" && rec.data.model === "designer-model" && rec.data.adaptive?.crew === true && rec.data.adaptive.approved?.model === "reviewer-model", "the receipt names the crew member used, and the approved one it stands in for", JSON.stringify(rec?.data)); }
  // nothing in the crew differs from the author: a model outside it, labelled, recorded; a verified Claude before an unverified one
  e.deps.usableModels = () => U(["codex", "worker-model"], ["claude", "claude-new", { verified: false }], ["claude", "claude-x"]);
  { const { o, t, rec } = await turn();
    ok(o.provider === "claude" && o.model === "claude-x" && o.effort === null && o.independence.level === "vendor" && o.independence.outside === true && /Not in this project's crew/.test(o.independence.en), "otherwise a verified model outside the crew, never an unverified Claude candidate beside a verified one, labelled", JSON.stringify(o));
    ok(t.status === "done" && t.provider === "claude" && t.independence === "vendor" && selects.at(-1)?.pick.provider === "claude", "the turn runs on that member through the native selection", JSON.stringify({ t: { status: t.status, provider: t.provider, error: t.error }, sel: selects.at(-1) }));
    ok(rec.data.seat === TUTOR_SEAT && rec.data.provider === "claude" && rec.data.model === "claude-x" && rec.data.effort === null && rec.data.adaptive?.independence === "vendor" && rec.data.adaptive.crew === false && rec.data.adaptive.approved?.model === "reviewer-model" && rec.data.config === config.hash,
      "the tutor seat's receipt names the member actually used, that it is outside the crew, and the approved member it stands in for", JSON.stringify(rec?.data));
    const job: any = [...h.agents.jobs.values()].filter((j: any) => j.kind === "review-room").at(-1);
    ok(job?.provider === "claude" && job.model === "claude-x", "the job admitted is that member's", JSON.stringify(job && { provider: job.provider, model: job.model })); }
  // a model whose verification is in its backoff is skipped: the next one is tried
  e.deps.usableModels = () => U(["codex", "worker-model"], ["claude", "claude-x"], ["claude", "claude-y"]); e.deps.verifyBackoff = (p: any) => p?.model === "claude-x";
  { const o: any = room.view(card.id).offer; ok(o.provider === "claude" && o.model === "claude-y", "a model in its verification backoff is skipped for the next one", JSON.stringify(o)); delete e.deps.verifyBackoff; }
  // another vendor signed in but held (quota unreadable): the tutor waits, it never falls back to the author's model
  e.deps.usableModels = () => U(["codex", "worker-model"], ["claude", "claude-x", { runnable: false, held: "claude is out of quota" }]);
  { const o: any = room.view(card.id).offer; ok(o.code === "no_tutor" && /The tutor waits: claude is out of quota/.test(o.error ?? ""), "a held vendor relaxes nothing: the tutor waits with the reason", JSON.stringify(o)); }
  // one model on this machine: the tutor runs on the author's own model, never refused, said plainly
  e.deps.usableModels = () => U(["codex", "worker-model"]);
  { const { o, t, rec } = await turn();
    ok(o.provider === "codex" && o.model === "worker-model" && o.independence.level === "same" && /Same model as the author/.test(o.independence.en) && /Only one model is usable/.test(o.independence.en), "one model on this machine: the tutor runs on the author's own model, labelled", JSON.stringify(o));
    ok(t.status === "done" && t.independence === "same" && rec.data.model === "worker-model" && rec.data.adaptive?.independence === "same", "and the receipt says so", JSON.stringify(rec?.data)); }
  // a member that is not usable, or a seat that is not adaptive, gets no receipt
  { const x = e.x(run, run.def.nodes.find((n: any) => n.id === "merge-card")!, run.nodes["merge-card"]), { OperatingRules } = await import("../src/operating-rules"), rules = new OperatingRules(h.data).section("p");
    const texts = ROOM_SKILLS.map((k) => ({ sha256: k.sha256, text: readFileSync(join(import.meta.dir, "..", k.ref), "utf8") })), sys = jobInstructions(texts.map((t) => t.text).join("\n"), rules);
    const issue = (member: any) => { try { e.deps.instructionReceipt(x, "reviewer", sys, { id: member.provider, model: member.model, reasoningEffort: member.effort }, { seat: TUTOR_SEAT, texts, rules, member }); return "issued"; } catch (err: any) { return String(err?.message ?? err); } };
    ok(/not usable/.test(issue({ provider: "cursor", model: "composer", effort: null, independence: "vendor" })), "a member this machine cannot run gets no receipt");
    e.deps.usableModels = () => U(["codex", "worker-model", { runnable: false, held: "codex's facts expired" }]);
    ok(/not usable/.test(issue({ provider: "codex", model: "worker-model", effort: null, independence: "same" })), "nor one that is held right now");
    e.deps.usableModels = () => U(["codex", "worker-model"]);
    const seats = e.deps.auxiliarySeats; e.deps.auxiliarySeats = { [TUTOR_SEAT]: { ...seats[TUTOR_SEAT], adaptive: false } };
    ok(/approved member/.test(issue({ provider: "codex", model: "worker-model", effort: null, independence: "same" })), "a seat that is not adaptive runs only on its role's approved member"); e.deps.auxiliarySeats = seats;
    delete e.deps.usableModels;
    ok(/not usable/.test(issue({ provider: "codex", model: "worker-model", effort: null, independence: "same" })) && issue({ provider: "codex", model: "reviewer-model", effort: "high", independence: "model" }) === "issued", "without provider facts only the approved member is admitted"); }
  // Studio verifies the chosen member before the paid turn: what it verified is on the Task's ledger; one it cannot admit is refused
  { e.deps.usableModels = () => U(["codex", "worker-model"], ["claude", "claude-x"]); const before = e.ledger(run.id).filter((x) => x.record === "staffing-auto-verify").length;
    e.deps.ensurePick = async (p: any) => ({ state: "ready", verified: [`tutor: ${p.provider} ${p.model}`] });
    await turn(); const rec: any = e.ledger(run.id).filter((x) => x.record === "staffing-auto-verify").slice(before);
    ok(rec.length === 1 && rec[0].data.verified.join() === "tutor: claude claude-x" && /review room/.test(rec[0].data.for), "the tutor's verification by Studio is recorded on the Task's ledger", JSON.stringify(rec[0]?.data));
    const runs = h.agents.jobs.size, checked: any[] = [];
    e.deps.ensurePick = async (p: any) => { checked.push(p); throw new Error("The tutor role's claude is out of quota. / 額度已用完"); };
    const o: any = room.view(card.id).offer; let refusal: any = null; try { await room.start(card.id, { action: "how", confirm: o.hash }, "captain"); } catch (x) { refusal = x; }
    ok(refusal?.code === "no_tutor" && /out of quota/.test(refusal.message) && checked[0]?.provider === "claude" && checked[0].model === "claude-x" && h.agents.jobs.size === runs, "the chosen member is verified first; one that cannot run is refused with the reason and nothing is paid", refusal?.message);
    delete e.deps.ensurePick; delete e.deps.usableModels; }
} finally { for (const r of e.list()) if (!["succeeded", "failed", "cancelled"].includes(r.status)) await e.cancel(r.id, "cleanup"); h.stop(); rmSync(repo, { recursive: true, force: true }); }
end();
