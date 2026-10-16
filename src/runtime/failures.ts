// One failure taxonomy for every workflow (captain decision 2026-10-16). A failure is never a generic string: it has
// a class, a typed code, en and zh-TW text, the exact underlying message (credentials removed), a log link (or the
// hook that names why there is none) and, for each class, the card and the actions the captain gets.
//
//   ask            the agent needs an answer                 → Answer and continue (same node, with the answer)
//   environment    tooling, test command, login, quota,      → Fix and retry (says exactly what to fix and where)
//                  sandbox or permission
//   scope          overlap or conflicting scope              → Rescope (a concrete note is required)
//   transient      network, timeout or rate limit            → Retry (with backoff)
//   deterministic  a check or gate failed on fixed inputs    → Retry, refused until the inputs change (shows what changed)
//   invalid-input  params or config                          → Edit params
//   internal       a Studio bug, or anything unmapped        → Report (diagnostics kept)
//   every class                                              → Park
//
// Sources classify where the failure happens (FailureError, failure()); anything that reaches the engine without a
// class is classified by its words, and what no rule recognizes is "internal" with full diagnostics.
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { redactText } from "../secure";

export const FAILURE_CLASSES = ["ask", "environment", "scope", "transient", "deterministic", "invalid-input", "internal"] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];
export type FText = { en: string; "zh-TW": string };
export type FailureSource = "agent" | "check" | "gate" | "engine" | "host" | "render" | "staffing" | "params" | "scope" | "queue";
const t = (en: string, zh: string): FText => ({ en, "zh-TW": zh });

