// A bounded JPEG decoder and PNG encoder, with no dependency: cursor-agent's image tool returns a JPEG, and every Studio
// image consumer (the image artifact, the coffee kit's media, verifyImagePng) takes a PNG. Baseline, extended-Huffman and
// progressive 8-bit JPEGs with one (gray) or three (YCbCr, or RGB under Adobe transform 0) components; arithmetic coding,
// lossless, 12-bit and CMYK are refused. Chroma is upsampled by replication.
import { deflateSync } from "node:zlib";

const MAX_BYTES = 16 * 1024 * 1024, MAX_SIDE = 4096, MAX_PIXELS = 16_777_216, MAX_SCANS = 64;
// decoding work, counted as blocks a scan visits times the coefficients of its band, may reach this many full passes over
// every coefficient: a baseline image is one, libjpeg's and mozjpeg's progressive scripts stay under four
const MAX_PASSES = 8;
const ZIGZAG = new Int32Array([0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28,
  35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63]);
const bad = (why: string): never => { throw new Error(`JPEG ${why}`); };

type Huffman = { maxcode: Int32Array; valptr: Int32Array; mincode: Int32Array; values: Uint8Array };
type Component = { id: number; h: number; v: number; tq: number; blocksPerLine: number; blocksPerColumn: number; stride: number; rows: number; data: Int16Array; pred: number; dc?: Huffman; ac?: Huffman };

function huffman(counts: Uint8Array, values: Uint8Array): Huffman {
  const maxcode = new Int32Array(18).fill(-1), valptr = new Int32Array(17), mincode = new Int32Array(17);
  let code = 0, k = 0;
  for (let l = 1; l <= 16; l++) { valptr[l] = k; mincode[l] = code; const n = counts[l - 1]; code += n; k += n; if (n) maxcode[l] = code - 1; if (code > 1 << l) bad("Huffman table is invalid"); code <<= 1; }
  if (k !== values.length) bad("Huffman table is invalid");
  return { maxcode, valptr, mincode, values };
}

