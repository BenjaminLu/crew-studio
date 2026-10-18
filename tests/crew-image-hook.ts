import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // temp folders only through the checked helper
// Image hook nodes on the Studio team (docs/design/crew-seats.md):
//   - an image hook (image.generate) is a crew slot on its declared seat (else image-maker) that needs image generation
//   - it resolves to a member that can generate images: its seat's, else the image-maker's (with a note); none: the seat is missing
//   - the Task records the image step's pick in its signed ledger like an agent node, and the image adapter runs that model
//     and effort instead of its own Codex choice; with no team, the adapter's own choice is unchanged
//   - a team with no member that can generate images refuses the start, and the seat card names the capability
//      bun tests/crew-image-hook.ts
import { createHash } from "node:crypto";
import { join } from "node:path";
import { suite, until } from "./rt-harness";
process.env.CREW_TEST_IN_PROCESS = "1";
const { ok, end } = suite("crew-image-hook");
const C = await import("../src/domain/crew");
const { createRuntime } = await import("../src/runtime");
const { Agents } = await import("../src/agent");
const { ArtifactStore } = await import("../src/artifacts");
const { StudioLog } = await import("../src/rawlog");
const { installCrewTools } = await import("../src/crew-tools");
const member = (provider: "codex" | "claude", model: string, effort: string | null) => ({ provider, model, effort, skills: [] });
const IMAGE_SEAT = { id: "image-maker", label: "Image maker", labelZh: "圖像產出", needs: ["image-generation"], suggest: { provider: "codex" as const } };
const base = (): any => ({ schema: 1, members: { coordinator: member("claude", "opus-5.5", "high"), maker: member("claude", "sonnet-5.5", "medium"), "alt-maker": member("codex", "gpt-6.1-sol", "medium"),
  reviewer: member("codex", "gpt-6-astra", "medium"), "design-reviewer": member("codex", "gpt-6-astra", "medium") }, seats: {}, workflows: {} });
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP437DvPwAH/AM9TriEzAAAAABJRU5ErkJggg==", "base64");
try {
  // ---------- resolution ----------
  {
    const hookOn = (seat?: string): any => ({ id: "fixture-pic", name: "Pic", kind: "image", version: 1, roles: [{ id: "image-worker", label: "Image maker", skill: "bundled:x", ...(seat ? { seat } : {}) }],
      nodes: [{ id: "draw", kind: "hook", label: "Draw", do: "image.generate", role: "image-worker", x: 0, y: 0 }, { id: "done", kind: "hook", label: "Done", x: 1, y: 0 }], edges: [["draw", "done"]] });
    const slot = C.slotsOf(hookOn()).find((s) => s.node === "draw");
    ok(slot?.seat === "image-maker" && slot.kind === "hook" && (slot as any).needs?.includes("image-generation"), "an image hook is a crew slot on the image-maker seat, needing image generation", JSON.stringify(slot));
    ok(!C.slotsOf(hookOn()).some((s) => s.node === "done"), "other hooks are not crew slots");
    ok(C.resolveCrew(base(), hookOn()).missing.join() === "image-maker", "with nobody on image-maker the seat is missing");
    const t = base(); t.seats["image-maker"] = IMAGE_SEAT; t.members["image-maker"] = member("codex", "gpt-image-2", "low");
    const r = C.resolveCrew(t, hookOn()).nodes.find((n) => n.node === "draw")!;
    ok(r.provider === "codex" && r.model === "gpt-image-2" && r.effort === "low" && r.source === "team", "with an image maker the hook runs its model and effort", JSON.stringify(r));
    const onMaker = C.resolveCrew(t, hookOn("maker")).nodes.find((n) => n.node === "draw")!;
    ok(onMaker.seat === "image-maker" && onMaker.model === "gpt-image-2" && onMaker.notes.some((n) => /cannot generate images/.test(n.en) && /不能產生圖片/.test(n.zh)), "a hook on a seat whose model cannot generate images runs on the image maker instead, with a note", JSON.stringify(onMaker));
    const onAlt = C.resolveCrew(t, hookOn("alt-maker")).nodes.find((n) => n.node === "draw")!;
    ok(onAlt.seat === "alt-maker" && onAlt.model === "gpt-6.1-sol", "a hook on a seat that can generate images keeps that seat's member");
    // a reviewer moved off the maker's model never lands on the image maker's model
    { const tr = structuredClone(t); tr.members.reviewer = member("claude", "sonnet-5.5", "medium"); tr.members["alt-maker"] = member("claude", "sonnet-5.5", "medium"); tr.members["design-reviewer"] = member("claude", "sonnet-5.5", "medium"); tr.members.coordinator = member("claude", "sonnet-5.5", "medium");
      const rev = { id: "fixture-rev", name: "Rev", kind: "web", version: 1, roles: [{ id: "w", label: "W", skill: "bundled:x", seat: "maker" }, { id: "r", label: "R", skill: "bundled:x", seat: "reviewer" }], nodes: [{ id: "m", kind: "agent", label: "M", role: "w", x: 0, y: 0 }, { id: "c", kind: "agent", label: "C", role: "r", x: 1, y: 0 }], edges: [["m", "c"]] };
      const c = C.resolveCrew(tr, rev).nodes.find((n) => n.node === "c")!;
      ok(c.model !== "gpt-image-2" && c.notes.some((n) => /not an independent opinion/.test(n.en)), "the reviewer rule never swaps in an image model", JSON.stringify(c)); }
    { const { crewView } = await import("../src/crew-routes"); const d = hookOn();
      const v: any = crewView({ defs: { catalog: () => [{ id: d.id, version: 1 }], get: () => d } as any, store: new C.CrewStore(checkedTempDir("crew-image-view-")), facts: () => [], library: () => [] });
      ok(v.seats.some((s: any) => s.id === "image-maker" && s.declared?.needs?.includes("image-generation")), "an image hook on no declared seat shows the image maker on the Crew page, so it can be filled"); }
    const solo = base(); const res = C.resolveCrew(solo, hookOn("maker"));
    ok(res.missing.join() === "image-maker", "no member that can generate images: the image-maker seat is missing", JSON.stringify(res.missing));
  }
  // ---------- a Task: the ledger and the adapter ----------
  const boot = (team: any | null) => {
    const data = checkedTempDir("crew-image-hook-"), store = new ArtifactStore(data), calls: any[] = [];
    if (team) new C.CrewStore(data).write(team, null, { by: "captain", via: "page" });
    const rt: any = createRuntime({ dataDir: data, agents: new Agents(data, () => ""), provider: () => { throw new Error("No language provider in image fixture"); }, defaultProvider: () => ({ provider: "stub", model: null }),
      log: new StudioLog(join(data, "events")), send() {}, fmRoot: join(data, "fm"), protectedRoots: [], m3: { store, lane: {} } as any, fileorg: {} as any, docs: {} as any, readiness: false,
      generateImage: async (_prompt: string, authorize: () => void, _signal: AbortSignal, _reference?: any, _rules?: any, crew?: any) => { authorize(); calls.push(crew ?? null);
        return { bytes: png, mime: "image/png", width: 1, height: 1, sha256: createHash("sha256").update(png).digest("hex"), provider: "codex", model: crew?.model ?? "configured-model", effort: crew?.effort ?? "medium" }; } } as any);
    return { rt, E: rt.engine, calls };
  };
  {
    const t = base(); t.seats["image-maker"] = IMAGE_SEAT; t.members["image-maker"] = member("codex", "gpt-image-2", "low");
    const { E, calls } = boot(t);
    const run = E.start({ workflow: "images", text: "A red balloon", params: { provider: "codex" } });
    await until(() => E.cards.list({ run: run.id, open: true }).some((c: any) => c.node === "accept") || ["failed", "cancelled"].includes(E.get(run.id)!.status));
    const rec = E.trusted(run.id).entries.find((x: any) => x.record === "crew-resolved")?.data as any;
    ok(rec?.nodes?.draft?.provider === "codex" && rec.nodes.draft.model === "gpt-image-2" && rec.nodes.draft.effort === "low" && rec.nodes.draft.seat === "image-maker", "the Task's signed ledger records the image step's pick like an agent node", JSON.stringify(rec?.nodes));
    ok(calls.length === 1 && calls[0]?.model === "gpt-image-2" && calls[0]?.effort === "low", "the image adapter runs the crew's model and effort", JSON.stringify(calls) + (E.get(run.id)!.error ?? ""));
    for (const x of E.list()) if (!["failed", "cancelled", "succeeded"].includes(x.status)) { try { await E.cancel(x.id); } catch {} }
  }
  {
    const { E, calls } = boot(null);
    const run = E.start({ workflow: "images", text: "A red balloon", params: { provider: "codex" } });
    await until(() => calls.length > 0 || ["failed", "cancelled"].includes(E.get(run.id)!.status));
    ok(calls.length === 1 && calls[0] === null, "with no team the adapter keeps its own Codex choice", JSON.stringify(calls));
    for (const x of E.list()) if (!["failed", "cancelled", "succeeded"].includes(x.status)) { try { await E.cancel(x.id); } catch {} }
  }
  {
    const { E } = boot(base());
    let refused = ""; try { E.start({ workflow: "images", text: "A red balloon", params: { provider: "codex" } }); } catch (e: any) { refused = e.message; }
    ok(/needs the team seat image-maker/.test(refused), "a team with nobody to generate images refuses the start, naming the seat", refused);
    const crew = installCrewTools(E, new C.CrewStore(E.deps.dataDir), { facts: async () => [{ provider: "claude", support: "supported", auth: "verified", models: [{ id: "opus-5.5", efforts: [] }] }] as any });
    refused = ""; try { await crew.seatGate(E.defs.get("images"), { key: "w-images" }); } catch (e: any) { refused = e.message; }
    const run = E.list().find((x: any) => x.workflow === "crew-change" && x.params.reason === "seat-unmet");
    await until(() => !!run && E.cards.list({ run: run.id, open: true }).length > 0);
    const card = run && E.cards.list({ run: run.id, open: true })[0];
    ok(/Image maker/.test(refused) && !!card && /generate images/.test(card.title.en) && /產生圖片/.test(card.title["zh-TW"]), "the seat card names the missing capability", card?.title.en ?? refused);
    for (const x of E.list()) if (!["failed", "cancelled", "succeeded"].includes(x.status)) { try { await E.cancel(x.id); } catch {} }
  }
} catch (e: any) { ok(false, "crew-image-hook threw", e?.stack ?? String(e)); }
end();
