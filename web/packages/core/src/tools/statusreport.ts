/*
 * Interlocking status report (File Info): port of NXSYS/v2/StatusReport.cpp (Mac build: CRLF = "\n";
 * no compiled-code section). The two machine-dependent lines (top-level path, modification time) are supplied
 * by the caller; the golden test compares everything else.
 */
import { TypeId, graphicObjectCount, mapAllGraphicObjects } from "../layout/nxgo.js";
import type { PanelSignal } from "../layout/signal.js";
import type { TrackSeg } from "../layout/xtgtrack.js";
import { allTurnoutsView } from "../layout/turnout.js";
import { allRelaySyms } from "../lisp/types.js";
import { loaderState } from "../interlocking/rdtrkcmn.js";
import { nxsysState } from "../interlocking/nxsys.js";

export interface StatusReportInfo {
  interlockingName: string;
  pathname: string;
  /** C ctime() text ("Wed Jun  1 12:00:00 2022\n", newline included) or the failure text */
  ctimeModified: string;
  counts: { label: string; count: number }[];
  nRelays: number;
}

const pad5 = (n: number): string => String(n).padStart(5, " ");

/** C ctime() format, local time, with trailing newline. */
export function ctimeString(d: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const mons = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p2 = (n: number): string => String(n).padStart(2, "0");
  return `${days[d.getDay()]} ${mons[d.getMonth()]} ${String(d.getDate()).padStart(2, " ")} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${d.getFullYear()}\n`;
}

/** InterlockingFileStatus::InterlockingFileStatus + Report(). `modified` is the file's mtime if known. */
export function interlockingStatusReport(modified?: Date | null): string {
  let nSignals = 0;
  let nControlledSignals = 0;
  let nTrackSegments = 0;
  let nExitLights = 0;
  const circuits = new Set<number>();
  mapAllGraphicObjects((g) => {
    switch (g.typeID()) {
      case TypeId.SIGNAL: {
        const sp = (g as PanelSignal).Sig;
        nSignals += 1;
        if (sp && sp.XlkgNo > 0) nControlledSignals += 1;
        break;
      }
      case TypeId.EXITLIGHT:
        nExitLights += 1;
        break;
      case TypeId.TRACKSEG: {
        const c = (g as TrackSeg).Circuit;
        if (c) circuits.add(c.StationNo);
        nTrackSegments += 1;
        break;
      }
      default:
        break;
    }
    return 0;
  });
  /* meterNTurnouts() is the length of the AllTurnouts array (one slot per joint) */
  const nSwitches = allTurnoutsView().length;
  const nRelays = allRelaySyms().filter((r) => r.relay !== null).length;
  const ctime = modified ? ctimeString(modified) : "Cannot determine file modification time.";

  let report = loaderState.InterlockingName + "\n";
  report += "Top level file: " + nxsysState.GlobalFilePathname + "\n";
  report += "Modified (on disk): " + ctime + "\n";
  const table: { label: string; count: number }[] = [
    { label: "switches (switch levers)", count: nSwitches },
    { label: "signals (total)", count: nSignals },
    { label: "controlled signals", count: nControlledSignals },
    { label: "track segments", count: nTrackSegments },
    { label: "track circuits", count: circuits.size },
    { label: "exit lights", count: nExitLights },
    { label: "total graphic objects", count: graphicObjectCount() },
    { label: "\nLogic substrate", count: 0 },
    { label: "relays (non-stub)", count: nRelays },
  ];
  for (const e of table) {
    if (e.label[0] === "\n") report += e.label + "\n\n";
    else report += pad5(e.count) + "  " + e.label + "\n";
  }
  return report;
}

/** The lines of a report that depend on the machine (path, mtime and the blank line ctime() leaves after it). */
export function stripVolatileStatusLines(report: string): string {
  const lines = report.split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("Top level file: ")) continue;
    if (lines[i].startsWith("Modified (on disk): ")) {
      if (lines[i + 1] === "") i++; /* ctime's own newline */
      continue;
    }
    out.push(lines[i]);
  }
  return out.join("\n");
}