type CodeInfo = { class: FailureClass; title: FText; meaning: FText; fix?: FText; where?: FText };
/** Every typed code. The class of a code never changes; new failures get a new code. */
export const FAILURE_CODES = {
  "ask.agent-question": { class: "ask", title: t("The agent asks a question", "agent 提出問題"), meaning: t("The agent stopped to ask you a question. It is not a scope conflict.", "agent 停下來問你一個問題；這不是範圍衝突。") },
  "ask.one-way": { class: "ask", title: t("A one-way choice is needed", "需要一個單向的選擇"), meaning: t("Two versions of the work diverged. Keeping one discards the other, so only you can pick.", "工作的兩個版本分岔了。保留一個就會捨棄另一個，所以只能由你決定。") },
  "env.login": { class: "environment", title: t("Sign-in is missing", "缺少登入"), meaning: t("The provider refused the sign-in, or no account is signed in.", "供應商拒絕登入，或沒有帳號登入。"),
    fix: t("Sign in again on the provider's account card.", "請在供應商的帳號卡片重新登入。"), where: t("Board → Accounts (the Codex or Claude card)", "Board → 帳號（Codex 或 Claude 卡片）") },
  "env.quota": { class: "environment", title: t("Usage quota is used up", "用量額度已用完"), meaning: t("The provider account has no quota left for this round.", "供應商帳號沒有剩餘額度可跑這一輪。"),
    fix: t("Wait for the quota reset, or raise the limit on the vendor account.", "請等額度重設，或在供應商帳號提高上限。"), where: t("The vendor account of the provider named in the message", "訊息中供應商的帳號") },
  "env.tool-missing": { class: "environment", title: t("A tool is missing", "缺少工具"), meaning: t("A program this step needs is not installed or did not start.", "這一步需要的程式沒有安裝或無法啟動。"),
    fix: t("Install the tool named in the message, then retry.", "請安裝訊息中的工具，再重試。"), where: t("Settings → Doctor", "設定 → Doctor 檢查頁") },
  "env.test-command": { class: "environment", title: t("The test command is missing or broken", "測試指令缺少或無法執行"), meaning: t("The repository has no test command Studio can run, or the command did not start.", "儲存庫沒有 Studio 能執行的測試指令，或指令無法啟動。"),
    fix: t("Set the test command, then retry.", "請設定測試指令，再重試。"), where: t("The repository: .crew/gates.json \"test\", or package.json scripts.test", "儲存庫：.crew/gates.json 的 \"test\"，或 package.json 的 scripts.test") },
  "env.sandbox": { class: "environment", title: t("The OS sandbox refused", "OS sandbox 拒絕執行"), meaning: t("The step needs the OS sandbox, and the sandbox did not start or refused the step.", "這一步需要 OS sandbox，sandbox 無法啟動或拒絕了這一步。"),
    fix: t("Repair the sandbox that the message names, then retry.", "請修好訊息中提到的 sandbox，再重試。"), where: t("Settings → Doctor (sandbox)", "設定 → Doctor 檢查頁（sandbox）") },
  "env.permission": { class: "environment", title: t("Permission was refused", "權限被拒絕"), meaning: t("Studio has no permission for a path, a tool or a network address this step needs.", "Studio 沒有這一步需要的路徑、工具或網路位址的權限。"),
    fix: t("Grant the permission the message names, then retry.", "請開啟訊息中提到的權限，再重試。"), where: t("The path or grant named in the message", "訊息中提到的路徑或授權") },
  "env.provider-unavailable": { class: "environment", title: t("No verified provider", "沒有已驗證的供應商"), meaning: t("No provider has a verified sign-in, quota and model for this round.", "沒有供應商的登入、額度和模型都已驗證，可以跑這一輪。"),
    fix: t("Verify a provider, or pick a model the provider supports.", "請驗證一個供應商，或選一個供應商支援的模型。"), where: t("Settings → Doctor, and the task's staffing", "設定 → Doctor 檢查頁，以及任務的人員配置") },
  "env.staffing": { class: "environment", title: t("Staffing is not ready", "人員配置尚未就緒"), meaning: t("A role of this workflow has no approved provider or model.", "這個工作流程有角色沒有核准的供應商或模型。"),
    fix: t("Approve a provider and model for every role.", "請為每個角色核准供應商和模型。"), where: t("The task's staffing card, or Settings → Staffing", "任務的人員配置卡，或 設定 → 人員配置") },
  "env.renderer": { class: "environment", title: t("The film renderer is not available", "影片渲染工具無法使用"), meaning: t("HyperFrames or its browser is not installed at the pinned version.", "HyperFrames 或它的瀏覽器沒有安裝在指定版本。"),
    fix: t("Install the film renderer, then restart Studio.", "請安裝影片渲染工具，再重新啟動 Studio。"), where: t("Settings → Doctor (HyperFrames)", "設定 → Doctor 檢查頁（HyperFrames）") },
  "env.repository": { class: "environment", title: t("The repository is not usable", "儲存庫無法使用"), meaning: t("The repository, branch or worktree this step needs is missing or cannot be read.", "這一步需要的儲存庫、branch 或 worktree 不存在或無法讀取。"),
    fix: t("Restore the repository or branch the message names, then retry.", "請恢復訊息中提到的儲存庫或 branch，再重試。"), where: t("The repository path in the project settings", "專案設定中的儲存庫路徑") },
  "scope.blocked": { class: "scope", title: t("The scope blocks the work", "範圍擋住了工作"), meaning: t("The work needs a file or a change outside the approved scope.", "工作需要動到核准範圍以外的檔案或改動。") },
  "scope.overlap": { class: "scope", title: t("Another task holds this scope", "另一個任務佔用這個範圍"), meaning: t("The scope overlaps a task that is still in flight.", "範圍和一個還在進行的任務重疊。") },
  "transient.network": { class: "transient", title: t("Network failure", "網路失敗"), meaning: t("Studio did not reach a service.", "連不到服務。") },
  "transient.timeout": { class: "transient", title: t("Time limit reached", "超過時間限制"), meaning: t("The step did not finish in its time limit.", "這一步沒有在時間限制內完成。") },
  "transient.rate-limit": { class: "transient", title: t("Rate limit", "頻率限制"), meaning: t("The provider asked Studio to slow down.", "供應商要求 Studio 放慢速度。") },
  "transient.stale": { class: "transient", title: t("The state changed during the step", "步驟進行中狀態改變了"), meaning: t("Something the step relied on changed while it ran, so Studio refused to act on old data. A retry reads the new state.", "這一步依賴的東西在執行中改變了，所以 Studio 拒絕用舊資料動作；重試會讀取新的狀態。") },
  "transient.interrupted": { class: "transient", title: t("The step was interrupted", "這一步被中斷"), meaning: t("The process stopped before the step finished (a restart, or the process ended).", "這一步完成前程序就停止了（重新啟動，或程序結束）。") },
  "deterministic.check": { class: "deterministic", title: t("A check failed", "檢查沒有通過"), meaning: t("A blocking check failed on these exact inputs. The same inputs give the same result.", "阻擋型檢查在這組輸入上沒有通過；相同輸入會得到相同結果。") },
  "deterministic.gate": { class: "deterministic", title: t("A gate failed", "gate 沒有通過"), meaning: t("A gate on the way to the next step failed on these exact inputs.", "通往下一步的 gate 在這組輸入上沒有通過。") },
  "deterministic.round-cap": { class: "deterministic", title: t("The round cap is reached", "已達回合上限"), meaning: t("The step used all of its rounds and still did not pass.", "這一步用完所有回合，仍然沒有通過。") },
  "deterministic.agent-result": { class: "deterministic", title: t("The agent's result was refused", "agent 的結果被拒絕"), meaning: t("The agent finished, but its result did not meet the step's rule.", "agent 做完了，但結果不符合這一步的規則。") },
  "deterministic.film": { class: "deterministic", title: t("The film did not pass its checks", "影片沒有通過檢查"), meaning: t("The film was made, but its checks failed on these inputs. No verified film was offered.", "影片做出來了，但在這組輸入上沒有通過檢查，所以沒有提供已驗證的影片。") },
  "deterministic.prepare-again": { class: "deterministic", title: t("The step needs a fresh preparation", "這一步需要重新準備"), meaning: t("Something changed after the gates or the card were prepared: the branch, its checks, or a confirmation the card did not get. Running this step again fails the same way.", "gate 或卡片準備好之後有東西改變了：branch、它的檢查，或卡片少了一個確認。直接重跑這一步會用同樣的方式失敗。") },
  "deterministic.new-task": { class: "deterministic", title: t("What was approved has changed", "已核准的內容改變了"), meaning: t("An approved plan, artifact or launched work changed or is gone after review. This task cannot go on from it.", "審查後，已核准的方案、作品或已派出的工作改變了或不見了。這個任務無法再從它繼續。") },
  "deterministic.unchanged": { class: "deterministic", title: t("Nothing changed since the last failure", "和上次失敗相比沒有任何改變"), meaning: t("The inputs are identical to the last failed attempt, so Studio did not run it again.", "輸入和上次失敗時完全相同，所以 Studio 沒有再跑一次。") },
  "invalid-input.params": { class: "invalid-input", title: t("A task parameter is invalid", "任務參數無效"), meaning: t("A parameter of this task has a value the workflow refuses.", "這個任務有參數的值被工作流程拒絕。") },
  "invalid-input.config": { class: "invalid-input", title: t("The configuration is invalid", "設定無效"), meaning: t("A workflow, policy or project setting is invalid.", "工作流程、policy 或專案設定無效。") },
  "internal.bug": { class: "internal", title: t("Studio hit an internal error", "Studio 發生內部錯誤"), meaning: t("Studio broke one of its own rules. This is a Studio bug, not your input.", "Studio 違反了自己的規則；這是 Studio 的 bug，不是你的輸入。") },
  "internal.unmapped": { class: "internal", title: t("An unclassified failure", "尚未分類的失敗"), meaning: t("No rule knows this failure, so Studio treats it as its own bug and keeps every detail.", "沒有規則認得這個失敗，所以 Studio 把它當成自己的 bug，並保留所有細節。") },
} satisfies Record<string, CodeInfo>;
export type FailureCode = keyof typeof FAILURE_CODES;

