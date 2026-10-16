// The readiness gate between a drafted workflow and Run: shared types.
// Every stage returns typed problems: which stage, which node, what is wrong and how to
// fix it, in en and zh-TW, and who can fix it. Firstmate fixes its own problems in the
// repair loop; a problem only the captain can resolve (a sign-in, an egress grant,
// staffing approval, a one-way decision) is shown as a notice and never looped.
export type StageId = "intent" | "contract" | "brief" | "dryrun" | "smoke";
export const STAGES: StageId[] = ["intent", "contract", "brief", "dryrun", "smoke"];
export type L2 = { en: string; zh: string };
export type CaptainNeed = "sign-in" | "egress" | "staffing" | "one-way";
export type GateProblem = {
  stage: StageId; code: string; node: string | null;
  /** error fails the stage; notice is shown to the captain and never fails it (staffing confirmed at Run) */
  level: "error" | "notice";
  /** who can fix it: Firstmate in the repair loop, or only the captain (never looped) */
  owner: "firstmate" | "captain"; need?: CaptainNeed | null;
  reason: L2; fix: L2;
  /** for a captain-owned problem: the one plain line the captain reads (what to do and why), shown as a notice */
  note?: L2 | null;
};
export type StageResult = { id: StageId; status: "pass" | "fail" | "skipped" | "running" | "pending"; problems: GateProblem[]; note?: L2 | null; ms?: number };
export type RenderedBrief = { node: string; label: string; system: string; prompt: string; roundDir: string };
export type DryStep = { node: string; state: string; outcome: string | null; error: string | null };
export type GateResult = {
  schema: 1; key: string; hash: string; at: string;
  stages: StageResult[];
  briefs: RenderedBrief[];
  dry?: { steps: DryStep[]; status: string; stoppedAt?: string | null } | null;
  /** stage 5: a real Task on the subscription; verified when it succeeded on this exact hash */
  smoke?: { task: string; status: "running" | "succeeded" | "failed"; startedAt: string; endedAt?: string | null; error?: string | null } | null;
  verified?: { at: string; task: string } | null;
};
export const P = (stage: StageId, code: string, node: string | null, reason: L2, fix: L2, o: { owner?: "firstmate" | "captain"; need?: CaptainNeed | null; level?: "error" | "notice"; note?: L2 | null } = {}): GateProblem =>
  ({ stage, code, node, level: o.level ?? "error", owner: o.owner ?? "firstmate", need: o.need ?? null, reason, fix, ...(o.note ? { note: o.note } : {}) });
/** The stable identity of a problem: what the repair loop compares between rounds. */
export const problemKey = (p: GateProblem) => `${p.stage}|${p.code}|${p.node ?? ""}|${p.reason.en}`;
/** Passed means stages 1-4 passed on this hash (stage 5 is the captain's optional real run). */
export const gatePassed = (r: GateResult | null | undefined) => !!r && ["intent", "contract", "brief", "dryrun"].every((s) => r.stages.find((x) => x.id === s)?.status === "pass");
export const firstFailing = (r: GateResult | null | undefined) => r?.stages.find((s) => s.status === "fail") ?? null;
