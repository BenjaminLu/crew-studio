// Takeover: Studio as the captain's single entry point to the firstmate session.
//   GET  /api/takeover                the firstmate sessions, who drives, the handoff notes, the cutover steps
//   POST /api/main/takeover {host, id, mode} fork the session and drive the copy; mode "takeover" | "rehearsal";
//                                     claude: --fork-session; codex: thread/fork, else a new thread seeded from a handoff
//   POST /api/main/start {host: "codex", confirm}  start a fresh firstmate on Codex in the firstmate repo, the newest state/HANDOFF-*.md first
//   POST /api/main/start {host: "claude", confirm} Studio's own workspace only: a fresh Firstmate on Claude; a typed refusal
//                                     (claudeNotSignedIn, claudeQuotaExhausted, claudeCrewTokenMissing, ...) never falls back to Codex
//   POST /api/main/question {id, answers}  answer a question the session asked (AskUserQuestion) through the permission bridge
//   POST /api/main/dispatch {text}    the captain's intent, sent to firstmate to draft a spec and raise the dispatch card
//   GET  /api/crew/live               every worker and reviewer round: task, title, role, vendor/model, round, phase, elapsed, activity, PR, CI, report
//   GET  /api/crew/report/<actor>     a finished round's final report
//   POST /api/answer/check-door       the board's one-way door check, before a one-way merge answer
// Nothing here writes firstmate state: forks run firstmate's own CLI and hooks, answers go through the board.
import type { Board } from "./board";
import { crewReport, type Actor, type Card, type FmState, type Task } from "./fm";
import type { GitHub } from "./github";
import { codexConfig } from "./host/codex";
import { newestHandoffFile, type MainSession } from "./host/main";
import { redactText } from "./secure";

type Who = { kind: string; device?: { name: string } };
type Deps = { claudePreflight?: () => Promise<{ ready: import("./host/claude-primary").ClaudePrimaryReady; status: unknown }>; claudePair?: () => { model: string; effort: string | null }; claudePrimary?: () => Promise<import("./host/claude-primary").ClaudePrimaryReady>; codexAccount?:Pick<import("./host/codex-account").CodexAccount,"view"|"ensureReady"|"blocking">; main: MainSession; fm: FmState; gh: GitHub; board: Board; stateDir: string; pending: () => Card[]; tasks: () => Task[]; crew: () => Actor[] };

