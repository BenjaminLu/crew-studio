import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// A review room's page version as a file (docs/units/review-room.md "Downloading a page", src/domain/review-download.ts): the
// route GET /api/review-room/<room>/page/<v>/download and a Library save's …/library/<artifact>/<n>/page/<v>/download, on a
// real isolated Studio with a room seeded on disk (tests/lib/review-room-download-fixture.mjs): the bytes exactly as kept, one
// file or a zip, an attachment with a sanitised name, never cached, never rendered; a file changed since it was kept is
// refused (integrity); no such room or version is a 404; a write is refused; a paired phone gets 403 desktopOnly.
//        bun tests/review-room-download.ts
import { readFileSync, writeFileSync } from "node:fs";
import { downloadName } from "../src/domain/review-download";
import { FILES, ID, ODD_SKILL, phone, sha, startStudio, unzipEntries } from "./lib/review-room-download-fixture.mjs";

let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };

// ---------- the file name: ASCII, no path, no quote, never empty ----------
{ const odd = downloadName(ID, 1, ODD_SKILL, ".html"), evil = downloadName('SC-1"; x=/../', 2, "\u0000\r\n../../etc/passwd", ".HTML"), empty = downloadName("", 3, "中文", ".weird-ext!");
  const safe = (s: string) => /^[A-Za-z0-9._-]+$/.test(s) && !s.includes("..") && !s.startsWith(".");
  ok(odd === `${ID}-v1-walk-.-through.html` && safe(odd), "a skill id with CJK, spaces, quotes, a slash and dots becomes ASCII letters, digits, . _ - only", odd);
  ok(evil === "SC-1-x-v2-etc-passwd.html" && safe(evil), "quotes, control characters and ../ never reach the name; the extension is lowercased", evil);
  ok(empty === "room-v3-page.bin" && safe(empty), "an empty part gets a plain word; an extension that is not one becomes .bin", empty); }

