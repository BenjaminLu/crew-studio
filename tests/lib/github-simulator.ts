// Official documented PR shape, synthetic values; bare refs are authoritative.
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { git, must } from "../../src/git";
const fixture = JSON.parse(readFileSync(new URL("../fixtures/github-foundation/provenance.json", import.meta.url), "utf8"));
export function githubSimulator(bare: string, repository = "fixture/project") {
  // the repository's community files (pull request templates, CONTRIBUTING) served by the contents API at the default branch head
  const community = new Map<string, string>();
  const pulls = new Map<number, any>(), calls: { method: string; path: string; body: any }[] = [];
  let transform: { method: string; path?: string; map: (v: any) => any } | null = null;
  let held: { method: string; path: string; ready: () => void; gate: Promise<void>; release: () => void } | null = null;
  let failure: { method: string; status?: number; delay?: number; after?: boolean; once?: boolean } | null = null;
  const json = (v: any, status = 200) => Response.json(v, { status });
  const bad = () => json({ message: "fixture refused unknown method, argument or route" }, 422);
  const keys = (v: any, allowed: string[], required: string[] = []) => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).every((k) => allowed.includes(k)) && required.every((k) => typeof v[k] === "string");
  const head = (branch: string) => { const r = git(bare, ["rev-parse", "--verify", `refs/heads/${branch}`]); return r.ok ? r.out : null; };
  const shaped = (p: any) => ({ ...p, head: { ref: p.head.ref, sha: head(p.head.ref), repo: { full_name: repository } }, base: { ref: p.base.ref, sha: head(p.base.ref), repo: { full_name: repository } } });
  const logs = new Map<number, { text: string; range: string; location?: string; status?: number; contentRange?: string }>();
  const expected = new Map<string, { body?: any; value: any; status?: number; range?: string }>();
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
    const u = new URL(req.url), prefix = `/repos/${repository}`;
    if (/^\/fixture-job-logs\/[1-9][0-9]*$/.test(u.pathname)) {
      const log = logs.get(Number(u.pathname.split("/")[2]));
      if (req.headers.has("authorization")) return bad();
      if (!log || req.method !== "GET" || u.search !== "?fixture=1" || req.headers.get("range") !== log.range) return bad();
      const match = /^bytes=([0-9]+)-([0-9]+)$/.exec(log.range)!;
      const start = Number(match[1]), end = Number(match[2]), bytes = new TextEncoder().encode(log.text);
      if (start > end || start >= bytes.length) return json({ message: "Range Not Satisfiable" }, 416);
      const last = Math.min(end, bytes.length - 1);
      return new Response(bytes.slice(start, last + 1), { status: log.status ?? 206, headers: { "content-range": log.contentRange ?? `bytes ${start}-${last}/${bytes.length}`, "accept-ranges": "bytes" } });
    }
    if (u.pathname === `/repos/${repository.split("/")[0]}/.github` || u.pathname.startsWith(`/repos/${repository.split("/")[0]}/.github/`)) return json({ message: "Not Found" }, 404); // no owner defaults
    if (u.pathname !== prefix && !u.pathname.startsWith(prefix + "/")) return bad();
    const path = u.pathname.slice(prefix.length); let body: any = null;
    if (req.method !== "GET") { try { body = await req.json(); } catch { return bad(); } }
    calls.push({ method: req.method, path: path + u.search, body });
    if (held?.method === req.method && held.path === path + u.search) { const current = held; held = null; current.ready(); await current.gate; }
    const fail = failure?.method === req.method ? failure : null;
    if (fail?.once) failure = null;
    if (fail && !fail.after) { if (fail.delay) await Bun.sleep(fail.delay); return json({ message: "fixture error includes fake-test-token-do-not-leak" }, fail.status ?? 503); }
    let response: Response;
    if (/^\/actions\/jobs\/[1-9][0-9]*\/logs$/.test(path)) {
      const id = Number(path.split("/")[3]);
      if (req.method !== "GET" || u.search || req.headers.has("range") || !logs.has(id)) return bad();
      return new Response(null, { status: 302, headers: { location: logs.get(id)?.location ?? `${u.origin}/fixture-job-logs/${id}?fixture=1` } });
    }
    if (/^\/git\/ref\/heads\/.+$/.test(path) && req.method === "GET" && !u.search) {
      const branch = decodeURIComponent(path.slice("/git/ref/heads/".length)), value = head(branch);
      if (!value) return json({ message: "Not Found" }, 404);
      return json({ ref: `refs/heads/${branch}`, object: { type: "commit", sha: value } });
    }
    if(path==='/pulls'&&req.method==='GET'&&['?state=open&per_page=30','?state=closed&sort=updated&direction=desc&per_page=100'].includes(u.search)){response=json([...pulls.values()].filter(p=>p.state===u.searchParams.get('state')).map(shaped));}
    else if (path === "/pulls" && req.method === "GET") {
      if ([...u.searchParams.keys()].some((k) => !["state", "head", "base", "per_page"].includes(k)) || [...u.searchParams.keys()].some(k => u.searchParams.getAll(k).length !== 1) || u.searchParams.get("state") !== "open" || u.searchParams.get("per_page") !== "100" || !u.searchParams.get("head")?.startsWith(repository.split("/")[0] + ":") || !u.searchParams.get("base")) return bad();
      const branch = u.searchParams.get("head")!.slice(repository.split("/")[0].length + 1);
      response = json([...pulls.values()].filter((p) => p.state === "open" && p.head.ref === branch && p.base.ref === u.searchParams.get("base")).map(shaped));
    } else if (path === "/pulls" && req.method === "POST" && !u.search) {
      if (!keys(body, ["title", "body", "head", "base", "draft"], ["title", "body", "head", "base"]) || (body.draft!==undefined&&body.draft!==true) || !head(body.head) || !head(body.base) || [...pulls.values()].some((p) => p.state === "open" && p.head.ref === body.head && p.base.ref === body.base)) return bad();
      const n = pulls.size + 1;
      const p = { ...fixture.pull, draft: body.draft===true, mergeable: true, mergeable_state: "clean", number: n, title: body.title, body: body.body, html_url: `https://github.com/${repository}/pull/${n}`, head: { ref: body.head }, base: { ref: body.base } };
      pulls.set(n, p); response = json(shaped(p), 201);
    } else if (/^\/pulls\/[1-9][0-9]*$/.test(path) && !u.search) {
      const p = pulls.get(Number(path.split("/")[2])); if (!p) return json({ message: "Not Found" }, 404);
      if (req.method === "GET") response = json(shaped(p));
      // GitHub's PATCH changes only the fields it is sent (a push that moves the head sends the base alone)
      else if (req.method === "PATCH" && keys(body, ["title", "body", "base"], ["base"]) && ("title" in body) === ("body" in body) && (!("title" in body) || (typeof body.title === "string" && typeof body.body === "string")) && head(body.base)) { Object.assign(p, { ...("title" in body ? { title: body.title, body: body.body } : {}), base: { ref: body.base } }); response = json(shaped(p)); }
      else return bad();
    } else if (req.method === "GET" && path === "" && !u.search && !expected.has("GET ")) {
      response = json({ full_name: repository, default_branch: "main", private: true, visibility: "private" });
    } else if (req.method === "GET" && path === "/commits/main" && !u.search) {
      const value = head("main"); if (!value) return json({ message: "Not Found" }, 404); response = json({ sha: value });
    } else if (req.method === "GET" && path.startsWith("/contents/")) {
      if (u.searchParams.get("ref") !== head("main")) return bad();
      const file = decodeURIComponent(path.slice("/contents/".length)), text = community.get(file);
      if (text !== undefined) { const bytes = Buffer.from(text); response = json({ type: "file", path: file, size: bytes.length, encoding: "base64", content: bytes.toString("base64"), sha: createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") }); }
      else { const children = [...community.keys()].filter((k) => k.startsWith(file + "/") && !k.slice(file.length + 1).includes("/")).map((k) => ({ type: "file", path: k })); if (!children.length) return json({ message: "Not Found" }, 404); response = json(children); }
    } else {
      const exact = expected.get(req.method + " " + path + u.search);
      const loose = path.endsWith("/merge") && body && typeof body === "object" && exact?.body && !("commit_title" in exact.body) && Object.keys(body).every((k) => ["sha", "merge_method", "commit_title", "commit_message"].includes(k)) && ["commit_title", "commit_message"].every((k) => body[k] === undefined || typeof body[k] === "string")
        ? Object.fromEntries(Object.entries(body).filter(([k]) => k !== "commit_title" && k !== "commit_message")) : body;
      if (!exact || JSON.stringify(loose) !== JSON.stringify(exact.body ?? null) || (req.headers.get("range") ?? undefined) !== exact.range) return bad();
      if (req.method === "PUT") {
        const p = pulls.get(Number(path.split("/")[2])); if (!p || p.state !== "open") return json({ message: "Not Found" }, 404);
        const current = head(p.head.ref), base = head(p.base.ref);
        if (!current || !base || (body.expected_head_sha ?? body.sha) !== current) return json({ message: "Head branch was modified" }, 409);
        const dir = mkdtempSync(join(tmpdir(), "github-simulator-merge-"));
        try {
          must(dir, ["clone", "-q", "--no-local", bare, "."]);
          if (path.endsWith("update-branch")) {
            must(dir, ["checkout", "-q", "-B", "fixture", current]); must(dir, ["merge", "--no-edit", base]);
            const next = must(dir, ["rev-parse", "HEAD"]);
            must(dir, ["push", `--force-with-lease=refs/heads/${p.head.ref}:${current}`, "origin", `${next}:refs/heads/${p.head.ref}`]);
            response = json(exact.value, exact.status ?? 202);
          } else {
            const method = body.merge_method;
            if (method === "rebase") { must(dir, ["checkout", "-q", "-B", "fixture", current]); must(dir, ["rebase", base]); }
            else { must(dir, ["checkout", "-q", "-B", "fixture", base]); must(dir, ["merge", method === "squash" ? "--squash" : "--no-ff", "--no-edit", ...(method === "merge" && body.commit_title ? ["-m", body.commit_title, ...(body.commit_message ? ["-m", body.commit_message] : [])] : []), current]);
              if (method === "squash") must(dir, ["commit", "-q", "-m", body.commit_title ?? "Squash fixture pull request", ...(body.commit_message ? ["-m", body.commit_message] : [])]); }
            const next = must(dir, ["rev-parse", "HEAD"]);
            must(dir, ["push", `--force-with-lease=refs/heads/${p.base.ref}:${base}`, "origin", `${next}:refs/heads/${p.base.ref}`]);
            p.state = "closed"; p.merged = true; p.merge_commit_sha = next;
            response = json({ ...exact.value, sha: next }, exact.status ?? 200);
          }
        } catch { response = json({ message: "Fixture merge conflict or lease mismatch" }, 409); }
        finally { rmSync(dir, { recursive: true, force: true }); }
      } else if (typeof exact.value === "string") {
        const match = /^bytes=([0-9]+)-([0-9]+)$/.exec(exact.range ?? "")!;
        const start = Number(match[1]), end = Number(match[2]), bytes = new TextEncoder().encode(exact.value);
        if (start > end || end >= bytes.length) return json({ message: "Range Not Satisfiable" }, 416);
        response = new Response(bytes.slice(start, end + 1), { status: exact.status ?? 206, headers: { "content-range": `bytes ${start}-${end}/${bytes.length}`, "accept-ranges": "bytes" } });
      } else response = json(req.method === "GET" && path === "" && exact.value && typeof exact.value === "object" ? { default_branch: "main", ...exact.value } : exact.value, exact.status ?? 200);
    }
    if (fail?.after) { if (fail.delay) await Bun.sleep(fail.delay); return json({ message: "fixture lost response" }, fail.status ?? 503); }
    if (transform?.method === req.method && (!transform.path || transform.path === path + u.search)) { const map = transform.map; transform = null; response = json(map(await response.json()), response.status); }
    return response;
  } });
  return { origin: `http://127.0.0.1:${server.port}`, calls, pulls, head, community,
    holdNext(method: "GET" | "POST" | "PATCH" | "PUT", path: string) {
      if (held || path !== "" && !path.startsWith("/")) throw new Error("invalid held fixture");
      let ready!: () => void, release!: () => void; const started = new Promise<void>(r => ready = r), gate = new Promise<void>(r => release = r);
      held = { method, path, ready, release, gate }; return { started, release };
    },
    transformNext(method: string, map: (v: any) => any, path?: string) { transform = { method, map, path }; },
    fail(v: typeof failure) { failure = v; },
    expectJobLogs(id: number, text: string, range: string, options: { location?: string; status?: number; contentRange?: string } = {}) { if (!Number.isSafeInteger(id) || id < 1 || typeof text !== "string" || !/^bytes=[0-9]+-[0-9]+$/.test(range)) throw new Error("invalid log fixture"); logs.set(id, { text, range, ...options }); },
    expect(method: string, path: string, value: any, body?: any, status?: number, range?: string) {
      const read = method === "GET" && ( path === "" || /^\/branches\/[^/]+\/protection$/.test(path) || /^\/branches\/[^/]+\/protection\/required_status_checks$/.test(path) || /^\/commits\/[a-f0-9]{40}\/(check-runs\?filter=all&per_page=100&page=[1-9][0-9]*|status\?per_page=100&page=[1-9][0-9]*)$/.test(path) || /^\/commits\/[a-f0-9]{40}\/(check-runs\?per_page=100|status)$/.test(path) || /^\/pulls\/[1-9][0-9]*\/(reviews|comments)$/.test(path));
      const mutation = method === "PUT" && /^\/pulls\/[1-9][0-9]*\/(update-branch|merge)$/.test(path);
      if (!read && !mutation) throw new Error("unsupported simulator fixture route");
      if (read && body !== undefined || mutation && (!keys(body, path.endsWith("merge") ? ["sha", "merge_method"] : ["expected_head_sha"], path.endsWith("merge") ? ["sha", "merge_method"] : ["expected_head_sha"]) || Object.values(body).some(v => typeof v !== "string"))) throw new Error("unsupported simulator fixture body");
      if (mutation && (!/^[a-f0-9]{40}$/.test(body.sha ?? body.expected_head_sha) || (path.endsWith("merge") && !["merge", "squash", "rebase"].includes(body.merge_method)))) throw new Error("unsupported simulator mutation arguments");
      expected.set(`${method} ${path}`, { value, body, status, range });
    },
    stop() { held?.release(); server.stop(true); }
  };
}
