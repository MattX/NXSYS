/*
 * UI-free relay query / state / list / trace helpers (semantics of NXSYSMac/RelayState.mm, RelaySelectorController.mm,
 * RelayListView.mm, RelayTracerController.mm and NXSYSWindows/RelayQueryDialog.cpp, RelayStateDialog.cpp).
 */
import { allRelaySyms, compareRlysyms, internRlysymNoCreate, type RlySym } from "../lisp/types.js";
import { setRelayTrace, type Relay } from "../relay/relay.js";
import { getTickCount } from "../clock/scheduler.js";

/** RelayQueryDialog's regex `\s*(\d+\w+)\s*` after upper-casing. Returns the canonical name or null. */
export function parseRelayName(s: string): string | null {
  const m = /^\s*(\d+\w+)\s*$/.exec(s.toUpperCase());
  return m ? m[1] : null;
}

/** MacRlyDialog's lookup: the relay named (e.g. "244pbs"), or null if there is none. */
export function lookupRelay(name: string): Relay | null {
  const n = parseRelayName(name);
  if (!n) return null;
  const m = /^(\d+)(.+)$/.exec(n)!;
  return internRlysymNoCreate(Number(m[1]), m[2])?.relay ?? null;
}

/** Sort order of the original lists (Relay/Rlysym operator<: number, then strcmp of the type name). */
export const compareRelays = (a: Relay, b: Relay): number => compareRlysyms(a.sym, b.sym);

/** get_relay_array_for_object_number, sorted as RelayListView::setRelayContent does. */
export function relaysForObject(nomenclature: number): Relay[] {
  return allRelaySyms()
    .filter((s: RlySym) => s.n === nomenclature && s.relay)
    .map((s) => s.relay!)
    .sort(compareRelays);
}

/** Every relay that has a Relay object, sorted. */
export function allRelays(): Relay[] {
  return allRelaySyms()
    .filter((s) => s.relay)
    .map((s) => s.relay!)
    .sort(compareRelays);
}

export interface RelayInfo {
  name: string;
  picked: boolean;
  /** relays whose logic mentions this one, sorted */
  dependents: { name: string; picked: boolean; relay: Relay }[];
  /** has autonomous logic to draw (RelayStateDialog enables Draw for non-compiled relays) */
  canDraw: boolean;
}

export function relayInfo(r: Relay): RelayInfo {
  return {
    name: r.name,
    picked: r.state,
    dependents: [...r.dependents].sort(compareRelays).map((d) => ({ name: d.name, picked: d.state, relay: d })),
    canDraw: r.exp !== null,
  };
}

/* ---------------- relay tracer ---------------- */

export interface TraceEntry {
  seq: number;
  t: number;
  name: string;
  picked: boolean;
}

/** RelayTracerController's log ("%-8s  PICK|DROP"), kept in memory for a UI window and/or the console. */
export class RelayTracer {
  entries: TraceEntry[] = [];
  private seq = 0;
  toWindow = false;
  toConsole = false;
  /** oldest entries are discarded beyond this many */
  maxEntries = 20000;

  private install(): void {
    if (this.toWindow || this.toConsole)
      setRelayTrace((name, state) => {
        if (this.toWindow) {
          this.entries.push({ seq: this.seq++, t: getTickCount(), name, picked: state });
          if (this.entries.length > this.maxEntries * 1.25) this.entries.splice(0, this.entries.length - this.maxEntries);
        }
        if (this.toConsole) console.log(`${name.padEnd(8)}  ${state ? "PICK" : "DROP"}`);
      });
    else setRelayTrace(null);
  }
  setWindow(on: boolean): void {
    this.toWindow = on;
    this.install();
  }
  setConsole(on: boolean): void {
    this.toConsole = on;
    this.install();
  }
  clear(): void {
    this.entries = [];
  }
  static format(e: TraceEntry): string {
    return `${e.name.padEnd(8)}  ${e.picked ? "PICK" : "DROP"}`;
  }
}
