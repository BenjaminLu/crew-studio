// What Firstmate is doing, in the captain's words (live S27): the chat showed every tool call as its raw name and JSON
// (`mcp__studio__studio_propose_work {"workflow":"images",…}`). Each call becomes one short activity line in English and
// Traditional Chinese (the page converts it for 简体中文); Studio's own tools say what they do, any other tool says only its
// short name, and plumbing the captain never needs (ToolSearch) is not shown. The raw call stays on the line, folded.

export type Activity = { en: string; "zh-TW": string };
/** null: a call the chat does not show (it stays in the log on disk and in the transcript) */
export type ToolActivity = { tool: string; activity: Activity | null };

const HIDDEN = new Set(["ToolSearch"]);
const pair = (en: string, zh: string): Activity => ({ en, "zh-TW": zh });

/** The tool's own name: `mcp__studio__studio_manual` → `studio_manual`. */
export const shortToolName = (name: string): string => { const m = /^mcp__[^_]+(?:_[^_]+)*?__(.+)$/.exec(name); return (m ? m[1] : name).trim().slice(0, 60); };

/** A value from the call's input, as one short line (titles are the captain's words: kept, never translated). */
const field = (input: unknown, k: string, n = 48): string => {
  const v = input && typeof input === "object" ? (input as Record<string, unknown>)[k] : undefined;
  if (typeof v !== "string" && typeof v !== "number") return "";
  const s = String(v).replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
};
const withArg = (a: Activity, arg: string): Activity => arg ? pair(`${a.en}: ${arg}`, `${a["zh-TW"]}：${arg}`) : a;

const STUDIO: Record<string, (input: unknown) => Activity> = {
  studio_list_workflows: () => pair("Looking at the workflow list", "查看工作流程清單"),
  studio_manual: (i) => withArg(pair("Reading the operating manual", "查閱操作手冊"), field(i, "section")),
  studio_list_projects: () => pair("Looking at the registered projects", "查看已登記的專案"),
  studio_operating_rules: () => pair("Reading the operating rules", "查看營運規則"),
  studio_work_status: (i) => withArg(pair("Checking work status", "查看工作進度"), field(i, "task") || field(i, "id")),
  studio_prepare_project_work: () => pair("Preparing a project registration", "準備登記專案"),
  studio_staffing_facts: () => pair("Checking which crew is available", "查看可用的船員設定"),
  studio_staffing_interview: () => pair("Working out the crew", "整理船員配置"),
  studio_propose_staffing: () => pair("Proposing the crew", "提出船員配置"),
  studio_keep_staffing: () => pair("Proposing to keep the crew", "提出沿用船員"),
  studio_change_staffing: (i) => withArg(pair("Proposing a crew change for a task", "提出更換任務船員"), field(i, "task")),
  studio_propose_work: (i) => withArg(pair("Proposing work", "提出派工"), field(i, "title") || field(i, "workflow")),
  studio_draft_workflow: (i) => withArg(pair("Drafting a workflow", "草擬工作流程"), field(i, "name") || field(i, "title")),
  studio_workflow_draft_contract: () => pair("Reading the workflow drafting guide", "查閱工作流程草擬規範"),
  studio_read_workflow: (i) => withArg(pair("Reading a workflow", "查看工作流程"), field(i, "workflow") || field(i, "id")),
  studio_update_workflow_staffing: () => pair("Updating a workflow's crew", "更新工作流程的船員"),
  studio_validate_workflow_draft: () => pair("Checking a workflow draft", "檢查工作流程草稿"),
  studio_save_workflow_draft: () => pair("Saving the workflow draft", "儲存工作流程草稿"),
  studio_workflow_gate: () => pair("Reading the readiness check", "查看就緒檢查結果"),
  studio_answer_agent_question: () => pair("Answering a crew member's question", "回答船員的問題"),
  studio_connect_github: () => pair("Proposing a GitHub connection", "提出連接 GitHub"),
  studio_triage_issues: () => pair("Starting an issue triage", "開始分類 issue"),
  studio_work_package: () => pair("Proposing the next issue of a work package", "提出工作包的下一張 issue"),
  studio_crew_assignments: () => pair("Looking at the crew assignments", "查看船員分派"),
  studio_propose_crew_change: () => pair("Proposing a crew change", "提出船員調整"),
};

/** The activity line for a tool call as it starts. */
export function toolActivity(name: string, input?: unknown): ToolActivity {
  const tool = shortToolName(name);
  if (HIDDEN.has(tool)) return { tool, activity: null };
  const known = STUDIO[tool];
  if (known) { try { return { tool, activity: known(input) }; } catch {} }
  return { tool, activity: pair(`Using a tool: ${tool}`, `使用工具：${tool}`) };
}

const REFINES = new Set(["studio_propose_work", "studio_prepare_project_work"]);
/** A call whose line changes once it answered (it names the run): the chat log writes it then. */
export const refinesOnDone = (tool: string) => REFINES.has(tool);
/** The line once the call answered: a proposal names the run it raised (`提出派工：… → R-093`). Unchanged otherwise. */
export function toolActivityDone(t: ToolActivity, result: string | undefined): ToolActivity {
  if (!t.activity || !result || !REFINES.has(t.tool)) return t;
  let id = ""; try { const o = JSON.parse(result); id = typeof o?.proposal === "string" ? o.proposal : ""; } catch {}
  if (!/^R-\d{1,6}$/.test(id)) return t;
  return { tool: t.tool, activity: pair(`${t.activity.en} → ${id}`, `${t.activity["zh-TW"]} → ${id}`) };
}
