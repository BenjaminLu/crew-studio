// The stub-CLI harness's part of a shared acceptance scenario (tests/acceptance/<id>.yaml, `stub:`):
// the offline runs of that workflow, what each does as the captain, and what it must leave behind.
// The shared fields (topic, start, cards, expect) are the defaults; a stub run only adds or overrides.
//
//   stub:
//     - name: approve                      # unique within the workflow
//       covers: one line on what it proves
//       how: board                         # board | firstmate | proposal | register | staffing | retired
//       server: sandbox                    # or local-unrestricted
//       provider: codex                    # the board's provider select (default: the shared start.provider)
//       topic: …                           # default: the shared topic (markers steer the scripted agent)
//       params: { folder: "{folder}" }      # added to the start params; {name} comes from a setup step
//       setup: [folder]                    # named captain steps (tests/acceptance/steps.ts) before the start
//       cards: [{ node: accept, answers: [changes, approve-draft], note: "…", before: step }]
//                                          # offline answers win over the shared cards (a throwaway Studio,
//                                          # so merge and other local steps may be answered here)
//       expect: { status: succeeded, result: done, visited: [...], not_visited: [...], library: true,
//                 outputs: 1, min_visits: { draft: 2 }, approved: "startup-{task}", waiting_on: node }
//       board_refusal: { status: 409, error: "regex" }   # the board start must be refused this way
//       known_failure: { observed: …, root_cause: "file:line …", covered_by: … }
import { decideCard, type RunContext, type Scenario } from "../../scripts/acceptance/scenarios";

export type StubCard = { node: string; answers: string[]; note: string | null; before: string | null };
export type StubExpect = { status?: "succeeded" | "failed" | "cancelled"; result?: string | null; visited: string[]; not_visited: string[]; library: boolean; outputs?: number; min_visits: Record<string, number>; approved?: string; waiting_on?: string };
export type KnownFailure = { observed: string; root_cause: string; covered_by?: string };
export type StubRun = { workflow: string; name: string; covers: string; how: "board" | "firstmate" | "proposal" | "register" | "staffing" | "retired"; server: "sandbox" | "local-unrestricted";
  provider: string | null; topic: string; params: Record<string, string>; setup: string[]; cards: StubCard[]; expect: StubExpect | null; board_refusal: { status: number; error: RegExp } | null;
  known_failure: KnownFailure | null; target: { workflow: string; params: Record<string, string> } | null; timeout_s: number; shared: Scenario };

const HOWS = ["board", "firstmate", "proposal", "register", "staffing", "retired"];
const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const strings = (v: unknown, at: string): string[] => { if (v === undefined) return []; if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw new Error(`${at} must be a list of names`); return v; };