/** The image's pixels as RGB (3 bytes a pixel, row by row). */
export function decodeJpeg(input: Uint8Array): { width: number; height: number; rgb: Uint8Array } {
  const d = input;
  if (d.length < 4 || d.length > MAX_BYTES || d[0] !== 0xff || d[1] !== 0xd8) bad("is not a bounded JPEG");
  const quant: (Int32Array | undefined)[] = [], dcTables: (Huffman | undefined)[] = [], acTables: (Huffman | undefined)[] = [];
  let frame: { width: number; height: number; progressive: boolean; maxH: number; maxV: number; mcusPerLine: number; mcusPerColumn: number; components: Component[] } | null = null;
  let resetInterval = 0, adobeTransform: number | null = null, ended = false, scans = 0, work = 0, pos = 2;
  const u16 = (at: number) => { if (at + 2 > d.length) bad("is truncated"); return (d[at] << 8) | d[at + 1]; };
  while (pos < d.length && !ended) {
    if (d[pos] !== 0xff) bad("marker expected");
    const marker = d[pos + 1]; pos += 2;
    if (marker === 0xff) { pos--; continue; }
    if (marker === 0xd9) { ended = true; break; }
    if (marker >= 0xd0 && marker <= 0xd7 || marker === 0x01) continue;
    const len = u16(pos), end = pos + len;
    if (len < 2 || end > d.length) bad("segment is truncated");
    const seg = d.subarray(pos + 2, end);
    if (marker === 0xdb) {
      for (let i = 0; i < seg.length;) {
        const pq = seg[i] >> 4, tq = seg[i] & 15; i++;
        if (tq > 3 || pq > 1 || i + 64 * (pq + 1) > seg.length) bad("quantization table is invalid");
        const t = new Int32Array(64);
        for (let k = 0; k < 64; k++) { t[ZIGZAG[k]] = pq ? (seg[i] << 8) | seg[i + 1] : seg[i]; i += pq + 1; }
        quant[tq] = t;
      }
    } else if (marker === 0xc4) {
      for (let i = 0; i < seg.length;) {
        if (i + 17 > seg.length) bad("Huffman table is truncated");
        const tc = seg[i] >> 4, th = seg[i] & 15, counts = seg.subarray(i + 1, i + 17); i += 17;
        const n = counts.reduce((a, b) => a + b, 0);
        if (tc > 1 || th > 3 || i + n > seg.length) bad("Huffman table is invalid");
        (tc ? acTables : dcTables)[th] = huffman(counts, seg.slice(i, i + n)); i += n;
      }
    } else if (marker === 0xdd) { if (seg.length < 2) bad("restart interval is invalid"); resetInterval = (seg[0] << 8) | seg[1]; }
    else if (marker === 0xee) { if (seg.length >= 12 && String.fromCharCode(...seg.subarray(0, 5)) === "Adobe") adobeTransform = seg[11]; }
    else if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
      if (frame) bad("has more than one frame");
      if (seg.length < 6 || seg[0] !== 8) bad("precision is not 8-bit");
      const height = (seg[1] << 8) | seg[2], width = (seg[3] << 8) | seg[4], n = seg[5];
      if (!width || !height || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) bad("dimensions are unsupported");
      if ((n !== 1 && n !== 3) || seg.length !== 6 + 3 * n) bad("component count is unsupported");
      const raw = [...Array(n)].map((_, i) => ({ id: seg[6 + 3 * i], h: seg[7 + 3 * i] >> 4, v: seg[7 + 3 * i] & 15, tq: seg[8 + 3 * i] }));
      if (raw.some((c) => c.h < 1 || c.h > 4 || c.v < 1 || c.v > 4 || c.tq > 3) || new Set(raw.map((c) => c.id)).size !== n) bad("component is invalid");
      const maxH = Math.max(...raw.map((c) => c.h)), maxV = Math.max(...raw.map((c) => c.v));
      const mcusPerLine = Math.ceil(width / (8 * maxH)), mcusPerColumn = Math.ceil(height / (8 * maxV));
      const components = raw.map((c) => {
        const stride = mcusPerLine * c.h, rows = mcusPerColumn * c.v;
        return { ...c, blocksPerLine: Math.ceil(Math.ceil((width * c.h) / maxH) / 8), blocksPerColumn: Math.ceil(Math.ceil((height * c.v) / maxV) / 8), stride, rows, data: new Int16Array(stride * rows * 64), pred: 0 };
      });
      frame = { width, height, progressive: marker === 0xc2, maxH, maxV, mcusPerLine, mcusPerColumn, components };
    } else if (marker >= 0xc3 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) bad("coding process is unsupported (lossless or arithmetic)");
    else if (marker === 0xda) {
      if (!frame) bad("scan before frame");
      const ns = seg[0];
      if (ns < 1 || ns > 4 || seg.length !== 4 + 2 * ns) bad("scan header is invalid");
      const comps = [...Array(ns)].map((_, i) => {
        const c = frame!.components.find((x) => x.id === seg[1 + 2 * i]) ?? bad("scan names an unknown component");
        c.dc = dcTables[seg[2 + 2 * i] >> 4]; c.ac = acTables[seg[2 + 2 * i] & 15]; return c;
      });
      const ss = seg[1 + 2 * ns], se = seg[2 + 2 * ns], ah = seg[3 + 2 * ns] >> 4, al = seg[3 + 2 * ns] & 15;
      if (!frame.progressive && (ss !== 0 || se !== 63 || ah || al)) bad("sequential scan is invalid");
      if (ss > se || se > 63 || (frame.progressive && ss === 0 && se !== 0) || (ss > 0 && ns !== 1) || al > 13) bad("progressive scan is invalid");
      if (++scans > MAX_SCANS) bad("has too many scans");
      const blocks = ns === 1 ? comps[0].blocksPerLine * comps[0].blocksPerColumn : frame.mcusPerLine * frame.mcusPerColumn * comps.reduce((n, c) => n + c.h * c.v, 0);
      work += blocks * (se - ss + 1);
      if (work > MAX_PASSES * 64 * frame.components.reduce((n, c) => n + c.stride * c.rows, 0)) bad("needs too much decoding work");
      pos = decodeScan(d, end, frame, comps, resetInterval, ss, se, ah, al);
      continue;
    }
    pos = end;
  }
  if (!frame || !scans) bad("has no image data");
  const f = frame;
  // dequantize and inverse-DCT every block into the component's sample plane
  const planes = f.components.map((c) => {
    const q = quant[c.tq] ?? bad("quantization table is missing"), w = c.stride * 8, plane = new Uint8ClampedArray(w * c.rows * 8);
    const block = new Float64Array(64), tmp = new Float64Array(64);
    for (let row = 0; row < c.rows; row++) for (let col = 0; col < c.stride; col++) {
      const off = (row * c.stride + col) * 64;
      for (let i = 0; i < 64; i++) block[i] = c.data[off + i] * q[i];
      idct(block, tmp);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) plane[(row * 8 + y) * w + col * 8 + x] = Math.round(block[y * 8 + x] + 128);
    }
    return { plane, w, c };
  });
  const rgb = new Uint8Array(f.width * f.height * 3), sx = planes.map((p) => p.c.h / f.maxH), sy = planes.map((p) => p.c.v / f.maxV);
  const rgbSpace = planes.length === 3 && adobeTransform === 0;
  for (let y = 0; y < f.height; y++) for (let x = 0; x < f.width; x++) {
    const at = (y * f.width + x) * 3, s = planes.map((p, i) => p.plane[Math.floor(y * sy[i]) * p.w + Math.floor(x * sx[i])]);
    if (s.length === 1) { rgb[at] = rgb[at + 1] = rgb[at + 2] = s[0]; continue; }
    if (rgbSpace) { rgb[at] = s[0]; rgb[at + 1] = s[1]; rgb[at + 2] = s[2]; continue; }
    const [Y, cb, cr] = [s[0], s[1] - 128, s[2] - 128];
    rgb[at] = clamp(Y + 1.402 * cr); rgb[at + 1] = clamp(Y - 0.344136 * cb - 0.714136 * cr); rgb[at + 2] = clamp(Y + 1.772 * cb);
  }
  return { width: f.width, height: f.height, rgb };
}
const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

