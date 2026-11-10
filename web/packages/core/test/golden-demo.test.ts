/*
 * Stage 2: demo-script (.xdo) runs must reproduce the C++ harness traces byte for byte.
 */
import { describe, it } from "vitest";
import { checkGolden } from "./golden-helpers.js";

const demos: [string, string][] = [
  ["demo-Myrtle", "Interlockings/Myrtle/Myrtle.xdo"],
  ["script-atlantic", "tools/trace-harness/scripts/atlantic.xdo"],
  ["script-duckburg", "tools/trace-harness/scripts/duckburg.xdo"],
  ["script-irt240", "tools/trace-harness/scripts/irt240.xdo"],
  ["script-islington", "tools/trace-harness/scripts/islington.xdo"],
  ["script-myrtle-routes", "tools/trace-harness/scripts/myrtle-routes.xdo"],
  ["script-progman", "tools/trace-harness/scripts/progman.xdo"],
];

describe("golden demo traces", () => {
  for (const [golden, src] of demos) it(golden, () => checkGolden(golden, src), 30000);
});
