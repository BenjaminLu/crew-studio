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
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { Studio } from "./studio";
import { CrewStore } from "../../src/domain/crew";
import { Ledger } from "../../src/runtime/checks";
import { verifyGitHubGrant } from "../../src/github-grant";

export const PROVES = ["pdf-chromium", "captures", "film", "web-smoke", "fail-first", "sandbox-probe", "crew-applied", "merge-granted", "merge-closed"];
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
  if (!r.ownLogin) bad.push("the round could not read its own login");
  if (r.ownLoginRefresh) bad.push("the round's login copy carries a refresh token");
  if (r.otherCredentials?.length) bad.push(`the round's env carries other credentials: ${r.otherCredentials.join(", ")}`);
  for (const [p, v] of Object.entries(r.denied ?? {})) if (v) bad.push(`the round could read ${p}`);
  if (!r.tmpWritable) bad.push("the round could not write its own TMPDIR");
  for (const [p, v] of Object.entries(r.nowrite ?? {})) if (v) bad.push(`the round could write into ${p}`);
  return bad;
}

export async function prove(s: Studio, view: any, what: string, o: { sinkHits?: () => number; github?: { origin: string; calls: { method: string; path: string }[] } } = {}): Promise<string[]> {
  const task = String(view?.id ?? ""), run = join(s.data, "runs", task), lower = task.toLowerCase();
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
    if (member?.provider !== "codex" || member.model !== "acceptance-model" || member.effort !== "medium") bad.push("the approved maker assignment was not persisted");
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
