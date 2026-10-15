// Builds the single binary: `bun run build` -> dist/crew-studio (this machine's
// platform), with every public/ file embedded. `bun run build -- --all` also
// cross-compiles darwin-x64, linux-x64 and windows-x64.
import { $ } from "bun";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const root = join(import.meta.dir, "..");
await $`bun ${join(root, "scripts/gen-assets.ts")}`;
mkdirSync(join(root, "dist"), { recursive: true });
const targets: [string, string][] = [["", "crew-studio"]];
if (process.argv.includes("--all")) targets.push(["bun-darwin-x64", "crew-studio-darwin-x64"], ["bun-linux-x64", "crew-studio-linux-x64"], ["bun-windows-x64", "crew-studio-windows-x64.exe"]);
for (const [target, out] of targets) {
  const file = join(root, "dist", out);
  const args = ["build", "--compile", "--minify", ...(target ? [`--target=${target}`] : []), join(root, "src/main.ts"), "--outfile", file];
  const r = Bun.spawnSync(["bun", ...args], { cwd: root, stdout: "pipe", stderr: "pipe" });
  if (!r.success) { console.error(`build ${out} failed:\n${r.stderr}`); process.exitCode = 1; continue; }
  console.log(`built dist/${out}  ${(statSync(file).size / 1e6).toFixed(1)} MB`);
}

// A relative double-click entry; no PATH installation or second Terminal needed.
if(process.platform === "darwin") writeFileSync(join(root,"dist","Open Crew Studio.command"),'#!/bin/sh\ncd -- "$(dirname -- "$0")" || exit 1\nexec ./crew-studio launch "$@"\n',{mode:0o755});
