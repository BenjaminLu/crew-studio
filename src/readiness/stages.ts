// Stages 1-3 of the readiness gate, as pure functions over a definition and a small
// environment. Nothing here starts a run, calls a model, reads a login secret or
// triggers a sign-in: the environment answers from state Studio already has.
//   1 intent    numbered intent lines in the captain's words, each served by a node
//   2 contract  every step can actually run: actions, params, skills, provider, sandbox, network, outcomes, external effects
//   3 brief     the exact brief each agent node would receive, rendered by the real round code path
// Later work (single-source param contracts, the failure taxonomy) plugs in through ContractEnv.
import { createHash } from "node:crypto";
import { isAbsolute, resolve, sep } from "node:path";
import { entryOf, terminalsOf, type SkillInfo, type WDef, type WNode } from "../runtime/defs";
import type { RoundSandboxSpec } from "../runtime/round-paths";
import { P, type GateProblem, type RenderedBrief } from "./types";
import { OPERATING_RULES_HEADING, neutralizeMarkers } from "../operating-rules";

export type IntentLine = { n: number; text: string; done: string; assumption?: string };
export type Sample = { text: string; params: Record<string, string> };

const stable = (v: any): string => v && typeof v === "object" ? Array.isArray(v) ? "[" + v.map(stable).join(",") + "]" : "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + stable(v[k])).join(",") + "}" : JSON.stringify(v);
/** What a gate result is bound to: everything that changes how the workflow runs (not its id, version, layout or history). */
export function gateHash(def: WDef): string {
  const { id, version, createdAt, by, note, diff, parent, seed, origin, ...rest } = def as any; void id; void version; void createdAt; void by; void note; void diff; void parent; void seed;
  const nodes = (rest.nodes ?? []).map(({ x, y, ...n }: any) => (void x, void y, n));
  return createHash("sha256").update(stable({ ...rest, nodes, brief: origin?.brief ?? null })).digest("hex");
}

// ---------- stage 1: intent lines ----------
/** A plain end marker (a terminal hook with no action or checks) serves the whole workflow, not one line. */
export const isPlainEnd = (d: WDef, n: WNode) => n.kind === "hook" && !n.do && !n.checks?.length && terminalsOf(d).some((t) => t.id === n.id);
export function intentStage(def: WDef): GateProblem[] {
  const out: GateProblem[] = []; const lines: IntentLine[] = Array.isArray((def as any).intents) ? (def as any).intents : [];
  if (!lines.length) return [P("intent", "intent-missing", null, { en: "The workflow has no intent lines: numbered lines in the captain's own words, each with a \"done means\" line.", zh: "流程沒有意圖條目：用船長自己的話寫成的編號條目，每條附「完成的意思」。" },
    { en: "Add intent lines (the captain's words) with a done-means line each, and name on every node which lines it serves.", zh: "加上意圖條目（船長的原話），每條附「完成的意思」，並在每個節點標明它服務哪幾條。" })];
  const ns = new Set<number>();
  for (const l of lines) { ns.add(l.n);
    if (!String(l.text ?? "").trim() || !String(l.done ?? "").trim()) out.push(P("intent", "intent-incomplete", null, { en: `Intent line ${l.n} needs both the captain's words and a "done means" line.`, zh: `意圖第 ${l.n} 條需要船長的原話和「完成的意思」。` }, { en: `Fill in line ${l.n}'s text and done-means.`, zh: `補上第 ${l.n} 條的內容與「完成的意思」。` })); }
  const served = new Map<number, string[]>();
  for (const n of def.nodes) {
    if (isPlainEnd(def, n)) continue;
    const s: number[] = Array.isArray((n as any).serves) ? (n as any).serves : [];
    if (!s.length) out.push(P("intent", "node-serves-none", n.id, { en: `${n.label} serves no intent line.`, zh: `「${n.label}」沒有服務任何意圖條目。` }, { en: `Name the intent line(s) ${n.label} serves, or remove the node.`, zh: `標明「${n.label}」服務哪幾條意圖，或移除這個節點。` }));
    for (const k of s) { if (!ns.has(k)) out.push(P("intent", "intent-unknown-line", n.id, { en: `${n.label} serves intent line ${k}, which does not exist.`, zh: `「${n.label}」服務的第 ${k} 條意圖不存在。` }, { en: `Use one of lines ${[...ns].join(", ")}.`, zh: `改用第 ${[...ns].join("、")} 條。` })); else served.set(k, [...(served.get(k) ?? []), n.id]); }
  }
  for (const l of lines) if (!served.has(l.n)) out.push(P("intent", "intent-unserved", null, { en: `Intent line ${l.n} ("${l.text}") is served by no node.`, zh: `意圖第 ${l.n} 條（「${l.text}」）沒有任何節點服務。` }, { en: `Add or change a node so it serves line ${l.n}.`, zh: `新增或調整節點，讓它服務第 ${l.n} 條。` }));
  return out;
}
/** Which nodes serve each intent line (the preview's mapping). */
export const intentMap = (def: WDef) => ((def as any).intents ?? []).map((l: IntentLine) => ({ ...l, nodes: def.nodes.filter((n) => ((n as any).serves ?? []).includes(l.n)).map((n) => ({ id: n.id, label: n.label })) }));