/** The hook for error-log links (branch error-log-links): the same shape as src/logs.ts LogRef, resolved by setFailureLogLinker. */
export type FailureLogRef =
  | { k: "job"; job: string; run?: string; node?: string; round?: string; line?: number }
  | { k: "evidence"; run: string; dir: string; file: string; line?: number }
  | { k: "session"; session: string; line?: number }
  | { k: "codex"; thread: string; line?: number }
  | { k: "work"; id: string; line?: number };
export type FailureLog = { ref: FailureLogRef | null; href: string | null; available: boolean; reason: FText | null };
let logLinker: ((ref: FailureLogRef) => FailureLog) | null = null;
/** Wire the error-log links (src/logs.ts linkFor) when they are available; until then a failure names its log reference only. */
export function setFailureLogLinker(f: ((ref: FailureLogRef) => FailureLog) | null) { logLinker = f; }
export function failureLog(ref: FailureLogRef | null): FailureLog {
  if (!ref) return { ref: null, href: null, available: false, reason: t("Studio kept no log for this step.", "Studio 沒有保留這一步的日誌。") };
  if (logLinker) try { return logLinker(ref); } catch {}
  return { ref, href: null, available: false, reason: t("The log viewer is not installed in this Studio build.", "這個 Studio 版本沒有安裝日誌檢視器。") };
}

export type InputSnapshot = Record<string, string>;
export type Failure = {
  schema: 1; class: FailureClass; code: FailureCode; source: FailureSource; at: string;
  run: string | null; node: string | null; visit: number | null;
  title: FText; meaning: FText; fix: FText | null; where: FText | null;
  /** the exact underlying message, credentials and control characters removed, bounded */
  message: string;
  log: FailureLog;
  /** internal (and unmapped) failures: everything Studio knows, kept for the report */
  diagnostics: Record<string, string> | null;
  /** what the failed attempt ran on: retry of a deterministic failure is refused until one of these changes */
  inputs: { hash: string; snapshot: InputSnapshot } | null;
  /** transient: the retry number and the wait before it runs */
  retry: { attempt: number; backoffMs: number } | null;
};

export const FAILURE_MESSAGE_MAX = 2000;
/** The user's home folder as ~ (stacks and paths carry it). */
export const homeless = (s: string) => { const h = homedir(); return h && h.length > 1 ? s.split(h).join("~") : s; };
/** The underlying message as it may be shown and kept: no credentials, no control characters, bounded. */
export function sanitizeMessage(raw: unknown): string {
  const stripped = String(raw ?? "").replace(/\u001b\[[0-9;?]*[ -\/]*[@-~]/g, "").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, "");
  const s = homeless(redactText(stripped)).trim();
  return s.length > FAILURE_MESSAGE_MAX ? s.slice(0, FAILURE_MESSAGE_MAX - 1) + "…" : s;
}

/** A typed failure. `diagnostics` is always filled for an internal class. */
export function failure(code: FailureCode, message: unknown, o: { source?: FailureSource; run?: string | null; node?: string | null; visit?: number | null; log?: FailureLogRef | null;
  diagnostics?: Record<string, unknown> | null; inputs?: InputSnapshot | null; attempt?: number; where?: FText; fix?: FText } = {}): Failure {
  const info: CodeInfo = FAILURE_CODES[code] ?? FAILURE_CODES["internal.unmapped"];
  const msg = sanitizeMessage(message) || "(the source gave no message)";
  const cls = info.class;
  const diag = o.diagnostics || cls === "internal" ? Object.fromEntries(Object.entries({ message: msg, source: o.source ?? "engine", code, ...(o.diagnostics ?? {}) }).map(([k, v]) => [k, sanitizeMessage(typeof v === "string" ? v : JSON.stringify(v))])) : null;
  const attempt = Math.max(1, o.attempt ?? 1);
  return { schema: 1, class: cls, code: FAILURE_CODES[code] ? code : "internal.unmapped", source: o.source ?? "engine", at: new Date().toISOString(), run: o.run ?? null, node: o.node ?? null, visit: o.visit ?? null,
    title: info.title, meaning: info.meaning, fix: o.fix ?? info.fix ?? null, where: o.where ?? info.where ?? null, message: msg, log: failureLog(o.log ?? null), diagnostics: diag,
    inputs: o.inputs ? { hash: inputsHash(o.inputs), snapshot: o.inputs } : null, retry: cls === "transient" ? { attempt, backoffMs: backoffMs(attempt) } : null };
}

