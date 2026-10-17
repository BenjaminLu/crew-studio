import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Every shipped workflow passes its own readiness gate on an empty install (retro finding 25).
// A real Studio (`bun src/server.ts`, tests/acceptance/studio.ts) on empty temporary data with
// the stub vendor CLIs signed in and no example workflows seeded (what a new captain gets): every
// workflow the catalog offers, and the captain's copy of the Hello tutorial, is gated through the
// route the Workflows page uses (POST /api/wf/<id>/gate). No stage may report an error-level
// finding; a captain-only notice (staffing confirmed at Run) is fine. A held workflow cannot start
// a Task, so it is not gated here; it must still be listed as held with its reason.
import { bootStudio, type Studio } from "./acceptance/studio";

let pass = 0, fail = 0;
const ok = (v: any, name: string, detail = "") => { console.log(`${v ? "  ok   " : "  FAIL "} ${name}${v ? "" : " " + detail}`); v ? pass++ : fail++; };
let s: Studio | null = null;
const gate = async (id: string) => {
  const r = await s!.api(`/api/wf/${id}/gate`, {});
  let v = r.body;
  for (let i = 0; i < 600 && v.gate?.stages?.some((x: any) => x.status === "running"); i++) { await Bun.sleep(50); v = (await s!.api(`/api/wf/${id}/gate`)).body; }
  const errors = (v.gate?.stages ?? []).flatMap((x: any) => x.problems.filter((p: any) => p.level === "error").map((p: any) => `${x.id}/${p.code}@${p.node}: ${p.reason.en}`));
  return { status: r.status, v, errors };
};
try {
  s = await bootStudio("bundled-gate", { examples: false });
  const list = (await s.api("/api/wf")).body;
  const ids: string[] = (list.workflows ?? []).map((w: any) => w.id);
  ok(["code-firstmate", "hello-crew-studio", "images", "file-organization", "documents", "video", "web-prototype"].every((id) => ids.includes(id)), "the catalog offers the shipped workflows", ids.join(", "));
  ok(!ids.includes("startup-recursion"), "the startup competition example is not in a fresh catalog", ids.join(", "));
  for (const id of ids) {
    const { status, v, errors } = await gate(id);
    const dry = v.gate?.stages?.find((x: any) => x.id === "dryrun"); if (dry?.note?.en) console.log(`        ${id} dry run: ${dry.note.en}`);
    if (dry?.status === "skipped" && /staffing/.test(dry.note?.en ?? "")) ok(/^Not dry-run: (staffing not yet chosen; the captain picks who works on each node at Run|it starts only after the captain approves its staffing)\.$/.test(dry.note.en), `${id}: a staffing skip says it in captain terms, not the raw start refusal`, dry.note.en);
    ok(status === 200 && v.gate && !errors.length, `${id} passes its own gate on an empty install (no error-level findings)`, `HTTP ${status}\n      ${errors.join("\n      ")}`);
  }
  for (const w of list.held ?? []) ok(/^held: /.test(w.held?.en ?? ""), `${w.id} is held with its reason, so no Task starts on it (not gated here)`, JSON.stringify(w.held));
  // the Hello tutorial's copy: the captain's own starter made from the template (public/runtime.js)
  const copy = await s.api("/api/wf", { id: "hello-tutorial-copy", name: "Hello Crew Studio", template: "hello-crew-studio", origin: "starter" });
  ok(copy.status === 201, "the Hello tutorial copy is created", JSON.stringify(copy.body).slice(0, 300));
  const t = await gate("hello-tutorial-copy");
  ok(t.status === 200 && t.v.gate && !t.errors.length, "the Hello tutorial copy passes its own gate", `HTTP ${t.status}\n      ${t.errors.join("\n      ")}`);
  // the code workflow's notices are the captain's Run-time steps, never Firstmate's errors
  const cf = await gate("code-firstmate");
  const briefs = cf.v.gate.stages.find((x: any) => x.id === "brief").problems;
  ok(briefs.length > 0 && briefs.every((p: any) => p.code === "brief-after-staffing" && p.level === "notice" && p.owner === "captain" && p.need === "staffing"), "code-firstmate's briefs wait on the captain's staffing approval at Run (a notice)", JSON.stringify(briefs.map((p: any) => [p.code, p.level])));
} catch (e: any) { fail++; console.log("  FAIL  exception", e?.stack ?? e); }
finally { await s?.close(); }
console.log(`bundled-workflow-gate: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
