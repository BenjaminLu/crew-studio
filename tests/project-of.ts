// Which project a run is in (projects design §3.2) and the `project` a wrun live event carries.
//   bun tests/project-of.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectOf } from "../src/runtime/engine";
import { createTasksApi } from "../src/tasks-api";
import { harness, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("project-of");

const reg = { ids: new Set(["harbor-api", "sandbox", "local-3fa9c2e1"]), byPath: (p: string) => (p === "/repos/harbor" ? "harbor-api" : null) };
const run = (o: any) => ({ workflow: "code-firstmate", params: {}, ctx: {}, def: { kind: "code" }, ...o });

ok(projectOf(run({ ctx: { project: "harbor-api" }, params: { project: "sandbox" } }), reg) === "harbor-api", "1. ctx.project (set by repo.prepare) wins");
ok(projectOf(run({ params: { project: "local-3fa9c2e1" } }), reg) === "local-3fa9c2e1", "a code run names its registered project in params.project");
ok(projectOf(run({}), reg) === "sandbox", "a code run with neither project nor repo works on the sandbox");
ok(projectOf(run({ params: { repo: "/repos/harbor" } }), reg) === "harbor-api", "a code run with params.repo resolves to the registered project at that path");
ok(projectOf(run({ params: { repo: "/repos/unknown" } }), reg) === "studio", "a code run with an unregistered params.repo has no project");
ok(projectOf(run({ ctx: { project: "gone" }, params: { project: "gone" } }), reg) === "studio", "a project that is no longer registered resolves to studio");
const proposal = { workflow: "firstmate-proposal", def: { kind: "native" }, ctx: {}, params: { project: JSON.stringify({ binding: "x" }), target: JSON.stringify({ workflow: "code-firstmate", version: 1, params: { project: "harbor-api" } }) } };
ok(projectOf(proposal as any, reg) === "harbor-api", "2. a firstmate-proposal resolves to its target's project, not its binding");
ok(projectOf({ ...proposal, params: { project: "harbor-api", target: "coffee-proposal-abc" } } as any, reg) === "studio", "a coffee proposal (content-addressed target) has no registered project");
ok(projectOf({ workflow: "documents", def: { kind: "documents" }, ctx: {}, params: { project: "harbor-api" } } as any, reg) === "harbor-api", "3. params.project when it is a registered id");
ok(projectOf({ workflow: "documents", def: { kind: "documents" }, ctx: {}, params: { project: "nope" } } as any, reg) === "studio", "an unregistered params.project is not a project");
ok(projectOf({ workflow: "coffee-kit", def: { kind: "coffee-kit" }, ctx: {}, params: { project: "harbor-api" } } as any, reg) === "coffee:harbor-api", "4. a coffee-kit run keeps its own artifact namespace, never a registered id");
ok(projectOf({ workflow: "coffee-kit", def: { kind: "coffee-kit" }, ctx: {}, params: {} } as any, reg) === "coffee:coffee-kit", "a coffee-kit run without a name uses the workflow namespace");
ok(projectOf({ workflow: "images", def: { kind: "images" }, ctx: {}, params: {} } as any, reg) === "studio", "5. anything else is studio (no project)");

// the engine reads data/projects.json, and every wrun live event carries the run's project
const H = await harness([Y({ id: "po", name: "po", roles: [], nodes: [{ id: "s", kind: "hook", label: "Set", do: "set", args: { key: "x", value: 1 }, x: 0, y: 0 }, { id: "k", kind: "card", label: "Ask", card: { title: "Ok?", options: [{ id: "go", label: "Go" }] }, x: 1, y: 0 }], edges: [["s", "k"]] })]);
const E = H.engine as any;
mkdirSync(H.data, { recursive: true });
writeFileSync(join(H.data, "projects.json"), JSON.stringify([{ id: "harbor-api", name: "harbor-api", path: null, base: "main", sensitive: [], proposed: null, proposedAt: null, approvedAt: null }]));
const a = E.start({ workflow: "po", text: "with project", params: { project: "harbor-api" } });
const b = E.start({ workflow: "po", text: "without project" });
await until(() => E.get(a.id).status === "waiting" && E.get(b.id).status === "waiting", 15000);
const evs = (id: string) => H.sent.filter(([t, d]: any) => t === "wrun" && d.id === id).map(([, d]: any) => d);
ok(evs(a.id).length > 0 && evs(a.id).every((d: any) => d.project === "harbor-api"), "wrun events of a project's run carry its project", JSON.stringify(evs(a.id).map((d: any) => d.project)));
ok(evs(b.id).length > 0 && evs(b.id).every((d: any) => d.project === "studio"), "wrun events of a run with no project carry studio");
ok(E.projectRow(E.get(a.id)) === "harbor-api" && E.projectRow(E.get(b.id)) === "studio", "projectRow: a registered id or studio");

// GET /api/tasks?project=<id>
const api = createTasksApi({ list: () => E.list(), get: (id) => E.get(id), openCards: () => E.cards.list({ open: true }), runView: async () => null, projectOf: (r) => E.projectRow(r) });
const call = async (p: string) => (await (await api.handle(new URL(`http://x${p}`), false))!.json());
const inProject = await call("/api/tasks?project=harbor-api"), inStudio = await call("/api/tasks?project=studio"), all = await call("/api/tasks");
ok(inProject.tasks.map((t: any) => t.id).join() === a.id, "?project=<id> lists only that project's Tasks", JSON.stringify(inProject.tasks.map((t: any) => t.id)));
ok(inStudio.tasks.map((t: any) => t.id).join() === b.id, "?project=studio lists the Tasks in no project");
ok(all.tasks.length === 2, "no filter lists every Task");
ok(inProject.cards.every((c: any) => c.run === a.id) && inProject.cards.length === 1, "the filtered list carries only its Tasks' cards");
const t = inProject.tasks[0];
ok(t.waitsOn?.kind === "captain" && t.waitsOn.node === "k" && t.waitsOn.card === inProject.cards[0].id && "result" in t, "a Task view carries result and who it waits on", JSON.stringify(t.waitsOn));
H.stop();
end();
