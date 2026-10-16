import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// One locator schema for machine findings and human annotations
// (docs/check-contract.md "Locator"): M3's web pins, timeline ranges (with a box)
// and document blocks are stored with a locator, older notes get one on read,
// and a version's notes come out as findings of the same type a check produces.
//   bun tests/locators.ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const { ArtifactStore } = await import("../src/artifacts");
const { parseFinding, locatorText } = await import("../src/runtime/locator");
const { createM3 } = await import("../src/m3");
const data = mkdtempSync(join(tmpdir(), "crew-loc-"));
const st = new ArtifactStore(data);
const src = (name: string, body: string) => { const d = join(data, "src-" + name); mkdirSync(d, { recursive: true }); writeFileSync(join(d, name), body); return d; };
st.create({ id: "page", title: "Page", type: "web", source: "html", entry: "index.html" });
st.addVersion("page", { from: src("index.html", "<h1>Hi</h1>"), primary: "index.html", createdBy: { kind: "captain" } });
st.create({ id: "clip", title: "Clip", type: "video", source: "film", entry: "film.html" });
st.addVersion("clip", { from: src("film.html", "<div id=stage></div>"), primary: "film.html", createdBy: { kind: "captain" } });
st.create({ id: "memo", title: "Memo", type: "doc", source: "md", entry: "doc.md" });
st.addVersion("memo", { from: src("doc.md", "# Memo\n\nText.\n"), primary: "doc.md", createdBy: { kind: "captain" } });

const pin = st.addNote("page", 1, { kind: "pin", selector: "h1", bbox: { x: 10, y: 20, w: 300, h: 40 }, comment: "make it bigger" });
ok(pin.locator?.type === "web" && (pin.locator as any).selector === "h1" && (pin.locator as any).x === 10 && (pin.locator as any).w === 300 && (pin.locator as any).viewport.w === 1280 && (pin.locator as any).url === "/af/page/1/index.html", "a web pin is stored with a web locator (url, selector, box, viewport)", JSON.stringify(pin.locator));
const rng = st.addNote("clip", 1, { kind: "range", t0: 2, t1: 3.5, box: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 }, comment: "frozen here" });
ok(rng.locator?.type === "timeline" && (rng.locator as any).from === 2 && (rng.locator as any).to === 3.5 && JSON.stringify((rng.locator as any).bbox) === "[0.1,0.2,0.3,0.4]", "a timeline range with a box is stored with a timeline locator (from, to, bbox)", JSON.stringify(rng.locator));
const blk = st.addNote("memo", 1, { kind: "pin", selector: "#b2", comment: "say why" });
ok(blk.locator?.type === "text" && (blk.locator as any).section === "#b2", "a document block note is stored with a text locator", JSON.stringify(blk.locator));
// an older note, saved before locators existed, gets one on read
const f = join(data, "artifacts", "page", "v1", "notes.json"); const raw = JSON.parse(readFileSync(f, "utf8")); raw.push({ id: "P9", kind: "pin", comment: "old", createdAt: "2026-10-01T00:00:00Z", status: "open", selector: ".cta", bbox: null }); writeFileSync(f, JSON.stringify(raw));
ok(st.notes("page", 1).find((x) => x.id === "P9")?.locator?.type === "web", "a note saved before locators existed gets one on read");
const fs = st.findings("page", 1);
const machine = parseFinding({ locator: { type: "web", url: "/af/page/1/index.html", selector: "h1", viewport: { w: 1280, h: 800 } }, message: "contrast too low", expected: "4.5:1", class: "contrast", severity: "blocking" }, "check", "web/contrast")!;
ok(fs.length === 2 && fs.every((x) => x.source === "human" && x.severity === "blocking" && x.locator) && JSON.stringify(Object.keys(fs[0]).sort()) === JSON.stringify(Object.keys(machine).sort()), "a version's notes come out as findings with the same fields as a check's finding");
ok(JSON.stringify(parseFinding(JSON.parse(JSON.stringify(fs[0])), "human")!.locator) === JSON.stringify(fs[0].locator), "a human finding passes the same locator validation as a machine one");
ok(/h1/.test(locatorText(fs[0].locator)) && /0:02\.0–0:03\.5/.test(locatorText(st.findings("clip", 1)[0].locator)), "both print the same way in a brief (locatorText)");
st.updateNote("page", 1, pin.id, { status: "resolved" });
ok(st.findings("page", 1).length === 1 && st.findings("page", 1, false).length === 2, "resolved notes leave the open findings");
const m3 = createM3({ dataDir: data, fileAllow: [], studioUrl: () => "http://127.0.0.1:1", provider: () => ({}) as any, send: () => {}, allowDrive: () => true });
const res = await m3.handle(new Request("http://x/api/artifacts/clip/v/1/findings"), new URL("http://x/api/artifacts/clip/v/1/findings"), { kind: "desktop" }, false);
const body = await res!.json();
ok(Array.isArray(body) && body[0]?.locator?.type === "timeline" && body[0].source === "human", "GET /api/artifacts/<id>/v/<n>/findings returns the notes as findings");
console.log(`\nlocators: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