// ---------- stage 2: static contract ----------
export type LoginState = "logged-in" | "not-logged-in" | "unknown";
export type ContractEnv = {
  actions: (name: string) => boolean; modes: (name: string) => boolean; cardModes: (name: string) => boolean; cardBodies: (name: string) => boolean;
  /** a check manifest, or null when there is no such check */
  check: (ref: string) => { network?: boolean } | null;
  /** a role skill's text, or null when the reference does not resolve */
  skillText: (ref: string) => string | null; skillInfo?: SkillInfo | null;
  knownProviders: string[]; defaultPick: () => { provider: string; model: string | null };
  /** login state read from what Studio already knows; never a probe that could start a sign-in */
  login: (provider: string) => LoginState;
  /** the folders a sample round of this agent node would get (its mode's sandbox spec) */
  sandbox: (def: WDef, node: WNode) => RoundSandboxSpec | null;
  /** the runtime's own round path rule (src/runtime/round-paths.ts) */
  pathRefusal: (spec: RoundSandboxSpec) => string | null;
  /** where round folders live (<data>/work) and what no node may need */
  roundRoot: string; forbidden: { label: string; path: string }[];
  egressAllow: (def: WDef) => string[];
  /** the Start inputs: what the Run form collects (the gate's sample input) */
  startInputs: Record<string, string>;
  /** the local film renderer (src/render.ts renderEnv): a video workflow cannot verify its MP4 without it */
  render?: () => { canFilm: boolean; missing: string[] };
  /** params a registered action or mode reads (later: the single-source param contracts) */
  reads?: (doName: string) => string[];
};
/** Params known actions read from the Start inputs. Interim registry until workflow params have one source. */
export const ACTION_PARAM_READS: Record<string, string[]> = { "fileorg.plan": ["folder"], "lane.recipe": ["repo", "artifact"] };
/** Outcomes a hook action can produce besides ok. */
export const ACTION_OUTCOMES: Record<string, string[]> = { "deliver.render": ["ok", "unavailable"] };
const CARD_BODY_OUTCOMES: Record<string, string[]> = { fileorg: ["apply", "discard"], lane: ["merge", "close"] };
const CARD_MODE_OUTCOMES: Record<string, string[]> = { "deliver-accept": ["approved", "changes", "rejected"] };
/** Failures route by default: no edge means the run stops failed (engine FAILS). */
const DEFAULT_ROUTED = new Set(["fail", "error", "cap", "cancel", "timeout"]);
/**
 * Deny by default: an action is local only when it is on this list (it stays inside this Mac and Studio's own data
 * and spends nothing). Every other action (repo.prepare / repo.cleanup, fileorg.apply, lane.*, image.generate,
 * coffee image and video jobs, staffing.activate, firstmate.dispatch / launch, anything new) counts as an external,
 * paid or irreversible effect until it is reviewed onto this list. It follows the live-acceptance list
 * (scripts/acceptance/scenarios.ts LOCAL_ACTIONS) minus the paid image job, plus read-only waits.
 */
