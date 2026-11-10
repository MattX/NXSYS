import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { dumpTrk } from "../src/lisp/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const fixtures = join(here, "fixtures/sexpr-dump");

const cases: [string, string][] = [
  ["progman", "Interlockings/Progman/progman.trk"],
  ["islington", "Interlockings/Islington/islingtn.trk"],
  ["myrtle", "Interlockings/Myrtle/myrtle.trk"],
  ["atlantic", "Interlockings/Atlantic/atlantic.trk"],
  ["duckburg", "Interlockings/Duckburg/db7.trk"],
  ["irt240", "Interlockings/irt240/irt.240tl.trk"],
];

// Files are bytes; decode as latin1 so each char is one byte (as C++ getc sees them).
const readFile = (p: string): string | null => (existsSync(p) ? readFileSync(p).toString("latin1") : null);

describe("sexpr-dump parity with C++ oracle", () => {
  for (const [name, path] of cases) {
    it(name, () => {
      const got = dumpTrk(join(repo, path), readFile);
      const want = readFileSync(join(fixtures, `${name}.txt`)).toString("latin1");
      expect(got.length).toBe(want.length);
      expect(got === want).toBe(true);
      expect(got).not.toMatch(/^(BARF|ERROR) /m);
    });
  }
});