/** A failure thrown at its source: the engine keeps its class instead of guessing from the words. */
export class FailureError extends Error {
  constructor(readonly code: FailureCode, message: string, readonly extra: { source?: FailureSource; diagnostics?: Record<string, unknown>; log?: FailureLogRef | null; where?: FText; fix?: FText } = {}) { super(message); }
}
export const isFailure = (v: any): v is Failure => !!v && v.schema === 1 && (FAILURE_CLASSES as readonly string[]).includes(v.class) && typeof v.code === "string" && typeof v.message === "string";

/**
 * Words → code, for failures that reach the engine as plain text (a provider message, a thrown Error from code that
 * predates the taxonomy). Order matters: the first match wins. Nothing here guesses "internal": no match is internal.unmapped.
 */
export const TEXT_RULES: { re: RegExp; code: FailureCode }[] = [
  { re: /^ASK\b|\bworker (asks|asked)\b|\bneeds? (an )?answer\b/i, code: "ask.agent-question" },
  // first: a change after approval or after the gates. Running the same step again never passes; the card offers what does
  { re: /moved since the (six )?gates ran|remote checks changed before merge|needs the door confirmation|base moved after review|needs explicit recovery/i, code: "deterministic.prepare-again" },
  { re: /identity changed or predates pinning|prepare a new task|approved lane image changed|never replay/i, code: "deterministic.new-task" },
  { re: /\bdiverged: decide\b/i, code: "ask.one-way" },
  { re: /confirm a fresh proposal|requires confirmation|wait for the captain/i, code: "env.staffing" },
  { re: /\bSCOPE-BLOCKED\b|outside the (spec's )?scope|is outside the scope/i, code: "scope.blocked" },
  { re: /\bscope held by R-\d+|\boverlaps R-\d+/i, code: "scope.overlap" },
  { re: /rate.?limit|\b429\b|too many requests|overloaded/i, code: "transient.rate-limit" },
  { re: /\bquota\b|usage.?limit|insufficient_quota|credit balance|spend.?limit|quotaExhausted/i, code: "env.quota" },
  { re: /notLoggedIn|not logged in|has no login|please run \/login|unauthori[sz]ed|\b401\b|sign.?in again|log.?in again|invalid.{0,20}(token|key|credential)|authentication failed/i, code: "env.login" },
  { re: /no test command|test command: none|run_tests: no test|\.crew\/gates\.json/i, code: "env.test-command" },
  { re: /\bsandbox\b.*(refus|unavailable|could not|missing|needs)|needs an OS sandbox|sandbox-exec/i, code: "env.sandbox" },
  { re: /HyperFrames rendering is unavailable|HyperFrames tools are not installed|film renderer|Pinned .* is unavailable|installed version differs from approved pin/i, code: "env.renderer" },
  { re: /no verified provider|provider capability is unverified|capability probe failed|unknown or unavailable configured model|reasoning effort is not supported|no approved model configured|cliUnavailable|could not start: .*(ENOENT|not found)/i, code: "env.provider-unavailable" },
  { re: /\bstaffing\b|approve every workflow role/i, code: "env.staffing" },
  { re: /\bEACCES\b|\bEPERM\b|permission denied|operation not permitted|\b403\b|forbidden|may not reach/i, code: "env.permission" },
  { re: /\bENOENT\b.*(spawn|exec)|command not found|is not installed|not on PATH|spawn \S+ ENOENT/i, code: "env.tool-missing" },
  { re: /not a local git repository|no branch \S+ in|worktree is gone|checkout is gone|no project \S+ with a repository|cannot read the remote head/i, code: "env.repository" },
  { re: /timed? ?out|timeout|\betimedout\b|deadline (exceeded|expired)|no result within/i, code: "transient.timeout" },
  { re: /econn(reset|refused|aborted)|enotfound|eai_again|network|stream disconnected|socket hang up|fetch failed|connection (reset|refused|closed|error)|\b50[234]\b/i, code: "transient.network" },
  { re: /Studio (stopped|restarted) during|interrupted|the turn ended without a result|exited (with )?(code|signal)|\bSIG(TERM|KILL)\b/i, code: "transient.interrupted" },
  { re: /round cap|cap was reached/i, code: "deterministic.round-cap" },
  { re: /inputs are unchanged|nothing changed since the failed/i, code: "deterministic.unchanged" },
  { re: /No verified (HyperFrames )?film|HyperFrames \S+ failed|MP4 output invalid/i, code: "deterministic.film" },
  { re: /\bgate\b.*\bfail|six signed exact-head gates|fail-first never ran|CI never ran|base moved|no longer fast-forwards/i, code: "deterministic.gate" },
  { re: /\bcheck\b.*\b(fail|error)\b|: fail(,|$| ·)|checks? (failed|blocked)|edge \S+ blocked/i, code: "deterministic.check" },
  { re: /did not call|did not write|changed nothing|wrote nothing|must not change files|gave no verdict|verdict was refused/i, code: "deterministic.agent-result" },
  { re: /^params:|must be a JSON array|invalid native dependency|is not runnable|invalid_params|parameter|unknown param/i, code: "invalid-input.params" },
  { re: /must be (a |an )?(boolean|number|string|explicitly)|configured fallback chain is invalid|wait_timeout_s must|no workflow \S+|invalid (policy|config)/i, code: "invalid-input.config" },
  { re: /no runner for node kind|no action \S+|no agent mode|too many hand-offs|cannot be authenticated|late check result|ownership or head changed|bad JSON on stdout|unknown verdict|stalled: no node can run/i, code: "internal.bug" },
  // the typed codes of native tools and staffing (host/native-errors.ts, firstmate-staffing.ts, firstmate-projects.ts)
  { re: /^(invalid_params|draft_invalid|staffing_answer_invalid)$/, code: "invalid-input.params" },
  { re: /^(configuration_missing|native_adapter_unavailable|staffing_unverified|staffing_model_unavailable|unavailable|staffing_required)$/, code: "env.staffing" },
  { re: /^quota_exhausted$/, code: "env.quota" },
  { re: /^(target_changed|registry_changed)$/, code: "transient.stale" },
  { re: /^(owner_ended|cancelled)$/, code: "transient.interrupted" },
  { re: /^(captain_confirmation_required|staffing_wait_captain)$/, code: "env.staffing" },
  { re: /^(project_required|project_ambiguous)$/, code: "invalid-input.params" },
  { re: /^(project_unregistered|project_disabled|project_revoked|workflow_missing|draft_missing)$/, code: "invalid-input.config" },
  { re: /^internal_error$/, code: "internal.bug" },
  { re: /requires (local )?(ffprobe|ffmpeg|git|node|python)|\bffprobe\b.*(missing|not found)/i, code: "env.tool-missing" },
  { re: /^git (commit|push|fetch|rebase)\b|Git common directory missing|could not take the worktree|worktree of \S+ is taken/i, code: "env.repository" },
  { re: /verification (expired|was revoked)|sign-in pending|crew token missing/i, code: "env.login" },
  { re: /GitHub did not merge|GitHub .*(refused|stopped)|remote .*(unverified|could not be (proved|verified))/i, code: "env.repository" },
  // families (after the specific rules): the shape of Studio's own refusals across the domains
  { re: /escapes (the )?(folder|through a link)|outside the chosen folder/i, code: "invalid-input.params" },
  { re: /\bwrote no\b|no output to accept|PNG is invalid|image is invalid|output invalid/i, code: "deterministic.agent-result" },
  { re: /malformed|untrusted|not persisted|evidence (changed|is missing)|history (is|cannot)|integrity|invariant|no intact|no pinned|no approved/i, code: "internal.bug" },
  { re: /owner ended|\bcancell?ed\b|was stopped|process death/i, code: "transient.interrupted" },
  { re: /\bchanged\b|\bstale\b|reload|differs\b|moved since|no longer|already (owned|attempted|running)/i, code: "transient.stale" },
  { re: /captain|approv|confirm|explicit (recovery|request|choice)|proposal|requires? a new .*card/i, code: "deterministic.prepare-again" },
  { re: /\bunavailable\b|not installed|requires codex|needs (the )?(OS|codex|claude)|not configured/i, code: "env.tool-missing" },
  { re: /\binvalid\b|must (be|name|have)|is required|\brequired\b|\bunknown\b|unsupported|exceeds?|too (large|long|many)|no such/i, code: "invalid-input.config" },
];
/** The code of a plain message, by its words; internal.unmapped when no rule matches. */
export function codeOf(message: string): FailureCode {
  for (const r of TEXT_RULES) if (r.re.test(message)) return r.code;
  return "internal.unmapped";
}

/** Classify a thrown value at the engine's funnel: a typed source failure keeps its class; anything else is read by its words. */
export function fromError(e: unknown, o: { source?: FailureSource; run?: string | null; node?: string | null; visit?: number | null; log?: FailureLogRef | null; inputs?: InputSnapshot | null; attempt?: number } = {}): Failure {
  const err: any = e;
  if (isFailure(err?.failure)) return { ...err.failure, run: err.failure.run ?? o.run ?? null, node: err.failure.node ?? o.node ?? null, visit: err.failure.visit ?? o.visit ?? null, inputs: err.failure.inputs ?? (o.inputs ? { hash: inputsHash(o.inputs), snapshot: o.inputs } : null) };
  const message = String(err?.message ?? err ?? "");
  let code: FailureCode | null = err instanceof FailureError ? err.code : null;
  // a native tool's typed refusal (host/types.ts NativeToolFailure): its own code decides, then its words
  if (!code && typeof err?.publicFailure?.code === "string") { const byWords = codeOf(message), byCode = codeOf(err.publicFailure.code);
    code = byWords === "deterministic.new-task" || byWords === "deterministic.prepare-again" ? byWords : byCode !== "internal.unmapped" ? byCode : null; }
  if (!code && err?.providerRefusal) code = /quota/i.test(message) ? "env.quota" : /login|sign/i.test(message) ? "env.login" : /fallback chain|must be/i.test(message) ? "invalid-input.config" : "env.provider-unavailable";
  if (!code && err?.queueRefusal) code = /scope held|overlap/i.test(message) ? "scope.overlap" : /staffing|confirmation/i.test(message) ? "env.staffing" : codeOf(message) === "internal.unmapped" ? "transient.interrupted" : codeOf(message);
  if (!code && err?.outcome === "blocked") code = codeOf(message);
  if (!code && err?.name === "HyperframesFailure") code = err.code === "unchanged-inputs" ? "deterministic.unchanged" : err.code === "timeout" ? "transient.timeout" : err.cleanupSafe === false ? "internal.bug" : err.code === "command-failed" || err.diagnostic ? "deterministic.film" : codeOf(message) === "internal.unmapped" ? "deterministic.film" : codeOf(message);
  if (!code) code = codeOf(message);
  const extra = err instanceof FailureError ? err.extra : {};
  const diagnostics = FAILURE_CODES[code].class === "internal" ? { ...(extra.diagnostics ?? {}), errorName: String(err?.name ?? typeof err), stack: String(err?.stack ?? "").split("\n").slice(0, 12).join("\n") } : extra.diagnostics ?? null;
  return failure(code, message, { ...o, source: extra.source ?? o.source, log: extra.log ?? o.log ?? null, diagnostics, where: extra.where, fix: extra.fix });
}

/** A typed chat notice (host/external-errors.ts ExternalError) as a failure: its class keeps its meaning. */
export function fromExternal(ext: { source: string; class: string; code: string; message: string }): Failure {
  const byWords = codeOf(ext.message);
  const code: FailureCode = ext.class === "quota" ? (/rate.?limit|\b429\b|too many requests/i.test(ext.message) ? "transient.rate-limit" : "env.quota") : ext.class === "auth" ? "env.login" : ext.class === "timeout" ? "transient.timeout"
    : ext.class === "network" ? "transient.network" : ext.class === "exit" ? "transient.interrupted" : ext.class === "attachment" || ext.class === "upload" ? "invalid-input.params" : byWords;
  return failure(code, ext.message, { source: "host", diagnostics: code.startsWith("internal") ? { externalClass: ext.class, externalCode: ext.code, vendor: ext.source } : null });
}

// ---------- inputs: what a retry must change ----------
export function inputsHash(s: InputSnapshot) { return createHash("sha256").update(JSON.stringify(Object.keys(s).sort().map((k) => [k, s[k]]))).digest("hex"); }
/** The keys whose value differs between the failed attempt and now. */
export function changedInputs(before: InputSnapshot | null | undefined, now: InputSnapshot): { key: string; before: string | null; now: string | null }[] {
  if (!before) return [];
  return [...new Set([...Object.keys(before), ...Object.keys(now)])].sort().filter((k) => before[k] !== now[k]).map((k) => ({ key: k, before: before[k] ?? null, now: now[k] ?? null }));
}
/** The retry wait for a transient failure: 5 s, 30 s, 2 min, then 10 min. */
export const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000];
export const backoffMs = (attempt: number) => BACKOFF_MS[Math.min(BACKOFF_MS.length - 1, Math.max(0, attempt - 1))];
const secs = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`);
const secsZh = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} 分鐘` : `${Math.round(ms / 1000)} 秒`);

