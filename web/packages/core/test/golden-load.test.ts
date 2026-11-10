/*
 * Phase 1 acceptance: the TS loader must produce byte-identical traces to the C++ harness
 * (tools/trace-harness/golden/load-*.trace) for all interlockings.
 */
import { describe, it } from "vitest";
import { checkGolden } from "./golden-helpers.js";

const loads: [string, string][] = [
  ["load-progman", "Interlockings/Progman/progman.trk"],
  ["load-islingtn", "Interlockings/Islington/islingtn.trk"],
  ["load-myrtle", "Interlockings/Myrtle/myrtle.trk"],
  ["load-atlantic", "Interlockings/Atlantic/atlantic.trk"],
  ["load-irt240", "Interlockings/irt240/irt.240tl.trk"],
  ["load-db7", "Interlockings/Duckburg/db7.trk"],
  ["load-dburg", "Interlockings/Duckburg/dburg.trk"],
];

describe("golden load traces", () => {
  for (const [golden, src] of loads) it(golden, () => checkGolden(golden, src));
});
