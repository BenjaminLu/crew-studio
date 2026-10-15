// The installed codex's app-server protocol, recorded in tests/fixture/codex-app-server/protocol.json
// by scripts/codex-protocol-fixture.ts, and a small JSON Schema (draft-07 subset) checker for it.
// The codex stub checks every message it receives and sends with this, so a stub that drifts
// from the vendor, or a client that sends what the vendor would refuse, shows up in the tests.
//   check(method, "params" | "result", value) -> list of problems ("" path = the value itself)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const protocol = JSON.parse(readFileSync(join(here, "fixture/codex-app-server/protocol.json"), "utf8"));
const def = (ref) => ref.replace("#/definitions/", "").split("/").reduce((o, k) => o?.[k], protocol.definitions);
const typeOf = (v) => v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v;
const typeOk = (t, v) => { const a = typeOf(v); return t === a || (t === "number" && a === "integer"); };

/** Problems with `v` against schema `s` (strict: an object's keys must be among its declared properties). */
export function validate(s, v, path = "") {
  if (s === true || s == null) return [];
  if (s === false) return [`${path}: not allowed`];
  if (s.$ref) { const d = def(s.$ref); if (!d) return [`${path}: unknown $ref ${s.$ref}`]; return validate(d, v, path); }
  const out = [];
  if (s.allOf) for (const x of s.allOf) out.push(...validate(x, v, path));
  if (s.anyOf && !s.anyOf.some((x) => !validate(x, v, path).length)) out.push(`${path}: matches none of anyOf`);
  if (s.oneOf) { const n = s.oneOf.filter((x) => !validate(x, v, path).length).length; if (n !== 1) out.push(`${path}: matches ${n} of oneOf ${s.title ?? ""}`.trim()); }
  if (s.enum && !s.enum.some((e) => JSON.stringify(e) === JSON.stringify(v))) out.push(`${path}: ${JSON.stringify(v)} not in ${JSON.stringify(s.enum)}`);
  if (s.type) { const ts = [].concat(s.type); if (!ts.some((t) => typeOk(t, v))) { out.push(`${path}: ${typeOf(v)} is not ${ts.join("|")}`); return out; } }
  if (typeof v === "number" && s.minimum != null && v < s.minimum) out.push(`${path}: below ${s.minimum}`);
  if (typeof v === "string" && s.minLength != null && v.length < s.minLength) out.push(`${path}: shorter than ${s.minLength}`);
  if (Array.isArray(v) && s.items) v.forEach((x, i) => out.push(...validate(s.items, x, `${path}[${i}]`)));
  if (typeOf(v) === "object" && (s.properties || s.required || s.additionalProperties !== undefined)) {
    for (const r of s.required ?? []) if (!(r in v)) out.push(`${path}: missing ${r}`);
    for (const [k, x] of Object.entries(v)) {
      if (s.properties && k in s.properties) out.push(...validate(s.properties[k], x, `${path}.${k}`));
      else if (s.additionalProperties && typeof s.additionalProperties === "object") out.push(...validate(s.additionalProperties, x, `${path}.${k}`));
      else if (s.properties && s.additionalProperties !== true) out.push(`${path}: unknown key ${k}`);
    }
  }
  return out;
}

/** Problems with a message's params or result, for a method Studio uses; unknown methods are a problem too. */
export function check(method, part, value) {
  const u = protocol.use[method];
  if (!u) return [`${method}: not a method Studio is meant to use`];
  const name = part === "result" ? u.result : u.params;
  if (!name) return [`${method}: has no ${part}`];
  return validate({ $ref: `#/definitions/${name}` }, value).map((p) => `${method} ${part}${p}`);
}
export const isMethod = (m) => protocol.clientRequests.includes(m);