export const DISPATCH_PREFIX = "Captain's intent for new work, sent from Crew Studio:";
export const dispatchText = (intent: string) => `${DISPATCH_PREFIX}\n\n${intent}\n\n` +
  "Draft the spec and raise the dispatch card through firstmate's normal scripts, so the card reaches the captain's inbox. " +
  "Do not dispatch before the captain answers that card. Reply with the card id when it is raised.";

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function createTakeover(d: Deps) {
  /** Studio's own copies, from the handoff notes, so they are never offered as "the firstmate session". */
  const copies = () => {
    const out = new Set<string>();
    for (const h of d.main.handoffs()) for (const m of h.text.matchAll(/The copy Studio drives is ([\w-]+)/g)) out.add(m[1]);
    const drv = d.main.driver(); if (drv.forkedFrom && drv.sessionId && drv.sessionId !== drv.forkedFrom) out.add(drv.sessionId);
    return out;
  };

  function crewLive() {
    const tasks = new Map(d.tasks().map((t) => [t.id, t]));
    const prs = new Map(d.gh.state.prs.map((p) => [p.number, p]));
    const merged = new Map(d.gh.merged.map((p) => [p.number, p]));
    return d.crew().map((c) => {
      const t = c.task ? tasks.get(c.task) : undefined;
      const pr = t?.pr ?? null;
      const open = pr ? prs.get(pr) : undefined, done = pr ? merged.get(pr) : undefined;
      const ci = open ? { pass: open.checks.filter((x) => x.bucket === "pass").length, fail: open.checks.filter((x) => x.bucket === "fail").length,
        pending: open.checks.filter((x) => x.bucket === "pending").length, state: open.mergeState }
        : done ? { pass: done.checks.pass, fail: done.checks.fail, pending: 0, state: "merged" } : null;
      const end = c.alive ? Date.now() : Date.parse(c.result?.at ?? c.lastWrite ?? "") || Date.now();
      const start = Date.parse(c.started ?? "") || end;
      const phase = c.alive ? (c.role === "reviewer" ? "reviewing" : "building") : c.result ? (c.result.status === "completed" && !c.result.exitCode ? "finished" : `ended: ${c.result.status}`) : "stopped";
      const last = c.lines.at(-1)?.text ?? null;
      return { actor: c.actor, name: c.name, role: c.role, task: c.task, title: c.task ? d.fm.title(c.task) : "", vendor: c.vendor, model: c.model,
        round: c.round, attempt: c.attempt, alive: c.alive, phase, taskPhase: t?.node ?? null, taskStatus: t?.status ?? null,
        started: c.started, elapsedMs: Math.max(0, end - start), lastWrite: c.lastWrite,
        activity: c.activity?.en && !/^Work description unavailable/.test(c.activity.en) ? c.activity : last ? { en: last, "zh-TW": last } : null,
        pr, merged: t?.mergedTs ?? null, ci, report: c.report, result: c.result, lines: c.alive ? c.lines.slice(-5) : [] };
    });
  }

  async function handle(req: Request, url: URL, who: Who, writing: boolean): Promise<Response | null> {
    const p = url.pathname;
    if (p === "/api/takeover" && !writing) {
      const own = copies();
      let sessions: any[] = [];let discoveryUnavailable=false;
      try { if(url.searchParams.get("independent")!=="1")sessions = (await d.main.discoverAll()).slice(0, 20).map((s) => ({ ...s, studioCopy: own.has(s.id) })); } catch { discoveryUnavailable=true; }
      const firstmate = sessions.find((s) => !s.studioCopy) ?? null;
      const project = d.main.view().project, newest = d.main.view().context === "studio" ? null : newestHandoffFile(d.stateDir);
      return json({ project, firstmate, sessions, discoveryUnavailable, view: d.main.view(), handoffs: d.main.handoffs(), board: d.board.status(),
        codex: { account:d.codexAccount?.view()??null, config: codexConfig(project), handoffFile: newest ? `state/${newest.name}` : null },
        claude: d.claudePair?.() ?? null });
    }
    if (p.startsWith("/api/crew/report/") && !writing) {
      const actor = decodeURIComponent(p.slice("/api/crew/report/".length));
      const text = crewReport(d.stateDir, actor);
      return text == null ? json({ error: "no final report for that round" }, 404) : json({ actor, text: redactText(text) });
    }
    if (p === "/api/crew/live" && !writing) return json(crewLive());
    // may a fresh Claude Firstmate start now? No config folder, no keychain decrypt, no model call (the sign-in status read runs
    // `claude auth status` in its own temporary folder). It also returns that status read, so the page reads it once.
    // Presence only: a crew item that exists but is empty or malformed passes here; Start and Switch decide with the full read.
    if (p === "/api/main/start/claude-ready" && !writing) {
      if (!d.claudePreflight) return json({ ok: false, code: "claudeUnavailable", reason: "Claude is not available to Studio / Studio 無法使用 Claude" });
      const { ready: r, status } = await d.claudePreflight();
      return json({ ...(r.ok ? { ok: true, model: r.model, effort: r.effort, permissionMode: r.permissionMode, autoMode: r.autoMode } : r), status });
    }
    if (!writing) return null;
    let b: any = {};
    if (["/api/main/takeover", "/api/main/start", "/api/main/switch", "/api/main/question", "/api/main/dispatch", "/api/answer/check-door", "/api/main/locale"].includes(p)) { try { b = await req.json(); } catch {} }
    if(['/api/main/start','/api/main/switch','/api/main/locale'].includes(p)&&b?.locale!==undefined&&!['en','zh-TW','zh-CN'].includes(b.locale))return json({error:'Unsupported dashboard language',code:'locale'},400);
    // the Board's language, as the captain shows it now: Firstmate's first message (a Start, a switch, a restart) greets in it
    // A Board report counts as on screen, or as the captain's own choice, only when it says so: a page from before these fields
    // (an open tab still on the previous release's JS) is a background tab with a browser default. A Start or a switch is the
    // captain acting on a Board they look at. Each report is logged, so a live check can tell which tab said what
    if(['/api/main/start','/api/main/switch','/api/main/locale'].includes(p)&&b?.locale!==undefined){
      const said={visible:p==='/api/main/locale'?b.visible===true:true,explicit:p==='/api/main/locale'?b.explicit===true:true,tab:typeof b.tab==='string'&&/^[A-Za-z0-9-]{1,32}$/.test(b.tab)?b.tab:null};
      console.log(`crew-studio: board language ${b.locale} visible=${said.visible} explicit=${said.explicit} tab=${said.tab??'-'} via=${p.slice(10)} at=${new Date().toISOString()}`);
      d.main.setBoardLocale?.(b.locale,said);
    }
    if(p==='/api/main/locale')return b?.locale===undefined?json({error:'Say the dashboard language',code:'locale'},400):json({ok:true,locale:b.locale});
    const boardLocale=():"en"|"zh-TW"|"zh-CN"=>b?.locale??d.main.boardLocale?.()??"en";
    // The boot restart holds the account check and may be starting the primary: the captain's Start or switch waits for it,
    // then sees the outcome (already running, or still stopped) instead of a misleading account refusal
    if (["/api/main/start", "/api/main/switch"].includes(p) && booting) await booting.catch(() => {});
    if (p === "/api/main/takeover") {
      if(d.codexAccount?.blocking)return json({error:"Complete or cancel Codex account action first / 請先完成或取消 Codex 帳號操作"},409);
      const mode = b?.mode === "rehearsal" ? "rehearsal" : "takeover";
      if (b?.confirm !== true) return json({ error: "confirm first: the terminal session must stay idle while Studio drives", code: "confirm" }, 400);
      const r = await d.main.takeover(b?.host === "codex" ? "codex" : "claude", String(b?.id ?? ""), mode);
      return json(r, r.ok ? 200 : 409);
    }
    // Switch Studio's own Codex Firstmate to Claude, atomically for the captain: the full Claude readiness (which reads the
    // crew token itself, as a start does) runs first; only when it passes is Codex stopped and Claude started with that login.
    // Any refusal leaves Codex attached and returns the typed reason.
    if (p === "/api/main/switch") {
      if (b?.to !== "claude") return json({ error: "Studio switches a Codex Firstmate to Claude only", code: "host" }, 400);
      if (b?.confirm !== true) return json({ error: "confirm first: Studio stops the running Firstmate", code: "confirm" }, 400);
      const v = d.main.view();
      if (v.context !== "studio" || v.origin || v.drive?.path !== "fresh" || !["attached", "paused"].includes(v.state) || v.host !== "codex")
        return json({ error: "No Studio-owned Codex Firstmate is running to switch / 沒有可切換的 Studio Codex Firstmate", code: "notRunning" }, 409);
      if (!d.claudePrimary) return json({ ok: false, code: "claudeUnavailable", reason: "Claude is not available to Studio / Studio 無法使用 Claude" }, 409);
      const ready = await d.claudePrimary();
      if (!ready.ok) return json({ ...ready, kept: "codex" }, 409);
      const now = d.main.view();
      if (now.host !== "codex" || !["attached", "paused"].includes(now.state)) return json({ error: "The Firstmate changed while Claude was checked; review it first / 檢查 Claude 期間 Firstmate 已變更，請先確認", code: "changed" }, 409);
      await d.main.detach();
      const r = await d.main.startFresh("claude", undefined, { locale:boardLocale(), env: ready.env, model: ready.model, effort: ready.effort, permissionMode: ready.permissionMode, autoMode: ready.autoMode });
      return json(r, r.ok ? 200 : 409);
    }
    if (p === "/api/main/start" && b?.host === "claude") {
      if (b?.confirm !== true) return json({ error: "confirm first: no other firstmate may run on the same state", code: "confirm" }, 400);
      if (d.main.view().context !== "studio") return json({ error: "Claude starts a fresh Firstmate only in Studio's own workspace / Claude 只能在 Studio 自己的工作空間開新的 Firstmate", code: "host" }, 400);
      if (d.main.view().state !== "detached") return json({ error: "Studio already owns firstmate; release it first / Studio 已在操作 firstmate，請先交還" }, 409);
      if (!d.claudePrimary) return json({ ok: false, code: "claudeUnavailable", reason: "Claude is not available to Studio / Studio 無法使用 Claude" }, 409);
      const ready = await d.claudePrimary();
      if (!ready.ok) return json(ready, 409);
      const r = await d.main.startFresh("claude", undefined, { locale:boardLocale(), env: ready.env, model: ready.model, effort: ready.effort, permissionMode: ready.permissionMode, autoMode: ready.autoMode });
      return json(r, r.ok ? 200 : 409);
    }
    if (p === "/api/main/start") {
      if (b?.host !== "codex") return json({ error: "a fresh start runs on Codex or Claude", code: "host" }, 400);
      if (b?.confirm !== true) return json({ error: "confirm first: no other firstmate may run on the same state", code: "confirm" }, 400);
      if(d.main.view().state!=="detached")return json({error:"Studio already owns firstmate; release it first / Studio 已在操作 firstmate，請先交還"},409);
      if(!d.codexAccount)return json({error:"Codex account verification unavailable / 無法驗證 Codex 帳號"},409);
      let verified:Awaited<ReturnType<NonNullable<Deps["codexAccount"]>["ensureReady"]>>;
      try{verified=await d.codexAccount.ensureReady();}catch{return json({error:"Connect Codex and verify the vendor-configured model/quota before starting / 請先連接 Codex 並驗證廠商設定的模型與配額"},409);}
      const r = await d.main.startFresh("codex",opened=>{
        const current=codexConfig(d.main.view().project), expected=verified.configuration??verified;
        if(verified.state!=="ready"||!verified.authenticated||verified.quota!=="available"||!verified.expires||verified.expires<=Date.now()||typeof verified.model!=="string"||!verified.model||typeof verified.effort!=="string"||!verified.effort||current.model!==expected.model||current.effort!==expected.effort||opened.model!==verified.model||opened.effort!==verified.effort)throw new Error(`Codex startup identity mismatch: expected ${verified.model}/${verified.effort}, received ${opened.model}/${opened.effort??"unknown"}. Refresh readiness before retrying. / Codex 啟動身分不符：預期 ${verified.model}/${verified.effort}，收到 ${opened.model}/${opened.effort??"未提供"}；請重新檢查可用性。`);
        return true;
      },{locale:boardLocale(),...(verified.configuration?.effort===null?{codexDefaultEffort:verified.effort!}:{})});
      return json(r, r.ok ? 200 : 409);
    }
    if (p === "/api/main/question") {
      const pend = d.main.bridge.pending().find((x) => x.id === b?.id);
      if (!pend || pend.tool !== "AskUserQuestion") return json({ error: "no such question waiting" }, 404);
      const answers: Record<string, string> = {};
      for (const [k, v] of Object.entries(b?.answers ?? {})) if (typeof v === "string" && v.trim()) answers[String(k)] = v.trim().slice(0, 2000);
      if (!Object.keys(answers).length) return json({ error: "answer at least one question" }, 400);
      const input = pend.input && typeof pend.input === "object" ? pend.input as Record<string, unknown> : {};
      return d.main.bridge.answer(pend.id, true, undefined, { ...input, answers }) ? json({ ok: true }) : json({ error: "no such question waiting" }, 404);
    }
    if (p === "/api/main/dispatch") {
      const text = String(b?.text ?? "").trim().slice(0, 6000);
      if (!text) return json({ error: "say what you want done" }, 400);
      if (d.main.view().state === "detached") return json({ error: "take over the firstmate session first", code: "detached" }, 409);
      return json({ queued: d.main.enqueue("chat", (d.main.view().context === "studio" ? `Captain requests new work in Studio: ${text}\nUse studio_list_workflows and studio_propose_work to raise a native captain dispatch card. Do not execute work or use legacy firstmate scripts before the captain approves.` : dispatchText(text)), who.kind === "phone" ? `phone:${who.device?.name ?? "?"}` : "desktop") });
    }
    if (p === "/api/answer/check-door") {
      const card = d.pending().find((c) => c.id === b?.id);
      if (!card) return json({ error: "no such pending card", code: "notPending" }, 404);
      const door = doorInput(b);
      if (!door || !doorComplete(card, door)) return json({ error: "review every intent and answer the check", code: "doorUnconfirmed" }, 400);
      const r = await d.board.checkDoor({ id: card.id, ...door });
      return json(r.body, r.status);
    }
    return null;
  }
  // the boot restart while it runs (resumeOnBoot): Start and switch wait for it
  let booting: Promise<unknown> | null = null;
  /** Boot after a restart (a live release): Studio's own primary was running, so start it again with the same host, model and
   *  permission mode. Only an account that is already signed in qualifies (the readiness reads never sign in); anything that
   *  differs or fails leaves Firstmate stopped with a notice saying why and that Start is the way on. */
  function resumeOnBoot(): Promise<{ resumed: boolean; reason?: string }> {
    const run = resumeBootPrimary(); booting = run; void run.finally(() => { if (booting === run) booting = null; }).catch(() => {});
    return run;
  }
  // how long a restart's greeting waits for an open Board to say its language when Studio never heard one
  const greetingLocale = () => d.main.greetingLocale(Number(process.env.CREW_BOARD_LOCALE_WAIT_MS) || 10000);
  async function resumeBootPrimary(): Promise<{ resumed: boolean; reason?: string }> {
    const p = d.main.takeBootPrimary(); if (!p) return { resumed: false };
    const v = d.main.view();
    const stay = (en: string, zh: string) => { d.main.note({ kind: "status", text: `${en} / ${zh}`, i18n: { en, "zh-TW": zh } }); return { resumed: false, reason: en }; };
    if (v.context !== "studio" || v.state !== "detached") return { resumed: false };
    const vendor = p.host === "claude" ? "Claude" : "Codex";
    try {
      if (p.host === "claude") {
        if (!d.claudePrimary) return stay("Firstmate was running on Claude before Studio restarted, but Claude is not available now. Press Start to begin again.", "Studio 重啟前 Firstmate 在 Claude 上執行，但現在無法使用 Claude。請按 Start 重新開始。");
        const ready = await d.claudePrimary();
        if (!ready.ok) return stay(`Firstmate was running on Claude before Studio restarted and was not restarted: ${ready.en} Press Start once that is fixed.`, `Studio 重啟前 Firstmate 在 Claude 上執行，這次沒有自動重開：${ready.zh}處理好後請按 Start。`);
        if (ready.model !== p.model || ready.permissionMode !== p.permissionMode)
          return stay(`Firstmate was running on Claude ${p.model ?? "(default)"} (${p.permissionMode ?? "default"} mode) before Studio restarted; the configuration is now ${ready.model} (${ready.permissionMode} mode), so it was not restarted. Press Start to begin with the new configuration.`,
            `Studio 重啟前 Firstmate 在 Claude ${p.model ?? "（預設）"}（${p.permissionMode ?? "default"} 模式）上執行；設定已改成 ${ready.model}（${ready.permissionMode} 模式），所以沒有自動重開。請按 Start 用新設定開始。`);
        const locale = await greetingLocale();
        if (d.main.view().state !== "detached") return { resumed: false };
        const r = await d.main.startFresh("claude", undefined, { locale, env: ready.env, model: ready.model, effort: ready.effort, permissionMode: ready.permissionMode, autoMode: ready.autoMode });
        if (!r.ok) return stay(`Firstmate could not be restarted on Claude after Studio restarted: ${r.reason}. Press Start to try again.`, `Studio 重啟後無法在 Claude 上重開 Firstmate：${r.reason}。請按 Start 再試一次。`);
      } else {
        if (!d.codexAccount) return stay("Firstmate was running on Codex before Studio restarted, but the Codex account cannot be verified now. Press Start to begin again.", "Studio 重啟前 Firstmate 在 Codex 上執行，但現在無法驗證 Codex 帳號。請按 Start 重新開始。");
        let verified: any;
        try { verified = await d.codexAccount.ensureReady(); } catch (e: any) { return stay(`Firstmate was running on Codex before Studio restarted and was not restarted: ${String(e?.message ?? e).slice(0, 200)}. Press Start once that is fixed.`, `Studio 重啟前 Firstmate 在 Codex 上執行，這次沒有自動重開。處理好後請按 Start。`); }
        if (verified.model !== p.model) return stay(`Firstmate was running on Codex ${p.model ?? "(default)"} before Studio restarted; the configuration is now ${verified.model}, so it was not restarted. Press Start to begin with the new configuration.`, `Studio 重啟前 Firstmate 在 Codex ${p.model ?? "（預設）"} 上執行；設定已改成 ${verified.model}，所以沒有自動重開。請按 Start 用新設定開始。`);
        const locale = await greetingLocale();
        if (d.main.view().state !== "detached") return { resumed: false };
        const r = await d.main.startFresh("codex", (opened) => {
          const current = codexConfig(d.main.view().project), expected = verified.configuration ?? verified;
          if (verified.state !== "ready" || !verified.authenticated || verified.quota !== "available" || !verified.expires || verified.expires <= Date.now() || current.model !== expected.model || current.effort !== expected.effort || opened.model !== verified.model || opened.effort !== verified.effort) throw new Error("Codex main model/effort changed or is unverified");
          return true;
        }, { locale, ...(verified.configuration?.effort===null?{codexDefaultEffort:verified.effort}:{}) });
        if (!r.ok) return stay(`Firstmate could not be restarted on Codex after Studio restarted: ${r.reason}. Press Start to try again.`, `Studio 重啟後無法在 Codex 上重開 Firstmate：${r.reason}。請按 Start 再試一次。`);
      }
    } catch (e: any) { return stay(`Firstmate could not be restarted on ${vendor} after Studio restarted: ${String(e?.message ?? e).slice(0, 200)}. Press Start to try again.`, `Studio 重啟後無法在 ${vendor} 上重開 Firstmate。請按 Start 再試一次。`); }
    d.main.note({ kind: "status", text: `Firstmate was running before Studio restarted; Studio started it again on ${vendor} with the same settings (a new conversation). / Studio 重啟前 Firstmate 正在執行；已用相同設定在 ${vendor} 上重新開始（新的對話）。`, i18n: { en: `Firstmate was running before Studio restarted; Studio started it again on ${vendor} with the same settings (a new conversation).`, "zh-TW": `Studio 重啟前 Firstmate 正在執行；已用相同設定在 ${vendor} 上重新開始（新的對話）。` } });
    return { resumed: true };
  }

  return { handle, crewLive, copies, resumeOnBoot };
}

