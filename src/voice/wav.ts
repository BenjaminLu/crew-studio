// 16-bit mono PCM chunks into one WAV file (RIFF, little endian): what the local voice serves for a point.

/** a WAV file of the chunks, in order, with gapMs of silence between them */
export function wav(chunks: Buffer[], sampleRate: number, gapMs = 0): Buffer {
  const gap = Buffer.alloc(Math.round((sampleRate * gapMs) / 1000) * 2);
  const parts: Buffer[] = []; chunks.forEach((c, i) => { if (i && gap.length) parts.push(gap); parts.push(c.length % 2 ? c.subarray(0, c.length - 1) : c); });
  const data = Buffer.concat(parts), h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii"); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii"); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii"); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
/** a WAV's sample rate and length in seconds (16-bit mono only), or null when it is not one */
export function wavInfo(b: Buffer): { sampleRate: number; seconds: number } | null {
  if (b.length < 44 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE" || b.readUInt16LE(22) !== 1 || b.readUInt16LE(34) !== 16) return null;
  const rate = b.readUInt32LE(24); return rate ? { sampleRate: rate, seconds: b.readUInt32LE(40) / 2 / rate } : null;
}
/** 16-bit PCM without the near-silence Kokoro puts before and after each run, keeping keepMs of it at either end */
export function trimSilence(pcm: Buffer, sampleRate: number, keepMs = 40, floor = 400): Buffer {
  const n = Math.floor(pcm.length / 2), keep = Math.round((sampleRate * keepMs) / 1000);
  let a = 0, b = n - 1; while (a < n && Math.abs(pcm.readInt16LE(a * 2)) < floor) a++; while (b > a && Math.abs(pcm.readInt16LE(b * 2)) < floor) b--;
  if (a >= n) return pcm.subarray(0, 0);
  return pcm.subarray(Math.max(0, a - keep) * 2, Math.min(n, b + 1 + keep) * 2);
}
