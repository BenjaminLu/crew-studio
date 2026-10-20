import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// Runtimes and system programs a skill needs (docs/units/skill-packages.md §4), resolved without asking: the host's own first;
// else a recipe's pinned download, fetched in the prepare sandbox from that one host, refused unless its size and sha256 match,
// unpacked into data/tools only; a Homebrew formula only through a Homebrew the user owns (planned here, never run); Xcode's
// tools only detected; otherwise "missing" with the reason. A local fixture server stands in for the download host.
//   bun tests/skill-tools.ts
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startRegistry, TOOL_SHA } from "./lib/skill-fixtures";
let pass = 0, fail = 0;
const ok = (c: boolean, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const { resolveBin, findBin, brewOf, brewPlan, RECIPES, recipeFor } = await import("../src/skillpkg/recipes");
const { resolveNode, resolvePython, hostPython } = await import("../src/skillpkg/runtimes");
const { fixtureEgress } = await import("./lib/skill-fixtures");

const root = mkdtempSync(join(tmpdir(), "crew-tools-")); const data = join(root, "data"); mkdirSync(data);
const listing = (d: string): string[] => readdirSync(d, { recursive: true }).map(String).filter((p) => !p.startsWith("data")).sort();
const before = listing(root);
const fx = startRegistry();
const egress = fixtureEgress(join(data, "egress.log")); await egress.start(); egress.testUpstreams.set("tools.fixture.test", { address: "127.0.0.1", port: fx.port });
const recipe = (o: { sha256?: string; bytes?: number } = {}) => [{ id: "fixture-tool", version: "1.0", bins: { "fixture-tool": "fixture-tool/bin/fixture-tool" },
  sources: [{ platform: process.platform, arch: process.arch, kind: "tar" as const, url: "http://tools.fixture.test/tools/fixture-tool.tar.gz", sha256: o.sha256 ?? TOOL_SHA, bytes: o.bytes ?? 1024 * 1024 }] }];
const ctx = (o: any = {}) => ({ dataDir: data, egress, path: "/usr/bin:/bin", brew: false as const, ...o });

// ---------- a checksum that does not match: refused, nothing installed ----------
{ const r = await resolveBin("fixture-tool", ctx({ recipes: recipe({ sha256: "f".repeat(64) }) }));
  ok(r.state === "missing" && /sha256 .*not the recipe's/.test(r.reason?.en ?? "") && !existsSync(join(data, "tools", "fixture-tool")) && readdirSync(join(data, "tools", ".fetch")).length === 0,
    "a download whose sha256 differs from the recipe is refused: nothing is unpacked, the download is removed, and the reason says so", JSON.stringify(r)); }
{ const r = await resolveBin("fixture-tool", ctx({ recipes: recipe({ bytes: 64 }) }));
  ok(r.state === "missing" && /failed|cap/.test(r.reason?.en ?? "") && !existsSync(join(data, "tools", "fixture-tool")), "a download over the recipe's size cap is refused", JSON.stringify(r)); }
// ---------- the pinned download: fetched in the sandbox from that host only, unpacked into data/tools ----------
{ const r = await resolveBin("fixture-tool", ctx({ recipes: recipe() }));
  const out = r.path ? Bun.spawnSync([r.path], { stdout: "pipe" }).stdout.toString().trim() : "";
  ok(r.state === "tool" && r.path?.startsWith(join(data, "tools", "fixture-tool")) && out === "fixture-tool ran" && JSON.stringify(r.hosts) === JSON.stringify(["tools.fixture.test"]),
    "a recipe's pinned download is fetched (its one host), checked and unpacked into data/tools, and runs", JSON.stringify(r));
  egress.testUpstreams.delete("tools.fixture.test");
  const again = await resolveBin("fixture-tool", ctx({ recipes: recipe() }));
  ok(again.state === "tool" && again.path === r.path, "a tool fetched before is found again with no download"); }
// ---------- the host first ----------
{ const bin = join(root, "hostbin"); mkdirSync(bin); writeFileSync(join(bin, "fixture-tool"), "#!/bin/sh\necho host\n", { mode: 0o755 });
  const r = findBin("fixture-tool", ctx({ path: `${bin}:/usr/bin`, recipes: recipe() }));
  ok(r?.state === "host" && r.path === join(bin, "fixture-tool"), "a program already on the host is used as it is (found on PATH first)", JSON.stringify(r)); }
// ---------- no safe recipe: missing, with the reason ----------
{ const r = await resolveBin("no-such-program", ctx());
  ok(r.state === "missing" && /no recipe/.test(r.reason?.en ?? "") && /沒有/.test(r.reason?.zh ?? ""), "a program with no recipe is missing, with the reason (en and zh-TW)", JSON.stringify(r)); }
{ const lo = recipeFor("soffice"), pop = recipeFor("pdftoppm");
  ok(!!lo && lo.sources.every((s) => s.kind === "dmg-app" && /^https:\/\/downloadarchive\.documentfoundation\.org\//.test(s.url) && s.bytes > 0) && !!pop?.brew && RECIPES.some((r) => r.clt && Object.hasOwn(r.bins, "gcc")),
    "Studio ships recipes for LibreOffice (the official image, into data/tools), Poppler (a Homebrew formula) and gcc (Xcode's tools, detection only)");
  const r = await resolveBin("soffice", ctx({ path: "/usr/bin" }));
  const hostHas = existsSync("/Applications/LibreOffice.app/Contents/MacOS/soffice");
  ok(hostHas ? r.state === "host" : r.state === "missing" && /no pinned checksum/.test(r.reason?.en ?? ""), "soffice: the host's LibreOffice when installed; otherwise missing, since the recipe's checksum is not pinned yet (never trusted unpinned)", JSON.stringify(r));
  const p = await resolveBin("pdftoppm", ctx({ path: "/usr/bin" }));
  ok(p.state === "missing" && /Homebrew/.test(p.reason?.en ?? ""), "pdftoppm with Homebrew off: missing, naming Homebrew as the way", JSON.stringify(p)); }
{ const no = findBin("gcc", ctx({ clt: () => false })), yes = findBin("gcc", ctx({ clt: () => true }));
  ok(no?.state === "missing" && /xcode-select --install/.test(no.reason?.en ?? "") && (!existsSync("/usr/bin/gcc") || yes?.state === "host"), "gcc comes only from Xcode's command line tools: reported when they are missing, never installed", JSON.stringify([no, yes])); }
// ---------- Homebrew: only one the user owns, a formula, never a cask, never sudo (planned, not run) ----------
{ const prefix = join(root, "brewprefix"); mkdirSync(join(prefix, "bin"), { recursive: true }); writeFileSync(join(prefix, "bin", "brew"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
  const plan = brewPlan(join(prefix, "bin", "brew"), "poppler");
  ok(brewOf({ brew: join(prefix, "bin", "brew") }) === join(prefix, "bin", "brew") && brewOf({ brew: false }) === null && brewOf({ brew: "/nonexistent/bin/brew" }) === null, "Homebrew is used only when it is installed at a prefix the user owns (or not at all when turned off)");
  ok(JSON.stringify(plan.argv.slice(1)) === JSON.stringify(["install", "--formula", "poppler"]) && plan.env.HOMEBREW_NO_AUTO_UPDATE === "1" && !plan.argv.includes("--cask") && !plan.argv.some((a) => /sudo/.test(a)),
    "a Homebrew install is one formula: no cask (never /Applications), no sudo, no auto-update", JSON.stringify(plan));
  let bad = ""; try { brewPlan("/x/brew", "poppler; rm -rf /"); } catch (e: any) { bad = e.message; } ok(/not a formula/.test(bad), "a formula name is checked before any command is made"); }
// ---------- runtimes ----------
{ const n = resolveNode({ dataDir: data, path: process.env.PATH });
  ok(!!n && (n.source === "host" || n.source === "studio") && !!n.version, "node: the host's node (with its npm), else Studio's own bun", JSON.stringify(n));
  const none = resolveNode({ dataDir: data, path: "/nonexistent" });
  ok(!!none && none.source === "studio" && !none.npm, "with no node on the host, Studio's bun runs node scripts (and a package-lock skill is not ready: no npm)", JSON.stringify(none));
  const hp = hostPython({ dataDir: data, path: process.env.PATH });
  const miss = await resolvePython({ dataDir: data, path: "/nonexistent", uv: false });
  ok("missing" in miss && /python3 missing/.test(miss.missing.en) && /uv/.test(miss.missing.en), "python: the host's python3; with none and no uv, missing with the reason", JSON.stringify([hp?.version, miss])); }

ok(JSON.stringify(listing(root)) === JSON.stringify(before.concat(["brewprefix", "brewprefix/bin", "brewprefix/bin/brew", "hostbin", "hostbin/fixture-tool"]).sort()), "nothing was written outside Studio's data folder (apart from this test's own fixtures)", JSON.stringify(listing(root)));
egress.stop(); fx.stop();
console.log(`\nskill-tools: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