export function stubRuns(s: Scenario): StubRun[] {
  const where = `${s.file ?? s.workflow} stub`; const seen = new Set<string>();
  return (s.stub ?? []).map((raw: any, i) => {
    const at = `${where}[${i}]`;
    const known = ["name", "covers", "how", "server", "provider", "topic", "params", "setup", "cards", "expect", "board_refusal", "known_failure", "target", "timeout_s"];
    for (const k of Object.keys(raw)) if (!known.includes(k)) throw new Error(`${at}: unknown field ${k}`);
    if (typeof raw.name !== "string" || !raw.name || seen.has(raw.name)) throw new Error(`${at}: needs a unique name`); seen.add(raw.name);
    if (typeof raw.covers !== "string" || !raw.covers.trim()) throw new Error(`${at}: covers says what the run proves`);
    const how = raw.how ?? "board"; if (!HOWS.includes(how)) throw new Error(`${at}: how must be one of ${HOWS.join(", ")}`);
    const server = raw.server ?? "sandbox"; if (!["sandbox", "local-unrestricted"].includes(server)) throw new Error(`${at}: server must be sandbox or local-unrestricted`);
    if (raw.params !== undefined && (!isObj(raw.params) || Object.values(raw.params).some((v) => typeof v !== "string"))) throw new Error(`${at}: params map names to strings`);
    const cards: StubCard[] = (raw.cards ?? []).map((c: any, j: number) => {
      if (!isObj(c) || typeof c.node !== "string") throw new Error(`${at} cards[${j}]: needs a node`);
      for (const k of Object.keys(c)) if (!["node", "answer", "answers", "note", "before"].includes(k)) throw new Error(`${at} cards[${j}]: unknown field ${k}`);
      const answers = c.answers ?? (c.answer !== undefined ? [c.answer] : []);
      if (!Array.isArray(answers) || !answers.length || answers.some((a: unknown) => typeof a !== "string")) throw new Error(`${at} cards[${j}]: answer (one option) or answers (one per visit)`);
      return { node: c.node, answers, note: c.note ?? null, before: c.before ?? null };
    });
    let expect: StubExpect | null = null;
    if (raw.expect !== undefined) {
      const e = raw.expect; if (!isObj(e)) throw new Error(`${at}: expect must be a mapping`);
      for (const k of Object.keys(e)) if (!["status", "result", "visited", "not_visited", "library", "outputs", "min_visits", "approved", "waiting_on"].includes(k)) throw new Error(`${at} expect: unknown field ${k}`);
      if (e.waiting_on === undefined && !["succeeded", "failed", "cancelled"].includes(e.status)) throw new Error(`${at} expect: status succeeded, failed or cancelled (or waiting_on a node)`);
      expect = { status: e.status, result: e.result, visited: strings(e.visited, `${at} expect.visited`), not_visited: strings(e.not_visited, `${at} expect.not_visited`), library: e.library === true, outputs: e.outputs, min_visits: e.min_visits ?? {}, approved: e.approved, waiting_on: e.waiting_on };
    }
    const kf = raw.known_failure; if (kf !== undefined && (!isObj(kf) || typeof kf.observed !== "string" || typeof kf.root_cause !== "string")) throw new Error(`${at}: known_failure needs observed and root_cause`);
    const br = raw.board_refusal; if (br !== undefined && (!isObj(br) || !Number.isInteger(br.status) || typeof br.error !== "string")) throw new Error(`${at}: board_refusal needs status and error`);
    const tg = raw.target; if (tg !== undefined && (!isObj(tg) || typeof tg.workflow !== "string")) throw new Error(`${at}: target needs a workflow`);
    if (["proposal", "register", "staffing"].includes(how) && !tg) throw new Error(`${at}: how ${how} needs a target workflow`);
    return { workflow: s.workflow, name: raw.name, covers: raw.covers.trim(), how, server, provider: raw.provider === undefined ? s.start.provider : raw.provider, topic: raw.topic ?? s.topic,
      params: raw.params ?? {}, setup: strings(raw.setup, `${at} setup`), cards, expect, board_refusal: br ? { status: br.status, error: new RegExp(br.error) } : null,
      known_failure: kf ? { observed: kf.observed, root_cause: kf.root_cause, ...(kf.covered_by ? { covered_by: kf.covered_by } : {}) } : null,
      target: tg ? { workflow: tg.workflow, params: tg.params ?? {} } : null, timeout_s: Number(raw.timeout_s ?? 120), shared: s };
  });
}

/** The offline captain: the run's own card answers first, else the shared scenario's decision
 *  (decideCard against the run's definition and the authorization windows open for it, as the live driver decides). */
export function stubDecision(run: StubRun, card: any, visit: number, def: any, ctx: RunContext): { choice: string; note: string | null; before: string | null } | { stop: string } {
  const rule = run.cards.find((r) => r.node === card.node);
  if (rule) return { choice: rule.answers[Math.min(visit, rule.answers.length - 1)], note: rule.note, before: rule.before };
  const d = decideCard(run.shared, card, def, ctx);
  return d.action === "answer" ? { choice: d.choice, note: d.note, before: null } : { stop: d.action === "stop" ? d.reason : `the shared scenario leaves ${card.node} for a person` };
}
