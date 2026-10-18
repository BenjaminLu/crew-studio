// Fixtures for the skill-package suites (docs/units/skill-packages.md): a fake npm registry and a wheel index served on
// loopback, reached only through Studio's egress proxy under fixture names (Egress.testUpstreams), and a skill folder whose
// package-lock.json and requirements.txt resolve to them. Nothing here reaches the internet.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const REGISTRY = "registry.fixture.test";
export const PYPI = "pypi.fixture.test";
const sha512 = (b: Buffer) => `sha512-${createHash("sha512").update(b).digest("base64")}`;
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** An npm tarball (package/…) made with the system tar. */
function tgz(name: string, files: Record<string, string>): Buffer {
  const d = mkdtempSync(join(tmpdir(), "npm-pkg-")); mkdirSync(join(d, "package"), { recursive: true });
  for (const [f, t] of Object.entries(files)) { mkdirSync(join(d, "package", f, ".."), { recursive: true }); writeFileSync(join(d, "package", f), t); }
  const out = join(d, `${name}.tgz`); const r = Bun.spawnSync(["/usr/bin/tar", "-czf", out, "-C", d, "package"]); if (r.exitCode !== 0) throw new Error("tar failed");
  return readFileSync(out);
}
/** A pure-Python wheel built with the stdlib zipfile (python3 -I). */
function wheel(dir: string): { file: string; bytes: Buffer } {
  const name = "fixture_py-1.0.0-py3-none-any.whl", out = join(dir, name);
  const py = `import zipfile,sys,hashlib,base64
files={"fixture_py/__init__.py":"def shout(s):\\n    return 'py:'+s.upper()\\n","fixture_py-1.0.0.dist-info/METADATA":"Metadata-Version: 2.1\\nName: fixture-py\\nVersion: 1.0.0\\n","fixture_py-1.0.0.dist-info/WHEEL":"Wheel-Version: 1.0\\nGenerator: fixture\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n"}
rec=[]
with zipfile.ZipFile(sys.argv[1],"w") as z:
  for k,v in files.items():
    z.writestr(k,v); d=base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b"=").decode(); rec.append(f"{k},sha256={d},{len(v.encode())}")
  rec.append("fixture_py-1.0.0.dist-info/RECORD,,"); z.writestr("fixture_py-1.0.0.dist-info/RECORD","\\n".join(rec)+"\\n")`;
  const r = Bun.spawnSync(["python3", "-I", "-c", py, out], { stderr: "pipe" }); if (r.exitCode !== 0) throw new Error(`wheel: ${r.stderr}`);
  return { file: name, bytes: readFileSync(out) };
}

export type Fixture = { port: number; hits: string[]; stop(): void; lock: string; pkg: string; requirements: string; scripted: string };
/** The registry and the index, and the lockfiles that point at them. */
export function startRegistry(): Fixture {
  const dep = tgz("fixture-dep-1.0.0", { "package.json": JSON.stringify({ name: "fixture-dep", version: "1.0.0", main: "index.js" }), "index.js": "module.exports = (s) => 'dep:' + s;\n" });
  const scripted = tgz("fixture-scripted-1.0.0", { "package.json": JSON.stringify({ name: "fixture-scripted", version: "1.0.0", main: "index.js", scripts: { postinstall: "node -e \"require('fs').writeFileSync('POSTINSTALL_RAN','ran')\"" } }), "index.js": "module.exports = 1;\n" });
  const wd = mkdtempSync(join(tmpdir(), "wheel-")); const whl = wheel(wd);
  const hits: string[] = [];
  const srv = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(req) {
    const u = new URL(req.url); hits.push(`${req.headers.get("host")}${u.pathname}`);
    if (u.pathname === "/fixture-dep/-/fixture-dep-1.0.0.tgz") return new Response(dep);
    if (u.pathname === "/fixture-scripted/-/fixture-scripted-1.0.0.tgz") return new Response(scripted);
    if (u.pathname === "/fixture-dep" || u.pathname === "/fixture-scripted") { const n = u.pathname.slice(1); const b = n === "fixture-dep" ? dep : scripted;
      return Response.json({ name: n, "dist-tags": { latest: "1.0.0" }, versions: { "1.0.0": { name: n, version: "1.0.0", dist: { tarball: `http://${REGISTRY}/${n}/-/${n}-1.0.0.tgz`, integrity: sha512(b) } } } }); }
    if (u.pathname === "/simple/fixture-py/") return new Response(`<!DOCTYPE html><html><body><a href="/files/${whl.file}#sha256=${sha256(whl.bytes)}">${whl.file}</a></body></html>`, { headers: { "content-type": "text/html" } });
    if (u.pathname === `/files/${whl.file}`) return new Response(whl.bytes);
    if (u.pathname === "/tools/fixture-tool.tar.gz") return new Response(TOOL_TGZ);
    return new Response("not found", { status: 404 });
  } });
  const lock = JSON.stringify({ name: "fixture-skill", version: "1.0.0", lockfileVersion: 3, requires: true, packages: {
    "": { name: "fixture-skill", version: "1.0.0", dependencies: { "fixture-dep": "1.0.0", "fixture-scripted": "1.0.0" } },
    "node_modules/fixture-dep": { version: "1.0.0", resolved: `http://${REGISTRY}/fixture-dep/-/fixture-dep-1.0.0.tgz`, integrity: sha512(dep) },
    "node_modules/fixture-scripted": { version: "1.0.0", resolved: `http://${REGISTRY}/fixture-scripted/-/fixture-scripted-1.0.0.tgz`, integrity: sha512(scripted), hasInstallScript: true } } }, null, 2);
  const pkg = JSON.stringify({ name: "fixture-skill", version: "1.0.0", dependencies: { "fixture-dep": "1.0.0", "fixture-scripted": "1.0.0" } }, null, 2);
  const requirements = `--index-url http://${PYPI}/simple/\nfixture-py==1.0.0 --hash=sha256:${sha256(whl.bytes)}\n`;
  return { port: srv.port as number, hits, stop: () => srv.stop(true), lock, pkg, requirements, scripted: "fixture-scripted" };
}
/** A tool archive for the recipe suite: bin/fixture-tool prints a line. */
export const TOOL_TGZ = (() => { const d = mkdtempSync(join(tmpdir(), "tool-")); mkdirSync(join(d, "fixture-tool", "bin"), { recursive: true });
  writeFileSync(join(d, "fixture-tool", "bin", "fixture-tool"), "#!/bin/sh\necho fixture-tool ran\n", { mode: 0o755 });
  const out = join(d, "t.tar.gz"); Bun.spawnSync(["/usr/bin/tar", "-czf", out, "-C", d, "fixture-tool"]); return readFileSync(out); })();
