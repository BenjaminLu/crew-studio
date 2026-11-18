// Rows of a terminal's raw output, read without drawing it: shared by how Studio finds a Remote Control link
// (src/terminals.ts findLink) and the plain-text screen (src/terminal-screen.ts plainScreen).

/** The output with a line break where a cursor move goes to another row (CUP, HVP, VPA, CUU, CUD); a move along the same
 *  row is dropped, so what a program drew on one row stays one line (a token drawn in two pieces is one token again). */
export function rowBreaks(raw: string): string {
  let row = 1;
  return raw.replace(/\x1b\[(\d*)(?:;(\d*))?([HfdAB])|\n/g, (all, a: string | undefined, _b: string | undefined, fin: string | undefined) => {
    if (all === "\n") { row++; return all; }
    const n = Number(a || 1), to = fin === "A" ? row - n : fin === "B" ? row + n : n;
    if (to === row) return "";
    row = to; return "\r\n";
  });
}
