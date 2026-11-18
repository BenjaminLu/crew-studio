// The index of Studio's native Firstmate tools: one list, in one order, that every place naming them is made from (the fresh
// primary's seed, src/host/main.ts nativeFreshText; the server instructions, the firstmate skill and studio_manual's index).
// A tool registered but missing here, or listed here as always registered but missing, fails tests/observe-registry.ts.
export type ToolGroup = "observe" | "work" | "manual" | "projects" | "staffing" | "drafts" | "questions" | "github" | "issues" | "crew" | "notes";
export type ToolEntry = { name: string; group: ToolGroup; /** registered in every Studio (false: only where its example is installed) */ always: boolean; about: string };

export const STUDIO_TOOLS: ToolEntry[] = [
  { name: "studio_now", group: "observe", always: true, about: "what the captain is looking at, what waits for them, what runs, the last hour" },
  { name: "studio_find", group: "observe", always: true, about: "search every kind (Tasks, cards, rooms, pull requests, workflows, skills, documents…) by id or name" },
  { name: "studio_list", group: "observe", always: true, about: "list one kind with each one's summary" },
  { name: "studio_get", group: "observe", always: true, about: "read one entity by ref" },
  { name: "studio_logs", group: "observe", always: true, about: "one Task's, room's, pull request's or terminal's log and progress (a terminal's screen only when the captain asks)" },
  { name: "studio_events", group: "observe", always: true, about: "Studio's event stream, read on with a cursor" },
  { name: "studio_list_workflows", group: "work", always: true, about: "workflows, versions and which one makes each deliverable" },
  { name: "studio_manual", group: "manual", always: true, about: "the operating manual; no section gives the index" },
  { name: "studio_list_projects", group: "projects", always: true, about: "registered projects" },
  { name: "studio_operating_rules", group: "manual", always: true, about: "the captain's operating rules (read only)" },
  { name: "studio_work_status", group: "observe", always: true, about: "the newest 50 Tasks (the older form of studio_list task)" },
  { name: "studio_prepare_project_work", group: "projects", always: true, about: "raise a registration card for an unregistered local project" },
  { name: "studio_staffing_facts", group: "staffing", always: true, about: "what each provider can run here" },
  { name: "studio_staffing_interview", group: "staffing", always: true, about: "the staffing defaults and choices" },
  { name: "studio_propose_staffing", group: "staffing", always: true, about: "raise the staffing confirmation card" },
  { name: "studio_keep_staffing", group: "staffing", always: true, about: "keep the approved crew on a new workflow version" },
  { name: "studio_change_staffing", group: "staffing", always: true, about: "change a held Task's staffing (captain approves)" },
  { name: "studio_propose_work", group: "work", always: true, about: "propose work; the captain approves its dispatch card" },
  { name: "studio_draft_workflow", group: "drafts", always: true, about: "draft the captain's own workflow" },
  { name: "studio_workflow_draft_contract", group: "drafts", always: true, about: "the drafting skill and schema" },
  { name: "studio_read_workflow", group: "drafts", always: true, about: "read a saved personal workflow" },
  { name: "studio_update_workflow_staffing", group: "drafts", always: true, about: "set a saved workflow's role staffing" },
  { name: "studio_validate_workflow_draft", group: "drafts", always: true, about: "validate a draft" },
  { name: "studio_save_workflow_draft", group: "drafts", always: true, about: "save a draft when the captain asks" },
  { name: "studio_workflow_gate", group: "drafts", always: true, about: "a draft's readiness gate result" },
  { name: "studio_answer_agent_question", group: "questions", always: true, about: "answer an agent's question or escalation Studio sent you" },
  { name: "studio_connect_github", group: "github", always: true, about: "raise the captain-only GitHub connect or merge grant card" },
  { name: "studio_triage_issues", group: "issues", always: true, about: "triage a project's issues" },
  { name: "studio_work_package", group: "issues", always: true, about: "an issue triage's work package" },
  { name: "studio_crew_assignments", group: "crew", always: true, about: "who runs each workflow's agent nodes" },
  { name: "studio_propose_crew_change", group: "crew", always: true, about: "propose a crew change (captain approves)" },
  { name: "studio_note_issue", group: "notes", always: true, about: "write down an issue the captain raised, for the next retro" },
  { name: "studio_startup_workflow_contract", group: "work", always: false, about: "the startup competition example's contract" },
];
/** The names a fresh primary is told about when the live specs cannot be read: every tool always registered, in index order. */
export const NATIVE_TOOL_NAMES: string[] = STUDIO_TOOLS.filter((t) => t.always).map((t) => t.name);
