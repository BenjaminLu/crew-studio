// The readiness gate between a drafted workflow and Run (src/readiness), on the real runtime
// over throwaway data: intent lines, the static contract, rendered briefs, the stub dry run, the
// stub-tested real smoke stage, hash-bound results, the repair loop with a stub Firstmate, the
// anti-weakening refusals, and a regression corpus of every historical failure class.
// No model is called and nothing reaches the network or the live Studio.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createRuntime } from "../src/runtime";
import { normalize, type WDef } from "../src/runtime/defs";
import { contractStage, briefStage, intentStage } from "../src/readiness/stages";
import { dryRun } from "../src/readiness/dryrun";
import { sampleOf, weakening } from "../src/readiness/service";
import { draftDef } from "../src/readiness";
import { gateHarness, until } from "./gate-harness";

let pass = 0, fail = 0;
const ok = (v: any, name: string, detail = "") => { console.log(`${v ? "  ok   " : "  FAIL "} ${name}${v ? "" : " " + detail}`); v ? pass++ : fail++; };
const FX = JSON.parse(readFileSync(join(import.meta.dir, "fixture/first-workflow-draft.json"), "utf8"));
const fx = () => JSON.parse(JSON.stringify(FX));
const settled = async (h: any, id: string) => { await until(async () => { const v = (await h.api(`/api/wf/drafts/${id}/gate`)).body; return !!v.gate && v.gate.stages.every((s: any) => s.status !== "running"); }, 30000); await h.rt.readiness.schedule(id); return (await h.api(`/api/wf/drafts/${id}/gate`)).body; };
const stage = (v: any, id: string) => v.gate?.stages.find((s: any) => s.id === id);
const codes = (v: any, id: string) => (stage(v, id)?.problems ?? []).map((p: any) => p.code);