export const GATE_LOCAL_ACTIONS = new Set([
  "note", "deliver.intake", "deliver.round", "deliver.render", "doc.export", "library.publish",
  "coffee.ready", "coffee.page-needed", "coffee.image-needed", "coffee.video-needed", "coffee.assemble", "coffee.library",
  "fileorg.plan", "fileorg.discard", "intent.capture", "pack-genesis-init",
  "github.review.wait", // reads review state; writes nothing
]);
export const isExternalEffect = (n: WNode) => !!n.do && !GATE_LOCAL_ACTIONS.has(n.do);
/** A captain-only card that names its one-way nature: an acceptance or merge card, a door confirmation, or an explicit one_way flag. */
export const isOneWayCard = (n: WNode) => n.kind === "card" && (!!n.card?.confirm_door || !!n.card?.door_from || ["acceptance", "merge"].includes(String(n.args?.card_kind ?? "")) || n.args?.mode === "deliver-accept" || n.args?.one_way === true);
const HOLDING = /^(reject|rejected|changes|change|revise|close|discard|cancel|cancelled|hold|no|skip|stop|later|park)$/i;
/** The outcomes of a one-way card that mean "yes, go ahead": only edges taken on these are guarded by it. */
export function approvingOutcomes(n: WNode): string[] {
  if (n.args?.mode === "deliver-accept") return ["approved"];
  if (n.args?.body_from === "fileorg") return ["apply"];
  if (n.args?.body_from === "lane") return ["merge"];
  return (n.card?.options ?? []).map((o) => o.id).filter((id) => !HOLDING.test(id));
}
/** The outcomes a node can produce (null: not knowable statically). */
export function outcomesOf(n: WNode): string[] | null {
  if (n.kind === "agent") return ["ok"];
  if (n.kind === "hook") return n.do ? ACTION_OUTCOMES[n.do] ?? ["ok"] : ["ok"];
  if (n.kind === "check") return n.args?.route_from ? null : ["pass", "fail"];
  if (n.kind === "card") {
    if (n.args?.mode) return CARD_MODE_OUTCOMES[n.args.mode] ?? null;
    if (n.args?.body_from) return CARD_BODY_OUTCOMES[n.args.body_from] ?? null;
    return (n.card?.options ?? []).map((o) => o.id);
  }
  return null;
}
const pathArgs = (v: any, key = ""): { key: string; value: string }[] => typeof v === "string" ? ((/^(cwd|dir|path|folder|root|workdir|writes?|reads?)$/i.test(key) || isAbsolute(v) || /(^|\/)data\/runs(\/|$)/.test(v)) ? [{ key, value: v }] : [])
  : Array.isArray(v) ? v.flatMap((x) => pathArgs(x, key)) : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => pathArgs(x, k)) : [];
const inside = (root: string, p: string) => { const a = resolve(root), b = resolve(p); return b === a || b.startsWith(a + sep); };

