// Authority (fix round 1, runtime class "authority", check-runtime#6; arch §1.8, §3.4):
// only a signed grant the captain opened in Studio may answer cards. A workflow
// definition, a pack, a bundled or hand-written policy file can never open an
// authorization window; granted_by is the captain's own action; a window never
// confirms a one-way door.     bun tests/authority.ts
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { harness, sleep, suite, until, Y } from "./rt-harness";
const { ok, end } = suite("authority");
const card = (id: string, door: string | null, extra: any = {}) => Y({ id, name: id, roles: [], ...extra, nodes: [
  { id: "a", kind: "hook", label: "A", do: "set", args: { key: "door", value: door ? { door } : null }, x: 0, y: 0 },
  { id: "q", kind: "card", label: "Merge?", args: { card_kind: "merge" }, card: { title: "Merge", confirm_door: true, door_from: "door", auto_option: "merge", options: [{ id: "close", label: "Close", primary: true, hold: true }, { id: "merge", label: "Merge" }] }, x: 1, y: 0 },
  { id: "m", kind: "hook", label: "Merged", args: { result: "merged" }, x: 2, y: 0 }, { id: "c", kind: "hook", label: "Closed", args: { result: "closed" }, x: 2, y: 1 }],
  edges: [["a", "q"], ["q", "m", "merge"], ["q", "c", "close"]] });
const window = { auth: { window: { kinds: ["merge"], until: "2099-01-01T00:00:00Z", granted_by: "a pack", one_way: true } } };
const H = await harness([card("plain", null), card("viadef", null, { policies: window }), card("oneway", "one-way")]);
const E = H.engine;
const waitCard = async (id: string) => { await until(() => E.cards.list({ run: id }).length > 0, 8000); await sleep(300); return E.cards.list({ run: id })[0]; };

// a workflow definition carrying an auth window answers nothing
{ const r = E.start({ workflow: "viadef", text: "x" }); const c = await waitCard(r.id);
  ok(c.status === "open", "a workflow definition carrying auth.window does not answer cards"); }
// a hand-written org policy file answers nothing either
mkdirSync(join(H.data, "policies"), { recursive: true }); writeFileSync(join(H.data, "policies", "org.yaml"), "auth:\n  window: { kinds: [merge], until: \"2099-01-01T00:00:00Z\", granted_by: someone }\n");
{ const r = E.start({ workflow: "plain", text: "x" }); const c = await waitCard(r.id);
  ok(c.status === "open" && E.policies.get("auth.window").value === undefined, "a policy file (org, project or pack) carrying auth.window does not answer cards"); }
// only the captain opens a window
let e1 = ""; try { E.grants.add({ kinds: ["merge"], until: "2099-01-01T00:00:00Z" }, "pack firstmate"); } catch (e: any) { e1 = e.message; }
ok(/only the captain/.test(e1), "only the captain's own action opens a window");
const g = E.grants.add({ kinds: ["merge"], until: "2099-01-01T00:00:00Z" }, "captain (desktop)");
{ const r = E.start({ workflow: "plain", text: "x" }); await until(() => E.get(r.id)!.status === "succeeded", 8000);
  const c = E.cards.list({ run: r.id })[0]; const led = E.ledger(r.id).find((e) => e.record === "card-answer");
  ok(E.get(r.id)!.result === "merged" && c.answer?.choice === "merge", "a captain's grant answers the listed kind with the workflow's auto option", JSON.stringify(c.answer));
  ok(new RegExp(`auth window ${g.id} \\(granted by captain \\(desktop\\)`).test(led?.actor ?? ""), "the ledger records the grant id and who granted it", led?.actor ?? ""); }
// a window never confirms a one-way door
{ const r = E.start({ workflow: "oneway", text: "x" }); const c = await waitCard(r.id);
  ok(c.status === "open" && c.door === "one-way", "a one-way merge card stays open inside a window"); }
// an edited grant line is ignored (its signature no longer holds)
const f = join(H.data, "policies", "grants.jsonl"); const lines = readFileSync(f, "utf8").trim().split("\n");
const forged = JSON.parse(lines[0]); forged.kinds = ["merge", "dispatch"]; forged.until = "2199-01-01T00:00:00.000Z"; writeFileSync(f, JSON.stringify(forged) + "\n");
ok(E.grants.open("merge", null) === null && E.grants.open("dispatch", null) === null, "an edited grant is ignored");
// a revoked or expired grant answers nothing
const g2 = E.grants.add({ kinds: ["merge"], until: "2099-01-01T00:00:00Z" }, "captain (desktop)"); E.grants.revoke(g2.id, "captain (desktop)");
ok(E.grants.open("merge", null) === null, "a revoked grant answers nothing");
const g3 = E.grants.add({ kinds: ["merge"], until: new Date(Date.now() + 400).toISOString() }, "captain (desktop)"); await sleep(600);
ok(g3 && E.grants.open("merge", null) === null, "an expired grant answers nothing");
H.stop();
end();
