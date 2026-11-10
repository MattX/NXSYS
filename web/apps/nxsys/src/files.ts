/*
 * In-memory file system for the (synchronous) core file reader, plus the bundled-interlocking
 * library (InterlockingLibrary.xml / manifest.json copied into public/data by scripts/copy-assets.mjs)
 * and user-supplied files (folder picker, drag and drop).
 */

export const DATA_BASE = "data/";

/** Bytes -> string, one char per byte (ISO-8859-1; TextDecoder("latin1") is really windows-1252). */
export function latin1(buf: ArrayBuffer): string {
  const u = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode(...u.subarray(i, i + 8192));
  return s;
}

export function normPath(p: string): string {
  const out: string[] = [];
  for (const seg of p.replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") out.pop();
    else out.push(seg);
  }
  return out.join("/");
}
export const dirOf = (p: string): string => p.slice(0, Math.max(0, p.lastIndexOf("/")));
export const baseOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

const TEXT_EXT = /\.(trk|xdo|txt|lisp|lsp)$/i;
export const isTextFile = (p: string): boolean => TEXT_EXT.test(p);

export class FileStore {
  private exact = new Map<string, string>();
  private lower = new Map<string, string>();
  set(path: string, text: string): void {
    const n = normPath(path);
    this.exact.set(n, text);
    this.lower.set(n.toLowerCase(), n);
  }
  has(path: string): boolean {
    return this.read(path) !== null;
  }
  /** Case-insensitive fallback, as on the (case-insensitive) Mac and Windows file systems. */
  read(path: string): string | null {
    const n = normPath(path);
    const t = this.exact.get(n);
    if (t !== undefined) return t;
    const k = this.lower.get(n.toLowerCase());
    return k !== undefined ? (this.exact.get(k) ?? null) : null;
  }
  paths(): string[] {
    return [...this.exact.keys()];
  }
  /** Remove everything under a prefix (re-dropping a folder). */
  clearPrefix(prefix: string): void {
    const p = normPath(prefix) + "/";
    for (const k of [...this.exact.keys()])
      if (k.startsWith(p)) {
        this.exact.delete(k);
        this.lower.delete(k.toLowerCase());
      }
  }
}

export interface LibraryEntry {
  title: string;
  /** path within the virtual file system, e.g. "Interlockings/Progman/progman.trk" */
  path: string;
}

export interface HelpEntry {
  title: string;
  url: string;
  external: boolean;
  include?: string;
}

let manifest: string[] = [];

async function fetchOk(url: string): Promise<Response> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
}

export async function loadLibrary(): Promise<LibraryEntry[]> {
  try {
    manifest = ((await (await fetchOk(DATA_BASE + "manifest.json")).json()) as { files: string[] }).files;
  } catch {
    manifest = [];
  }
  const xml = await (await fetchOk(DATA_BASE + "InterlockingLibrary.xml")).text();
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const out: LibraryEntry[] = [];
  doc.querySelectorAll("interlocking").forEach((el) => {
    const path = (el.getAttribute("path") ?? "").replace(/\$\(here\)\/?/g, "");
    out.push({ title: el.getAttribute("name") ?? path, path: normPath(path) });
  });
  return out;
}

export async function loadHelpIndex(): Promise<HelpEntry[]> {
  try {
    const xml = await (await fetchOk(DATA_BASE + "Help.xml")).text();
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const out: HelpEntry[] = [];
    doc.querySelectorAll("item").forEach((el) => {
      const url = el.getAttribute("url") ?? "";
      const local = url.startsWith("file://");
      out.push({
        title: el.getAttribute("title") ?? url,
        url: local ? DATA_BASE + url.slice("file://".length) : url,
        external: !local,
        include: el.getAttribute("include") ?? undefined,
      });
    });
    return out;
  } catch {
    return [];
  }
}

/** Fetch every bundled file in the folder of `path` (and below) into the store. */
export async function prefetchFolder(store: FileStore, path: string): Promise<void> {
  const dir = dirOf(path) + "/";
  const want = manifest.filter((f) => f.startsWith(dir) && isTextFile(f) && store.read(f) === null);
  await Promise.all(
    want.map(async (f) => {
      const r = await fetchOk(DATA_BASE + encodeURI(f).replace(/#/g, "%23"));
      store.set(f, latin1(await r.arrayBuffer()));
    }),
  );
  if (store.read(path) === null) {
    // not in the manifest (dev server without manifest?) -> try directly, plus includes
    const r = await fetchOk(DATA_BASE + encodeURI(path));
    store.set(path, latin1(await r.arrayBuffer()));
    await prefetchIncludes(store, path);
  }
}

async function prefetchIncludes(store: FileStore, path: string, seen = new Set<string>()): Promise<void> {
  if (seen.has(path)) return;
  seen.add(path);
  const text = store.read(path);
  if (text === null) return;
  for (const m of text.matchAll(/\(\s*include\s+"([^"]+)"/gi)) {
    const p = normPath(dirOf(path) + "/" + m[1]);
    if (store.read(p) === null) {
      try {
        const r = await fetchOk(DATA_BASE + encodeURI(p));
        store.set(p, latin1(await r.arrayBuffer()));
      } catch {
        continue; // the loader reports the missing include
      }
    }
    await prefetchIncludes(store, p, seen);
  }
}

/** Demo scripts (.xdo) bundled alongside a library interlocking. */
export function demosInFolder(path: string): string[] {
  const dir = dirOf(path) + "/";
  return manifest.filter((f) => f.startsWith(dir) && /\.xdo$/i.test(f));
}

/* ---------------- user files ---------------- */

export interface UserFile {
  path: string;
  file: File;
}

export async function storeUserFiles(store: FileStore, files: UserFile[]): Promise<string[]> {
  const stored: string[] = [];
  await Promise.all(
    files.map(async ({ path, file }) => {
      if (!isTextFile(path)) return;
      store.set(path, latin1(await file.arrayBuffer()));
      stored.push(normPath(path));
    }),
  );
  return stored.sort();
}

/** FileList from <input webkitdirectory> (or multi-select). */
export function filesFromInput(list: FileList): UserFile[] {
  return [...list].map((file) => ({ file, path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }));
}

/** Drag-and-drop: walk directories via the FileSystemEntry API. */
export async function filesFromDrop(dt: DataTransfer): Promise<UserFile[]> {
  const out: UserFile[] = [];
  const entries: FileSystemEntry[] = [];
  for (const item of [...dt.items]) {
    const e = item.webkitGetAsEntry?.();
    if (e) entries.push(e);
  }
  if (entries.length === 0) return filesFromInput(dt.files);
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) {
      const file = await new Promise<File>((res, rej) => (e as FileSystemFileEntry).file(res, rej));
      out.push({ file, path: e.fullPath.replace(/^\//, "") });
    } else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (batch.length === 0) break;
        for (const c of batch) await walk(c);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}

/**
 * Main interlockings among stored .trk paths: those no other stored .trk (include "...")s.
 */
export function mainTrkFiles(store: FileStore, paths: string[]): string[] {
  const trks = paths.filter((p) => /\.trk$/i.test(p));
  const included = new Set<string>();
  for (const p of trks) {
    const t = store.read(p) ?? "";
    for (const m of t.matchAll(/\(\s*include\s+"([^"]+)"/gi)) included.add(normPath(dirOf(p) + "/" + m[1]).toLowerCase());
  }
  const mains = trks.filter((p) => !included.has(normPath(p).toLowerCase()));
  return mains.length ? mains : trks;
}