// ---------- the card and its actions ----------
/** The action ids of failure cards: the runtime answers them by these names, never by a domain's words. */
export const ACT = { answer: "answer", fixRetry: "fix-retry", retry: "retry", rescope: "rescope", editParams: "edit-params", report: "report", park: "park", prepareAgain: "prepare-again", newTask: "new-task" } as const;
export type FailureOption = { id: string; label: string; labelZh: string; primary?: boolean; note?: boolean; hold?: boolean };
export const PARK: FailureOption = { id: "park", label: "Park", labelZh: "暫停（Park）", hold: true };
/** The actions each class offers. Park is always there. */
export function failureActions(cls: FailureClass, code?: FailureCode, o: { ended?: boolean } = {}): FailureOption[] {
  // a run that ended (succeeded) on a failed outcome is not revived: a new task is the way on
  if (o.ended) return [{ id: ACT.newTask, label: "Start a new task", labelZh: "開始新任務", primary: true }, PARK];
  if (code === "deterministic.prepare-again") return [{ id: ACT.prepareAgain, label: "Prepare again", labelZh: "重新準備", primary: true }, PARK];
  if (code === "deterministic.new-task") return [{ id: ACT.newTask, label: "Start a new task", labelZh: "開始新任務", primary: true }, PARK];
  const main: Record<FailureClass, FailureOption[]> = {
    ask: [{ id: "answer", label: "Answer and continue", labelZh: "回答並繼續", primary: true, note: true }],
    environment: [{ id: "fix-retry", label: "Fix and retry", labelZh: "修好後重試", primary: true }],
    transient: [{ id: "retry", label: "Retry", labelZh: "重試", primary: true }],
    deterministic: [{ id: "retry", label: "Retry (needs changed inputs)", labelZh: "重試（輸入必須改變）", primary: true }, { id: "edit-params", label: "Edit params and retry", labelZh: "修改參數後重試", note: true }],
    scope: [{ id: "rescope", label: "Rescope", labelZh: "重新界定範圍", primary: true, note: true }],
    "invalid-input": [{ id: "edit-params", label: "Edit params", labelZh: "修改參數", primary: true, note: true }],
    internal: [{ id: "report", label: "Report it (diagnostics kept)", labelZh: "回報問題（保留診斷資料）", primary: true, hold: true }],
  };
  return [...main[cls], PARK];
}

