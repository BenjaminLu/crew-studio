import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Actual code-firstmate workflow with stub agent, real signed checks and subprocesses.
// Negative controls alter only the isolated fixture, never live Studio data.
import { existsSync, mkdtempSync, readFileSync, renameSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { harness, suite, until } from "./rt-harness";
const { ok, end } = suite("code-card-evidence-integration");
const root = join(import.meta.dir, "..");
const data = mkdtempSync(join(tmpdir(), "crew-smoke-"));
const { prepareSandbox, registerSandbox } = await import("../src/sandbox-repo");
prepareSandbox(data); registerSandbox(data);
const { installCode } = await import("../src/domain/code");
const { Projects } = await import("../src/doors");
const { Worktrees } = await import("../src/worktrees");
const originalInstall = Worktrees.prototype.installDeps;
let installsBeforeDispatch = 0;
Worktrees.prototype.installDeps = async function (...args) { installsBeforeDispatch++; return originalInstall.apply(this, args); };
const def = readFileSync(join(root, "packs/firstmate/workflows/code-firstmate.wf.yaml"), "utf8");
const H = await harness([def], { data, checkRoots: [] });
const E = H.engine;
const P = new Projects(data);
installCode(E, { dataDir: data, projects: P });
const repo = join(data, "demo-repo");



const intent = [
  "Add a percent function to money-kit",
  "STUB_FILE src/percent.ts :: // A percent of an amount in cents, rounded to the cent.\\nexport function percent(amount: number, pct: number): number {\\n  return Math.round((amount * pct) / 100); \\n}\\n",
  'STUB_FILE test/percent.test.ts :: import { expect, test } from "bun:test";\\ntest("percent rounds to the cent", async () => { expect(await Bun.file(new URL("../src/percent.ts", import.meta.url)).exists()).toBe(true); const { percent } = await import("../src/percent"); expect(percent(1999, 15)).toBe(300); });\\n',
  "STUB_FIX src/percent.ts :: / 100);  => / 100);",
].join("\n");
const r = E.start({ workflow: "code-firstmate", text: intent, params: {} });
const waitCard = async (kind: string) => { await until(() => E.cards.list({ run: r.id, open: true }).some((c) => c.kind === kind) || ["succeeded", "failed"].includes(E.get(r.id)!.status), 120000); return E.cards.list({ run: r.id, open: true }).find((c) => c.kind === kind); };

const dispatch = await waitCard("dispatch");
ok(!!dispatch && /percent/i.test(dispatch.title.en) && /[一-鿿]/.test(dispatch.title["zh-TW"]) && dispatch.options.map((o) => o.id).join(",") === "dispatch,rescope,drop", "the dispatch card comes after the spec, with its options and a Chinese zh-TW title", `${E.get(r.id)!.status} ${E.get(r.id)!.error}`);
ok(installsBeforeDispatch === 0, "spec reaches dispatch without dependency installation");
Worktrees.prototype.installDeps = originalInstall;
E.policies.setProject("sandbox", { install: false });
const spec = E.get(r.id)!.ctx.spec;
ok(spec?.done?.[0]?.includes("test/percent.test.ts") && spec.door?.kind === "two-way" && JSON.stringify(spec.scope) === '["src/percent.ts","test/percent.test.ts"]', "the coordinator's spec names the test, the door and the scope", JSON.stringify(spec));
const specChecks = E.ledger(r.id).filter((e) => e.node === "spec");
ok(["firstmate/spec-schema", "firstmate/done-lines-provable", "firstmate/caller-coverage", "firstmate/overlap", "core/ste-wording"].every((c) => specChecks.some((e) => e.check === c && e.verdict === "pass")), "the spec passed its deterministic checks", JSON.stringify(specChecks.map((e) => `${e.check}:${e.verdict}:${e.error ?? ""}`)));
await E.answer(dispatch!.id, { choice: "dispatch", by: "captain" });

const merge = await waitCard("merge");

if(!merge)throw new Error('actual code workflow never reached merge');
await until(()=>E.get(r.id)!.nodes[merge.node].waiting==='card',10000);
const view=()=>E.cards.view(E.cards.get(merge.id)!);
const evidence=()=>view().detail!.codeEvidence!;
ok(evidence().state==='success'&&!evidence().blocked,'real runtime reaches ready evidence on genuine merge card',JSON.stringify(evidence()));
ok(E.trusted(r.id).entries.some(e=>e.record==='code-card-evidence-offer'&&e.data.card===merge.id),'required evidence snapshot has a signed issuance receipt');
const before=readFileSync(join(E.cards.dir,merge.id+'.json'),'utf8');view();
ok(readFileSync(join(E.cards.dir,merge.id+'.json'),'utf8')===before,'view does not mutate stored card');
const source=E.trusted(r.id).entries.find(e=>e.seq===merge.detail!.codeEvidenceOffer!.requiredEvidence[0].seq)!;
const file=join(source.dir!,source.evidence[0]),gone=file+'.withheld';renameSync(file,gone);
ok(evidence().state==='missing'&&evidence().blocked,'withheld actual raw command log produces missing state');
const tampered=E.cards.get(merge.id)!;delete tampered.detail!.codeEvidenceOffer;E.cards.save(tampered);
ok(evidence().state==='missing'&&evidence().blocked,'removing stored schema cannot downgrade a signed new card to legacy');
E.cards.save(merge);
const removedDetail=E.cards.get(merge.id)!;delete removedDetail.detail;E.cards.save(removedDetail);
let wholeDetailRefusal='';try{await E.answer(merge.id,{choice:'merge',by:'captain',note:'negative control: entire detail removed'});}catch(e:any){wholeDetailRefusal=e.message;}
ok(/evidence/.test(wholeDetailRefusal)&&E.cards.get(merge.id)!.status==='open','removing entire detail cannot bypass signed evidence contract');
E.cards.save(merge);
let refused='';try{await E.answer(merge.id,{choice:'merge',by:'captain',note:'direct forged approval'});}catch(e:any){refused=e.message;}
ok(/evidence/.test(refused)&&E.cards.get(merge.id)!.status==='open','missing backing rejects direct approval before answer persistence',refused);
renameSync(gone,file);
ok(evidence().state==='success','restoring retained backing recovers availability (rerun recovery tested separately)');
const run=E.get(r.id)!; const node=run.def.nodes.find(n=>n.id===merge.node)!; const x=E.x(run,node,run.nodes[node.id]);
const ciReceipt=E.trusted(r.id).entries.filter(e=>e.check==='firstmate/ci'&&e.head===run.ctx.head).at(-1)!;
const ciNode=run.def.nodes.find(n=>n.id===ciReceipt.node)!;const ciX=E.x(run,ciNode,run.nodes[ciNode.id]);
// A real failing check subprocess, not a fabricated passing/failing card object.
const wt=run.ctx.worktree;const test=join(wt,'test/percent.test.ts');const original=readFileSync(test,'utf8');
chmodSync(test,0o644);await Bun.write(test,original+'\nthrow new Error("actual evidence failure control");\n');
await E.runChecks(ciX,[{use:'firstmate/ci'}],ciReceipt.edge??null);
ok(evidence().state==='fail'&&evidence().blocked,'actual failing CI subprocess supersedes earlier ready receipt');
refused='';try{await E.answer(merge.id,{choice:'merge',by:'captain',note:'approve despite failed evidence'});}catch(e:any){refused=e.message;}
ok(!!refused&&E.cards.get(merge.id)!.status==='open','failed execution cannot persist an affirmative answer');
await Bun.write(test,original);await E.runChecks(ciX,[{use:'firstmate/ci'}],ciReceipt.edge??null);
ok(evidence().state==='success','actual rerun restores successful execution evidence');
// A real new commit changes the recorded target; the action path independently rechecks Git.
const change=Bun.spawnSync(['git','commit','--allow-empty','-m','test: move acceptance target'],{cwd:wt,stdout:'pipe',stderr:'pipe'});
if(change.exitCode!==0)throw new Error(change.stderr.toString());
const newHead=Bun.spawnSync(['git','rev-parse','HEAD'],{cwd:wt,stdout:'pipe'}).stdout.toString().trim();
run.ctx.head=newHead;run.ctx.pr.head=newHead;E.save(run);
ok(evidence().state==='stale'&&evidence().blocked,'new actual commit makes retained offer stale');
refused='';try{await E.answer(merge.id,{choice:'merge',by:'captain',note:'approve old head'});}catch(e:any){refused=e.message;}
ok(!!refused&&E.cards.get(merge.id)!.status==='open','old target rejected before answer persistence');
await E.answer(merge.id,{choice:'changes',by:'captain',note:'Recheck the current change and issue fresh evidence.'});
const fresh=await waitCard('merge');
ok(!!fresh&&fresh.id!==merge.id,'request changes follows supported runtime path to a fresh merge card',E.get(r.id)!.error??'');
if(fresh){await until(()=>E.get(r.id)!.nodes[fresh.node].waiting==='card',10000);const current=E.cards.view(E.cards.get(fresh.id)!);ok(current.detail?.codeEvidence?.state==='success','fresh verification and issuance recover the evidence hold');}
await E.cancel(r.id,'captain');H.stop();end();
