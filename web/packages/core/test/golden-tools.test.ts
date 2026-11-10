/*
 * Phase 5: the TS relay drafter, full-signal windows and status report must reproduce what the original C++
 * records (tools/trace-harness/golden/tools/, spec in tools-spec.txt): nxdraw display lists of the drafter's
 * paint for chosen relays, of full-signal windows, and the File Info text, at several sim times.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { firstDifference, goldenDir, readFileLatin1, repoRoot } from "./golden-helpers.js";
import { runNxtrace } from "../src/trace/nxtrace.js";
import { recordTools, type ToolSpec } from "../src/tools/record.js";
import { stripVolatileStatusLines } from "../src/tools/statusreport.js";

const toolsDir = resolve(goldenDir, "tools");
const specText = readFileSync(resolve(repoRoot, "tools/trace-harness/tools-spec.txt"), "latin1");

interface Entry {
  src: string;
  times: number[];
  spec: ToolSpec;
}
const entries: Entry[] = specText
  .split("\n")
  .filter((l) => l.trim() !== "" && !l.startsWith("#"))
  .map((l) => {
    const [src, times, pages, sigs] = l.split("\t");
    return {
      src,
      times: times.split(",").map(Number),
      spec: {
        pages: pages.split(";").map((p) => p.split(",")),
        fullsigs: sigs.split(",").map(Number),
        status: true,
      },
    };
  });

describe("golden tool recordings (relay drafter, full signals, status report)", () => {
  it("has a spec", () => expect(entries.length).toBeGreaterThanOrEqual(6));

  for (const { src, times, spec } of entries) {
    it(`${basename(src)} (${times.length} times)`, () => {
      const got = new Map<string, string>();
      const code = runNxtrace(resolve(repoRoot, src), readFileLatin1, () => {}, {
        atTimes: times,
        onAt: (ms) => {
          for (const [k, v] of recordTools(basename(src), ms, spec)) got.set(k, v);
        },
      });
      expect(code).toBe(0);
      const failures: string[] = [];
      let n = 0;
      for (const [name, text] of got) {
        const gp = resolve(toolsDir, name);
        if (!existsSync(gp)) {
          failures.push(`${name}: no golden`);
          continue;
        }
        n++;
        const golden = readFileSync(gp, "latin1");
        if (name.endsWith(".status")) {
          if (stripVolatileStatusLines(golden) !== stripVolatileStatusLines(text)) failures.push(`${name}: status differs\n${golden}\n---\n${text}`);
        } else {
          const diff = firstDifference(golden, text);
          if (diff !== null) failures.push(`${name}: ${diff}`);
        }
      }
      // every golden file for this source must have been produced
      const expected = readdirGolden(basename(src));
      expect(n).toBe(expected.length);
      if (failures.length) throw new Error(`${failures.length} of ${got.size} recordings differ\n${failures.slice(0, 3).join("\n\n")}`);
    }, 60000);
  }
});

import { readdirSync } from "node:fs";
function readdirGolden(base: string): string[] {
  return readdirSync(toolsDir).filter((f) => f.startsWith(base + "@"));
}
