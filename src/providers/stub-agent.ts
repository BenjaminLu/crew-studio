// The stub provider's scripted agents (tests and offline demos): each mode makes
// the same kind of tool calls a model would, through the real tool route.
//   SKILL EDIT REQUEST  adds the captain's request as a rule under the first "## " heading
//   PACK GENESIS        drafts a small pack from the description
//   GATE FIX            makes the failing gate pass the simplest way it is told
//   GATE REVIEW         approves unless the diff contains STUB_REJECT
//   DOC DRAFT           writes a short document from the prompt
//   SPEC DRAFT … DESIGN DRAFT  the v2 runtime's agent nodes (see the end of this file); the intent
//                       text steers them: STUB_FILE <path> :: <content> (\n = newline) is written on
//                       round 1, STUB_FIX <path> :: <old> => <new> on a fix round, STUB_REJECT in an
//                       added line makes the reviewer reject, STUB_SLOW makes a build round slow,
//                       STUB_BLOCKED makes the worker report SCOPE-BLOCKED
import type { NEvent } from "./types";
type Call = (name: string, args: any) => AsyncGenerator<NEvent, any>;
type Say = (s: string) => AsyncGenerator<NEvent, boolean>;

const nativeLabelScript = () => `let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const i=JSON.parse(s),bad=i.params.detect_empty&&/<button(?:\\s[^>]*)?>\\s*<\\/button>/.test(i.artifact.content||"");process.stdout.write(JSON.stringify({verdict:bad?"fail":"pass",score:bad?0:1,findings:bad?[{locator:{type:"web",url:i.artifact.url,selector:"button",viewport:{w:390,h:900}},message:"The button has no label",expected:"Give every button a visible or accessible label",class:"captain-note",severity:"blocking"}]:[],evidence:[],proves:[]}));});`;

