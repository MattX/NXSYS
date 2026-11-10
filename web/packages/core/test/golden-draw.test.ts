/*
 * Phase 2: the TS Display() code must reproduce, call for call, the GDI streams the original C++
 * records when it paints the panel (tools/trace-harness/golden/draw/*.nxdraw, listed in MANIFEST),
 * and drawing must not disturb the relay trace.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { goldenDir, readFileLatin1, repoRoot } from "./golden-helpers.js";
import { runNxtrace, traceToString } from "../src/trace/nxtrace.js";

const drawDir = resolve(goldenDir, "draw");

/** Golden file text; also accepts a gzipped copy (.nxdraw.gz) should the goldens ever be compressed. */
function readGoldenDraw(name: string): string {
  const p = resolve(drawDir, name);
  if (existsSync(p)) return readFileSync(p, "latin1");
  return gunzipSync(readFileSync(p + ".gz")).toString("latin1");
}

/** First differing line, ~10 lines of context, and the OBJ the difference is in. */
export function describeDrawDifference(expected: string, actual: string): string | null {
  if (expected === actual) return null;
  const e = expected.split("\n");
  const a = actual.split("\n");
  let i = 0;
  while (i < e.length && i < a.length && e[i] === a[i]) i++;
  let obj = "(before first OBJ)";
  let objLine = -1;
  for (let k = Math.min(i, e.length - 1); k >= 0; k--)
    if (e[k].startsWith("OBJ ")) {
      obj = e[k];
      objLine = k + 1;
      break;
    }
  const from = Math.max(0, i - 10);
  const ctx = e.slice(from, i).map((l) => `  ${l}`);
  return [
    `first difference at line ${i + 1} (expected ${e.length} lines, got ${a.length}); in "${obj}" (line ${objLine})`,
    ...ctx,
    `- ${e[i] ?? "<end of expected>"}`,
    `+ ${a[i] ?? "<end of actual>"}`,
    ...e.slice(i + 1, i + 3).map((l) => `  (expected next) ${l}`),
  ].join("\n");
}

interface Entry {
  src: string;
  times: number[];
}
const manifest: Entry[] = readFileSync(resolve(drawDir, "MANIFEST"), "latin1")
  .split("\n")
  .filter((l) => l.trim() !== "")
  .map((l) => {
    const [src, times] = l.split("\t");
    return { src, times: times.split(",").map(Number) };
  });

describe("golden draw lists", () => {
  it("has a manifest covering every source", () => {
    expect(manifest.length).toBeGreaterThanOrEqual(14);
  });

  for (const { src, times } of manifest) {
    it(`${basename(src)} (${times.length} paints)`, () => {
      const draws = new Map<number, string>();
      const { text, code } = (() => {
        const lines: string[] = [];
        const code = runNxtrace(resolve(repoRoot, src), readFileLatin1, (l) => lines.push(l), {
          drawAt: times,
          onDraw: (ms, t) => draws.set(ms, t),
        });
        return { text: lines.map((l) => l + "\n").join(""), code };
      })();
      expect(code).toBe(0);
      expect(draws.size).toBe(times.length);
      const failures: string[] = [];
      for (const ms of times) {
        const name = `${basename(src)}@${ms}.nxdraw`;
        const diff = describeDrawDifference(readGoldenDraw(name), draws.get(ms) ?? "");
        if (diff !== null) failures.push(`${name}: ${diff}`);
      }
      if (failures.length) throw new Error(`${failures.length} of ${times.length} draw lists differ\n${failures.slice(0, 3).join("\n\n")}`);
      // painting must not change the relay trace
      const plain = traceToString(resolve(repoRoot, src), readFileLatin1);
      expect(text).toBe(plain.text);
    }, 60000);
  }
});