export const TOOL_SHA = sha256(TOOL_TGZ);

/** A script skill folder: a node script using fixture-dep, a python script using fixture-py, and their lockfiles. */
export function skillFolder(root: string, f: Fixture, o: { name?: string; extraScript?: string; hosts?: string[]; python?: boolean } = {}): string {
  const name = o.name ?? "fixture-pkg"; const d = join(root, name); mkdirSync(join(d, "scripts"), { recursive: true });
  const fm = [`name: ${name}`, "description: A fixture skill with dependencies", ...(o.hosts?.length ? ["metadata:", "  hosts:", ...o.hosts.map((h) => `    - ${h}`)] : [])].join("\n");
  writeFileSync(join(d, "SKILL.md"), `---\n${fm}\n---\n\nRun scripts/use-dep.js with a word.\n`);
  writeFileSync(join(d, "package.json"), f.pkg); writeFileSync(join(d, "package-lock.json"), f.lock);
  writeFileSync(join(d, "scripts", "use-dep.js"), "const dep = require('fixture-dep');\nconst fs = require('fs');\nconst out = dep(process.argv[2] || 'none');\nfs.writeFileSync('skill-output.txt', out);\nconsole.log(out);\n");
  writeFileSync(join(d, "scripts", "fetch.js"), "const http = require('http');\nconst url = process.argv[2];\nconst proxy = new URL(process.env.http_proxy || 'http://127.0.0.1:1');\nconst req = http.request({ host: proxy.hostname, port: proxy.port, path: url, headers: { host: new URL(url).host, 'proxy-authorization': 'Basic ' + Buffer.from(decodeURIComponent(proxy.username) + ':' + decodeURIComponent(proxy.password)).toString('base64') } }, (res) => { let b = ''; res.on('data', (d) => b += d); res.on('end', () => { console.log(res.statusCode + ' ' + b.slice(0, 80)); }); });\nreq.on('error', (e) => { console.log('error ' + e.message); });\nreq.end();\n");
  writeFileSync(join(d, "scripts", "install.sh"), "#!/bin/sh\nnpm install left-pad\n");
  writeFileSync(join(d, "scripts", "write-self.sh"), "#!/bin/sh\necho changed > \"$SKILL_DIR/SKILL.md\" && echo wrote-skill || echo refused-skill-write\n");
  if (o.python !== false) { writeFileSync(join(d, "requirements.txt"), f.requirements); writeFileSync(join(d, "scripts", "use-py.py"), "import sys\nimport fixture_py\nprint(fixture_py.shout(sys.argv[1] if len(sys.argv) > 1 else 'none'))\n"); }
  if (o.extraScript) writeFileSync(join(d, "scripts", "extra.sh"), o.extraScript);
  return d;
}
