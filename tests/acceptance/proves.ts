// What a stub run's real side effects must show (`proves:` in tests/acceptance/<id>.yaml), read from the Task's own folder
// on the throwaway Studio. A proof that needs the real renderer (a Chromium print, a capture, a film, an interaction smoke)
// is checked only in the sandboxed-e2e profile, where the renderer is this Mac's (the other profiles use the stand-in);
// the sandbox probe and fail-first hold in every profile (the round sandbox is on in all of them).
//   pdf-chromium   the approved document's PDF was printed by headless Chromium (its /Creator), not the built-in writer
//   captures       the designer's before/after captures are real PNGs of a rendered page (at least 600 px wide)
//   film           the run's rendered MP4 is a real H.264 film at least 960 px wide (ffprobe)
//   web-smoke      the interaction smoke clicked each primary action under the preview-tab CSP and every one changed the page
//   fail-first     the worker's test failed on the base and passed on the head (firstmate/fail-first passed), and CI passed
//   sandbox-probe  every round that ran the probe (ACCEPT_PROBE in the intent) reached the network only through the egress
//                  proxy and only its provider's host, read its own login and none of the denied paths, wrote nothing outside
import { existsSync, readdirSync, readFileSync, statSync, renameSync, writeFileSync, realpathSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Studio } from "./studio";
import { CrewStore } from "../../src/domain/crew";
import { Ledger } from "../../src/runtime/checks";
import { verifyGitHubGrant } from "../../src/github-grant";
import { CURSOR_MODEL, ON_CURSOR } from "./provider";

export const PROVES = ["pdf-chromium", "captures", "film", "web-smoke", "fail-first", "sandbox-probe", "crew-applied", "merge-granted", "merge-closed", "files-applied", "files-discarded", "project-registered", "project-not-registered"];
/** the proofs only a real renderer can give */
export const RENDERER_PROVES = ["pdf-chromium", "captures", "film", "web-smoke"];

const walk = (dir: string, out: string[] = [], depth = 0): string[] => { if (depth > 8 || !existsSync(dir)) return out; for (const e of readdirSync(dir, { withFileTypes: true })) { const p = join(dir, e.name); if (e.isDirectory()) walk(p, out, depth + 1); else out.push(p); } return out; };
const pngWidth = (f: string) => { const b = readFileSync(f); return b.length > 24 && b.toString("latin1", 1, 4) === "PNG" ? b.readUInt32BE(16) : 0; };

/** One line per round that ran the probe: its parsed result and the round folder it came from. */
export function probeResults(s: Studio, task: string): { round: string; r: any }[] {
  const out: { round: string; r: any }[] = [];
  for (const f of walk(join(s.data, "runs", task, "nodes")).filter((f) => f.endsWith("stream.jsonl")))
    for (const line of readFileSync(f, "utf8").split("\n")) {
      let e: any; try { e = JSON.parse(line); } catch { continue; }
      const text = Object.values(e ?? {}).find((v) => typeof v === "string" && v.includes("ACCEPT_PROBE_RESULT ")) as string | undefined; if (!text) continue;
      try { out.push({ round: f.slice(join(s.data, "runs", task, "nodes").length + 1, -"/stream.jsonl".length), r: JSON.parse(text.slice(text.indexOf("ACCEPT_PROBE_RESULT ") + 20).split("\n")[0]) }); } catch {}
      break;
    }
  return out;
}
/** What one probe result breaks, in plain words (empty: the round could do exactly what it should). */
export function probeProblems(r: any): string[] {
  const bad: string[] = [];
  if (!r.proxyEnv) bad.push("no egress proxy (reserved scoped listener) in the round's env");
  if (!r.proxyCredentialFree) bad.push("the round proxy URL carries a credential in exec environment");
  if (!r.noProxyLoopbackOnly) bad.push("NO_PROXY is not loopback only");
  if (r.directPublic?.ok) bad.push("a direct connection to a public address went out around the proxy");
  if (r.directSink?.ok) bad.push("a direct connection to another loopback port (the harness's sink) went out");
  if (r.directStudio?.ok) bad.push("a direct connection to Studio's own port went out");
  if (!r.toolListener?.ok) bad.push(`Studio's tool listener was not reachable (${r.toolListener?.error})`);
  const admitted = (v: any) => [200, 502].includes(v?.status) || v?.status === null && /still connecting/.test(v?.error ?? "");
  if (!admitted(r.providerViaProxy)) bad.push(`the proxy did not let the round reach its provider's API host (${JSON.stringify(r.providerViaProxy)})`);
  if (r.otherViaProxy?.status !== 403) bad.push(`the proxy did not refuse a host off the round's list (${JSON.stringify(r.otherViaProxy)})`);
  if (!admitted(r.noCredentialViaProxy)) bad.push(`the round's admitted scoped relay required client credentials or refused its provider (${JSON.stringify(r.noCredentialViaProxy)})`);
  if (!r.ownLogin) bad.push("the round could not reach its own login (the captain's own account, in place)");
  if (r.loginCopy) bad.push(`the round got a copy of a login (${r.loginCopy}); a CLI signs in from the captain's own account in place`);
  if (r.otherCredentials?.length) bad.push(`the round's env carries other credentials: ${r.otherCredentials.join(", ")}`);
  for (const [p, v] of Object.entries(r.denied ?? {})) if (v) bad.push(`the round could read ${p}`);
  if (!r.tmpWritable) bad.push("the round could not write its own TMPDIR");
  for (const [p, v] of Object.entries(r.nowrite ?? {})) if (v) bad.push(`the round could write into ${p}`);
  return bad;
}