/** What the card says to do, per class. */
export function failureHow(f: Failure, o: { ended?: boolean } = {}): FText {
  if (o.ended) return t("This run ended on this result, so it does not run again. Start a new task: it gets the same request and params and runs from the start.", "這個 run 已經以這個結果結束，不會再跑。請開始新任務：它會用同樣的需求和參數從頭執行。");
  if (f.code === "deterministic.prepare-again") return t("Prepare again: Studio goes back to the step before the card, runs the gates again and raises a new card. Nothing is merged before that card is answered.", "重新準備：Studio 回到卡片前一步，重跑 gate，再發一張新卡。新卡回答前不會合併任何東西。");
  if (f.code === "deterministic.new-task") return t("Start a new task: it gets the same request and declared params and prepares everything again. This task stays as it is.", "開始新任務：它會用同樣的需求和已宣告的參數，重新準備一切。這個任務維持原狀。");
  switch (f.class) {
    case "ask": if (f.code === "ask.one-way") return t("Write which version to keep in the note, then pick Answer and continue. The step runs again with your choice. The version you do not keep is discarded.", "請在備註寫下要保留哪個版本，再選「回答並繼續」；這一步會帶著你的選擇再跑一次，沒保留的版本會被捨棄。");
      return t("Write your answer in the note and pick Answer and continue. The same step runs again with your answer.", "請在備註寫下回答，再選「回答並繼續」；同一步會帶著你的回答再跑一次。");
    case "environment": return t(`Fix this first: ${f.fix?.en ?? "the cause the message names."} Where: ${f.where?.en ?? "the place the message names."} Then pick Fix and retry.`, `請先修好：${f.fix?.["zh-TW"] ?? "訊息中提到的原因。"} 位置：${f.where?.["zh-TW"] ?? "訊息中提到的地方。"} 修好後選「修好後重試」。`);
    case "transient": { const a = f.retry?.attempt ?? 1, ms = f.retry?.backoffMs ?? backoffMs(a); return t(`Retry ${a} waits ${secs(ms)} before it runs (backoff: 5 s, 30 s, 2 min, then 10 min).`, `第 ${a} 次重試會先等 ${secsZh(ms)} 再執行（間隔：5 秒、30 秒、2 分鐘，之後 10 分鐘）。`); }
    case "deterministic": return t("The same inputs give the same failure. Studio refuses Retry until an input changes: the params, the agent, the code head, the policy or the round budget. Edit params and retry changes the params.", "相同輸入會得到相同的失敗。在輸入改變前，Studio 會拒絕重試；輸入包含參數、agent、程式碼 head、policy 或回合預算。「修改參數後重試」會改變參數。");
    case "scope": return t("Write a concrete note: the files or the change the new scope adds or removes. Rescope refuses an empty note, a vague note and the same note again.", "請寫具體的備註：新範圍加入或移除哪些檔案或改動。空白、含糊或與上次相同的備註會被拒絕。");
    case "invalid-input": return t("Write one parameter per line as key=value in the note, then pick Edit params. Studio accepts only the parameters the workflow declares, checks each value against its declared options and pattern, and then runs the step again.", "請在備註每行寫一個參數，格式 key=value，再選「修改參數」。Studio 只接受工作流程宣告的參數，依宣告的選項和格式檢查每個值，再重跑這一步。");
    case "internal": return t("This is a Studio bug. Report it: Studio keeps the diagnostics below with the task. The run stays failed.", "這是 Studio 的 bug。請回報：Studio 會把下方的診斷資料和任務一起保留。run 會維持失敗狀態。");
  }
}
const CLASS_NAME: Record<FailureClass, FText> = { ask: t("Question", "提問"), environment: t("Environment", "環境"), scope: t("Scope", "範圍"), transient: t("Transient", "暫時性"), deterministic: t("Deterministic", "確定性"), "invalid-input": t("Invalid input", "輸入無效"), internal: t("Studio bug", "Studio bug") };
export const className = (c: FailureClass) => CLASS_NAME[c];

