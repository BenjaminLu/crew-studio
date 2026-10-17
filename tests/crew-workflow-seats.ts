import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // temp folders only through the checked helper
// Every built-in workflow's agents declare their team seat (docs/design/crew-seats.md, decision 9):
//   - every agent role and agent/loop node of every built-in workflow has a declared seat, and each definition validates
//   - web-prototype's design-b is the second maker: a web-prototype Task records design-a and design-b on different models
//   - reviewers are the reviewer seat, designer reviews the design-reviewer seat; coffee's image worker is a specialist seat
//     that needs image generation
//   - a seat that is neither built in nor declared is refused
//      bun tests/crew-workflow-seats.ts
import { harness, suite } from "./rt-harness";
const { ok, end } = suite("crew-workflow-seats");
const { bundledList, bundledText, parseYaml } = await import("../src/bundled");
const { normalize, validate } = await import("../src/runtime/defs");
const C = await import("../src/domain/crew");
const { installCrewGuard } = await import("../src/crew-guard");
const files = [...bundledList("workflows/v2/"), ...bundledList("packs/")].filter((f) => f.endsWith(".wf.yaml"));
try {
  const defs = files.map((f) => normalize(parseYaml(bundledText(f)!)));
  const undeclared: string[] = [];
  for (const d of defs) { for (const s of C.slotsOf(d)) if (!s.declared) undeclared.push(`${d.id}/${s.node}`); for (const r of d.roles) if (!r.seat) undeclared.push(`${d.id} role ${r.id}`); }
  ok(defs.length >= 10 && undeclared.length === 0, "every built-in agent role and node declares its team seat", undeclared.join(", "));
  const problems = defs.flatMap((d) => validate(d).filter((p) => p.level === "error" && /seat/.test(p.text)).map((p) => `${d.id}: ${p.text}`));
  ok(problems.length === 0, "every built-in definition's seats validate", problems.join("; "));
  const get = (id: string) => defs.find((d) => d.id === id)!;
  const seats = (id: string) => Object.fromEntries(C.slotsOf(get(id)).map((s) => [s.node, s.seat]));
  ok(seats("web-prototype")["design-a"] === "maker" && seats("web-prototype")["design-b"] === "alt-maker", "web-prototype: design-a is the maker, design-b the second maker", JSON.stringify(seats("web-prototype")));
  const code = seats("code-firstmate");
  ok(code.spec === "coordinator" && code.build === "maker" && code.review === "reviewer" && code.designer === "design-reviewer", "code-firstmate: coordinator, maker, reviewer, design reviewer", JSON.stringify(code));
  ok(get("github-review").roles.find((r) => r.id === "reviewer")?.seat === "reviewer" && seats("documents").draft === "maker" && seats("video").draft === "maker", "github-review's reviewer, documents' and video's makers");
  const img = get("coffee-kit").roles.find((r) => r.id === "image-worker");
  ok(img?.seat === "image-maker" && get("coffee-kit").seats?.find((s) => s.id === "image-maker")?.needs?.includes("image-generation"), "coffee's image worker sits on a specialist seat that needs image generation");
  const bad = { ...get("documents"), roles: get("documents").roles.map((r) => ({ ...r, seat: "drummer" })) };
  ok(validate(bad).some((p) => p.level === "error" && /seat drummer is not a team seat/.test(p.text)), "an undeclared seat is refused");
  // a web-prototype Task: A and B on different models, recorded in the ledger
  const h = await harness([bundledText("workflows/v2/web-prototype.wf.yaml")!], { data: checkedTempDir("crew-web-ab-") }), e = h.engine;
  const store = new C.CrewStore(h.data); installCrewGuard(e, store);
  const m = (provider: "codex" | "claude", model: string, effort: string) => ({ provider, model, effort, skills: [] });
  // even a team whose second maker is the maker's own model: the rule moves B to another model, with a note
  store.write({ schema: 1, members: { maker: m("codex", "gpt-6.1-sol", "medium"), "alt-maker": m("codex", "gpt-6.1-sol", "medium"), reviewer: m("claude", "opus-5.5", "high"), "design-reviewer": m("codex", "gpt-6-astra", "medium") }, seats: {}, workflows: {} }, null, { by: "captain", via: "page" });
  const run = e.start({ workflow: "web-prototype", text: "a page for a tofu pudding shop" });
  const rec = e.trusted(run.id).entries.find((x) => x.record === "crew-resolved")?.data as any;
  ok(rec?.nodes["design-a"].model === "gpt-6.1-sol" && rec.nodes["design-b"].model !== rec.nodes["design-a"].model && rec.nodes["design-b"].notes.length === 1, "web-prototype: design-a and design-b run on different models, and the record says why", JSON.stringify(rec?.nodes));
  ok(e.deps.approvedPick(run, run.def.nodes.find((n: any) => n.id === "design-b"), undefined)?.model === rec.nodes["design-b"].model, "design-b's turns run the recorded model");
  h.stop();
} catch (e: any) { ok(false, "crew-workflow-seats threw", e?.stack ?? String(e)); }
end();
