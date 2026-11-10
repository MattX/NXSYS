/* Shared helpers for the golden-trace tests (not a test file itself). */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { traceToString } from "../src/trace/nxtrace.js";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../../../..");
export const goldenDir = resolve(repoRoot, "tools/trace-harness/golden");

export const readFileLatin1 = (p: string): string | null => {
  try {
    return readFileSync(p, "latin1");
  } catch {
    return null;
  }
};

/** First differing line with ~10 lines of context, or null if equal. */
export function firstDifference(expected: string, actual: string): string | null {
  if (expected === actual) return null;
  const e = expected.split("\n");
  const a = actual.split("\n");
  let i = 0;
  while (i < e.length && i < a.length && e[i] === a[i]) i++;
  const from = Math.max(0, i - 10);
  const ctx = e.slice(from, i).map((l) => `  ${l}`);
  const exp = e.slice(i, i + 3).map((l) => `- ${l}`);
  const got = a.slice(i, i + 3).map((l) => `+ ${l}`);
  return [`first difference at line ${i + 1} (expected ${e.length} lines, got ${a.length}):`, ...ctx, ...exp, ...got].join("\n");
}

export function checkGolden(goldenName: string, sourceFile: string): void {
  const expected = readFileSync(resolve(goldenDir, goldenName + ".trace"), "latin1");
  const { text, code } = traceToString(resolve(repoRoot, sourceFile), readFileLatin1);
  const diff = firstDifference(expected, text);
  if (diff !== null) throw new Error(`${goldenName}: trace differs (exit code ${code})\n${diff}`);
}