/** A card body for one failure: title, why (what failed), how (what to do), the exact message, and the class's actions. */
export function failureCardBody(f: Failure, o: { label?: string; ended?: boolean } = {}) {
  const how = failureHow(f, o);
  const where = o.label ? ` (${o.label})` : "";
  // the card's failure box (card.failure) shows the message, fix, where, log and diagnostics in the card's language: no second copy in the body
  return { title: `${f.title.en}${where}`, zhTitle: `${f.title["zh-TW"]}${where}`, en: { why: f.meaning.en, how: how.en }, zh: { why: f.meaning["zh-TW"], how: how["zh-TW"] },
    body: "", options: failureActions(f.class, f.code, o) };
}

// ---------- no-change refusals ----------
export type Refusal = { code: "no-change" | "not-fixed" | "vague-note" | "same-note" | "same-base" | "bad-params"; en: string; "zh-TW": string; changed?: { key: string; before: string | null; now: string | null }[] };
/** Retry of a deterministic failure on unchanged inputs is refused, and says what it compared. */
export function retryRefusal(f: Failure, now: InputSnapshot | null): Refusal | null {
  if (f.class !== "deterministic" || !f.inputs || !now) return null;
  const changed = changedInputs(f.inputs.snapshot, now);
  if (changed.length) return null;
  const keys = Object.keys(f.inputs.snapshot).sort().join(", ");
  return { code: "no-change", en: `Retry refused: nothing changed since the failure (compared: ${keys}). The same inputs give the same result. Change an input first, or use Edit params and retry.`,
    "zh-TW": `已拒絕重試：失敗之後沒有任何輸入改變（比對了：${keys}）。相同輸入會得到相同結果。請先改變輸入，或使用「修改參數後重試」。`, changed: [] };
}
const VAGUE = /^(rescope|retry|again|try again|redo|fix( it)?|same|ok|okay|go|continue|please|yes|no|refresh|update|change( it)?|-|\.|\?|重試|再試|繼續|同上|好)$/i;
/** Rescope needs a concrete note, different from the last rescope note; a base refresh to the same commit changes nothing. */
export function rescopeRefusal(o: { note: string | null | undefined; previous?: string | null; from?: string | null; target?: string | null; base?: string | null; requireConcrete?: boolean }): Refusal | null {
  if (o.from && o.target && o.from === o.target) {
    const s = o.from.slice(0, 12);
    return { code: "same-base", en: `Rescope refused: it refreshes base ${o.base ?? ""} from ${s} to ${s}, which changes nothing. Write what the new scope adds or removes instead.`.replace(/  +/g, " "),
      "zh-TW": `已拒絕重新界定範圍：它會把基底 ${o.base ?? ""} 從 ${s} 更新到 ${s}，沒有任何改變。請改寫新範圍要加入或移除的內容。`.replace(/  +/g, " ") };
  }
  const note = String(o.note ?? "").trim();
  if (o.requireConcrete && (note.length < 12 || VAGUE.test(note)))
    return { code: "vague-note", en: "Rescope refused: the note is not concrete. Name the files or the change the new scope adds or removes.", "zh-TW": "已拒絕重新界定範圍：備註不夠具體。請寫出新範圍加入或移除的檔案或改動。" };
  if (note && o.previous && note.replace(/\s+/g, " ").toLowerCase() === String(o.previous).trim().replace(/\s+/g, " ").toLowerCase())
    return { code: "same-note", en: "Rescope refused: the note is the same as the last rescope, so the scope does not change. Write what is different this time.", "zh-TW": "已拒絕重新界定範圍：備註和上次相同，範圍不會改變。請寫出這次不同的地方。" };
  return null;
}
/** Keys a param edit never changes: Studio's own pins (_…) and what names the task's identity (project, repository, target, definition). */
export const PARAM_LOCKED = /^_|^(project|repo|repository|target|definition|workflow|branch|base|worktree|source)$/i;
export type ParamSpec = { label?: string; default?: string; options?: string[]; pattern?: string; max_length?: number };
/** key=value lines → params. Only declared, unlocked params; each value is checked against its declared spec. */
export function parseParamEdit(note: string | null | undefined, current: Record<string, string>, declared: Record<string, ParamSpec> | null | undefined): { params: Record<string, string> } | Refusal {
  const spec = declared ?? {}; const editable = Object.keys(spec).filter((k) => !PARAM_LOCKED.test(k));
  if (!editable.length) return { code: "bad-params", en: "Edit refused: this workflow declares no parameter you can edit. Start a new task instead.", "zh-TW": "已拒絕修改：這個工作流程沒有宣告可修改的參數。請改為開始新任務。" };
  const out: Record<string, string> = {}; const bad: string[] = [];
  for (const line of String(note ?? "").split(/\r?\n/)) { const l = line.trim(); if (!l) continue; const m = /^([A-Za-z_][\w.-]*)\s*=\s*(.*)$/.exec(l); if (!m) { bad.push(l.slice(0, 60)); continue; }
    const [k, v] = [m[1], m[2]];
    if (!editable.includes(k)) { bad.push(k); continue; }
    const p = spec[k]; const problem = /[\u0000-\u001f\u007f]/.test(v) ? "control characters" : v.length > Math.min(4000, p.max_length ?? 4000) ? `longer than ${Math.min(4000, p.max_length ?? 4000)}`
      : p.options?.length && !p.options.map(String).includes(v) ? `not one of ${p.options.join(", ")}` : p.pattern && !safeTest(p.pattern, v) ? `does not match ${p.pattern}` : null;
    if (problem) { bad.push(`${k} (${problem})`); continue; }
    out[k] = v; }
  if (bad.length || !Object.keys(out).length)
    return { code: "bad-params", en: `Edit refused: write one editable parameter per line as key=value${bad.length ? ` (not accepted: ${bad.join(", ")})` : ""}. Known: ${editable.join(", ")}.`,
      "zh-TW": `已拒絕修改：請每行寫一個可修改的參數，格式 key=value${bad.length ? `（不接受：${bad.join("、")}）` : ""}。已知參數：${editable.join("、")}。` };
  if (Object.entries(out).every(([k, v]) => current[k] === v))
    return { code: "no-change", en: "Edit refused: every value is the same as now, so nothing changes.", "zh-TW": "已拒絕修改：每個值都和目前相同，沒有任何改變。", changed: [] };
  return { params: out };
}
const safeTest = (re: string, v: string) => { try { return new RegExp(`^(?:${re})$`).test(v); } catch { return false; } };
export class FailureRefusal extends Error { constructor(readonly refusal: Refusal) { super(refusal.en); } }
