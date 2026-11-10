/*
 * CLI: print the nxtrace for a .trk / .xdo file (same output as tools/trace-harness/build/nxtrace).
 *   npx tsx packages/core/scripts/nxtrace.ts [--settle MS] [--until MS] <file.trk|file.xdo>
 */
import { readFileSync } from "node:fs";
import { runNxtrace } from "../src/trace/nxtrace.js";

const usage = "usage: nxtrace [--settle MS] [--until MS] <file.trk|file.xdo>";
let settle: number | undefined;
let until: number | undefined;
let file: string | null = null;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "--settle" && i + 1 < args.length) settle = parseInt(args[++i], 10);
  else if (a === "--until" && i + 1 < args.length) until = parseInt(args[++i], 10);
  else if (a[0] === "-" && a.length > 1) {
    console.error(usage);
    process.exit(64);
  } else file = a;
}
if (!file) {
  console.error(usage);
  process.exit(64);
}

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
  { settle, until },
);
flush();
process.exitCode = code;