export function contractStage(def: WDef, env: ContractEnv): GateProblem[] {
  const out: GateProblem[] = [];
  const add = (code: string, node: WNode | null, reason: { en: string; zh: string }, fix: { en: string; zh: string }, o: Parameters<typeof P>[5] = {}) => out.push(P("contract", code, node?.id ?? null, reason, fix, o));
  const declared = def.params ?? {};
  // 1 every do is a registered action; every mode and card mode has a runner
  for (const n of def.nodes) {
    if (n.do && !env.actions(n.do)) add("action-unknown", n, { en: `${n.label}: "${n.do}" is not a registered action.`, zh: `「${n.label}」：「${n.do}」不是已註冊的動作。` }, { en: `Use a registered action or remove "do" from ${n.label}.`, zh: `改用已註冊的動作，或移除「${n.label}」的 do。` });
    if (n.kind === "agent" && n.mode && !env.modes(n.mode)) add("mode-unknown", n, { en: `${n.label}: no agent mode "${n.mode}".`, zh: `「${n.label}」：沒有「${n.mode}」這種代理模式。` }, { en: "Use a mode Studio runs (deliver for drafts).", zh: "改用 Studio 支援的模式（草稿用 deliver）。" });
    if (n.kind === "card" && n.args?.mode && !env.cardModes(n.args.mode)) add("card-mode-unknown", n, { en: `${n.label}: no card mode "${n.args.mode}".`, zh: `「${n.label}」：沒有「${n.args.mode}」這種卡片模式。` }, { en: "Use a plain card with options, or a known card mode.", zh: "改用一般選項卡，或已知的卡片模式。" });
    if (n.kind === "card" && n.args?.body_from && !env.cardBodies(n.args.body_from)) add("card-body-unknown", n, { en: `${n.label}: no card body "${n.args.body_from}".`, zh: `「${n.label}」：沒有「${n.args.body_from}」卡片內容。` }, { en: "Remove body_from or use a registered card body.", zh: "移除 body_from 或改用已註冊的卡片內容。" });
  }
  // 2 every param the steps read is declared (so Run asks for it) and every required one has a Start input
  const reads = new Map<string, string[]>();
  for (const n of def.nodes) {
    const r = [...(n.do ? (env.reads?.(n.do) ?? ACTION_PARAM_READS[n.do] ?? []) : []), ...[...JSON.stringify(n.card ?? {}).matchAll(/\{\{\s*params\.([\w-]+)\s*\}\}/g)].map((m) => m[1])];
    for (const k of r) reads.set(k, [...(reads.get(k) ?? []), n.id]);
  }
  for (const [k, ids] of reads) if (!Object.hasOwn(declared, k)) { const n = def.nodes.find((x) => x.id === ids[0])!; add("param-undeclared", n, { en: `${n.label} reads the Start input "${k}", but the workflow does not declare it, so Run never asks for it.`, zh: `「${n.label}」需要開始輸入「${k}」，但流程沒有宣告，執行時不會詢問。` }, { en: `Declare params.${k} with a label so the Run form asks for it.`, zh: `宣告 params.${k}（附標籤），讓執行表單詢問它。` }); }
  for (const [k, spec] of Object.entries(declared)) if ((spec as any)?.default === undefined && !String(env.startInputs[k] ?? "").trim()) {
    const n = def.nodes.find((x) => (reads.get(k) ?? []).includes(x.id)) ?? null;
    add("param-no-input", n, { en: `The required Start input "${k}" (${(spec as any)?.label ?? k}) has no value in the sample input, so a run would start without it.`, zh: `必填的開始輸入「${k}」（${(spec as any)?.label ?? k}）在樣本輸入中沒有值，執行會在缺少它的情況下開始。` }, { en: `Give "${k}" a default or a sample value; the Run form asks the captain for it.`, zh: `為「${k}」設定預設值或樣本值；執行表單會向船長詢問。` });
  }
  // 3 roles and skills resolve, pins match the library
  for (const n of def.nodes.filter((x) => x.kind === "agent")) {
    const role = def.roles.find((r) => r.id === n.role);
    if (!role) { add("role-missing", n, { en: `${n.label}: no role "${n.role}" in this workflow.`, zh: `「${n.label}」：流程中沒有「${n.role}」角色。` }, { en: "Add the role with a library skill, or pick an existing role.", zh: "新增該角色並指定技能，或改用既有角色。" }); continue; }
    for (const ref of [role.skill, n.skill].filter(Boolean) as string[]) { let t: string | null = null; try { t = env.skillText(ref); } catch { t = null; }
      if (!t || !t.trim()) add("skill-unknown", n, { en: `${n.label}: the skill ${ref} does not resolve to a library skill.`, zh: `「${n.label}」：技能 ${ref} 在技能庫中找不到。` }, { en: "Use a bundled Studio role skill (writer or designer).", zh: "改用 Studio 內建的角色技能（撰稿或設計）。" }); }
    for (const p of (Array.isArray(n.skills) ? n.skills : []) as any[]) { const info = env.skillInfo?.(p.id, Number(p.v));
      if (!info) add("skill-unknown", n, { en: `${n.label}: no skill ${p.id} v${p.v} in the library.`, zh: `「${n.label}」：技能庫沒有 ${p.id} v${p.v}。` }, { en: `Pin a version of ${p.id} that the library has.`, zh: `改釘技能庫中存在的 ${p.id} 版本。` });
      else if (info.sha256 !== p.sha256) add("skill-hash", n, { en: `${n.label}: ${p.id} v${p.v} does not match the stored version's hash.`, zh: `「${n.label}」：${p.id} v${p.v} 的雜湊和技能庫不符。` }, { en: `Re-pin ${p.id} v${p.v} from the library.`, zh: `從技能庫重新釘選 ${p.id} v${p.v}。` }); }
  }
  // 4 provider and model resolve by the engine's pick order (node → role → Start input → Studio default) and the provider is logged in
  const logged = env.knownProviders.filter((p) => env.login(p) === "logged-in");
  for (const n of def.nodes.filter((x) => x.kind === "agent")) {
    const role = def.roles.find((r) => r.id === n.role);
    const pick = n.provider ? { provider: n.provider, model: n.model ?? null } : role?.provider ? { provider: role.provider, model: role.model ?? null } : env.startInputs.provider ? { provider: env.startInputs.provider, model: env.startInputs.model || null } : env.defaultPick();
    if (!env.knownProviders.includes(pick.provider)) { add("provider-unknown", n, { en: `${n.label}: unknown provider "${pick.provider}".`, zh: `「${n.label}」：未知的供應商「${pick.provider}」。` }, { en: `Use one of ${env.knownProviders.join(", ")}.`, zh: `改用 ${env.knownProviders.join("、")} 之一。` }); continue; }
    const own = ["firstmate-draft", "starter"].includes(String(def.origin?.source ?? ""));
    if (!pick.model || own && (!n.provider || !n.model || n.provider === "codex" && !n.effort)) add("staffing-missing", n, { en: `${n.label}: no model${pick.provider === "codex" ? " or effort" : ""} chosen yet; the captain confirms staffing at Run.`, zh: `「${n.label}」：尚未選擇模型${pick.provider === "codex" ? "或推理強度" : ""}；船長在執行時確認配置。` }, { en: "The captain picks the model when clicking Run.", zh: "船長按下執行時選擇模型。" }, { owner: "captain", need: "staffing", level: "notice",
      note: { en: `When you click Run, you choose who works on “${n.label}”.`, zh: `按下執行時，由你選擇「${n.label}」由誰負責。` } });
    const st = env.login(pick.provider);
    if (st === "not-logged-in") { const other = logged.find((p) => p !== pick.provider);
      add("provider-not-logged-in", n, { en: `${n.label}: ${pick.provider} is not logged in on this Mac.`, zh: `「${n.label}」：這台 Mac 上的 ${pick.provider} 尚未登入。` },
        other ? { en: `Switch ${n.label} to ${other} (logged in), or the captain signs in to ${pick.provider}.`, zh: `把「${n.label}」改用已登入的 ${other}，或由船長登入 ${pick.provider}。` } : { en: `The captain signs in to ${pick.provider} in Settings; Studio never starts a sign-in by itself.`, zh: `請船長在設定中登入 ${pick.provider}；Studio 不會自行啟動登入。` },
        other ? {} : { owner: "captain", need: "sign-in", note: { en: `Sign in to ${pick.provider} in Settings so “${n.label}” can run. Studio never signs in for you.`, zh: `請在設定中登入 ${pick.provider}，「${n.label}」才能執行。Studio 不會替你登入。` } }); }
  }
  // 5 the sandbox: every round writes only inside its own round folder; no node needs data/runs, the repo root or Studio data
  for (const n of def.nodes) {
    const specs: RoundSandboxSpec[] = []; if (n.kind === "agent") { try { const s = env.sandbox(def, n); if (s) specs.push(s); } catch (e: any) { add("sandbox-path", n, { en: `${n.label}: its round folder cannot be prepared: ${e?.message ?? e}`, zh: `「${n.label}」：無法準備回合資料夾：${e?.message ?? e}` }, { en: "Use a mode that opens in its own round folder.", zh: "改用在自己回合資料夾中執行的模式。" }); } }
    for (const s of specs) {
      const bad = env.pathRefusal(s) ?? [...s.writes, ...(s.cwd ? [s.cwd] : [])].find((p) => !inside(env.roundRoot, p)) ?? null;
      if (bad) add("sandbox-path", n, { en: `${n.label}: its round would open at ${bad}, outside its own round folder (the agent path check refuses it).`, zh: `「${n.label}」：回合會在 ${bad} 開啟，超出它自己的回合資料夾（代理路徑檢查會拒絕）。` }, { en: `Let ${n.label} work only in its round folder under ${env.roundRoot}.`, zh: `讓「${n.label}」只在 ${env.roundRoot} 下的回合資料夾中工作。` });
    }
    for (const a of pathArgs(n.args ?? {})) {
      if (inside(env.roundRoot, resolve(env.roundRoot, a.value)) && !/(^|\/)data\/runs(\/|$)/.test(a.value)) continue;
      const hit = env.forbidden.find((f) => inside(f.path, resolve(env.roundRoot, a.value)) || /(^|\/)data\/runs(\/|$)/.test(a.value) && f.label === "Studio runs");
      const outside = isAbsolute(a.value) && !inside(env.roundRoot, a.value);
      if (hit || outside) add("sandbox-path", n, { en: `${n.label}: args.${a.key} points at ${a.value}${hit ? ` (${hit.label})` : ""}, outside the round folder.`, zh: `「${n.label}」：args.${a.key} 指向 ${a.value}${hit ? `（${hit.label}）` : ""}，超出回合資料夾。` }, { en: "Remove the path; a round works only in the folder Studio makes for it.", zh: "移除該路徑；回合只在 Studio 為它建立的資料夾中工作。" });
    }
  }
  // 6 network: a node that needs it declares the hosts, and the egress policy allows them
  const allow = env.egressAllow(def);
  for (const n of def.nodes) {
    const declaredHosts: string[] = Array.isArray(n.args?.network) ? n.args!.network.map(String) : [];
    const needs = (n.checks ?? []).some((c) => env.check(c.use)?.network) || declaredHosts.length > 0 || n.args?.network === true;
    if (needs && !declaredHosts.length) add("network-undeclared", n, { en: `${n.label} needs network access but does not declare which hosts.`, zh: `「${n.label}」需要網路，但沒有宣告要連哪些主機。` }, { en: `List the hosts in ${n.label}'s args.network.`, zh: `在「${n.label}」的 args.network 列出主機。` });
    const denied = declaredHosts.filter((h) => !allow.includes(h));
    if (denied.length) add("network-not-allowed", n, { en: `${n.label} needs ${denied.join(", ")}, which the egress policy does not allow.`, zh: `「${n.label}」需要連到 ${denied.join("、")}，但對外連線政策不允許。` }, { en: `The captain grants ${denied.join(", ")} in policy egress.allow, or the node works offline.`, zh: `請船長在 egress.allow 政策中允許 ${denied.join("、")}，或讓節點離線工作。` }, { owner: "captain", need: "egress", note: { en: `Allow ${denied.join(", ")} in the network policy so “${n.label}” can reach it.`, zh: `請在網路政策中允許 ${denied.join("、")}，「${n.label}」才能連線。` } });
  }
  // 7 every outcome a node can produce has an edge (or the default: a failure stops the run)
  const terms = new Set(terminalsOf(def).map((n) => n.id));
  for (const n of def.nodes) {
    if (terms.has(n.id)) continue;
    const outs = def.edges.filter((e) => e.from === n.id); const plain = outs.some((e) => !e.when);
    const unhandled = (outcomesOf(n) ?? []).filter((o) => !outs.some((e) => e.when?.split("|").includes(o)) && !(plain && !DEFAULT_ROUTED.has(o)) && !DEFAULT_ROUTED.has(o));
    if (unhandled.length) add("outcome-unhandled", n, { en: `${n.label} can end with ${unhandled.map((o) => `"${o}"`).join(", ")}, and no edge takes ${unhandled.length > 1 ? "them" : "it"}: the run would stop there.`, zh: `「${n.label}」可能以 ${unhandled.map((o) => `「${o}」`).join("、")} 結束，但沒有連線承接，任務會停在那裡。` }, { en: `Add an edge from ${n.label} for ${unhandled.join(", ")} (or one plain edge).`, zh: `為「${n.label}」的 ${unhandled.join("、")} 加上連線（或一條不帶條件的連線）。` });
  }
  // 8 an external effect is preceded by a one-way captain card on every path: only that card's approving
  //   edges are guarded; its other edges (changes, rejected, a plain edge any answer takes) are not
  const entry = entryOf(def);
  if (entry) {
    const seen = new Set<string>(); const q = [entry.id];
    while (q.length) { const id = q.shift()!; if (seen.has(id)) continue; seen.add(id); const n = def.nodes.find((x) => x.id === id); if (!n) continue;
      const ok = isOneWayCard(n) ? approvingOutcomes(n) : [];
      for (const e of def.edges) if (e.from === id && !(e.when && e.when.split("|").every((w) => ok.includes(w)))) q.push(e.to); }
    for (const n of def.nodes) if (isExternalEffect(n) && seen.has(n.id)) add("external-unguarded", n, { en: `${n.label} (${n.do}) changes something outside Studio, and a path reaches it without a one-way captain card first.`, zh: `「${n.label}」（${n.do}）會改動 Studio 以外的東西，但有路徑不經過船長的單向確認卡就能到達。` }, { en: `Put a captain-only one-way card (card_kind acceptance or merge) before ${n.label} on every path.`, zh: `在每條通往「${n.label}」的路徑上，先放一張只限船長的單向確認卡（acceptance 或 merge）。` });
  }
  // 9 a video workflow renders its film: the render environment is checked here, not discovered at the render step
  const films = def.nodes.filter((n) => n.do === "deliver.render" || (n.kind === "agent" && n.mode === "deliver" && n.args?.format === "video"));
  const r = films.length ? env.render?.() : null;
  if (r && !r.canFilm) { const n = films.find((x) => x.do === "deliver.render") ?? films[0];
    add("renderer-missing", n, { en: `${n.label}: the local film renderer is missing (${r.missing.join(", ")}), so no MP4 can be rendered or checked.`, zh: `「${n.label}」：缺少本機影片轉檔工具（${r.missing.join("、")}），無法轉出或檢查 MP4。` },
      { en: "Install the missing renderer parts from Doctor, then run the gate again.", zh: "在 Doctor 安裝缺少的轉檔元件後，再跑一次檢查。" },
      { owner: "captain", need: "install", note: { en: `Install ${r.missing.join(", ")} from Doctor so the video workflow can render and check its MP4.`, zh: `請在 Doctor 安裝 ${r.missing.join("、")}，影片流程才能轉出並檢查 MP4。` } }); }
  return out;
}