/** The door confirmation a one-way merge answer carries, as the board takes it. */
export function doorInput(b: any): { reviewed_intents: number[]; check_answer: number; locale: string } | null {
  const reviewed = Array.isArray(b?.reviewed_intents) ? b.reviewed_intents.filter((n: unknown) => Number.isInteger(n)) : null;
  if (!reviewed?.length || !Number.isInteger(b?.check_answer)) return null;
  return { reviewed_intents: reviewed, check_answer: b.check_answer, locale: ["en", "zh-TW", "zh-CN"].includes(b?.locale) ? b.locale : "en" };
}

/** Every intent of the card, each exactly once, and nothing else: the board's rule, checked before anything is sent. */
export function doorComplete(card: Card, door: { reviewed_intents: number[] }): boolean {
  const n = Array.isArray(card.details?.en?.intent) ? card.details!.en!.intent.length : 0;
  const r = door.reviewed_intents;
  return n > 0 && r.length === n && new Set(r).size === n && r.every((i) => Number.isInteger(i) && i >= 1 && i <= n);
}

/** Does answering `chosen` on this card merge a one-way change? Then the board needs the door confirmation. */
export function needsDoor(card: Card, chosen: string, answers?: { ok: boolean }[]): boolean {
  const en = card.details?.en;
  if (en?.door?.kind !== "one-way") return false;
  if (answers?.some((a) => a.ok === false)) return false;
  const effect = (card.details as any)?.effect?.[chosen] ?? ((card.kind === "merge" || card.kind === "merge-untracked") ? (chosen === "A" ? "merge" : "hold") : null);
  return effect === "merge";
}