export async function* stubAgent(text: string, call: Call, say: Say): AsyncGenerator<NEvent | "interrupted"> {
  const done = async function* (s: string): AsyncGenerator<NEvent | "interrupted"> { if (!(yield* say(s))) yield "interrupted"; };
  // Native genesis offline fixture: actual agent tools, artifacts and executable checks.
  if (text.startsWith("NATIVE PACK INTERVIEW")) {
    const rows = [["inputs", "What inputs will the workflow receive?", "流程會收到哪些輸入？"], ["outputs", "What outputs should it create?", "應產生哪些輸出？"], ["tools", "Which tools are available?", "有哪些可用工具？"], ["quality", "What makes the result good?", "怎樣的結果算好？"], ["dealbreakers", "Which faults must be rejected?", "哪些缺失一定要拒絕？"], ["signoff", "Who gives final acceptance?", "誰做最後核准？"]];
    yield* call("interview_batch", { questions: rows.map(([key, en, zh]) => ({ key, en, zh })) }); yield* done("All interview questions are in one batch."); return;
  }
  if (text.startsWith("NATIVE PACK SAMPLES")) {
    yield* call("sample_create", { title: "Good labelled button", html: '<!doctype html><html><body><button aria-label="Continue">Continue</button></body></html>' });
    yield* call("sample_create", { title: "Bad unlabelled button", html: '<!doctype html><html><body><button></button></body></html>' });
    yield* done("Two actual local samples are ready for captain labels."); return;
  }
  if (text.startsWith("NATIVE PACK PROPOSE")) {
    const proposals = JSON.parse(/^Proposals: (.*)$/m.exec(text)?.[1] ?? "[]");
    for (const p of proposals) {
      if(p.check==='button-judge')yield* call('proposal_plan',{proposal:p.id,plan:{check:p.check,judge:{prompt:'Judge only actual missing accessible button labels in artifact.content. Do not invent faults in labelled buttons.'}}});
      else if (p.check) yield* call("proposal_plan", { proposal: p.id, plan: { check: p.check, params: { detect_empty: true } } });
      else yield* call("proposal_plan", { proposal: p.id, plan: { newCheck: { manifest: { id: `human-${p.id}`, version: "1.0.0", title: { en: "Catch the captain's annotation", "zh-TW": "捕捉船長標註" }, kind: "deterministic", runtime: "studio", blocking: false, network: false, applies_to: ["web"], needs: ["artifact"], timeout_s: 10, params: { type: "object", properties: { detect_empty: { type: "boolean", default: true } } } }, script: nativeLabelScript() } } });
    }
    yield* done("The native preview check will measure each proposed change.");return;
  }
  if (text.startsWith("NATIVE PACK AUTHOR") || text.startsWith("NATIVE PACK REFINE")) {
    const id = /^Pack id: ([a-z0-9-]+)$/m.exec(text)?.[1] ?? "offline-pack";
    const refined = text.startsWith("NATIVE PACK REFINE");
    const accepted = refined ? JSON.parse(/^Accepted\/edited proposals: (.*)$/m.exec(text)?.[1] ?? "[]") : [];
    let version='1.0.0';if(refined){const existing=(yield* call('pack_read',{path:'manifest.yaml'})) as any;try{version=JSON.parse(String(existing.text).split('\n').map(line=>line.replace(/^\d+\t/,'')).join('\n')).version;}catch{throw new Error('Native refinement must preserve the candidate version');}}
    const manifest = { id, name: "Accessible page review", version, description: "Produce and review accessible local pages", engine: "native-v2", skills: [{ role: "maker", file: "skills/maker.md" }], checks: [{ id: "button-label", promotion: { n: 2, m: 3 } }], workflows: ["workflows/page.wf.yaml"], permissions: [] };
    if(refined&&text.includes('STUB_PG_THRESHOLD_REFINE'))manifest.checks[0].promotion={n:5,m:5};
    const withJudge=text.includes('STUB_PG_JUDGED');if(withJudge)manifest.checks.push({id:'button-judge',promotion:{n:2,m:3}});
    for (const p of accepted) if (p.plan?.newCheck) { const c = p.plan.newCheck; manifest.checks.push({ id: c.manifest.id, promotion: { n: 2, m: 3 } }); yield* call("pack_write", { path: `checks/${c.manifest.id}/check.yaml`, content: JSON.stringify(c.manifest) }); yield* call("pack_write", { path: `checks/${c.manifest.id}/run`, content: c.script }); }
    yield* call("pack_write", { path: "manifest.yaml", content: JSON.stringify(manifest) });
    yield* call("pack_write", { path: "skills/maker.md", content: "# Page maker\nWrite the requested local page. Give every button a label. Return an actual version through result_create.\n" });
    const wf = { id: "page-review", name: "Page review", roles: [{ id: "maker", label: "Maker", skill: `pack:${id}/skills/maker.md` }], nodes: [{ id: "make", kind: "agent", label: "Make page", mode: "pack-produce", role: "maker", x: 0, y: 0 }, { id: "check", kind: "check", label: "Check page", checks: [{ use: `${id}/button-label`, blocking: false }], x: 220, y: 0 }, { id: "accept", kind: "card", label: "Final acceptance", args: { mode: "pack-final" }, x: 440, y: 0 }, { id: "done", kind: "hook", label: "Done", x: 660, y: 0 }, { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 660, y: 150 }], edges: [["make", "check"], ["check", "accept"], ["accept", "done", "accept"], ["accept", "closed", "reject"]] };
    wf.nodes.find(n => n.id === "check")!.checks = manifest.checks.map(c => ({ use: `${id}/${c.id}`, blocking: false }));
    yield* call("pack_write", { path: "workflows/page.wf.yaml", content: JSON.stringify(wf) });
    const check = { id: "button-label", version: "1.0.0", title: { en: "Buttons have a label", "zh-TW": "按鈕有標籤" }, kind: "deterministic", runtime: "studio", blocking: false, network: false, applies_to: ["web"], needs: ["artifact"], timeout_s: 10, params: { type: "object", properties: { detect_empty: { type: "boolean", default: refined } } } };
    yield* call("pack_write", { path: "checks/button-label/check.yaml", content: JSON.stringify(check) });
    if(withJudge)yield* call('pack_write',{path:'checks/button-judge/check.yaml',content:JSON.stringify({id:'button-judge',version:'1.0.0',title:{en:'Independent button judgement','zh-TW':'獨立按鈕判斷'},kind:'judged',blocking:false,network:false,applies_to:['web'],needs:['artifact'],timeout_s:10,params:{type:'object',properties:{}},judge:{distinct_providers:true,prompt:accepted.find(p=>p.plan?.judge)?.plan.judge.prompt??(text.includes('STUB_PG_JUDGED_FALSE_HIT')?'STUB_PG_FALSE_HIT Judge actual HTML button labels.':'Judge the actual HTML button labels shown in artifact.content.'),vendors:['stub-alpha','stub-beta'],quorum:{n:2,of:2}}})});
    const script = text.includes("STUB_PG_CHECK_ERROR") ? 'throw new Error("Actual fixture check execution failed");' : nativeLabelScript();
    yield* call("pack_write", { path: "checks/button-label/run", content: script });yield* done("The native pack files are ready for actual measurement.");return;
  }
  if (text.startsWith("NATIVE PACK PRODUCE")) {
    const bad = text.includes("STUB_BAD_RESULT");
    yield* call("result_create", { type: text.includes("STUB_PG_UNSUPPORTED_TYPE") ? "image" : "web", title: "Actual shadow page", content: bad ? '<!doctype html><html><body><button></button></body></html>' : '<!doctype html><html><body><button aria-label="Continue">Continue</button></body></html>' });yield* done("Created the actual result artifact.");return;
  }
  if (text.startsWith("SKILL EDIT REQUEST")) {
    const req = /^Captain's request: (.*)$/m.exec(text)?.[1] ?? "";
    if (req.includes("STUB_NOCHANGE")) { yield* call("skill_report", { summary: "nothing to change" }); yield* done("Nothing to change."); return; }
    const heads = (yield* call("skill_search", { text: "## " })) as any[];
    const h = Array.isArray(heads) ? heads.find((x) => /^## /.test(x.text)) : null;
    const rule = `- ${req.replace(/^[-\s]+/, "")}`;
    if (h) yield* call("skill_replace", { path: "SKILL.md", old: h.text, new: `${h.text}\n\n${rule}` });
    else { const r = (yield* call("skill_read", { path: "SKILL.md", start: 1, lines: 800 })) as any; const body = String(r?.text ?? "").split("\n").map((l: string) => l.replace(/^\d+\t/, "")).join("\n");
      yield* call("skill_write", { path: "SKILL.md", content: `${body}\n\n${rule}\n` }); }
    yield* call("skill_report", { summary: `added a rule: ${req.slice(0, 80)}`, expected: "fewer repeats of the issue" });
    yield* done(`Added the rule under ${h ? h.text : "the end"}.`);
    return;
  }
  if (text.startsWith("PACK GENESIS")) {
    const desc = /^Description: (.*)$/m.exec(text)?.[1] ?? "a new way of working";
    const id = (/^Pack id: ([a-z0-9-]+)$/m.exec(text)?.[1]) ?? "drafted-pack";
    const words = desc.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3).slice(0, 3);
    const name = desc.split(/[.,;]/)[0].slice(0, 60);
    yield* call("pack_write", { path: "manifest.yaml", content: `id: ${id}\nname: ${JSON.stringify(name)}\nversion: 0.1.0\ndescription: ${JSON.stringify(desc.slice(0, 200))}\nskills:\n  - { role: maker, file: skills/maker.md }\n  - { role: checker, file: skills/checker.md }\ngates:\n  - { id: not-empty, builtin: not-empty, label: "The result is not empty" }\nartifactTypes:\n  - { id: result, label: Result, viewer: doc }\nworkflows:\n  - workflows/${id}.flow.yaml\nevals:\n  - evals/maker.json\npermissions: []\n` });
    yield* call("pack_write", { path: "skills/maker.md", content: `# Maker\n\nYou do the work described as: ${desc}\n\n## Rules\n\n- Work in small steps and say what you changed.\n- Ask when the request is unclear.\n` });
    yield* call("pack_write", { path: "skills/checker.md", content: `# Checker\n\nYou check the maker's result against the request.\n\n## Rules\n\n- Approve only when every point of the request is met.\n` });
    yield* call("pack_write", { path: `workflows/${id}.flow.yaml`, content: `id: ${id}\nname: ${JSON.stringify(name)}\nversion: 1\nnodes:\n  - { id: ask, kind: human, label: Request, x: 0, y: 60 }\n  - { id: make, kind: agent, label: Make, x: 220, y: 60 }\n  - { id: check, kind: gate, label: Check, x: 440, y: 60, gates: [{ id: not-empty, builtin: not-empty }] }\n  - { id: approve, kind: human, label: Approve, x: 660, y: 60 }\nedges:\n  - [ask, make]\n  - [make, check]\n  - [check, approve]\n  - [check, make, REJECT]\nroles:\n  - { id: maker, label: Maker, skill: "pack:${id}/skills/maker.md" }\n  - { id: checker, label: Checker, skill: "pack:${id}/skills/checker.md" }\n` });
    yield* call("pack_write", { path: "evals/maker.json", content: JSON.stringify([{ id: `EV-${id}-1`, role: "maker", title: "Unclear request", situation: `The request is: ${words.join(" ") || "something vague"}.`, ask: "The request leaves the scope open. What do you do?", terms: ["ask", "unclear"], expect: [{ pattern: "ask", why: "asks when unclear" }] }], null, 1) });
    yield* call("pack_report", { summary: `drafted ${id}: 2 roles, 1 gate, 1 workflow, 1 eval` });
    yield* done(`Drafted the pack ${id}.`);
    return;
  }
  if (text.startsWith("GATE FIX")) {
    const hint = /^Fix hint: (.*)$/m.exec(text)?.[1] ?? "";
    const files = ((yield* call("fs_list", {})) ?? []) as any[];
    if (/STUB_GIVEUP/.test(text)) { yield* done("I could not fix it."); return; }
    const m = /^replace (.+?) => (.*) in (\S+)$/.exec(hint);
    if (m) yield* call("fs_replace", { path: m[3], old: m[1], new: m[2], all: true });
    else { const f = files.find((x) => x.editable); if (f) { const r = (yield* call("fs_read", { path: f.path })) as any; void r; } }
    yield* done("Fixed what the gate reported.");
    return;
  }
  if (text.startsWith("GATE REVIEW")) {
    const reject = /^\+.*STUB_REJECT/m.test(text);
    yield* call("review_verdict", { verdict: reject ? "REJECT" : "APPROVE", findings: reject ? ["the diff still contains STUB_REJECT"] : [] });
    yield* done(reject ? "REJECT: see the finding." : "APPROVE.");
    return;
  }
  if (text.startsWith("DOC DRAFT")) {
    const title = /^Title: (.*)$/m.exec(text)?.[1] ?? "Draft";
    const prompt = /^Prompt: (.*)$/m.exec(text)?.[1] ?? "";
    yield* call("doc_write", { path: "doc.md", content: `# ${title}\n\n${prompt ? `This draft answers: ${prompt}\n\n` : ""}## Summary\n\nA short first draft for review.\n\n## Details\n\n- The first point.\n- The second point.\n\n## Next steps\n\nReview this draft and leave notes.\n` });
    yield* done("Drafted doc.md.");
    return;
  }
  if (/^(SPEC DRAFT|PLAN ROUND|PLAN DECISION|BUILD ROUND|FIX BRIEF|CODE REVIEW|DESIGN DRAFT|JUDGE|ROOT CAUSE|FILM FIX|TEST AGENT)/.test(text)) { yield* runtimeAgent(text, call, say); return; }
}

