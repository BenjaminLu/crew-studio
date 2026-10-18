import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
import { checkedTempDir } from "./lib/git-hygiene.mjs"; // temp folders only through the checked helper
// The model choices are detected on this machine (docs/design/crew-seats.md), with stubbed CLIs only:
//   - Claude's list comes from the installed CLI's own model list (the stream-json initialize request), not a constant;
//     only that request is written, never a user turn; efforts are Studio's table narrowed by what the CLI reports
//   - no CLI, or a CLI that does not answer: the fixed list, marked unverified, with the reason
//   - one detection is reused for a minute and shared while it runs
//   - the Crew page's list: only detected models, each with its efforts; an assigned model no longer detected stays,
//     marked unavailable; per provider the login, the count, when it was read, and a clear state when it is missing
//   - GET /api/team?facts=1 (the page opening) detects again unless a detection just finished; force=1 always does
//      bun tests/dynamic-models.ts
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ClaudeNative, CLAUDE_FALLBACK_MODELS } from "../src/providers/claude-native";
import { crewModels, crewRoutes } from "../src/crew-routes";
import { emptyTeam } from "../src/domain/crew";
let pass = 0, fail = 0;
const ok = (c: unknown, name: string, extra = "") => { if (c) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name} ${extra}`); } };
const fixture = join(import.meta.dir, "fixture/claude-models.mjs"), home = checkedTempDir("dynamic-models-");
const traceFile = join(home, ".claude-models-trace.jsonl"), trace = () => existsSync(traceFile) ? readFileSync(traceFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
const cli = [
  { value: "default", resolvedModel: "claude-opus-4-8", displayName: "Default", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
  { value: "opus", resolvedModel: "claude-opus-4-8", displayName: "Opus 4.8", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"] },
  { value: "claude-sonnet-4-6", resolvedModel: "claude-sonnet-4-6", displayName: "Sonnet 4.6", supportsEffort: true, supportedEffortLevels: ["low", "medium", "high"] },
  { value: "claude-haiku-4-5-20251001", resolvedModel: "claude-haiku-4-5-20251001", displayName: "Haiku 4.5" },
  { value: "claude-nova-7", displayName: "A model Studio's effort table does not know", supportsEffort: true, supportedEffortLevels: ["low", "high"] },
  { value: "sonnet", displayName: "An alias without a resolved id" },
];
writeFileSync(join(home, ".claude-models.json"), JSON.stringify(cli));
try {
  // ---------- Claude: the CLI's own list ----------
  const native = new ClaudeNative({ bin: fixture, authEnv: () => ({ HOME: home }) });
  const inv = await native.models();
  const ids = inv.models.map((m) => m.id);
  ok(inv.source === "cli" && JSON.stringify(ids) === JSON.stringify(["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001", "claude-nova-7"]), "the Claude list is the CLI's list: resolved ids, once each, aliases without an id skipped", JSON.stringify(inv));
  ok(!CLAUDE_FALLBACK_MODELS.some((id) => ids.includes(id)), "none of the fixed fallback models appears when the CLI answers");
  const eff = (id: string) => inv.models.find((m) => m.id === id)?.efforts.join(",");
  ok(eff("claude-opus-4-8") === "low,medium,high,xhigh,max" && eff("claude-sonnet-4-6") === "low,medium,high" && eff("claude-haiku-4-5-20251001") === "" && eff("claude-nova-7") === "",
    "efforts per model: Studio's table narrowed by the CLI (no effort support, or a model the table does not know: none)", JSON.stringify(inv.models));
  ok(inv.version === "9.9.9-fixture" && typeof inv.at === "number" && !JSON.stringify(inv).includes("PRIVATE_ACCOUNT"), "the reading carries the CLI version and time, never the account");
  const t1 = trace();
  ok(t1.length === 1 && t1[0].kind === "initialize", "only the initialize request reaches the CLI: no user turn, no model request", JSON.stringify(t1));
  // ---------- reuse ----------
  await native.models();
  ok(trace().length === 1, "a second read within a minute reuses the detection");
  await Promise.all([native.models({ fresh: true }), native.models()]);
  ok(trace().length === 2, "a fresh read detects again, and a read meanwhile shares it", JSON.stringify(trace()));
  // ---------- no list: unverified fallback, with the reason ----------
  const none = await new ClaudeNative({ bin: join(home, "no-such-claude") }).models();
  ok(none.source === "unverified-fallback" && JSON.stringify(none.models.map((m) => m.id)) === JSON.stringify(CLAUDE_FALLBACK_MODELS) && /not installed/.test(none.reason ?? ""), "no Claude CLI: the fixed list, marked unverified, says why", JSON.stringify(none));
  writeFileSync(join(home, ".claude-models-silent"), "1");
  const silent = await native.models({ fresh: true });
  ok(silent.source === "unverified-fallback" && /does not answer/.test(silent.reason ?? ""), "a CLI that does not answer the list request: unverified, and why", JSON.stringify(silent));
  rmSync(join(home, ".claude-models-silent"));
  ok((await native.models()).source === "cli", "an unverified reading is not reused: the next read asks the CLI again");

  // ---------- the shared Claude fixture answers the same listing, and only that ----------
  const shared = join(home, "cli"); mkdirSync(shared); copyFileSync(join(import.meta.dir, "fixture/claude-native.mjs"), join(shared, "success.mjs"));
  const listed = await new ClaudeNative({ bin: join(shared, "success.mjs") }).models();
  const sharedTrace = () => readFileSync(join(shared, "trace.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  ok(listed.source === "cli" && sharedTrace().every((r) => r.phase === "models"), "the shared Claude fixture serves the listing as a models read", JSON.stringify(listed));
  const turn = Bun.spawnSync([process.execPath, join(shared, "success.mjs"), "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--tools", "", "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}', "--setting-sources", "", "--permission-mode", "dontAsk", "--permission-prompts", "none", "--restricted"], { stdin: Buffer.from(JSON.stringify({ type: "user", message: { role: "user", content: "hi" } }) + "\n") });
  ok(turn.exitCode === 3 && sharedTrace().at(-1).phase === "model", "a user turn on that listing is traced as a model request", String(turn.exitCode));
  const wide = Bun.spawnSync([process.execPath, join(shared, "success.mjs"), "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--tools", "Bash"], { stdin: Buffer.from("") });
  ok(wide.exitCode !== 0, "a listing with wider authority is refused");

  // ---------- the Crew page's list ----------
  const team = { ...emptyTeam(), members: { maker: { provider: "codex", model: "gpt-old", effort: "medium", skills: [] }, reviewer: { provider: "claude", model: "claude-opus-4-8", effort: "high", skills: [] } } } as any;
  const facts = [
    { provider: "codex", auth: "verified", login: "logged-in" as const, inventory: "detected" as const, detectedAt: 1000, models: [{ id: "gpt-new", efforts: ["low", "high"] }] },
    { provider: "claude", auth: "unverified", login: "logged-in" as const, inventory: "detected" as const, detectedAt: 2000, models: [], candidates: inv.models.map((m) => ({ id: m.id, efforts: m.efforts })) },
  ];
  const v = crewModels(facts, team);
  const find = (p: string, m: string) => v.models.find((x) => x.provider === p && x.model === m);
  ok(find("codex", "gpt-new")?.available && find("codex", "gpt-new")?.efforts.join(",") === "low,high" && find("claude", "claude-sonnet-4-6")?.efforts.join(",") === "low,medium,high", "the choices are the detected models with their own efforts (Claude's from its CLI list)");
  ok(find("codex", "gpt-old")?.available === false && find("codex", "gpt-old")?.efforts.length === 0, "a model the team uses that is no longer detected stays, marked unavailable", JSON.stringify(find("codex", "gpt-old")));
  ok(find("claude", "claude-opus-4-8")?.available === true, "a used model that is detected is a normal choice");
  const prov = (p: string, vv = v) => vv.providers.find((x) => x.provider === p)!;
  ok(prov("codex").count === 1 && prov("codex").detectedAt === 1000 && prov("claude").count === 4 && prov("claude").detectedAt === 2000 && prov("claude").login === "logged-in", "per provider: login, model count, when it was detected", JSON.stringify(v.providers));
  const missing = crewModels([{ provider: "codex", auth: "unverified", login: "not-logged-in", inventory: "unavailable", detectedAt: 3000, reason: "no verified native Codex login is available", models: [] }], team);
  ok(prov("codex", missing).state === "unavailable" && prov("codex", missing).login === "not-logged-in" && prov("codex", missing).count === 0 && /no verified native Codex login/.test(prov("codex", missing).reason ?? ""), "a provider without a login says so, with no models and the reason", JSON.stringify(missing.providers));
  ok(prov("claude", missing).state === "unread" && prov("claude", missing).count === 0, "a provider not detected yet is marked unread, not empty");
  const fb = crewModels([{ provider: "claude", login: "unknown", inventory: "unverified-fallback", inventoryReason: "The Claude CLI is not installed or not on PATH, so its model list cannot be read", detectedAt: 4000, models: [], candidates: none.models }], emptyTeam());
  ok(prov("claude", fb).state === "unverified-fallback" && /not installed/.test(prov("claude", fb).reason ?? "") && fb.models.every((m) => m.unverified), "the fallback list is marked unverified, with why");

  // ---------- refresh when the page opens ----------
  let refreshes = 0, current: any[] = [];
  const defs = { catalog: () => [], get: () => undefined, versions: () => [] } as any;
  const store = { current: () => null } as any;
  const handle = crewRoutes({ defs, store, facts: () => current, library: () => [], forceMinMs: 0, refreshFacts: async () => { refreshes++; await new Promise((r) => setTimeout(r, 30)); current = facts; } });
  const get = async (q: string) => (await handle("/api/team", new URL(`http://x/api/team${q}`), "GET", false, null, { kind: "desktop" }))!.json();
  const first: any = await get("?facts=1");
  ok(refreshes === 1 && first.models.some((m: any) => m.model === "gpt-new") && typeof first.detection.at === "number", "opening the page detects the models and answers with them", JSON.stringify(first.detection));
  await get("?facts=1");
  ok(refreshes === 1, "opening it again right away reuses that detection");
  await get("");
  ok(refreshes === 1, "a plain read never detects");
  await Promise.all([get("?facts=1&force=1"), get("?facts=1&force=1")]);
  ok(refreshes === 2, "重新偵測 always detects again; two at once share one detection", String(refreshes));
  const throttled = crewRoutes({ defs, store, facts: () => current, library: () => [], refreshFacts: async () => { refreshes++; } });
  for (let i = 0; i < 3; i++) await throttled("/api/team", new URL("http://x/api/team?facts=1&force=1"), "GET", false, null, { kind: "desktop" });
  ok(refreshes === 3, "重新偵測 clicked again within 10 seconds reuses the detection that just finished", String(refreshes));
  refreshes = 2;
  const quick = crewRoutes({ defs, store, facts: () => current, library: () => [], reuseMs: 0, refreshFacts: async () => { refreshes++; } });
  await quick("/api/team", new URL("http://x/api/team?facts=1"), "GET", false, null, { kind: "desktop" });
  await quick("/api/team", new URL("http://x/api/team?facts=1"), "GET", false, null, { kind: "desktop" });
  ok(refreshes === 4, "after the reuse window the next opening detects again");
} finally { rmSync(home, { recursive: true, force: true }); }
console.log(`dynamic-models: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
