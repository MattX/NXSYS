/*
 * Recording of tool windows as nxdraw files / text, mirroring `nxtrace --tool-at/--draft-relays/--fullsig/--status-at`
 * (tools/trace-harness/src/main.cpp). Used by the golden tests and the CLI.
 */
import { RecordingDC } from "../render/recording.js";
import { TypeId, mapGraphicObjectsOfType } from "../layout/nxgo.js";
import type { PanelSignal, Signal } from "../layout/signal.js";
import { DRAFT_PAGE_HEIGHT, DRAFT_PAGE_WIDTH, RelayDrafter } from "./ldgut.js";
import { fullSignalClientSize, paintFullSignal } from "./fullsig.js";
import { interlockingStatusReport } from "./statusreport.js";

export interface ToolSpec {
  /** draft pages: each a list of relay names */
  pages: string[][];
  /** full-signal numbers (XlkgNo, or StationNo if none) */
  fullsigs: number[];
  status: boolean;
}

/** The signal with the given number (XlkgNo, else StationNo), as main.cpp SignalFinder. */
export function findSignalByNumber(no: number): Signal | null {
  let found: Signal | null = null;
  mapGraphicObjectsOfType(TypeId.SIGNAL, (g) => {
    const s = (g as PanelSignal).Sig;
    if (s && (s.XlkgNo ? s.XlkgNo : s.StationNo) === no) {
      found = s;
      return 1;
    }
    return 0;
  });
  return found;
}

export function recordDraftPage(base: string, ms: number, names: string[]): string {
  const d = new RelayDrafter();
  for (const n of names) {
    if (!d.drawRelayFromName(n)) continue;
    if (!d.placeRelayDrawing()) console.error(`nxtrace: relay circuit ${n} too big for the page`);
  }
  const rec = new RecordingDC();
  rec.header(base, ms);
  rec.view(0, 0, DRAFT_PAGE_WIDTH, DRAFT_PAGE_HEIGHT, 1);
  d.paint(rec);
  rec.end();
  return rec.toString();
}

export function recordFullSignal(base: string, ms: number, s: Signal): string {
  const { w, h } = fullSignalClientSize(s);
  const rec = new RecordingDC();
  rec.header(base, ms);
  rec.view(0, 0, w, h, 1);
  paintFullSignal(s, rec);
  rec.end();
  return rec.toString();
}

/** file name -> contents, named exactly as the C++ harness names them. */
export function recordTools(base: string, ms: number, spec: ToolSpec): Map<string, string> {
  const out = new Map<string, string>();
  spec.pages.forEach((names, k) => out.set(`${base}@${ms}.draft${k}.nxdraw`, recordDraftPage(base, ms, names)));
  for (const no of spec.fullsigs) {
    const s = findSignalByNumber(no);
    if (s) out.set(`${base}@${ms}.fullsig${no}.nxdraw`, recordFullSignal(base, ms, s));
    else console.error(`nxtrace: no signal ${no}`);
  }
  if (spec.status) out.set(`${base}@${ms}.status`, interlockingStatusReport(null));
  return out;
}
