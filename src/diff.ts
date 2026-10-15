// A small line diff (no dependency): common prefix and suffix are trimmed, the
// middle is an LCS table. Good for skill and document edits, which are local.
export type DiffOp = { op: "=" | "-" | "+"; text: string; a: number | null; b: number | null };

export function diffLines(before: string, after: string): DiffOp[] {
  const A = before.split("\n"), B = after.split("\n");
  let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0; while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  const a = A.slice(s, A.length - e), b = B.slice(s, B.length - e);
  const ops: DiffOp[] = [];
  for (let i = 0; i < s; i++) ops.push({ op: "=", text: A[i], a: i + 1, b: i + 1 });
  if (a.length * b.length > 4_000_000) { // too big for the table: show it as a replacement
    a.forEach((t, i) => ops.push({ op: "-", text: t, a: s + i + 1, b: null })); b.forEach((t, i) => ops.push({ op: "+", text: t, a: null, b: s + i + 1 }));
  } else {
    const n = a.length, m = b.length, L: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[i] === b[j]) { ops.push({ op: "=", text: a[i], a: s + i + 1, b: s + j + 1 }); i++; j++; }
      else if (j < m && (i >= n || L[i][j + 1] >= L[i + 1][j])) { ops.push({ op: "+", text: b[j], a: null, b: s + j + 1 }); j++; }
      else { ops.push({ op: "-", text: a[i], a: s + i + 1, b: null }); i++; }
    }
  }
  for (let k = 0; k < e; k++) ops.push({ op: "=", text: A[A.length - e + k], a: A.length - e + k + 1, b: B.length - e + k + 1 });
  return ops;
}

/** Only the changed lines with `ctx` lines of context around them, as hunks. */
export function hunks(ops: DiffOp[], ctx = 3): DiffOp[][] {
  const keep = new Set<number>();
  ops.forEach((o, i) => { if (o.op !== "=") for (let k = Math.max(0, i - ctx); k <= Math.min(ops.length - 1, i + ctx); k++) keep.add(k); });
  const out: DiffOp[][] = []; let cur: DiffOp[] = []; let last = -2;
  for (const i of [...keep].sort((x, y) => x - y)) { if (i !== last + 1 && cur.length) { out.push(cur); cur = []; } cur.push(ops[i]); last = i; }
  if (cur.length) out.push(cur);
  return out;
}

export function unified(before: string, after: string, name: string): string {
  const hs = hunks(diffLines(before, after));
  if (!hs.length) return "";
  const lines = [`--- a/${name}`, `+++ b/${name}`];
  for (const h of hs) {
    const a0 = h.find((o) => o.a != null)?.a ?? 0, b0 = h.find((o) => o.b != null)?.b ?? 0;
    lines.push(`@@ -${a0},${h.filter((o) => o.op !== "+").length} +${b0},${h.filter((o) => o.op !== "-").length} @@`);
    for (const o of h) lines.push(`${o.op === "=" ? " " : o.op}${o.text}`);
  }
  return lines.join("\n") + "\n";
}

export const diffStat = (ops: DiffOp[]) => ({ added: ops.filter((o) => o.op === "+").length, removed: ops.filter((o) => o.op === "-").length });
