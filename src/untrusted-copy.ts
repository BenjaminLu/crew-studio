// Copying what an untrusted process wrote (a build's out/) with no path ever resolved twice: every directory
// and file is opened relative to its parent's descriptor (openat) with O_NOFOLLOW, and checked on the open
// descriptor (fstat). A symlink at any level, a hard link, a fifo, a device or a socket is refused, never
// followed; a directory swapped for a link while the copy runs is refused too, since nothing is looked up by
// path after the root. macOS on arm64 (libc through bun:ffi, built in); elsewhere the caller falls back.
import { dlopen, FFIType, ptr, read, CString } from "bun:ffi";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const O_RDONLY = 0x0000, O_NONBLOCK = 0x0004, O_NOFOLLOW = 0x0100, O_CLOEXEC = 0x01000000, O_DIRECTORY = 0x00100000;
const S_IFMT = 0o170000, S_IFDIR = 0o040000, S_IFREG = 0o100000;
let lib: any = null;
function libc() {
  if (lib) return lib;
  lib = dlopen("/usr/lib/libSystem.B.dylib", {
    open: { args: [FFIType.cstring, FFIType.i32], returns: FFIType.i32 },
    openat: { args: [FFIType.i32, FFIType.cstring, FFIType.i32], returns: FFIType.i32 },
    fstat: { args: [FFIType.i32, FFIType.ptr], returns: FFIType.i32 },
    read: { args: [FFIType.i32, FFIType.ptr, FFIType.u64], returns: FFIType.i64 },
    close: { args: [FFIType.i32], returns: FFIType.i32 },
    fdopendir: { args: [FFIType.i32], returns: FFIType.ptr },
    readdir: { args: [FFIType.ptr], returns: FFIType.ptr },
    closedir: { args: [FFIType.ptr], returns: FFIType.i32 },
  }).symbols;
  return lib;
}
const cstr = (s: string) => Buffer.from(s + "\0", "utf8");
// struct stat (64-bit inodes): st_dev i32 @0, st_mode u16 @4, st_nlink u16 @6, st_ino u64 @8, st_size i64 @96
function fstatOf(fd: number): { mode: number; nlink: number; size: number } | null {
  const b = new Uint8Array(144); if (libc().fstat(fd, ptr(b)) !== 0) return null;
  const v = new DataView(b.buffer); return { mode: v.getUint16(4, true), nlink: v.getUint16(6, true), size: Number(v.getBigInt64(96, true)) };
}
// struct dirent (64-bit inodes): d_ino u64 @0, d_seekoff u64 @8, d_reclen u16 @16, d_namlen u16 @18, d_type u8 @20, d_name @21
function names(dirfd: number): string[] {
  const L = libc(); const dup = L.openat(dirfd, cstr("."), O_RDONLY | O_DIRECTORY | O_CLOEXEC); if (dup < 0) return [];
  const dp = L.fdopendir(dup); if (!dp) { L.close(dup); return []; }
  const out: string[] = [];
  for (let e = L.readdir(dp); e; e = L.readdir(dp)) { const len = read.u16(e, 18); const n = new CString(e, 21, len).toString(); if (n !== "." && n !== "..") out.push(n); }
  L.closedir(dp); return out.sort();
}
function readAll(fd: number, size: number): Buffer {
  const L = libc(); const chunks: Buffer[] = []; let total = 0;
  for (;;) { const b = Buffer.alloc(Math.max(4096, Math.min(1 << 20, size - total + 1))); const n = Number(L.read(fd, ptr(b), b.length)); if (n <= 0) break; chunks.push(b.subarray(0, n)); total += n; if (total > size + (1 << 20)) break; }
  return Buffer.concat(chunks);
}

// the struct offsets above are macOS arm64's (64-bit inodes, the unsuffixed fstat/readdir are the $INODE64 ones there);
// on x86_64 macOS the unsuffixed symbols are the 32-bit-inode variants, so this path is arm64 only
export const canCopyByDescriptor = (platform: string = process.platform, arch: string = process.arch) => platform === "darwin" && arch === "arm64";
export function copyByDescriptor(src: string, dst: string, o: { maxFiles: number; maxBytes: number; maxDepth: number; skipTop?: string[] }): { copied: string[]; refused: string[] } {
  const L = libc(); const out = { copied: [] as string[], refused: [] as string[] }; let bytes = 0;
  const root = L.open(cstr(src), O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC); if (root < 0) return { copied: [], refused: [".: not a folder (or a link)"] };
  const walk = (dirfd: number, rel: string, depth: number) => {
    for (const n of names(dirfd)) {
      if (!rel && o.skipTop?.includes(n)) continue; // a top-level name the caller leaves out (a skill folder's .git)
      const r = rel ? `${rel}/${n}` : n;
      const fd = L.openat(dirfd, cstr(n), O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
      if (fd < 0) { out.refused.push(`${r}: a symlink`); continue; } // O_NOFOLLOW refuses a link at this level (ELOOP); anything else unopenable is refused too
      try {
        const st = fstatOf(fd); if (!st) { out.refused.push(`${r}: could not be read safely`); continue; }
        const kind = st.mode & S_IFMT;
        if (kind === S_IFDIR) { if (depth >= o.maxDepth) { out.refused.push(`${r}: too deep`); continue; } mkdirSync(join(dst, r), { recursive: true }); walk(fd, r, depth + 1); continue; }
        if (kind !== S_IFREG) { out.refused.push(`${r}: not a regular file`); continue; }
        if (st.nlink > 1) { out.refused.push(`${r}: a hard link`); continue; }
        if (out.copied.length >= o.maxFiles) { out.refused.push(`${r}: too many files`); continue; }
        if (bytes + st.size > o.maxBytes) { out.refused.push(`${r}: too large`); continue; }
        const buf = readAll(fd, st.size); bytes += buf.length;
        mkdirSync(join(dst, rel), { recursive: true }); writeFileSync(join(dst, r), buf, { mode: 0o644 }); out.copied.push(r);
      } finally { L.close(fd); }
    }
  };
  mkdirSync(dst, { recursive: true });
  try { walk(root, "", 0); } finally { L.close(root); }
  return out;
}
