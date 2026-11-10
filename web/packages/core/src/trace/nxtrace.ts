/*
 * Trace runner: produces output in EXACTLY the nxtrace format of the C++ headless harness
 * (tools/trace-harness/src/main.cpp; format in tools/trace-harness/NOTES.md):
 *
 *   # nxtrace 1 <basename>
 *   @<ms> LOAD <basename>      each ReadLayout call (the C++ wraps ReadLayout with ld --wrap)
 *   @<ms> PICK|DROP <relay>    relay transitions
 *   @<ms> LOADED <n>           after a successful load; n = relay symbols that have a relay
 *   @<ms> DEMO <PRep>          top-level demo forms, as executed
 *   @<ms> END
 *   STATE <relay> <0|1>        sorted by Rlysym::operator< (number, then strcmp of type name)
 *
 * A .trk file is loaded at sim time 0 and then the clock runs `settle` ms (default 20000);
 * a .xdo file is run as a demo until it finishes, then `settle` more ms. `until` (absolute ms)
 * overrides both stop times.
 */
import { setLispBarfHandler, getLispBarfString } from "../lisp/barf.js";
import { printSexpr } from "../lisp/printer.js";
import { allRelaySyms, compareRlysyms } from "../lisp/types.js";
import { setRelayTrace } from "../relay/relay.js";
import { scheduler } from "../clock/scheduler.js";
import { AppAbort, host } from "../host.js";
import { getLayout, startUpNXSYS } from "../interlocking/nxsys.js";
import { loadHooks, setFileReader, type FileReader } from "../interlocking/rdtrkcmn.js";
import { demo, demoActive, demoUI, resetDemo } from "../interlocking/demo.js";

export interface NxtraceOptions {
  /** ms to keep running after load / after the demo ends (default 20000) */
  settle?: number;
  /** absolute stop time in ms */
  until?: number;
}

const baseName = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

/**
 * Run a trace. `emit` receives each output line (without newline) as it is produced.
 * Returns the harness exit code (0 ok, 2 load failed, 3 fatal relay error, 5 other exception).
 */
export function runNxtrace(
  file: string,
  readFile: FileReader,
  emit: (line: string) => void,
  opts: NxtraceOptions = {},
): number {
  const settle = opts.settle ?? 20000;
  const until = opts.until ?? -1;
  const base = baseName(file);
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot).toLowerCase() : "";
  const isDemo = ext === ".xdo";

  setFileReader(readFile);
  const prevBarf = setLispBarfHandler((e) => host().messageBox(e.message, getLispBarfString(), "ok"));
  resetDemo();

  const now = (): number => scheduler.now;
  const countRelays = (): number => allRelaySyms().filter((r) => r.relay !== null).length;

  loadHooks.beforeReadLayout = (fname) => emit(`@${now()} LOAD ${baseName(fname)}`);
  loadHooks.afterReadLayout = (ok, fname) => {
    if (ok) emit(`@${now()} LOADED ${countRelays()}`);
    else console.error(`nxtrace: layout load failed: ${fname}`);
  };
  demoUI.trace = (s) => emit(`@${now()} DEMO ${printSexpr(s)}`);

  try {
    emit(`# nxtrace 1 ${base}`);
    const tracer = (name: string, state: boolean): void => emit(`@${now()} ${state ? "PICK" : "DROP"} ${name}`);

    startUpNXSYS(); // resets the clock, layout, Lisp and relay engines
    setRelayTrace(tracer); // before anything loads

    let stop: number;
    if (!isDemo) {
      if (!getLayout(file, true)) {
        console.error(`nxtrace: could not load ${file}`);
        return 2;
      }
      stop = until >= 0 ? until : now() + settle;
    } else {
      demo(file);
      const limit = until >= 0 ? until : 0x7fffffff;
      while (demoActive() && scheduler.step(limit)) {
        /* step the clock until the demo finishes */
      }
      stop = until >= 0 ? until : now() + settle;
    }
    scheduler.runUntil(stop);
    emit(`@${now()} END`);

    const syms = allRelaySyms().filter((r) => r.relay !== null);
    syms.sort(compareRlysyms); // Array.prototype.sort is stable
    for (const r of syms) emit(`STATE ${r.toString()} ${r.relay!.state ? 1 : 0}`);
    return 0;
  } catch (e) {
    if (e instanceof AppAbort) {
      console.error("nxtrace: FATAL: NxsysAppAbort (fatal relay logic error, e.g. relay race); exiting");
      return 3;
    }
    console.error(`nxtrace: exception: ${(e as Error).stack ?? e}`);
    return 5;
  } finally {
    setRelayTrace(null);
    loadHooks.beforeReadLayout = loadHooks.afterReadLayout = null;
    demoUI.trace = null;
    setLispBarfHandler(prevBarf);
  }
}

/** Convenience: whole trace as one string (every line '\n'-terminated). */
export function traceToString(file: string, readFile: FileReader, opts: NxtraceOptions = {}): { text: string; code: number } {
  const lines: string[] = [];
  const code = runNxtrace(file, readFile, (l) => lines.push(l), opts);
  return { text: lines.map((l) => l + "\n").join(""), code };
}