const COS = (() => { const t = new Float64Array(64); for (let x = 0; x < 8; x++) for (let u = 0; u < 8; u++) t[x * 8 + u] = (u ? 1 : Math.SQRT1_2) * Math.cos(((2 * x + 1) * u * Math.PI) / 16) / 2; return t; })();
/** In place: an 8x8 block of dequantized coefficients (natural order) becomes its level-shifted-free samples. */
function idct(b: Float64Array, t: Float64Array) {
  for (let v = 0; v < 8; v++) for (let x = 0; x < 8; x++) { let s = 0; for (let u = 0; u < 8; u++) s += COS[x * 8 + u] * b[v * 8 + u]; t[v * 8 + x] = s; }
  for (let x = 0; x < 8; x++) for (let y = 0; y < 8; y++) { let s = 0; for (let v = 0; v < 8; v++) s += COS[y * 8 + v] * t[v * 8 + x]; b[y * 8 + x] = s; }
}

/** One scan's entropy-coded data, from `start` to its next non-restart marker; returns that marker's position. */
function decodeScan(d: Uint8Array, start: number, f: { mcusPerLine: number; mcusPerColumn: number; progressive: boolean }, comps: Component[], resetInterval: number, ss: number, se: number, ah: number, al: number): number {
  let pos = start, bits = 0, count = 0, eobrun = 0, acState = 0, acNext = 0, rst = 0;
  // a scan's (or restart interval's) data holds every one of its blocks: reading on into a marker or the end is refused
  const bit = (): number => {
    if (count) return (bits >> --count) & 1;
    if (pos >= d.length || (d[pos] === 0xff && d[pos + 1] !== 0)) bad("scan data ends before its last block");
    bits = d[pos]; pos += bits === 0xff ? 2 : 1;
    count = 7; return (bits >> 7) & 1;
  };
  const receive = (n: number) => { let v = 0; while (n--) v = (v << 1) | bit(); return v; };
  const extend = (n: number) => { if (!n) return 0; const v = receive(n); return v >= 1 << (n - 1) ? v : v - (1 << n) + 1; };
  const decode = (h: Huffman | undefined): number => {
    if (!h) bad("scan uses a missing Huffman table");
    let code = 0;
    for (let l = 1; l <= 16; l++) { code = (code << 1) | bit(); if (h!.maxcode[l] >= 0 && code <= h!.maxcode[l]) return h!.values[h!.valptr[l] + code - h!.mincode[l]]; }
    return bad("Huffman code is invalid");
  };
  const block = (c: Component, off: number) => {
    const z = c.data;
    if (!f.progressive) {
      const t = decode(c.dc); z[off] = c.pred += extend(t);
      for (let k = 1; k < 64;) { const rs = decode(c.ac), s = rs & 15, r = rs >> 4; if (!s) { if (r < 15) break; k += 16; continue; } k += r; if (k > 63) bad("block overruns"); z[off + ZIGZAG[k]] = extend(s); k++; }
    } else if (ss === 0) {
      if (!ah) { const t = decode(c.dc); z[off] = c.pred += extend(t) * (1 << al); } else if (bit()) z[off] |= 1 << al;
    } else if (!ah) {
      if (eobrun > 0) { eobrun--; return; }
      for (let k = ss; k <= se;) { const rs = decode(c.ac), s = rs & 15, r = rs >> 4; if (!s) { if (r < 15) { eobrun = receive(r) + (1 << r) - 1; break; } k += 16; continue; } k += r; if (k > 63) bad("block overruns"); z[off + ZIGZAG[k]] = extend(s) * (1 << al); k++; }
    } else {
      let r = 0;
      for (let k = ss; k <= se;) {
        const at = off + ZIGZAG[k], sign = z[at] < 0 ? -1 : 1;
        if (acState === 0) {
          const rs = decode(c.ac), s = rs & 15; r = rs >> 4;
          if (!s) { if (r < 15) { eobrun = receive(r) + (1 << r); acState = 4; } else { r = 16; acState = 1; } }
          else { if (s !== 1) bad("refinement is invalid"); acNext = extend(s); acState = r ? 2 : 3; }
          continue;
        }
        if (acState === 1 || acState === 2) { if (z[at]) z[at] += sign * (bit() << al); else if (--r === 0) acState = acState === 2 ? 3 : 0; }
        else if (acState === 3) { if (z[at]) z[at] += sign * (bit() << al); else { z[at] = acNext << al; acState = 0; } }
        else if (z[at]) z[at] += sign * (bit() << al);
        k++;
      }
      if (acState === 4 && --eobrun === 0) acState = 0;
    }
  };
  const one = comps.length === 1 ? comps[0] : null;
  const total = one ? one.blocksPerLine * one.blocksPerColumn : f.mcusPerLine * f.mcusPerColumn;
  let mcu = 0;
  for (;;) {
    const n = resetInterval ? Math.min(total - mcu, resetInterval) : total - mcu;
    for (const c of comps) c.pred = 0;
    eobrun = 0; acState = 0;
    for (let i = 0; i < n; i++, mcu++) {
      if (one) { const row = Math.floor(mcu / one.blocksPerLine), col = mcu % one.blocksPerLine; block(one, (row * one.stride + col) * 64); continue; }
      const mr = Math.floor(mcu / f.mcusPerLine), mc = mcu % f.mcusPerLine;
      for (const c of comps) for (let v = 0; v < c.v; v++) for (let h = 0; h < c.h; h++) block(c, ((mr * c.v + v) * c.stride + mc * c.h + h) * 64);
    }
    // past the interval's padding: blocks left means the next restart marker in sequence, none left means the scan ends
    count = 0;
    while (pos + 1 < d.length && !(d[pos] === 0xff && d[pos + 1] !== 0 && d[pos + 1] !== 0xff)) pos++;
    if (pos + 1 >= d.length) bad("scan is truncated");
    if (mcu < total) { if (d[pos + 1] !== 0xd0 + (rst++ & 7)) bad("restart marker is missing or out of order"); pos += 2; continue; }
    return pos;
  }
}

function crc32(b: Uint8Array) { let c = 0xffffffff; for (const v of b) { c ^= v; for (let n = 0; n < 8; n++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; }
const chunk = (name: string, body: Uint8Array) => { const head = Buffer.alloc(8), tail = Buffer.alloc(4); head.writeUInt32BE(body.length); head.write(name, 4, "ascii"); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body]))); return Buffer.concat([head, body, tail]); };
/** An 8-bit RGB PNG of these pixels (no filter, zlib-deflated). */
export function encodePng(width: number, height: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rows.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", new Uint8Array(0))]);
}
/** A JPEG as the PNG Studio's image consumers take. */
export function jpegToPng(jpeg: Uint8Array): { png: Buffer; width: number; height: number } {
  const { width, height, rgb } = decodeJpeg(jpeg);
  return { png: encodePng(width, height, rgb), width, height };
}
