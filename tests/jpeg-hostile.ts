import "./lib/isolated-env.mjs"; // first: tests never read the operator's .env
// The JPEG decoder of the Cursor image job (src/providers/jpeg.ts) against hostile inputs built here byte by byte: scans
// with no data, huge frames with a tiny payload, data cut off mid-scan. Each is refused quickly, with bounded memory.
//   bun tests/jpeg-hostile.ts
const { decodeJpeg } = await import("../src/providers/jpeg");

let passed = 0, failed = 0;
const ok = (v: unknown, n: string, extra = "") => { console.log(`${v ? "ok" : "FAIL"} ${n}${v ? "" : ` ${extra}`}`); v ? passed++ : failed++; };

// a JPEG writer: DC table 0 codes symbol s (0..15) as the 4 bits of s; AC table 0 codes symbol s (0..254) as the byte s
const seg = (m: number, body: number[]) => [0xff, m, (body.length + 2) >> 8, (body.length + 2) & 255, ...body];
const range = (n: number) => [...Array(n).keys()];
const SOI = [0xff, 0xd8], EOI = [0xff, 0xd9];
const DQT = seg(0xdb, [0, ...Array(64).fill(1)]);
const DHT = [...seg(0xc4, [0x00, 0, 0, 0, 16, ...Array(12).fill(0), ...range(16)]), ...seg(0xc4, [0x10, 0, 0, 0, 0, 0, 0, 0, 255, ...Array(8).fill(0), ...range(255)])];
// the same, except all-zero bits decode as AC symbol 0x01 (one coefficient) rather than EOB: zero bits cost 63 codes a block
const DHT_SLOW = [...seg(0xc4, [0x00, 0, 0, 0, 16, ...Array(12).fill(0), ...range(16)]), ...seg(0xc4, [0x10, 0, 0, 0, 0, 0, 0, 0, 255, ...Array(8).fill(0), 1, 0, ...range(255).slice(2)])];
const sof = (marker: number, w: number, h: number, sampling: number[]) => seg(marker, [8, h >> 8, h & 255, w >> 8, w & 255, sampling.length, ...sampling.flatMap((hv, i) => [i + 1, hv, 0])]);
const sos = (ids: number[], ss: number, se: number, ahal = 0) => seg(0xda, [ids.length, ...ids.flatMap((id) => [id, 0x00]), ss, se, ahal]);
const dri = (n: number) => seg(0xdd, [n >> 8, n & 255]);
class Bits {
  out: number[] = []; acc = 0; n = 0;
  put(v: number, len: number) { for (let i = len - 1; i >= 0; i--) { this.acc = (this.acc << 1) | ((v >> i) & 1); if (++this.n === 8) this.byte(); } return this; }
  byte() { this.out.push(this.acc); if (this.acc === 0xff) this.out.push(0); this.acc = 0; this.n = 0; }
  done() { if (this.n) this.put(0xff, 8 - this.n); return this.out; }
}
const jpeg = (...parts: number[][]) => Uint8Array.from(parts.flat());
/** One progressive gray AC band 1..63 scan whose every block is zero, coded as EOB runs of at most 32767 blocks. */
const eobRuns = (blocks: number) => { const b = new Bits(); for (let left = blocks; left > 0;) { const run = Math.min(left, 32767), r = 31 - Math.clz32(run); b.put(r << 4, 8).put(run - (1 << r), r); left -= run; } return b.done(); };
/** A gray baseline scan of zero blocks: DC difference 0, then EOB. */
const zeroBlocks = (blocks: number) => { const b = new Bits(); for (let i = 0; i < blocks; i++) b.put(0, 4).put(0, 8); return b.done(); };

function refused(name: string, bytes: Uint8Array, want: RegExp = /^JPEG /, ms = 2000, mb = 300) {
  Bun.gc(true);
  const rss = process.memoryUsage().rss, t = performance.now();
  let e = "";
  try { decodeJpeg(bytes); } catch (x: any) { e = String(x?.message); }
  const took = performance.now() - t, grew = (process.memoryUsage().rss - rss) / 1048576;
  ok(want.test(e), `${name} (${bytes.length} bytes) is refused`, e || "decoded");
  ok(took < ms, `${name} is refused within ${ms} ms`, `${took.toFixed(0)} ms`);
  ok(grew < mb, `${name} grows RSS by under ${mb} MB`, `${grew.toFixed(0)} MB`);
  console.log(`  ${name}: ${took.toFixed(1)} ms, RSS +${grew.toFixed(0)} MB`);
}

