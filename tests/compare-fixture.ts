// A seeded startup competition Task for the compare-transcripts tests: the real startup-recursion workflow and
// its domain steps, a fixture provider in place of Claude and Codex (no paid call), three founder/judge rounds,
// waiting on the captain's acceptance card. Plus a plain two-round workflow that declares no pairs. Temp data only.
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { harness, until, Y } from "./rt-harness";
import { ArtifactStore } from "../src/artifacts";
import { installStartupRecursion } from "../src/domain/startup-recursion";

export const FLOW = readFileSync(join(import.meta.dir, "../workflows/v2/startup-recursion.wf.yaml"), "utf8");
/** a credential planted into the files after the round wrote them: the reader must hide it */
export const PLANTED = "ghp_" + "Q1w2E3r4T5y6U7i8O9p0A1s2D3f4G5h6J7k8";
export const PLAIN = Y({ id: "plain-two", name: "Plain two rounds", roles: [{ id: "writer", label: "Writer", skill: "x" }, { id: "editor", label: "Editor", skill: "x" }], nodes: [
  { id: "draft", kind: "agent", label: "Draft", role: "writer", mode: "test", args: { say: "write the draft" }, x: 0, y: 0 },
  { id: "edit", kind: "agent", label: "Edit", role: "editor", mode: "test", args: { say: "edit the draft" }, x: 1, y: 0 },
  { id: "end", kind: "hook", label: "Done", x: 2, y: 0 }], edges: [["draft", "edit"], ["edit", "end"]] });

export async function seeded(o: { data?: string } = {}) {
  const H = await harness([FLOW, PLAIN], o);
  const store = new ArtifactStore(H.data);
  installStartupRecursion(H.engine, { artifacts: store });
  const stub = H.engine.deps.provider;
  H.engine.deps.provider = ((id = "codex", model = "fixture-model") => ({ id, model, sandboxFree: true, start(sys: any, tools: any, ctx: any) { return { interrupt() {}, async *send(text: string) {
    if (!text.includes("STARTUP COMPETITION")) { yield* (stub as any)(id, model).start(sys, tools, ctx).send(text); return; } // the plain workflow's stub agent
    const judge = text.includes("Role: judge"), round = Number(/round: (\d)/.exec(text)![1]);
    const payload = judge ? { text: `評審第 ${round} 輪：付費意願仍未驗證。先找五家付費試點，再談成長預算。Critique round ${round}.`, score: 60 + round * 5, verdict: "revise" }
      : { text: `創業提案第 ${round} 輪：給獨立咖啡店主理人的在地顧客研究服務，先做付費試點，營收假設明確標示未驗證。Proposal round ${round}.`, revision: round === 1 ? "" : `回應第 ${round - 1} 輪評審：改成五家付費試點，並降低成本。` };
    yield { type: "message", text: judge ? `我會檢查第 ${round} 輪提案的付費證據。` : `我先寫第 ${round} 輪提案。` };
    yield { type: "toolStart", id: `submit-${round}`, name: "startup_submit", args: payload };
    const result = await H.agents.callTool(ctx.token, "startup_submit", payload);
    yield { type: "toolEnd", id: `submit-${round}`, result: JSON.stringify(result) };
    yield { type: "message", text: judge ? `已提交：${payload.score}/100，revise。` : `已提交第 ${round} 輪提案。` };
    yield { type: "turnEnd", status: "ok", usage: { usd: 0.01, inTokens: 100 * round, outTokens: 50 * round } };
  } }; } }) as any) as any;
  const run = H.engine.start({ workflow: "startup-recursion", text: "Fixture only: 『我是主理人』創業競賽。", params: { founderModel: "fixture-claude", judgeModel: "fixture-codex" } });
  if (!(await until(() => H.engine.cards.list({ run: run.id, open: true }).length === 1))) throw new Error("no choice card");
  await H.engine.answer(H.engine.cards.list({ run: run.id, open: true })[0].id, { choice: "template", by: "fixture captain" });
  if (!(await until(() => H.engine.cards.list({ run: run.id, open: true }).some((c: any) => c.node === "accept"), 30000))) throw new Error(`startup did not reach acceptance: ${JSON.stringify(H.engine.get(run.id)?.nodes)}`);
  const plain = H.engine.start({ workflow: "plain-two", text: "Write and edit one paragraph." });
  if (!(await until(() => H.engine.get(plain.id)?.status === "succeeded" && !H.engine.busy(plain.id), 20000))) throw new Error("plain run did not finish");
  return { H, store, startup: run.id, plain: plain.id };
}

/** Plant the credential into a round's prompt, stream and report, the way an older record or an unknown secret could hold it. */
export function plant(data: string, run: string, node: string, visit = 1) {
  const d = join(data, "runs", run, "nodes", node, String(visit));
  appendFileSync(join(d, "prompt.md"), `\nOld note: token=${PLANTED}\n`);
  appendFileSync(join(d, "stream.jsonl"), JSON.stringify({ ts: new Date().toISOString(), type: "message", text: `leaked ${PLANTED} in a message` }) + "\n"
    + JSON.stringify({ ts: new Date().toISOString(), type: "tool_call", id: "x", name: "Bash", args: { command: `curl -H 'Authorization: Bearer ${PLANTED}'`, token: PLANTED } }) + "\n");
  const rp = join(d, "report.json"); const r = JSON.parse(readFileSync(rp, "utf8"));
  r.said = `${r.said ?? ""} and ${PLANTED}`; writeFileSync(rp, JSON.stringify(r));
}