const s = await startStudio("room-download");
const url = (v: number | string, id = ID) => `${s.base}/api/review-room/${id}/page/${v}/download`;
const get = (u: string, init: RequestInit = {}) => fetch(u, { ...init, headers: { "x-crew-session": process.env.CREW_SESSION_TOKEN!, ...(init.headers ?? {}) } });
try {
  // ---------- one file: the page's bytes exactly as kept ----------
  { const r = await get(url(3)), body = Buffer.from(await r.arrayBuffer());
    ok(r.status === 200 && sha(body) === sha(FILES[3].files["index.html"]) && body.equals(Buffer.from(FILES[3].files["index.html"])), "v3 (baton's one self-contained page) downloads byte for byte as kept, its sha256 the version's", `${r.status} ${sha(body)}`);
    ok(r.headers.get("content-disposition") === `attachment; filename="${ID}-v3-studio-baton.html"`, "as an attachment named <room>-v<n>-<skill>.html", String(r.headers.get("content-disposition")));
    ok(/^text\/html/.test(r.headers.get("content-type") ?? "") && r.headers.get("cache-control") === "no-store" && r.headers.get("x-content-type-options") === "nosniff",
      "text/html, never cached, nosniff", JSON.stringify(Object.fromEntries(r.headers)));
    ok(/(^|;\s*)sandbox(;|$)/.test(r.headers.get("content-security-policy") ?? "") && /default-src 'none'/.test(r.headers.get("content-security-policy") ?? ""), "and sandboxed with no network, should anything ever render it in Studio's origin", String(r.headers.get("content-security-policy"))); }
  { const r = await get(url(1)), body = Buffer.from(await r.arrayBuffer());
    ok(r.status === 200 && body.equals(Buffer.from(FILES[1].files["index.html"])) && r.headers.get("content-disposition") === `attachment; filename="${ID}-v1-walk-.-through.html"`, "a skill id that needs sanitising gives a safe name; the bytes are unchanged", String(r.headers.get("content-disposition"))); }
  // ---------- several files: a zip of them, at the paths the page refers to them by ----------
  { const r = await get(url(2)), body = Buffer.from(await r.arrayBuffer()), z = unzipEntries(body);
    ok(r.status === 200 && r.headers.get("content-type") === "application/zip" && r.headers.get("content-disposition") === `attachment; filename="${ID}-v2-walkthrough.zip"`, "a page with a picture downloads as <room>-v<n>-<skill>.zip", `${r.status} ${r.headers.get("content-type")} ${r.headers.get("content-disposition")}`);
    ok([...z.keys()].sort().join(",") === "fig.png,index.html" && z.get("index.html")!.equals(Buffer.from(FILES[2].files["index.html"])) && z.get("fig.png")!.equals(FILES[2].files["fig.png"] as Buffer),
      "the zip holds every file of the version byte for byte, the picture at the path the page names", JSON.stringify([...z.keys()])); }
  // ---------- refusals ----------
  { const no = await get(url(9)), noRoom = await get(url(1, "PR-000000000000-9")), post = await get(url(1), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), bad = await get(`${s.base}/api/review-room/${ID}/page/x/download`);
    const nj = await no.json().catch(() => ({})), pj = await post.json().catch(() => ({}));
    ok(no.status === 404 && !no.headers.get("content-disposition") && noRoom.status === 404, "no such version, no such room: 404, no file", `${no.status} ${noRoom.status} ${JSON.stringify(nj)}`);
    ok(post.status === 405 && !post.headers.get("content-disposition"), "a POST is refused: 405", `${post.status} ${JSON.stringify(pj)}`);
    ok(bad.status === 404, "a version that is not a number is no route", String(bad.status)); }
  { const p = await phone(s), view = await p.get(`/api/review-room/${ID}`), d = await p.get(`/api/review-room/${ID}/page/3/download`);
    ok(!!p.token && view.status === 200 && d.status === 403 && d.body?.code === "desktopOnly" && !d.cd, "a paired phone reads the room but its page does not download: 403 desktopOnly, no file", JSON.stringify({ token: !!p.token, view: view.status, d: d.status, code: d.body?.code }));
    // ---------- a Library save: the same, from the save's own files ----------
    const sv = await get(`${s.base}/api/review-room/${ID}/save`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }), sj: any = await sv.json();
    ok(sv.status === 200 && /^room-pr-/.test(sj.artifact) && sj.n === 1, "fixture: the room saved to the Library", JSON.stringify(sj));
    const lib = (v: number, n = 1) => `${s.base}/api/review-room/library/${sj.artifact}/${n}/page/${v}/download`;
    const l3 = await get(lib(3)), b3 = Buffer.from(await l3.arrayBuffer()), l2 = await get(lib(2)), z2 = unzipEntries(Buffer.from(await l2.arrayBuffer()));
    ok(l3.status === 200 && b3.equals(Buffer.from(FILES[3].files["index.html"])) && l3.headers.get("content-disposition") === `attachment; filename="${ID}-v3-studio-baton.html"` && l3.headers.get("cache-control") === "no-store",
      "a saved version's page downloads from the save, byte for byte, with the room's own file name", `${l3.status} ${l3.headers.get("content-disposition")}`);
    ok(l2.status === 200 && z2.get("fig.png")?.equals(FILES[2].files["fig.png"] as Buffer) === true, "a saved page with a picture is a zip of the save's files", String(l2.status));
    const ln = await get(lib(9)), lv = await get(lib(3, 7)), lx = await get(`${s.base}/api/review-room/library/room-pr-000000000000-9/1/page/1/download`), lp = await p.get(`/api/review-room/library/${sj.artifact}/1/page/3/download`);
    ok(ln.status === 404 && lv.status === 404 && lx.status === 404, "no such page, save version or saved room: 404", `${ln.status} ${lv.status} ${lx.status}`);
    ok(lp.status === 403 && lp.body?.code === "desktopOnly", "a paired phone gets 403 desktopOnly for a saved page too", String(lp.status));
    // a file of the save changed since it was saved: refused, nothing downloaded
    const saved = `${s.data}/artifacts/${sj.artifact}/v1/files/pages/v3/index.html`; writeFileSync(saved, readFileSync(saved, "utf8").replace("rounds to 300", "rounds to 301"));
    const li = await get(lib(3)), lij: any = await li.json().catch(() => ({}));
    ok(li.status === 400 && lij.code === "integrity" && !li.headers.get("content-disposition"), "a saved file changed since the save is refused: integrity, no file", `${li.status} ${JSON.stringify(lij)}`);
    const { rmSync: rm } = await import("node:fs"); rm(`${s.data}/artifacts/${sj.artifact}/v1/files/pages/v2/fig.png`);
    const lm = await get(lib(2)), lmj: any = await lm.json().catch(() => ({}));
    ok(lm.status === 400 && lmj.code === "integrity" && /missing/.test(lmj.error) && !lm.headers.get("content-disposition"), "a saved file gone from the save is refused: integrity, no file", `${lm.status} ${JSON.stringify(lmj)}`);
    // the save's manifest names the entry and the skill: an edited room.json is refused before any page is served
    const man = `${s.data}/artifacts/${sj.artifact}/v1/files/room.json`; writeFileSync(man, readFileSync(man, "utf8").replace('"entry":"pages/v1/index.html"', '"entry":"pages/v1/other.html"'));
    const lr = await get(lib(1)), lrj: any = await lr.json().catch(() => ({}));
    ok(lr.status === 400 && lrj.code === "integrity" && /room\.json/.test(lrj.error), "a save whose room.json changed is refused: integrity, even for a page whose files are intact", `${lr.status} ${JSON.stringify(lrj)}`); }
  // ---------- a room's file changed on disk since it was made: refused, nothing downloaded ----------
  { writeFileSync(s.room.file(1, "index.html"), "<h1>changed</h1>");
    const r = await get(url(1)), j: any = await r.json().catch(() => ({}));
    ok(r.status === 400 && j.code === "integrity" && /changed since it was made/.test(j.error) && !r.headers.get("content-disposition"), "a page file changed since it was made is refused: integrity, no file", `${r.status} ${JSON.stringify(j)}`);
    const { rmSync } = await import("node:fs"); rmSync(s.room.file(2, "fig.png"));
    const m = await get(url(2)), mj: any = await m.json().catch(() => ({}));
    ok(m.status === 400 && mj.code === "integrity" && /missing/.test(mj.error), "a page file gone from disk is refused too: integrity", `${m.status} ${JSON.stringify(mj)}`); }
} catch (e: any) { fail++; console.log(`  FAIL  the suite threw: ${e?.stack ?? e}\n${s.log().slice(-3000)}`); }
finally { s.stop(); }
console.log(`\nreview-room-download: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