const stubFiles = (text: string) => [...text.matchAll(/STUB_FILE (\S+) :: (.*)$/gm)].map((m) => ({ path: m[1], content: m[2].replace(/\\n/g, "\n") }));
const stubFixes = (text: string) => [...text.matchAll(/STUB_FIX (\S+) :: (.*?) => (.*)$/gm)].map((m) => ({ path: m[1], old: m[2], new: m[3] }));
async function* runtimeAgent(text: string, call: Call, say: Say): AsyncGenerator<NEvent | "interrupted"> {
  const done = async function* (s: string): AsyncGenerator<NEvent | "interrupted"> { if (!(yield* say(s))) yield "interrupted"; };
  if (text.startsWith("SPEC DRAFT")) {
    const intent = (/Captain's intent:\n([\s\S]*?)\n\n?(?:The captain asked|BRIEF|Start with)/.exec(text)?.[1] ?? "a change").trim();
    const files = stubFiles(intent);
    yield* call("fs_list", {});
    const scope = [...new Set([...files.map((f) => f.path), ...[...intent.matchAll(/STUB_SCOPE (\S+)/g)].map((m) => m[1])])];
    const test = files.find((f) => /tests?\//.test(f.path))?.path ?? "tests/price.test.mjs";
    const oneWay = scope.some((p) => /^migrations\/|\.sql$|^\.github\//.test(p));
    const draft = Number(/· draft (\d+)\./.exec(text)?.[1] ?? 1);
    const vague = /STUB_VAGUE_SPEC/.test(intent) && draft === 1;
    yield* call("spec_write", { title: intent.split("\n")[0].replace(/STUB_\w+.*$/, "").trim().slice(0, 80) || "A change", what: intent.split("\n")[0].replace(/STUB_\w+.*$/, "").trim().slice(0, 200) || "A change to the code",
      why: ["the captain asked for it"], done: vague ? ["the change works and we will ensure it is fast"] : [`${test}: the new test passes on the head (fails on base)`],
      scope: scope.length ? scope : ["src/", "tests/"], door: { kind: oneWay ? "one-way" : "two-way", reason: oneWay ? "it changes a sensitive path" : "a revert undoes it" },
      explain: { en: "This change does what the captain asked.", "zh-TW": "這個變更做到船長要求的事。" },
      // STUB_ZH_ENGLISH: the first draft's zh-TW is the English title and a placeholder (the checks send it back)
      zh: /STUB_ZH_ENGLISH/.test(intent) && draft === 1 ? { title: intent.split("\n")[0].trim().slice(0, 80), why: ["船長要求的變更。"] } : { title: "依照意圖修改程式碼並補上測試", why: ["船長在意圖裡寫了要的結果，這個改動照著做，並用測試證明。"] } });
    yield* done("Spec written."); return;
  }
  if (text.startsWith("PLAN ROUND")) {
    const n = (/Done when:\n([\s\S]*?)\n\n/.exec(text)?.[1] ?? "1. x").split("\n").filter((l) => /^\d+\./.test(l)).length || 1;
    yield* call("fs_list", {});
    yield* call("plan_write", { questions: ["Is the scope final?"], files: ["src/", "tests/"], rows: Array.from({ length: n }, (_, i) => ({ n: i + 1, test: `tests/ line for done ${i + 1}`, where: "node tests/run.mjs", fails_on_base: "the assertion fails without the change" })) });
    yield* done("Plan written."); return;
  }
  if (text.startsWith("PLAN DECISION")) {
    yield* call("plan_decision", { accept: true, answers: [{ q: "Is the scope final?", a: "Yes: the spec's scope." }], note: "" });
    yield* done("Plan accepted."); return;
  }
  if (text.startsWith("BUILD ROUND")) {
    const round = Number(/· round (\d+) ·/.exec(text)?.[1] ?? 1);
    if (/STUB_SLOW/.test(text) && !/^HANDOFF$/m.test(text)) { if (!(yield* say(".".repeat(24 * 400)))) { yield "interrupted"; return; } }
    // STUB_LINGER: one tool call, then talks for about a minute (a live agent to look at; tests cancel the run)
    if (/STUB_LINGER/.test(text) && !/^HANDOFF$/m.test(text)) { yield* call("fs_list", {}); if (!(yield* say(".".repeat(24 * 6000)))) { yield "interrupted"; return; } }
    yield* call("fs_list", {});
    if (/REPORT ONLY/.test(text)) { yield* call("worker_report", { marker: "WORKER_COMPLETE", summary: "report rewritten; the code is kept (fixed: report)", swept: { searched: "the report", found: 1, fixed: 1 }, classes: ["report"] }); yield* done("Report only."); return; }
    if (/STUB_BLOCKED/.test(text)) { yield* call("worker_report", { marker: "SCOPE-BLOCKED", summary: "needs a path outside the scope" }); yield* done("SCOPE-BLOCKED"); return; }
    // STUB_ASK_AFTER <text>: once the build brief contains <text> (and holds no answer yet), the worker asks about captain change A1
    const askAfter = /STUB_ASK_AFTER (.+)$/m.exec(text)?.[1];
    if (askAfter && text.replace(/^STUB_ASK_AFTER .*$/m, "").includes(askAfter) && !/^CAPTAIN'S ANSWER$/m.test(text)) { yield* call("worker_report", { marker: "ASK", summary: "Should A1 still hold?", amendment: 1 }); yield* done("ASK"); return; }
    if (round === 1 || !stubFixes(text).length) for (const f of stubFiles(text)) yield* call("fs_write", { path: f.path, content: f.content });
    else for (const f of stubFixes(text)) yield* call("fs_replace", { path: f.path, old: f.old, new: f.new, all: true });
    yield* call("run_tests", {});
    const noSwept = /STUB_NO_SWEPT/.test(text);
    const classes = [...text.matchAll(/^\d+\. \[([\w.-]+)\]/gm)].map((m) => m[1]);
    yield* call("worker_report", { marker: "WORKER_COMPLETE", summary: round === 1 ? "built the change" : `fixed the brief's classes: ${classes.join(", ")}`, ...(round > 1 && !noSwept ? { swept: { searched: "the files the brief names", found: 1, fixed: 1 }, classes } : {}), failfirst: "tests/ (stub)" });
    yield* done("WORKER_COMPLETE"); return;
  }
  if (text.startsWith("FIX BRIEF")) {
    const failing = (/Failing:\n([\s\S]*?)\n(?:Gate details|CI log|Fail-first|Reviewer findings|\nStart)/.exec(text)?.[1] ?? "").trim();
    yield* call("fs_list", {});
    yield* call("brief_write", { diagnosis: failing || "a check failed", where: ["see the failing check"], cause: "the last round left it", expected: "make the failing check pass", class: "every instance of the same mistake" });
    yield* done("Brief written."); return;
  }
  if (text.startsWith("CODE REVIEW")) {
    const reject = /^\+.*STUB_REJECT/m.test(text);
    // STUB_SHALLOW_REVIEW on an added line of the diff: a reviewer that only reads the diff and gives its verdict (it is refused)
    if (!/^\+.*STUB_SHALLOW_REVIEW/m.test(text)) {
      // run mode: the tests once, and a small verification command
      if (/· mode run/.test(text)) { yield* call("run_tests", {}); yield* call("run_command", { argv: ["ls"] }); }
      // every file the read plan lists, in ranges of 800 lines (an image, a PDF or a binary is seen in one read)
      const plan = /^Read plan [^\n]*: read (.*)$/m.exec(text)?.[1] ?? ""; const files = plan === "(nothing)" ? [] : plan.split(", ").filter(Boolean);
      for (const f of files) for (let s = 1; s <= 1600; s += 800) yield* call("fs_read", { path: f, start: s, lines: 800 });
    }
    // STUB_AMENDED on an added line: a change the captain asked for after the spec. Like a real reviewer, the stub rejects it as
    // unauthorized against the done lines unless the brief lists it as a captain's binding change (then done line 1 is superseded).
    if (/^\+.*STUB_AMENDED/m.test(text) && !reject) {
      const listed = /^CAPTAIN'S BINDING CHANGES/m.test(text);
      yield* call("review_verdict", listed ? { verdict: "APPROVE", findings: [], followups: [], superseded: [{ done: 1, amendment: 1 }] }
        : { verdict: "REJECT", findings: [{ path: "src/", line: 1, text: "unauthorized change: the approved done lines do not ask for it", tag: "must-fix", fix: "revert to what the done lines say" }], followups: [] });
      yield* done(listed ? "APPROVE" : "REJECT"); return;
    }
    yield* call("review_verdict", reject ? { verdict: "REJECT", findings: [{ text: "an added line still says STUB_REJECT", tag: "must-fix", fix: "replace it" }], followups: [] } : { verdict: "APPROVE", findings: [], followups: /STUB_FOLLOWUP/.test(text) ? ["a follow-up"] : [] });
    yield* done(reject ? "REJECT" : "APPROVE"); return;
  }
  if (text.startsWith("TEST AGENT")) {
    // tests: "Call: <tool> <json>" lines are made in order; STUB_SLOW talks for ~3 s first (unless handed off)
    if (/STUB_SLOW/.test(text) && !/^HANDOFF$/m.test(text)) { if (!(yield* say(".".repeat(24 * 200)))) { yield "interrupted"; return; } }
    if (/STUB_HANG/.test(text)) { if (!(yield* say(".".repeat(24 * 4000)))) { yield "interrupted"; return; } }
    for (const m of text.matchAll(/^Call: (\w+) (.*)$/gm)) yield* call(m[1], JSON.parse(m[2]));
    yield* done("Done."); return;
  }
  if(text.startsWith('JUDGE button-judge')){const input=JSON.parse(text.split('Input (JSON):\n')[1]),bad=/<button(?:\s[^>]*)?>\s*<\/button>/.test(input.artifact.content||'')||text.includes('STUB_PG_FALSE_HIT');yield* call('judge_report',{verdict:bad?'fail':'pass',findings:bad?[{locator:{type:'web',url:input.artifact.url,selector:'button',viewport:{w:390,h:900}},message:'The button has no label',expected:'Give every button a visible or accessible label',class:'captain-note',severity:'blocking'}]:[]});yield* done('Judged the actual HTML sample.');return;}
  if (text.startsWith("JUDGE")) {
    const fail = /STUB_JUDGE_FAIL|^\+.*STUB_REJECT/m.test(text);
    const finding={locator:{type:"file",path:"src/price.js",line:1},message:"the judge found STUB_REJECT",expected:"remove it",class:"review-stub",severity:"blocking"};
    if(fail){
      // Exercise the actual tool contract: malformed payload is refused, then corrected.
      const refused=yield* call("judge_report",{verdict:"fail",findings:[finding,{message:"missing locator",class:"x"}]});
      if(!refused?.error)throw new Error("Malformed judge fixture was not refused");
      const corrected=yield* call("judge_report",{verdict:"fail",findings:[finding]});
      if(corrected?.error)throw new Error("Corrected judge fixture was refused");
    }else yield* call("judge_report",{verdict:"pass",findings:[]});
    yield* done(fail ? "fail" : "pass"); return;
  }
  if (text.startsWith("ROOT CAUSE")) {
    // like a model: a concrete expected change for each item that has none (or only "<check> passes"), and a locator where it has none
    const items = [...text.matchAll(/^(\d+)\. \[([^\]]+)\] (\S+) — (.*)\n   Found: (.*)\n   Expected: (.*)$/gm)];
    const expected = items.filter((m) => { const e = m[6].trim().replace(/\.$/, ""); return !e || /^[\w@./:-]+ passes$/.test(e) || m[4] === "(no locator)" || /^node |^edge /.test(m[4]); })
      .map((m) => ({ n: Number(m[1]), expected: `the ${m[2]} finding "${m[5].slice(0, 80)}" no longer occurs`, ...(m[4] === "(no locator)" || /^node |^edge /.test(m[4]) ? { locator: { type: "card", field: m[3] } } : {}) }));
    yield* call("root_cause", { cause: "the last round left the named class unfixed", expected });
    yield* done("Root cause given."); return;
  }
  if (text.startsWith("DESIGN DRAFT")) {
    const title = /^Title: (.*)$/m.exec(text)?.[1] ?? "Prototype"; const variant = /^Variant: (.*)$/m.exec(text)?.[1] ?? "A";
    yield* call("work_write", { path: "index.html", content: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font:16px system-ui;margin:0;padding:40px;background:#fff;color:#111}@media (prefers-color-scheme:dark){body{background:#111;color:#eee}}h1{font-size:40px}</style></head><body><header><h1>${title}</h1><p class="lead">Variant ${variant}</p></header><main><section class="cta"><a href="#">Get started</a></section></main></body></html>` });
    yield* done(`Drafted variant ${variant}.`); return;
  }
}
