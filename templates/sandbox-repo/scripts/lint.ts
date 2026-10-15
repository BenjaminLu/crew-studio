// Style rules for src/ and test/: no tabs, no trailing spaces, no console.log in src/.
import { readdirSync, readFileSync } from "node:fs";
let bad = 0;
for (const dir of ["src", "test"]) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
    readFileSync(`${dir}/${f}`, "utf8").split("\n").forEach((line, i) => {
      if (/\t/.test(line) || / +$/.test(line) || (dir === "src" && /console\.log/.test(line))) { bad++; console.log(`${dir}/${f}:${i + 1}: ${line.trim().slice(0, 60) || "trailing space"}`); }
    });
  }
}
console.log(bad ? `${bad} lint problems` : "lint clean");
process.exit(bad ? 1 : 0);