export async function prove(s: Studio, view: any, what: string, o: { sinkHits?: () => number; github?: { origin: string; calls: { method: string; path: string }[] }; fileorg?: { root: string; files: Record<string, string>; plan?: any } } = {}): Promise<string[]> {
  if(what === "project-registered" || what === "project-not-registered") {
    const path=JSON.parse(view.params.identity).path,raw=JSON.parse(readFileSync(join(s.data,"projects.json"),"utf8"));
    const matches=raw.filter((p:any)=>p.path===path),auth=new Ledger(s.data,view.id).authenticatedPrefix();
    const records=auth.prefix.filter((e:any)=>e.record==='local-project-registered');
    const out:string[]=[];
    if(auth.bad.length||auth.malformed)out.push('registration ledger does not authenticate');
    if(what==='project-registered'&&(matches.length!==1||records.length!==1||records[0].data.project!==matches[0].id))out.push('exactly one matching registered project and signed mutation receipt required');
    if(what==='project-not-registered'&&(matches.length||records.length))out.push('cancelled registration wrote a project or receipt');
    const runs=(await s.api('/api/wruns')).body.runs;
    if(runs.some((r:any)=>['code-firstmate','firstmate-proposal','firstmate-staffing'].includes(r.workflow)))out.push('registration unexpectedly launched coding, staffing or dispatch');
    return out;
  }
  const task = String(view?.id ?? ""), run = join(s.data, "runs", task), lower = task.toLowerCase();
  if (what === "files-applied" || what === "files-discarded") {
    const fixture = o.fileorg, bad: string[] = [];
    if (!fixture?.plan || fixture.plan.id !== view.ctx?.plan?.id) return ["the reviewed file plan snapshot is missing"];
    const { root, files, plan: before } = fixture, dir = join(s.data, "fileorg", before.id), undo = join(dir, "undo.jsonl");
    const plan = JSON.parse(readFileSync(join(dir, "plan.json"), "utf8"));
    const identity = (p: any) => p.moves.map((m: any) => [m.id, m.from, m.to, m.include, m.size, m.mtimeMs]);
    if (before.root !== root || plan.root !== root || JSON.stringify(identity(before)) !== JSON.stringify(identity(plan))) return ["the completed plan differs from the captain's reviewed moves"];
    if (plan.moves.length !== Object.keys(files).length || plan.moves.some((m: any) => !m.include || !(relative(root, m.from) in files) || !resolve(m.to).startsWith(root + "/"))) return ["the plan does not cover exactly the original fixture files"];
    const card = view.cards?.find((c: any) => c.node === "card" && c.status === "answered" && c.captainOnly);
    const ledger = new Ledger(s.data, task).authenticatedPrefix(), choice = what === "files-applied" ? "apply" : "discard";
    const answer = ledger.prefix.find(e => e.record === "card-answer" && e.data?.card === card?.id && e.data?.choice === choice && /^captain\b/i.test(String(e.actor ?? "")) && e.head === view.ctx.plan.hash);
    if (ledger.bad.length || ledger.malformed || !card || card.answer?.choice !== choice || !answer) bad.push("the signed captain file-plan answer is missing");
    if (!ledger.prefix.some(e => e.check === "file-organization/plan-gates" && e.verdict === "pass" && e.head === view.ctx.plan.hash && e.seq < (answer?.seq ?? 0))) bad.push("no passing gate receipt precedes approval of this plan");
    if (what === "files-discarded") {
      if (plan.status !== "discarded" || view.ctx?.applied || existsSync(undo) || JSON.stringify(readdirSync(root).sort()) !== JSON.stringify(Object.keys(files).sort())) bad.push("discard mutated the folder or produced apply evidence");
      for (const [f, text] of Object.entries(files)) if (!existsSync(join(root, f)) || readFileSync(join(root, f), "utf8") !== text) bad.push(`discard changed ${f}`);
    } else {
      if (plan.status !== "applied" || view.ctx?.applied?.moved !== Object.keys(files).length) bad.push("not all reviewed files were applied");
      const rows = existsSync(undo) ? readFileSync(undo, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : [];
      if (rows.length !== plan.moves.length) bad.push("the undo log does not cover every reviewed move");
      for (const m of plan.moves) {
        if (existsSync(m.from) || m.result !== "moved" || !existsSync(m.to) || readFileSync(m.to, "utf8") !== files[relative(root, m.from)]) bad.push(`applied bytes differ for move ${m.id}`);
        if (rows.filter((r: any) => r.id === m.id && r.from === m.from && r.to === m.to && typeof r.at === "string").length !== 1) bad.push(`undo evidence differs for move ${m.id}`);
      }
      if (JSON.stringify(walk(root).sort()) !== JSON.stringify(plan.moves.map((m: any) => m.to).sort())) bad.push("the resulting folder has unexpected files");
    }
    return bad;
  }
  if (what === "merge-granted" || what === "merge-closed") {
    const bad: string[] = [], project = JSON.parse(readFileSync(join(s.data, "projects.json"), "utf8")).find((p: any) => p.id === view.params?.project);
    if (!project) return ["the Task's registered project is missing"];
    try { verifyGitHubGrant(s.data, project); } catch (e: any) { bad.push(`the project grant does not verify: ${e.message}`); }
    const grant = project.github, card = view.cards?.find((c: any) => c.node === "card" && c.status === "answered" && c.captainOnly);
    if (!o.github || grant?.mode !== "simulator" || grant.apiOrigin !== o.github.origin || grant.repository !== "fixture/project" || grant.base !== "main" || grant.branchPrefix !== "crew/") bad.push("the grant scope differs from the isolated simulator project");
    if (!o.github?.calls.some(c => c.method === "GET" && c.path === "") || o.github.calls.some(c => c.method !== "GET")) bad.push("expected a read-only simulator access probe and no remote writes");
    const ledger = new Ledger(s.data, task).authenticatedPrefix();
    if (ledger.bad.length || ledger.malformed) bad.push("the merge approval evidence does not authenticate");
    const answer = ledger.prefix.find(e => e.record === "card-answer" && e.data?.card === card?.id);
    const receipts = ledger.prefix.filter(e => e.record === "grant-merge");
    if (!card || !answer || !/^captain\b/i.test(String(card.answer?.by ?? ""))) bad.push("a signed captain answer is missing");
    if (!card?.options.some((c: any) => c.id === "grant-squash")) bad.push("the permission card did not offer the authorized squash grant");
    if (what === "merge-closed") {
      if (card?.answer?.choice !== "close" || grant?.operations || receipts.length) bad.push("closing the card must not persist merge permission or a grant receipt");
    } else {
      const ops = grant?.operations, receipt = receipts[0];
      if (card?.answer?.choice !== "grant-squash" || ops?.version !== 1 || ops.repository !== "fixture/project" || ops.mergeMethod !== "squash" || ops.enableRealWrites !== true || ops.approvalId !== `${task}/${card?.id}` || ops.approvedAt !== card?.answer?.at) bad.push("the approved squash permission is not bound to this repository and card");
      if (receipts.length !== 1 || receipt?.data?.project !== project.id || receipt.data.repository !== "fixture/project" || receipt.data.method !== "squash" || receipt.data.card !== card?.id || receipt.data.answerSeq !== answer?.seq || receipt.data.approvalId !== ops?.approvalId || !/^captain\b/i.test(String(receipt?.actor ?? "")) || (receipt?.seq ?? 0) <= (answer?.seq ?? 0)) bad.push("the grant receipt is not bound to the captain answer and scoped permission");
    }
    return bad;
  }
  if (what === "crew-applied") {
    const bad: string[] = [], team = new CrewStore(s.data).current();
    if (!team) return ["no approved team was persisted"];
    const member = team.members.maker;
    const want = ON_CURSOR ? { provider: "cursor", model: CURSOR_MODEL, effort: null } : { provider: "codex", model: "acceptance-model", effort: "medium" };
    if (member?.provider !== want.provider || member.model !== want.model || (member.effort ?? null) !== want.effort) bad.push("the approved maker assignment was not persisted");
    const card = view.cards?.find((c: any) => c.node === "confirm" && c.status === "answered" && c.answer?.choice === "approve" && c.captainOnly);
    const ledger = new Ledger(s.data, task).authenticatedPrefix();
    if (ledger.bad.length || ledger.malformed) bad.push("the approval evidence does not authenticate");
    const answers = ledger.prefix.filter(e => e.record === "card-answer" && e.data?.card === card?.id && e.data?.choice === "approve");
    const receipts = ledger.prefix.filter(e => e.record === "crew-approved" && e.data?.card === card?.id && e.data?.team === team.hash && e.data?.version === team.version);
    if (!card || !/^captain\b/i.test(String(card.answer?.by ?? "")) || answers.length !== 1 || receipts.length !== 1) bad.push("expected one captain approval and one matching crew-approved receipt");
    if (team.approval.run !== task || team.approval.card !== card?.id || team.approval.answerSeq !== answers[0]?.seq || team.approval.via !== "card") bad.push("the persisted team is not bound to this Task's card approval");
    if (answers[0] && receipts[0] && answers[0].seq >= receipts[0].seq) bad.push("the team receipt precedes its approval");
    return bad;
  }
  if (what === "pdf-chromium") {
    const pdfs = walk(join(run, "exports")).filter((f) => f.endsWith(".pdf"));
    if (!pdfs.length) return ["no PDF was exported"];
    return pdfs.filter((f) => !/\/Creator \(Chromium\)/.test(readFileSync(f).toString("latin1"))).map((f) => `${f.slice(run.length + 1)} was not printed by Chromium (the built-in writer, or no browser)`);
  }
  if (what === "captures") {
    const after = walk(join(run, "captures")).filter((f) => /\/after\/[^/]+\.png$/.test(f));
    if (!after.length) return ["no after-capture PNG in the run folder"];
    return after.filter((f) => pngWidth(f) < 600).map((f) => `${f.slice(run.length + 1)} is not a rendered page (width ${pngWidth(f)})`);
  }
  if (what === "film") {
    const films = [...walk(run), ...walk(join(s.data, "artifacts")).filter((f) => f.includes(lower))].filter((f) => f.endsWith(".mp4") && statSync(f).size > 10_000);
    if (!films.length) return ["no rendered MP4 for this Task"];
    const ffprobe = Bun.which("ffprobe"); if (!ffprobe) return ["ffprobe is not on PATH: the film cannot be checked"];
    const bad: string[] = [];
    for (const f of films) { const r = Bun.spawnSync([ffprobe, "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width", "-of", "json", f], { stdout: "pipe" }); let st: any = null; try { st = JSON.parse(r.stdout.toString()).streams?.[0]; } catch {}
      if (st?.codec_name !== "h264" || !(st.width >= 960)) bad.push(`${f.split("/").slice(-3).join("/")} is not a rendered H.264 film (${JSON.stringify(st)})`); }
    return bad;
  }
  if (what === "web-smoke") {
    const smokes = Object.entries<any>(view?.ctx?.webSmoke ?? {}); if (!smokes.length) return ["no interaction smoke ran (ctx.webSmoke is empty)"];
    const bad: string[] = [];
    for (const [k, v] of smokes) { if (v.status !== "ran") bad.push(`${k}: the smoke did not run (${v.reason ?? v.status})`); for (const a of v.results ?? []) if (!a.found || !a.changed) bad.push(`${k}: "${a.text}" ${!a.found ? "is not on the page" : "changed nothing"}`); }
    return bad;
  }
  if (what === "fail-first") {
    const sums = (view?.events ?? []).map((e: any) => String(e.summary ?? ""));
    const bad: string[] = [];
    if (!sums.some((x: string) => /firstmate\/fail-first: pass/.test(x))) bad.push("no passing fail-first check (the worker's test must fail on the base and pass on the head)");
    if (!sums.some((x: string) => /firstmate\/ci: pass/.test(x)) && !sums.some((x: string) => /^CI · .*: pass/.test(x))) bad.push("CI never passed");
    return bad;
  }
  if (what === "sandbox-probe") {
    const all = probeResults(s, task); if (!all.length) return ["no round ran the sandbox probe (ACCEPT_PROBE in the intent)"];
    const bad = all.flatMap(({ round, r }) => probeProblems(r).map((p) => `${round}: ${p}`));
    if ((o.sinkHits?.() ?? 0) > 0) bad.push(`the harness's sink port took ${o.sinkHits!()} connection(s) from a round`);
    return bad;
  }
  return [`no proof named ${what}`];
}

/** Persistent verifier regression: corrupt only this run's generated fixture, then restore it. */
export async function fileOrgNegativeControls(s: Studio, view: any, o: Parameters<typeof prove>[3]): Promise<string[]> {
  const bad: string[] = [], fixture = o?.fileorg;
  if (!fixture?.plan?.moves?.length || !fixture.root.startsWith(realpathSync(s.root) + "/")) return ["negative controls require this Studio's generated folder fixture"];
  const dest = fixture.plan.moves[0].to, undo = join(s.data, "fileorg", fixture.plan.id, "undo.jsonl");
  const check = async (name: string, mutate: () => void, restore: () => void, expected: RegExp) => {
    try { mutate(); const failures = await prove(s, view, "files-applied", o);
      if (!failures.some(f => expected.test(f))) bad.push(`negative control ${name}: corrupted effects were not rejected`);
    } finally { restore(); }
  };
  const bytes = readFileSync(dest), log = readFileSync(undo), hidden = `${dest}.acceptance-negative`;
  await check("mutated bytes", () => writeFileSync(dest, "corrupted acceptance fixture"), () => writeFileSync(dest, bytes), /applied bytes differ/);
  await check("missing destination", () => renameSync(dest, hidden), () => renameSync(hidden, dest), /applied bytes differ/);
  const hiddenUndo = `${undo}.acceptance-negative`;
  await check("missing undo", () => renameSync(undo, hiddenUndo), () => renameSync(hiddenUndo, undo), /undo (log|evidence)/);
  const rows = log.toString().trim().split("\n").map(l => JSON.parse(l)); rows[0].from += "-wrong";
  await check("mismatched undo", () => writeFileSync(undo, rows.map(r => JSON.stringify(r)).join("\n") + "\n"), () => writeFileSync(undo, log), /undo evidence differs/);
  if ((await prove(s, view, "files-applied", o)).length) bad.push("negative controls did not restore valid effects");
  return bad;
}
