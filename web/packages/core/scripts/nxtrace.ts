/*
 * CLI: print the nxtrace for a .trk / .xdo file (same output as tools/trace-harness/build/nxtrace).
 *   npx tsx packages/core/scripts/nxtrace.ts [--settle MS] [--until MS] [--draw-at MS[,MS...] --draw-dir DIR] <file.trk|file.xdo>
 * --draw-at/--draw-dir write <DIR>/<basename>@<ms>.nxdraw display lists, like the C++ harness.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { runNxtrace } from "../src/trace/nxtrace.js";

const usage = "usage: nxtrace [--settle MS] [--until MS] [--draw-at MS[,MS...] --draw-dir DIR] <file.trk|file.xdo>";
let drawAt: number[] = [];
let drawDir: string | null = null;
let settle: number | undefined;
let until: number | undefined;
let file: string | null = null;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--settle" && i + 1 < args.length) settle = parseInt(args[++i], 10);
  else if (a === "--until" && i + 1 < args.length) until = parseInt(args[++i], 10);
  else if (a === "--draw-at" && i + 1 < args.length)
    drawAt = args[++i]
      .split(",")
      .filter((x) => x !== "")
      .map((x) => parseInt(x, 10));
  else if (a === "--draw-dir" && i + 1 < args.length) drawDir = args[++i];
  else if (a[0] === "-" && a.length > 1) {
    console.error(usage);
    process.exit(64);
  } else file = a;
}
if (!file || (drawAt.length > 0 && drawDir === null)) {
  console.error(usage);
  process.exit(64);
}
if (drawDir !== null) mkdirSync(drawDir, { recursive: true });

const readFile = (p: string): string | null => {
  try {
    return readFileSync(p, "latin1");
  } catch {
    return null;
  }
};

let buf: string[] = [];
const flush = (): void => {
  if (buf.length) process.stdout.write(buf.join(""));
  buf = [];
};
const code = runNxtrace(
  file,
  readFile,
  (l) => {
    buf.push(l + "\n");
    if (buf.length >= 512) flush();
  },
  {
    settle,
    until,
    drawAt,
    onDraw: (ms, text) => writeFileSync(join(drawDir!, `${basename(file!)}@${ms}.nxdraw`), text, "latin1"),
  },
);
flush();
process.exitCode = code;
