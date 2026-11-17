// A generic "Ship a feature" workflow for the Steps view (public/wf-rail.js) tests: take the request, plan, you approve, build, review, a QA
// check, open the pull request, a detour card when review gets stuck, two ends. Saved through the workflow API as v2 of a
// starter the test creates; sample data only.
export const SHIP_FEATURE = {
  roles: [
    { id: "planner", label: "Planner", skill: "pack:core/skills/coordinator.md" },
    { id: "builder", label: "Builder", skill: "pack:core/skills/coordinator.md" },
    { id: "reviewer", label: "Reviewer", skill: "pack:core/skills/coordinator.md" },
  ],
  nodes: [
    { id: "intake", kind: "hook", label: "Take the request", detail: "your change request", do: "note", args: { text: "request" }, x: -180, y: 100 },
    { id: "plan", kind: "agent", label: "Plan the change", detail: "a plan with done lines", role: "planner", mode: "draft", checks: [{ use: "core/brief-quality", blocking: false }], x: 0, y: 100 },
    { id: "approve-plan", kind: "card", label: "You approve the plan", card: { options: [{ id: "approve", label: "Approve", labelZh: "核准" }, { id: "change", label: "Change the plan", labelZh: "改計畫" }, { id: "close", label: "Close", labelZh: "關閉" }] }, x: 180, y: 100 },
    { id: "build", kind: "agent", label: "Build it", detail: "a tested change", role: "builder", mode: "draft", max_visits: 3, x: 360, y: 100 },
    { id: "review", kind: "agent", label: "Review the change", detail: "an approved change", role: "reviewer", mode: "review", x: 540, y: 100 },
    { id: "qa", kind: "check", label: "QA gate", checks: [{ use: "core/artifact-ready" }], x: 720, y: 100 },
    { id: "ship", kind: "hook", label: "Open the pull request", detail: "an open pull request", do: "note", args: { text: "ship" }, x: 900, y: 100 },
    { id: "stuck", kind: "card", label: "Rounds ran out: you decide", card: { options: [{ id: "more", label: "One more round", labelZh: "再一輪" }, { id: "close", label: "Close", labelZh: "關閉" }] }, x: 540, y: 300 },
    { id: "done", kind: "hook", label: "Done", x: 1080, y: 100 },
    { id: "closed", kind: "hook", label: "Closed", args: { result: "closed" }, x: 1080, y: 300 },
  ],
  edges: [
    { from: "intake", to: "plan" },
    { from: "plan", to: "approve-plan" },
    { from: "approve-plan", to: "build", when: "approve" },
    { from: "approve-plan", to: "plan", when: "change" },
    { from: "approve-plan", to: "closed", when: "close" },
    { from: "build", to: "review" },
    { from: "review", to: "qa" },
    { from: "review", to: "build", when: "changes" },
    { from: "review", to: "stuck", when: "blocked" },
    { from: "qa", to: "ship", when: "pass" },
    { from: "ship", to: "done" },
    { from: "stuck", to: "build", when: "more" },
    { from: "stuck", to: "closed", when: "close" },
  ],
};

/** Create the workflow and save the fixture as its v2, through the page's own session. */
export async function seedShipFeature(request, base, id = "ship-feature") {
  const made = await request.post(`${base}/api/wf`, { data: { id, name: "Ship a feature", locale: "en" } });
  if (!made.ok()) throw new Error(`create ${id}: ${made.status()} ${await made.text()}`);
  const v = (await made.json()).def.version;
  const saved = await request.post(`${base}/api/wf/${id}`, { data: { base: v, ...SHIP_FEATURE, description: "Plan a change, build it, get it reviewed, pass QA, open the pull request.", note: "fixture" } });
  if (!saved.ok()) throw new Error(`save ${id}: ${saved.status()} ${await saved.text()}`);
  return (await saved.json()).def;
}