try {
  // ---------------- 1 intent lines ----------------
  {
    const h = gateHarness();
    const d = await h.tool("studio_draft_workflow", fx());
    const v = await settled(h, d.draft);
    ok(stage(v, "intent")?.status === "pass" && v.intents.length === 2 && v.intents[0].nodes.map((n: any) => n.id).join() === "topics,draft", "1 draft carries numbered intent lines and the preview maps each line to its nodes", JSON.stringify(v.intents));
    ok(v.intents.every((l: any) => l.done), "1 every intent line has a done-means line");
    const noIntent = fx(); delete noIntent.workflow.intents; for (const n of noIntent.workflow.nodes) delete n.serves;
    const d2 = await h.tool("studio_draft_workflow", noIntent); await settled(h, d2.draft);
    const s2 = await h.api(`/api/wf/drafts/${d2.draft}/save`, { revision: 1 });
    ok(s2.status === 400 && /Cannot save yet/.test(s2.body.error) && /還不能儲存/.test(s2.body.error), "1 save is refused with a clear en / zh-TW message when the draft has no intent lines", JSON.stringify(s2.body).slice(0, 200));
    const orphan = fx(); orphan.workflow.nodes.find((n: any) => n.id === "review").serves = []; orphan.workflow.nodes.find((n: any) => n.id === "approve").serves = [1];
    const d3 = await h.tool("studio_draft_workflow", orphan); await settled(h, d3.draft);
    const s3 = await h.api(`/api/wf/drafts/${d3.draft}/save`, { revision: 1 });
    ok(s3.status === 400 && /serves no intent line/.test(s3.body.error) && /served by no node/.test(s3.body.error) && s3.body.problems?.some((p: any) => p.node === "review"), "1 save is refused when a node serves no line and when a line is served by no node", JSON.stringify(s3.body).slice(0, 300));
    const saved = await h.api(`/api/wf/drafts/${d.draft}/save`, { revision: v.revision });
    ok(saved.status === 200 && saved.body.created, "1 a draft whose lines are all served saves", JSON.stringify(saved.body));
    const wf = (await h.api(`/api/wf/${saved.body.workflow}`)).body.def;
    ok(wf.intents?.length === 2 && wf.nodes.find((n: any) => n.id === "draft").serves[0] === 1, "1 the saved workflow keeps intent lines and each node's serves");
    const ed = await h.api(`/api/wf/${wf.id}`, { base: wf.version, nodes: wf.nodes.map((n: any) => n.id === "review" ? { ...n, serves: [] } : n), edges: wf.edges, roles: wf.roles });
    ok(ed.status === 400 && /還不能儲存/.test(ed.body.error), "1 an editor save that leaves a node serving no line is refused too", JSON.stringify(ed.body).slice(0, 200));
    // the run's acceptance card ticks the drafted workflow's own intent lines
    const acc = fx(); acc.workflow.nodes.splice(3, 1, { id: "approve", serves: [2], kind: "card", label: "Accept", accept: true });
    acc.workflow.edges = [{ from: "topics", to: "draft", when: "continue" }, { from: "draft", to: "review" }, { from: "review", to: "approve" }, { from: "approve", to: "done", when: "approved" }, { from: "approve", to: "draft", when: "changes" }, { from: "approve", to: "done", when: "rejected" }];
    for (const n of acc.workflow.nodes) if (n.kind === "agent") Object.assign(n, { provider: "codex", model: "fixture-model", effort: "low" });
    const da = await h.tool("studio_draft_workflow", acc); const va = await settled(h, da.draft);
    ok(va.passed, "1 a draft with an acceptance card passes stages 1-4", JSON.stringify(va.gate?.stages.map((s: any) => [s.id, s.status, s.problems.map((p: any) => p.reason.en)])));
    const sa = await h.api(`/api/wf/drafts/${da.draft}/save`, { revision: va.revision });
    const ask = await h.api("/api/wruns", { workflow: sa.body.workflow, text: "This week" });
    const go = await h.api("/api/wruns", { workflow: sa.body.workflow, text: "This week", staffingConfirm: ask.body.staffing?.hash });
    const topic = await until(() => h.rt.engine.cards.list({ run: go.body.id, open: true }).length > 0); const c1 = h.rt.engine.cards.list({ run: go.body.id, open: true })[0];
    if (topic) await h.api(`/api/scards/${c1.id}/answer`, { choice: "continue" });
    await until(() => h.rt.engine.cards.list({ run: go.body.id, open: true }).some((c: any) => c.node === "approve"));
    const card = h.rt.engine.cards.list({ run: go.body.id, open: true }).find((c: any) => c.node === "approve");
    ok(card?.detail?.intents?.length === 2 && card.detail.intents[0].en.startsWith("1. A weekly newsletter about local coffee events — done means:"), "1 the run's acceptance card ticks the drafted workflow's own intent lines", JSON.stringify(card?.detail?.intents));
    const half = await h.api(`/api/scards/${card?.id}/answer`, { choice: "approve-review", aligned: [0] });
    ok(half.status === 400 && /tick every intent line/.test(half.body.error), "1 the acceptance card refuses approval until every drafted intent line is ticked");
    h.rt.engine.cancel(go.body.id);
    h.rt.readiness.stop();
  }

  // ---------------- 2-4 stages on the fixture, hash binding ----------------
  {
    const h = gateHarness();
    const d = await h.tool("studio_draft_workflow", fx()); const v = await settled(h, d.draft);
    ok(["intent", "contract", "brief", "dryrun"].every((s) => stage(v, s)?.status === "pass"), "2-4 the fixture draft passes intent, contract, brief and dry run", JSON.stringify(v.gate?.stages.map((s: any) => [s.id, s.status])));
    ok(stage(v, "contract").problems.some((p: any) => p.code === "staffing-missing" && p.level === "notice" && p.owner === "captain" && p.node === "review"), "2 an unstaffed node is a captain notice (confirmed at Run), never a failure");
    const b = v.gate.briefs.find((x: any) => x.node === "draft");
    const writer = readFileSync(join(import.meta.dir, "../workflows/skills/v2/writer.md"), "utf8").trim();
    ok(b && b.system.startsWith("# Studio safety rules") && b.system.includes(writer.slice(0, 200)) && b.prompt.includes("A weekly newsletter about local coffee events") && b.prompt.includes("1. A weekly newsletter about local coffee events — done means:"), "3 the rendered brief carries the operating rules, role text, the Task input and the node's intent lines");
    ok(b.roundDir.includes("/work/deliver/R-GATE/draft-1-0"), "3 the brief's round folder is the round's own folder under data/work", b.roundDir);
    ok(v.gate.dry?.status === "succeeded" && v.gate.dry.steps.map((s: any) => s.node).join() === "topics,draft,review,approve,done", "4 the dry run walks the draft end to end on the real engine and board path", JSON.stringify(v.gate.dry));
    ok(h.seen.length === 0, "4 the dry run used its own throwaway stub, never the Studio provider");
    ok(h.rt.engine.list().length === 0, "4 the dry run left no Task in the live runtime");
    // hash binding: any revision invalidates the result; a saved version carries the same result only while identical
    const rev = fx(); rev.draft = d.draft; rev.workflow.nodes[1].label = "Draft it";
    await h.tool("studio_draft_workflow", rev);
    const stale = h.rt.readiness.gate.read(`draft-${d.draft}`, draftDef(h.rt.drafts.get(d.draft)));
    ok(!stale || stale.hash !== v.gate.hash, "6 an edit invalidates the stored result (hash-bound)");
    const v2 = await settled(h, d.draft);
    ok(v2.gate.hash !== v.gate.hash && v2.passed, "6 the gate re-runs on the new revision");
    const saved = await h.api(`/api/wf/drafts/${d.draft}/save`, { revision: v2.revision });
    const w1 = (await h.api(`/api/wf/${saved.body.workflow}/gate`)).body;
    ok(w1.gate?.hash === v2.gate.hash && w1.passed, "6 the saved workflow v1 shows the draft's result (same hash)");
    const def = (await h.api(`/api/wf/${saved.body.workflow}`)).body.def;
    await h.api(`/api/wf/${def.id}`, { base: 1, nodes: def.nodes.map((n: any) => n.id === "review" ? { ...n, label: "Review it" } : n), edges: def.edges, roles: def.roles });
    const w2now = (await h.api(`/api/wf/${def.id}/gate?v=2`)).body;
    ok(!w2now.gate || w2now.gate.hash !== w1.gate.hash, "6 an editor save makes a new version whose gate starts over");
    await until(async () => (await h.api(`/api/wf/${def.id}/gate?v=2`)).body.passed);
    const w2 = (await h.api(`/api/wf/${def.id}/gate?v=2`)).body; const w1again = (await h.api(`/api/wf/${def.id}/gate?v=1`)).body;
    ok(w2.passed && w1again.gate?.hash === w1.gate.hash, "6 each version keeps its own result");
    ok(/Not verified yet/.test(w2.status.text.en) && /尚未驗證/.test(w2.status.text.zh), "5 until verified the version says Not verified yet");
    const fm = await h.tool("studio_workflow_gate", { workflow: def.id, version: 2 });
    ok(fm?.gate?.stages?.length === 5 && fm.status?.text?.en, "6 Firstmate reads the gate result through its tool", JSON.stringify(fm).slice(0, 200));
    h.rt.readiness.stop();
  }

  // ---------------- 7 regression corpus: each historical failure class caught at its stage ----------------
  {
    const h = gateHarness({ login: { codex: "not-logged-in", claude: "not-logged-in" } });
    const E = h.rt.engine; const env = (def: WDef) => h.rt.readiness.gate.static(def, sampleOf(def));
    const base = (): WDef => normalize({ ...draftDef({ ...h.rt.drafts.get((await0 as any).draft) }), id: "corpus" });
    const await0 = await h.tool("studio_draft_workflow", fx());
    const at = (def: WDef, s: string) => env(def).stages.find((x: any) => x.id === s)!;
    // round cwd under data/runs (R-029): a mode whose round opens in Studio's runs folder
    E.modes["r029"] = { ...E.modes.deliver, sandbox: () => ({ writes: [join(h.data, "runs", "R-029")], cwd: join(h.data, "runs", "R-029") }) };
    const r029 = base(); r029.nodes.find((n) => n.id === "draft")!.mode = "r029";
    ok(at(r029, "intent").status === "pass" && at(r029, "contract").problems.some((p: any) => p.code === "sandbox-path" && p.node === "draft" && /runs\/R-029/.test(p.reason.en)), "7 round cwd under data/runs is caught at stage 2 (contract)");
    // and the dry run catches the same refusal on the real agent path check
    const dry = await dryRun(r029, { sample: sampleOf(r029), protectedRoots: [], createRuntime: (deps: any) => { const rt = createRuntime(deps); rt.engine.modes["r029"] = { ...rt.engine.modes.deliver, sandbox: () => ({ writes: [join(deps.dataDir, "runs", "R-029")], cwd: join(deps.dataDir, "runs", "R-029") }) }; return rt; } });
    ok(dry.status === "fail" && dry.problems.some((p) => p.code === "dryrun-refused" && /a round may not reach .*runs\/R-029/.test(p.reason.en)), "7 the same round is refused in the stub dry run with the exact path error (stage 4)", JSON.stringify(dry.problems));
    // missing param (file-organization started without folder)
    const fo = normalize({ ...h.rt.defs.get("file-organization")!, origin: undefined }); const foNoParam = normalize({ ...fo, params: undefined });
    ok(at(foNoParam, "contract").problems.some((p: any) => p.code === "param-undeclared" && p.node === "plan" && /folder/.test(p.reason.en)), "7 an action reading an undeclared Start input is caught at stage 2");
    ok(at(fo, "contract").problems.some((p: any) => p.code === "param-no-input" && /folder/.test(p.reason.en)), "7 a required Start input with no value is caught at stage 2");
    ok(!at(normalize({ ...fo, sample: { params: { folder: "/tmp/x" } } } as any), "contract").problems.some((p: any) => p.code === "param-no-input"), "7 a sample value satisfies the Start input");
    // unknown skill and hash mismatch
    const sk = base(); sk.roles[0].skill = "bundled:workflows/skills/v2/nope.md";
    ok(at(sk, "contract").problems.some((p: any) => p.code === "skill-unknown" && p.node === "draft"), "7 an unknown role skill is caught at stage 2");
    h.rt.defs.skillInfo = (id: string, v: number) => id === "house-style" && v === 1 ? { sha256: "a".repeat(64), bytes: 10 } : null;
    const hm = base(); (hm.nodes.find((n) => n.id === "draft") as any).skills = [{ id: "house-style", v: 1, sha256: "b".repeat(64) }];
    ok(at(hm, "contract").problems.some((p: any) => p.code === "skill-hash"), "7 a skill pin whose hash does not match the library is caught at stage 2");
    h.rt.defs.skillInfo = null;
    // not-logged-in provider: a captain-only sign-in, never something Firstmate does
    const nl = at(base(), "contract").problems.find((p: any) => p.code === "provider-not-logged-in");
    ok(nl && nl.owner === "captain" && nl.need === "sign-in" && /never starts a sign-in/.test(nl.fix.en), "7 a not-logged-in provider is caught at stage 2 as a captain-only sign-in");
    h.login.claude = "logged-in";
    const nl2 = at(base(), "contract").problems.find((p: any) => p.code === "provider-not-logged-in");
    ok(nl2 && nl2.owner === "firstmate" && /Switch .* to claude/.test(nl2.fix.en), "7 with another provider logged in, the gate works around it (Firstmate may switch the node)");
    h.login.codex = "logged-in";
    // network not allowed
    const nw = base(); nw.nodes.push({ id: "fetch", kind: "hook", label: "Fetch prices", do: "note", args: { network: ["api.example.com"] }, x: 0, y: 0, serves: [1] } as any); nw.edges = nw.edges.map((e) => e.from === "draft" ? { ...e, from: "fetch" } : e); nw.edges.push({ from: "draft", to: "fetch" });
    const nwp = at(nw, "contract").problems.find((p: any) => p.code === "network-not-allowed");
    ok(nwp && nwp.owner === "captain" && nwp.need === "egress", "7 a node needing a host the egress policy does not allow is caught at stage 2 (captain grant)");
    const nu = base(); nu.nodes.find((n) => n.id === "topics")!.args = { network: true };
    ok(at(nu, "contract").problems.some((p: any) => p.code === "network-undeclared"), "7 a node needing network without declaring hosts is caught at stage 2");
    // unhandled outcome
    const uo = base(); uo.nodes.find((n) => n.id === "approve")!.card!.options!.push({ id: "skip", label: "Skip" });
    ok(at(uo, "contract").problems.some((p: any) => p.code === "outcome-unhandled" && p.node === "approve" && /"skip"/.test(p.reason.en)), "7 an outcome with no edge is caught at stage 2 and listed");
    const acc = base(); acc.nodes.find((n) => n.id === "approve")!.args = { mode: "deliver-accept", card_kind: "acceptance" }; delete (acc.nodes.find((n) => n.id === "approve") as any).card; acc.edges = acc.edges.filter((e) => e.from !== "approve").concat([{ from: "approve", to: "done", when: "approved" }]);
    const accp = at(acc, "contract").problems.find((p: any) => p.code === "outcome-unhandled");
    ok(accp && /"changes"/.test(accp.reason.en) && /"rejected"/.test(accp.reason.en), "7 an acceptance card's unhandled outcomes are all listed");
    // external effect without a one-way card
    E.actions["remote.push"] = () => "ok";
    const ex = base(); ex.nodes.push({ id: "push", kind: "hook", label: "Push", do: "remote.push", x: 0, y: 0, serves: [1] } as any); ex.edges = ex.edges.filter((e) => !(e.from === "approve" && e.to === "done")).concat([{ from: "approve", to: "push", when: "publish" }, { from: "push", to: "done" }]);
    ok(at(ex, "contract").problems.some((p: any) => p.code === "external-unguarded" && p.node === "push"), "7 an external effect without a one-way captain card before it is caught at stage 2");
    const exg = JSON.parse(JSON.stringify(ex)); exg.nodes.find((n: any) => n.id === "approve").args = { card_kind: "merge" };
    ok(!at(exg, "contract").problems.some((p: any) => p.code === "external-unguarded"), "7 the same effect behind a one-way card passes");
    // empty brief
    E.modes["blank"] = { ...E.modes.deliver, system: () => "", prompt: () => "" };
    const eb = base(); eb.nodes.find((n) => n.id === "review")!.mode = "blank";
    const ebs = env(eb); const ebb = ebs.stages.find((x: any) => x.id === "brief")!;
    ok(ebs.stages[0].status === "pass" && ebb.status === "fail" && ebb.problems.some((p: any) => p.code === "brief-empty" && p.node === "review") && ebb.problems.some((p: any) => p.code === "brief-no-input"), "7 an empty brief is caught at stage 3");
    const pb = base(); E.modes["pathy"] = { ...E.modes.deliver, prompt: () => "DELIVER document\nRead /etc/passwd and data/runs/R-1/events.jsonl\nIntent: A weekly newsletter about local coffee events" };
    pb.nodes.find((n) => n.id === "review")!.mode = "pathy";
    ok(env(pb).stages.find((x: any) => x.id === "brief")!.problems.some((p: any) => p.code === "brief-path" && /\/etc\/passwd/.test(p.reason.en)), "7 a brief that points outside the round folder is caught at stage 3");
    // the pure stages stay pure: no run was started by any of this
    ok(E.list().length === 0, "7 static stages and corpus checks start no Task");
    h.rt.readiness.stop();
  }

  // ---------------- repair loop ----------------
  {
    // a fixable problem (unhandled outcome + a missing Start input), repaired by a stub Firstmate within the cap
    const broken = fx(); broken.workflow.nodes.find((n: any) => n.id === "approve").card.options.push({ id: "skip", label: "Skip" }); broken.workflow.params = { city: { label: "City" } };
    let h: any; const prompts: string[] = [];
    h = gateHarness({ ask: (text) => { prompts.push(text); const m = /^GATE-REPAIR (d-[a-f0-9]{12}) ([a-f0-9]+)/.exec(text)!; setTimeout(async () => {
      const fixed = fx(); fixed.draft = m[1]; fixed.workflow.params = { city: { label: "City" } }; fixed.workflow.sample = { text: "This week's events", params: { city: "Taipei" } };
      fixed.workflow.nodes.find((n: any) => n.id === "approve").card.options.push({ id: "skip", label: "Skip" }); fixed.workflow.edges.push({ from: "approve", to: "done", when: "skip" });
      await h.tool("studio_draft_workflow", fixed, text, false); }, 5); return true; } });
    const d = await h.tool("studio_draft_workflow", broken);
    ok(await until(() => h.rt.readiness.gate.repair(d.draft).status === "passed", 30000), "loop a fixable draft is repaired by Firstmate and passes", JSON.stringify(h.rt.readiness.gate.repair(d.draft)).slice(0, 400));
    const rs = h.rt.readiness.gate.repair(d.draft);
    ok(rs.rounds.length === 1 && rs.rounds[0].problems.some((p: any) => p.code === "outcome-unhandled") && rs.rounds[0].problems.some((p: any) => p.code === "param-no-input"), "loop round 1 lists the typed problems it sent", JSON.stringify(rs.rounds.map((r: any) => r.problems.map((p: any) => p.code))));
    ok(rs.rounds[0].changes?.some((c: string) => /added edge approve→done\[skip\]/.test(c)), "loop each round records the changes Firstmate made", JSON.stringify(rs.rounds[0].changes));
    ok(/^GATE-REPAIR d-/.test(prompts[0]) && /node approve/.test(prompts[0]) && /Fix:/.test(prompts[0]) && /Do not ask the captain/.test(prompts[0]), "loop the repair turn carries stage, node, error and fix text, and tells Firstmate not to ask");
    ok(h.rt.engine.cards.list().length === 0, "loop the repair loop raises no captain card");
    h.rt.readiness.stop();
  }
  {
    // no progress: Firstmate resubmits the same broken graph; after two rounds it switches to redrafting, six rounds in all, then a plain notice
    const broken = fx(); broken.workflow.nodes.find((n: any) => n.id === "approve").card.options.push({ id: "skip", label: "Skip" });
    let h: any; const prompts: string[] = [];
    h = gateHarness({ ask: (text) => { prompts.push(text); const m = /^GATE-REPAIR (d-[a-f0-9]{12}) /.exec(text)!; setTimeout(() => { const same = JSON.parse(JSON.stringify(broken)); same.draft = m[1]; same.workflow.description = "attempt " + prompts.length; void h.tool("studio_draft_workflow", same, text, false); }, 5); return true; } });
    const d = await h.tool("studio_draft_workflow", broken);
    ok(await until(() => h.rt.readiness.gate.repair(d.draft).status === "not-verified", 40000), "loop a no-progress draft ends Not verified", JSON.stringify(h.rt.readiness.gate.repair(d.draft)).slice(0, 300));
    const rs = h.rt.readiness.gate.repair(d.draft);
    ok(rs.rounds.length === 6 && prompts.length === 6, "loop the total is capped at six rounds", `${rs.rounds.length} rounds, ${prompts.length} prompts`);
    ok(rs.rounds[0].strategy === "patch" && rs.rounds[1].strategy === "patch" && rs.rounds[2].strategy === "redraft" && /REDRAFT/.test(prompts[2]) && /redraft the failing part from scratch/.test(prompts[2]) && !/REDRAFT/.test(prompts[1]), "loop after two rounds without progress Firstmate switches to redrafting", JSON.stringify(rs.rounds.map((r: any) => r.strategy)));
    ok(rs.notice && /Not verified after 6 repair rounds/.test(rs.notice.en) && /skip/.test(rs.notice.en) && /修正 6 輪後仍未通過驗證/.test(rs.notice.zh) && !("options" in rs.notice), "loop the final status is a plain notice listing what is left (no options)", JSON.stringify(rs.notice));
    ok(h.rt.engine.cards.list().length === 0, "loop no captain card or question on no progress");
    h.rt.readiness.stop();
  }
  {
    // captain-only: a provider sign-in with no other provider logged in is a notice, never a loop
    const h = gateHarness({ login: { codex: "not-logged-in", claude: "not-logged-in" } });
    const d = await h.tool("studio_draft_workflow", fx());
    await settled(h, d.draft);
    const rs = h.rt.readiness.gate.repair(d.draft);
    ok(h.asks.length === 0 && rs.status === "waiting-captain" && rs.rounds.length === 0, "loop a captain-only problem never loops", JSON.stringify(rs).slice(0, 300));
    ok(rs.notice && /Only you can do/.test(rs.notice.en) && /sign-in/.test(rs.notice.en) && /只有你能處理/.test(rs.notice.zh), "loop the captain-only problem is a plain notice with its reason");
    const v = (await h.api(`/api/wf/drafts/${d.draft}/gate`)).body;
    ok(stage(v, "dryrun")?.status === "pass", "loop the gate keeps working around a captain-only problem (the dry run still runs)");
    h.rt.readiness.stop();
  }
  {
    // anti-weakening: every way to "fix" by weakening the gate is refused
    const broken = fx(); broken.workflow.nodes.find((n: any) => n.id === "approve").card.options.push({ id: "skip", label: "Skip" });
    let h: any; let prompt = "";
    h = gateHarness({ ask: (t) => { prompt = t; return true; } });
    const d = await h.tool("studio_draft_workflow", broken); await settled(h, d.draft);
    ok(!!prompt, "weak a repair turn is pending");
    const noNonce = fx(); noNonce.draft = d.draft;
    const forged = await h.tool("studio_draft_workflow", noNonce, "please revise", false);
    ok(forged.code === "owner_ended", "weak a non-captain turn without the repair nonce cannot revise", JSON.stringify(forged));
    const dropLine = fx(); dropLine.draft = d.draft; dropLine.workflow.intents = dropLine.workflow.intents.slice(0, 1); for (const n of dropLine.workflow.nodes) if (n.serves?.[0] === 2) n.serves = [1];
    const r1 = await h.tool("studio_draft_workflow", dropLine, prompt, false);
    ok(/repair refused: intent line 2 must stay/.test(r1.error ?? ""), "weak removing the captain's intent line is refused", JSON.stringify(r1));
    const reword = fx(); reword.draft = d.draft; reword.workflow.intents[0].text = "Any newsletter";
    ok(/repair refused: intent line 1/.test((await h.tool("studio_draft_workflow", reword, prompt, false)).error ?? ""), "weak rewording an intent line is refused");
    const assume = fx(); assume.draft = d.draft; assume.workflow.intents[0].assumption = "weekly means every Friday";
    const r2 = await h.tool("studio_draft_workflow", assume, prompt, false);
    ok(r2.revision === 2, "weak adding an assumption to an ambiguous line is allowed", JSON.stringify(r2));
    ok(h.rt.readiness.gate.repair(d.draft).rounds.some((x: any) => /intent line 2/.test(x.refused ?? "")), "weak a refused repair is recorded on its round");
    // the other weakenings, on full definitions (the drafting vocabulary cannot even express them)
    const W = (o: any): WDef => normalize({ id: "w", name: "w", version: 1, roles: [], intents: [{ n: 1, text: "Ship it", done: "Shipped" }], nodes: [{ id: "a", kind: "hook", label: "A", do: "note", serves: [1] }, { id: "gate", kind: "card", label: "Merge?", args: { card_kind: "merge" }, card: { options: [{ id: "go", label: "Go" }] }, serves: [1] }, { id: "push", kind: "hook", label: "Push", do: "remote.push", serves: [1] }, { id: "end", kind: "hook", label: "End" }], edges: [{ from: "a", to: "gate" }, { from: "gate", to: "push", when: "go" }, { from: "push", to: "end" }], ...o });
    const prev = W({}); const dropCard = W({ nodes: prev.nodes.filter((n) => n.id !== "gate"), edges: [{ from: "a", to: "push" }, { from: "push", to: "end" }] });
    ok(/one-way captain card gate .* cannot be removed/.test(weakening(prev, dropCard) ?? ""), "weak dropping the one-way card before an external effect is refused");
    const cOf = (def: WDef) => contractStage(def, h.rt.readiness.gate.d.contract(def, sampleOf(def)));
    const widen = W({ nodes: prev.nodes.map((n) => n.id === "a" ? { ...n, args: { cwd: "/etc" } } : n) });
    ok(/would work outside its round folder/.test(weakening(prev, widen, cOf) ?? ""), "weak widening a node's folders outside its round folder is refused");
    const checked = W({ nodes: prev.nodes.map((n) => n.id === "a" ? { ...n, checks: [{ use: "studio/brief-quality" }] } : n) });
    ok(/checks on a cannot be removed/.test(weakening(checked, prev) ?? ""), "weak removing a node's checks is refused");
    const soft = W({ nodes: prev.nodes.map((n) => n.id === "a" ? { ...n, checks: [{ use: "studio/brief-quality", blocking: false }] } : n) });
    ok(/non-blocking/.test(weakening(checked, soft) ?? ""), "weak making a check non-blocking is refused");
    ok(/policies/.test(weakening(prev, W({ policies: { round_timeout_s: 1 } })) ?? ""), "weak changing the workflow's policies is refused");
    ok(weakening(prev, W({ nodes: prev.nodes.map((n) => n.id === "a" ? { ...n, label: "Prepare" } : n) }), cOf) === null, "weak a fair repair is not refused");
    h.rt.readiness.stop();
  }

  // ---------------- 5 real smoke stage (stub provider) ----------------
  {
    let h: any; const prompts: string[] = [];
    h = gateHarness({ ask: (t) => { prompts.push(t); return true; } });
    const good = fx(); good.workflow.nodes.find((n: any) => n.id === "review").provider = "claude"; good.workflow.nodes.find((n: any) => n.id === "review").model = "claude-fixture";
    const d = await h.tool("studio_draft_workflow", good); const v = await settled(h, d.draft);
    const saved = await h.api(`/api/wf/drafts/${d.draft}/save`, { revision: v.revision }); const wid = saved.body.workflow;
    const before = (await h.api(`/api/wf/${wid}/gate`)).body;
    ok(before.passed && !before.status.verified && /Not verified yet: stages 1-4 pass/.test(before.status.text.en), "5 before the real run the version says Not verified yet");
    const runAnyway = await h.api("/api/wruns", { workflow: wid, text: "Go" });
    ok(runAnyway.status === 409 && runAnyway.body.code === "staffing_confirmation_required", "5 the captain may still Run an unverified version (only staffing is asked)");
    const ask = await h.api(`/api/wf/${wid}/gate/smoke`, {});
    ok(ask.status === 409 && ask.body.code === "staffing_confirmation_required", "5 Verify with a real run asks for the same staffing confirmation as Run");
    const go = await h.api(`/api/wf/${wid}/gate/smoke`, { staffingConfirm: ask.body.staffing.hash });
    ok(go.status === 200 && /^R-\d+$/.test(go.body.task), "5 Verify with a real run starts exactly one Task", JSON.stringify(go.body).slice(0, 200));
    const again = await h.api(`/api/wf/${wid}/gate/smoke`, { staffingConfirm: ask.body.staffing.hash });
    ok(again.status === 409 && again.body.code === "smoke_running", "5 a second verification run is refused while one is going");
    // Studio answers none of the real run's cards: the captain does
    await until(() => h.rt.engine.cards.list({ run: go.body.task, open: true }).length > 0);
    ok(h.rt.engine.cards.list({ run: go.body.task, open: true })[0]?.node === "topics", "5 the real run waits for the captain's card (nothing auto-answered)");
    await h.api(`/api/scards/${h.rt.engine.cards.list({ run: go.body.task, open: true })[0].id}/answer`, { choice: "continue" });
    await until(() => h.rt.engine.cards.list({ run: go.body.task, open: true }).some((c: any) => c.node === "approve"));
    await h.api(`/api/scards/${h.rt.engine.cards.list({ run: go.body.task, open: true })[0].id}/answer`, { choice: "publish" });
    ok(await until(async () => (await h.api(`/api/wf/${wid}/gate`)).body.status.verified, 15000), "5 a successful real run marks the version verified");
    const after = (await h.api(`/api/wf/${wid}/gate`)).body;
    ok(new RegExp(`^Verified \\d{4}-\\d{2}-\\d{2}, Task ${go.body.task}$`).test(after.status.text.en) && /^已驗證 /.test(after.status.text.zh), "5 the version reads Verified <date>, Task R-…", after.status.text.en);
    // a failing real run is fed back to Firstmate once, with the Task's failure
    const bad = fx(); bad.workflow.sample = { text: "SMOKEFAIL this week" }; for (const n of bad.workflow.nodes) if (n.kind === "agent") Object.assign(n, { provider: "codex", model: "fixture-model", effort: "low" });
    const d2 = await h.tool("studio_draft_workflow", bad); const v2 = await settled(h, d2.draft);
    ok(v2.passed, "5 the SMOKEFAIL draft passes stages 1-4 with the dry-run stub", JSON.stringify(v2.gate?.stages.map((s: any) => [s.id, s.status])));
    const s2 = await h.api(`/api/wf/drafts/${d2.draft}/save`, { revision: v2.revision });
    const a2 = await h.api(`/api/wf/${s2.body.workflow}/gate/smoke`, {}); const g2 = await h.api(`/api/wf/${s2.body.workflow}/gate/smoke`, { staffingConfirm: a2.body.staffing.hash });
    await until(() => h.rt.engine.cards.list({ run: g2.body.task, open: true }).length > 0); await h.api(`/api/scards/${h.rt.engine.cards.list({ run: g2.body.task, open: true })[0].id}/answer`, { choice: "continue" });
    ok(await until(() => prompts.some((p) => p.includes(d2.draft) && /real run R-\d+ failed/.test(p)), 15000), "5 a failed real run feeds its typed failure back to Firstmate", prompts.at(-1)?.slice(0, 300));
    const f = (await h.api(`/api/wf/${s2.body.workflow}/gate`)).body;
    ok(stage(f, "smoke")?.status === "fail" && !f.status.verified, "5 a failed real run leaves the version Not verified with stage 5 failing");
    const n = prompts.length; h.rt.readiness.checkSmokes(); await Bun.sleep(100);
    ok(prompts.length === n, "5 the real-run failure is fed back only once");
    // the repair turn may revise the saved draft; saving again writes the next version
    const m = /^GATE-REPAIR (d-[a-f0-9]{12}) ([a-f0-9]+)/.exec(prompts.at(-1)!)!; const fixed = JSON.parse(JSON.stringify(bad)); fixed.draft = m[1]; fixed.workflow.sample = { text: "This week" };
    const rv = await h.tool("studio_draft_workflow", fixed, prompts.at(-1), false);
    ok(rv.revision === 2, "5 Firstmate revises the saved draft from the real-run failure", JSON.stringify(rv));
    const s3 = await h.api(`/api/wf/drafts/${d2.draft}/save`, { revision: 2 });
    ok(s3.status === 200 && s3.body.version === 2 && s3.body.workflow === s2.body.workflow, "5 saving the repaired draft writes the next version of the same workflow", JSON.stringify(s3.body));
    h.rt.readiness.stop();
  }
  // pure stages never need the runtime (contract and intent are functions of the definition and a small environment)
  {
    const def = normalize({ id: "p", name: "p", version: 1, roles: [], intents: [{ n: 1, text: "x", done: "y" }], nodes: [{ id: "a", kind: "card", label: "A", serves: [1], card: { options: [{ id: "go", label: "Go" }] } }, { id: "b", kind: "hook", label: "B" }], edges: [{ from: "a", to: "b", when: "go" }] } as any);
    ok(intentStage(def).length === 0 && briefStage(def, [], { text: "x", params: {} }).length === 0, "pure stages run with no engine");
  }
} catch (e: any) { fail++; console.log("  FAIL  exception", e?.stack ?? e); }
console.log(`workflow-gate: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