// ---------- stage 3: briefs ----------
// Only the in-process renderer can establish source provenance. The displayed
// brief stays byte-identical to the real job. JSON metadata or a copied notice
// cannot exempt text, and mutation of the rendered system invalidates the proof.
const briefSources=new WeakMap<RenderedBrief,{system:string;source:string}>();
export function sourceBoundBrief<T extends RenderedBrief>(brief:T,source:string):T {
  briefSources.set(brief,{system:brief.system,source});return brief;
}
export const SAFETY_HEAD = "# Studio safety rules";
const ABS_PATH = /(?<![\w:/.~-])(\/(?:[A-Za-z0-9._@-]+\/)*[A-Za-z0-9._@-]+)/g;
export function briefStage(def: WDef, briefs: (RenderedBrief & { roleText?: string; skills?: { id: string; body: string }[]; rules?: string; error?: string | null })[], sample: Sample): GateProblem[] {
  const out: GateProblem[] = [];
  const add = (code: string, b: { node: string }, en: string, zh: string, fen: string, fzh: string) => out.push(P("brief", code, b.node, { en, zh }, { en: fen, zh: fzh }));
  for (const n of def.nodes.filter((x) => x.kind === "agent")) {
    const b = briefs.find((x) => x.node === n.id);
    if (!b || b.error) { add("brief-render", { node: n.id }, `${n.label}: its brief could not be rendered: ${b?.error ?? "no brief"}`, `「${n.label}」：無法產生簡報：${b?.error ?? "沒有簡報"}`, "Fix the node's role, mode and skill so a round can build its brief.", "修正節點的角色、模式與技能，讓回合能產生簡報。"); continue; }
    const all = `${b.system}\n${b.prompt}`;
    if (!b.prompt.trim() || !b.system.trim()) add("brief-empty", b, `${n.label}: the brief is empty.`, `「${n.label}」：簡報是空的。`, "Give the node a role with a skill and an input to work on.", "為節點指定有技能的角色與要處理的輸入。");
    // the operating rules block a real round gets (jobInstructions): Studio's safety rules, then the captain's operating rules section
    if (!b.system.startsWith(SAFETY_HEAD) || !b.rules || !b.system.includes(b.rules) || !b.system.includes(OPERATING_RULES_HEADING)) add("brief-no-rules", b, `${n.label}: the brief has no operating rules block.`, `「${n.label}」：簡報缺少操作規則區塊。`, "Build the brief through the round code path (the safety rules come first).", "透過回合程式路徑產生簡報（安全規則在最前面）。");
    if (!b.roleText?.trim() || !b.system.includes(neutralizeMarkers(b.roleText.trim()))) add("brief-no-role", b, `${n.label}: the brief does not carry the role's text.`, `「${n.label}」：簡報沒有包含角色內容。`, "Give the role a library skill with text.", "為角色指定有內容的技能。");
    for (const s of b.skills ?? []) if (!b.system.includes(s.body.trim())) add("brief-no-skill", b, `${n.label}: the enabled skill ${s.id} is not in the brief.`, `「${n.label}」：簡報中沒有已啟用的技能 ${s.id}。`, `Re-pin ${s.id} from the library.`, `從技能庫重新釘選 ${s.id}。`);
    const inputs = [sample.text.trim(), ...(((def as any).intents ?? []) as IntentLine[]).filter((l) => ((n as any).serves ?? []).includes(l.n)).map((l) => l.text.trim())].filter(Boolean);
    const missing = inputs.filter((t) => !b.prompt.includes(t));
    if (missing.length) add("brief-no-input", b, `${n.label}: the brief is missing its inputs: ${missing.map((t) => `"${t.slice(0, 60)}"`).join(", ")}.`, `「${n.label}」：簡報缺少輸入：${missing.map((t) => `「${t.slice(0, 60)}」`).join("、")}。`, "The brief must carry the Task input and the intent lines this node serves.", "簡報必須帶有任務輸入與此節點服務的意圖條目。");
    const bound=briefSources.get(b);
    const pathText=bound?.system===b.system?`${bound.source}\n${b.prompt}`:all;
    const paths = [...pathText.matchAll(ABS_PATH)].map((m) => m[1]).filter((p) => !inside(b.roundDir, p));
    const rel = /(^|[\s"'`(])data\/runs\//.test(pathText) ? ["data/runs/"] : [];
    const bad = [...new Set([...paths, ...rel])];
    if (bad.length) add("brief-path", b, `${n.label}: the brief points outside the round folder: ${bad.slice(0, 4).join(", ")}.`, `「${n.label}」：簡報指向回合資料夾以外的路徑：${bad.slice(0, 4).join("、")}。`, "Refer only to files in the round folder; remove other paths from the role, skills and input.", "只引用回合資料夾內的檔案；從角色、技能與輸入中移除其他路徑。");
  }
  return out;
}
