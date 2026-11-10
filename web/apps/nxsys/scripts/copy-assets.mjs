// Copies the shared, unchanged assets of the repo (Interlockings, InterlockingLibrary.xml, Help.xml,
// Documentation) into public/data/ so Vite serves/bundles them, and writes manifest.json listing every
// file. Nothing copied here is committed (public/data is gitignored).
import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const out = resolve(here, "../public/data");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const f of ["InterlockingLibrary.xml", "Help.xml"]) cpSync(join(repo, f), join(out, f));
for (const d of ["Interlockings", "Documentation"]) {
  if (existsSync(join(repo, d))) cpSync(join(repo, d), join(out, d), { recursive: true });
}

const files = [];
(function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else files.push(relative(out, p).split("\\").join("/"));
  }
})(out);
files.sort();
writeFileSync(join(out, "manifest.json"), JSON.stringify({ files }));
console.log(`copy-assets: ${files.length} files -> ${relative(process.cwd(), out)}`);