console.log("scans whose data ends before their last block");
{
  // 2048x2048 gray: 65536 blocks
  const frame = [...SOI, ...DQT, ...DHT, ...sof(0xc2, 2048, 2048, [0x11])];
  const empty = (n: number) => range(n).flatMap(() => sos([1], 1, 63));
  refused("a progressive frame with 100 empty AC scans", jpeg(SOI, DQT, DHT_SLOW, sof(0xc2, 2048, 2048, [0x11]), sos([1], 0, 0), empty(100), EOI));
  refused("a progressive frame whose DC scan is empty", jpeg(frame, sos([1], 0, 0), EOI), /data ends/);
  ok(decodeJpeg(jpeg(frame, sos([1], 0, 0), new Bits().put(0, 4 * 65536).done(), sos([1], 1, 63), eobRuns(65536), EOI)).width === 2048, "the same frame with a DC scan and an AC scan of EOB runs over every block decodes");
  refused("an AC scan whose EOB runs stop short", jpeg(frame, sos([1], 0, 0), new Bits().put(0, 4 * 65536).done(), sos([1], 1, 63), eobRuns(65535), EOI), /data ends/);
  const base = [...SOI, ...DQT, ...DHT, ...sof(0xc0, 2048, 2048, [0x11])], data = zeroBlocks(65536);
  ok(decodeJpeg(jpeg(base, sos([1], 0, 63), data, EOI)).width === 2048, "the same baseline frame with every block's data decodes");
  refused("a baseline scan cut off mid-scan, then EOI", jpeg(base, sos([1], 0, 63), data.slice(0, data.length >> 1), EOI), /data ends/);
  refused("a baseline scan cut off mid-scan, no EOI", jpeg(base, sos([1], 0, 63), data.slice(0, data.length >> 1)));
  // restart interval of 1 MCU: each interval's data, then RSTn with n = 0..7 cycling
  const rst = (i: number) => [0xff, 0xd0 + (i & 7)];
  const intervals = (blocks: number, body: (i: number) => number[]) => range(blocks).flatMap((i) => [...(i ? rst(i - 1) : []), ...body(i)]);
  const one = zeroBlocks(1), small = [...SOI, ...DQT, ...DHT, ...dri(1), ...sof(0xc0, 64, 64, [0x11])];
  ok(decodeJpeg(jpeg(small, sos([1], 0, 63), intervals(64, () => one), EOI)).width === 64, "a restart scan with every interval's data decodes");
  refused("a restart scan whose intervals are empty", jpeg(small, sos([1], 0, 63), intervals(64, (i) => (i ? [] : one)), EOI), /data ends/);
  refused("a restart scan with its restart markers out of order", jpeg(small, sos([1], 0, 63), intervals(64, () => one).map((v, i, a) => (a[i - 1] === 0xff && v === 0xd3 ? 0xd5 : v)), EOI), /restart/);
  refused("a restart scan that ends at EOI before its last interval", jpeg(small, sos([1], 0, 63), intervals(32, () => one), EOI), /restart|data ends/);
  const big = [...SOI, ...DQT, ...DHT, ...dri(1), ...sof(0xc0, 2048, 2048, [0x11])];
  refused("a 2048x2048 restart scan of 65536 empty intervals", jpeg(big, sos([1], 0, 63), intervals(65536, (i) => (i ? [] : one)), EOI), /data ends/);
}

console.log("scan count and decoding work");
{
  // 8x8 gray, one block: a DC scan, one AC scan for each coefficient 1..63, then DC refinement scans
  const frame = [...SOI, ...DQT, ...DHT, ...sof(0xc2, 8, 8, [0x11]), ...sos([1], 0, 0), ...zeroBlocks(0), ...new Bits().put(0, 4).done()];
  const scans = (n: number) => jpeg(frame, range(63).flatMap((k) => [...sos([1], k + 1, k + 1), ...eobRuns(1)]), range(n - 64).flatMap(() => [...sos([1], 0, 0, 0x10), ...new Bits().put(0, 1).done()]), EOI);
  ok(decodeJpeg(scans(64)).width === 8, "a progressive JPEG of 64 scans decodes");
  refused("a progressive JPEG of 65 scans", scans(65), /too many scans/);
  // 2048x2048 gray: a DC scan, then AC scans over band 1..63 of all 65536 blocks, each a few bytes of EOB runs
  const ac = (n: number) => jpeg(SOI, DQT, DHT, sof(0xc2, 2048, 2048, [0x11]), sos([1], 0, 0), new Bits().put(0, 4 * 65536).done(), range(n).flatMap(() => [...sos([1], 1, 63), ...eobRuns(65536)]), EOI);
  ok(decodeJpeg(ac(8)).width === 2048, "8 full AC passes over a 2048x2048 frame decode");
  refused("9 full AC passes over a 2048x2048 frame", ac(9), /too much decoding work/);
}

console.log(`jpeg-hostile: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
