/*
 * Interlocking (.trk) loader — port of NXSYS/rdtrkcmn.cpp: top-level forms, ROUTE form,
 * FinishUpLoad (ProcessLoadComplete for all object types, Goose_Generale, ReportAllTrackSecsClear,
 * DropAllApproach, traffic levers, BRGP/RAS/CPB quislings).
 *
 * File access is injected (setFileReader): `readFile(path)` returns the file as a latin1 string
 * (one char per byte) or null. Path resolution is relative to the including file, as
 * std::filesystem::path::replace_filename does.
 */
import {
  setMacroExpander,
  defineRelayFromLisp,
  defineTimerRelayFromLisp,
  gooseRelay,
  initRelaySys,
  pulseToRelay,
  reportToRelay,
  type Relay,
} from "../relay/relay.js";
import { createQuislingRelay } from "../relay/rlyapi.js";
import { nxTimer } from "../clock/scheduler.js";
import { host } from "../host.js";
import { LispFileInputSource, readSexp } from "../lisp/reader.js";
import { defrmacro, maybeExpandMacro } from "../lisp/macros.js";
import { printSexpr } from "../lisp/printer.js";
import { replaceFilename } from "../lisp/dump.js";
import { lCoerceToFloat } from "../lisp/math.js";
import {
  Cons,
  DEFRMACRO,
  EOF_OBJ,
  FORMS,
  LChar,
  LFloat,
  LispSentinel,
  Sym,
  mapRelaySyms,
  listLength,
  type ReadResult,
  type Sexpr,
} from "../lisp/types.js";
import { Glb, setTrackGeometryDefaults, setTrainKinematicsDefaults, trainCfg } from "../layout/geometry.js";
import { TypeId, mapGraphicObjectsOfType } from "../layout/nxgo.js";
import {
  reportAllTrackSecsClear,
  trackCircuitSystemLoadTimeComplete,
  trackCircuitSystemReInit,
} from "../layout/xtgtrack.js";
import { PanelSignal, Stop, signalGlobals } from "../layout/signal.js";
import { TrafficLever, initTrafficLeverData } from "../layout/trafficlever.js";
import { ExitLight } from "../layout/exlight.js";
import { PanelLight } from "../layout/plight.js";
import { initSwitchKeyData } from "../layout/swkey.js";
import { setUpLayoutTrainMetrics } from "../layout/trainmetrics.js";
import { auxKeysLoadComplete, initXTGReader, processLayoutForm, switchesLoadComplete } from "./xtgload.js";
import { defineMenuFromLisp, enableDynMenus } from "./dynmenu.js";
import { deInstallLayout } from "./nxsys.js";

const RGP_BOBBLE_TIME_MS = 3000;
const APP_NAME = "V2 NXSYS";

export { replaceFilename };

/* ---- injected file access ---- */
export type FileReader = (path: string) => string | null;
let fileReader: FileReader = () => null;
export function setFileReader(fn: FileReader): void {
  fileReader = fn;
}
export function readFileText(path: string): string | null {
  return fileReader(path);
}

/* ---- globals (rdtrkcmn.cpp) ---- */
export const loaderState = {
  InterlockingName: "",
  InterpretedP: false,
  InterlockingLoaded: false,
  INameRetval: "",
};

/** Observers for the trace harness (the C++ harness wraps ReadLayout with ld --wrap). */
export const loadHooks = {
  beforeReadLayout: null as ((fname: string) => void) | null,
  afterReadLayout: null as ((ok: boolean, fname: string) => void) | null,
};

/** Help menu registrations made by ROUTE forms (RegisterHelpMenuText / RegisterHelpURL). */
export const helpRegistry = {
  texts: [] as { title: string; text: string }[],
  urls: [] as { title: string; url: string | null }[],
};
export function clearHelpMenu(): void {
  helpRegistry.texts = [];
  helpRegistry.urls = [];
}

let BRGP0: Relay | null = null;
let RAS0: Relay | null = null;
export let CPB0: Relay | null = null;

setMacroExpander(maybeExpandMacro);

function usermsgstop(text: string): void {
  host().messageBox(text, APP_NAME, "ok");
}

function loadError(msg: string, s?: Sexpr | ReadResult): number {
  let message = msg;
  if (s !== undefined && s !== EOF_OBJ) {
    message += ": ";
    message += printSexpr(s);
  }
  usermsgstop("Error in track code file: " + message);
  return 0;
}

const NormallyPickedRelays = new Set(["AS", "D", "DV", "RGP"]);

const symcmp = (s: Sexpr, str: string): boolean => s instanceof Sym && s.name === str;

function finishUpLoad(): void {
  processLoadComplete();
  auxKeysLoadComplete();
  loaderState.InterlockingLoaded = true;
  reportAllTrackSecsClear();
  BRGP0 = createQuislingRelay(0, "BRGP");
  RAS0 = createQuislingRelay(0, "RAS");
  CPB0 = createQuislingRelay(0, "CPB");
  signalGlobals.CPB0 = CPB0;

  enableDynMenus(true);
  setUpLayoutTrainMetrics();

  mapRelaySyms((rs) => {
    if (!rs.relay) return;
    if (NormallyPickedRelays.has(rs.type)) gooseRelay(rs.relay);
  });
  dropAllApproach();
  reportAllTrafficLeversNormal();
}

/** The full-blown file loader (C++ LoadExprcodeFile). */
function loadExprcodeFile(fname: string): boolean {
  const text = fileReader(fname);
  if (text === null) {
    usermsgstop(`Cannot open exprcode track file ${fname} for reading: No such file or directory`);
    return false;
  }
  const f = new LispFileInputSource(text);
  let gotIt = false;
  let success = true;
  while (success && !gotIt) {
    const s = readSexp(f);
    if (s instanceof LispSentinel) {
      if (s === EOF_OBJ) gotIt = true; /* otherwise read_err_obj */
      else success = false;
    } else success = interpretTopLevelForm(fname, s) !== 0;
  }
  return gotIt;
}

function extensionUpper(fname: string): string {
  const base = fname.slice(fname.lastIndexOf("/") + 1);
  const i = base.lastIndexOf(".");
  if (i <= 0) return "";
  return base.slice(i).toUpperCase();
}

/** C++ ReadLayout: returns the interlocking name, or null on failure. */
export function readLayout(fname: string): string | null {
  loadHooks.beforeReadLayout?.(fname);
  const r = readLayout0(fname);
  loadHooks.afterReadLayout?.(r !== null, fname);
  return r;
}

function readLayout0(fname: string): string | null {
  loaderState.INameRetval = "NX Interlocking";
  initRelaySys();
  initXTGReader();
  enableDynMenus(false);
  trackCircuitSystemReInit();
  initSwitchKeyData();
  initTrafficLeverData();

  if (extensionUpper(fname) === ".TKO") {
    host().messageBox(
      fname + "\n.TKO compiled interlockings are not supported by this version of NXSYS.",
      "NXSYS Layout Loader",
      "ok",
    );
    return null;
  }
  if (!loadExprcodeFile(fname)) {
    deInstallLayout();
    return null;
  }
  loaderState.InterpretedP = true;
  loaderState.InterlockingName = loaderState.INameRetval;
  loaderState.INameRetval += " (Interpreted)";
  finishUpLoad();
  return loaderState.INameRetval;
}

function resetRouteDefaults(): void {
  Glb.TorontoStyle = false;
  Glb.IRTStyle = false;
  Glb.TrafficLeversTristate = false;
  setTrackGeometryDefaults();
  setTrainKinematicsDefaults();
}

function interpretTopLevelForm(fname: string, s: Sexpr): number {
  if (!(s instanceof Cons)) return loadError("Item definition not a list", s);
  const fn = s.car;
  if (!(fn instanceof Sym)) return loadError("Top-level item doesn't start with atom", s);
  const f2 = maybeExpandMacro(s);
  if (f2 !== EOF_OBJ) return interpretTopLevelForm(fname, f2 as Sexpr);
  else if (fn === DEFRMACRO) {
    defrmacro(s);
    return 1;
  } else if (fn === FORMS) {
    for (let r = s.cdr; r instanceof Cons; r = r.cdr) if (!interpretTopLevelForm(fname, r.car)) return 0;
    return 1;
  }
  const rest = s.cdr;

  if (symcmp(fn, "QUIT")) return 1;
  else if (symcmp(fn, "INCLUDE")) {
    if (!(rest instanceof Cons && typeof rest.car === "string")) return loadError("Bad INCLUDE", s);
    return loadExprcodeFile(replaceFilename(fname, rest.car)) ? 1 : 0;
  } else if (symcmp(fn, "RELAY")) return defineRelayFromLisp(rest) !== null ? 1 : 0;
  else if (symcmp(fn, "TIMER")) return defineTimerRelayFromLisp(rest) !== null ? 1 : 0;
  else if (symcmp(fn, "ROUTE")) {
    resetRouteDefaults();
    return processRouteForm(rest, fname);
  } else if (symcmp(fn, "MENU")) return defineMenuFromLisp(rest);
  else if (symcmp(fn, "COMMENT")) return 1;
  else if (symcmp(fn, "EVAL-WHEN")) {
    const r2 = s.cdr;
    if (r2 instanceof Cons && r2.car instanceof Cons) {
      for (let sc: Sexpr = r2.car; sc instanceof Cons; sc = sc.cdr)
        if (sc.car instanceof Sym && symcmp(sc.car, "EVAL")) {
          for (let r = r2.cdr; r instanceof Cons; r = r.cdr) if (!interpretTopLevelForm(fname, r.car)) return 0;
          return 1;
        }
    }
    return 1;
  } else if (symcmp(fn, "LAYOUT")) return processLayoutForm(rest);
  return loadError("Unknown top level form", fn);
}

/** RGP bobble (trains/other agents): raise BRGP for RGP_BOBBLE_TIME_MS. */
export function bobbleRGPs(): void {
  if (BRGP0 !== null) {
    reportToRelay(BRGP0, true);
    nxTimer(BRGP0, () => reportToRelay(BRGP0, false), RGP_BOBBLE_TIME_MS);
  }
}

export function dropAllApproach(): void {
  if (RAS0 !== null) pulseToRelay(RAS0);
}

/** Forget load-global relay pointers (a fresh interlocking is about to load, or none is loaded). */
export function resetLoaderGlobals(): void {
  BRGP0 = RAS0 = CPB0 = null;
  signalGlobals.CPB0 = null;
  loaderState.InterlockingLoaded = false;
}

function registerHelpMenuTextCRLF1(text: string, title: string): void {
  let fixed = "";
  for (const ch of text) {
    if (ch === "\n") fixed += "\r";
    fixed += ch;
  }
  helpRegistry.texts.push({ title, text: fixed });
}

function floatOf(s: Sexpr): number {
  const f = lCoerceToFloat(s);
  return f instanceof LFloat ? f.value : 0;
}

function processRouteForm(s: Sexpr, fname: string): number {
  const LERROR = (msg: string, x?: Sexpr): number => loadError(msg, x);
  if (listLength(s) < 4) return LERROR("Should be at least 5 items in ROUTE?", s);
  const car = (x: Sexpr): Sexpr => (x instanceof Cons ? x.car : s); // (garbage-in: unreachable after length check)
  const cdr = (x: Sexpr): Sexpr => (x instanceof Cons ? x.cdr : x);
  const popCar = (): Sexpr => {
    const c = car(s);
    s = cdr(s);
    return c;
  };

  if (typeof car(s) !== "string") return LERROR("#2 item in route list not string", car(s));
  loaderState.INameRetval = popCar() as string;
  if (!(car(s) instanceof LChar)) return LERROR("#3 item in route list not char", car(s));
  Glb.RouteIdentifier = (popCar() as LChar).ch;
  if (typeof car(s) !== "number") return LERROR("#4 item in route list not number", car(s));
  s = cdr(s);
  if (!(car(s) instanceof Sym)) return LERROR("#5 item in route list not ATOM", car(s));

  popCar(); /* NS: just ignore the damned thing */

  for (; s instanceof Cons && s.cdr instanceof Cons; s = (s.cdr as Cons).cdr) {
    const p = s.car;
    const v = s.cdr.car;

    if (symcmp(p, ":CRUISING-FEET-PER-SECOND")) trainCfg.CruisingSpeed = floatOf(v);
    else if (symcmp(p, ":YELLOW-FEET-PER-SECOND")) trainCfg.YellowFeetPerSecond = floatOf(v);
    else if (symcmp(p, ":TRAIN-LENGTH-FEET")) Glb.TrainLengthFeet = floatOf(v);
    else if (symcmp(p, ":TORONTO")) Glb.TorontoStyle = true;
    else if (symcmp(p, ":IRT")) Glb.IRTStyle = true;
    else if (symcmp(p, ":EXTENDED-ROUTE-LETTER")) Glb.RouteIdentifier = typeof v === "string" ? v : v instanceof Sym ? v.name : "";
    else if (symcmp(p, ":TRAFFIC-LEVERS-TRISTATE")) Glb.TrafficLeversTristate = true;
    else if (symcmp(p, ":HELP-TEXT")) {
      const value = v;
      if (!(value instanceof Cons) || !(value.cdr instanceof Cons))
        return LERROR("Value of :HELP-TEXT is not a list at least two long", value);
      const s1 = value.car;
      const s2 = value.cdr.car;
      if (typeof s1 !== "string" || typeof s2 !== "string") return LERROR("Members of :HELP-TEXT not strings.", value);
      const helpMenuTitle = s1;
      let helpMenuText: string;
      const cddr = value.cdr.cdr;
      if (cddr instanceof Cons) {
        const s3 = cddr.car;
        if (typeof s3 !== "string") return LERROR("Third element of :HELP-TEXT not a string.", value);
        helpMenuText = s3;
        if (!(helpMenuText.length && helpMenuText[0] === "@"))
          return LERROR("Third element of :HELP-TEXT doesn't start with @.", value);
        if (helpMenuText.indexOf(".html") !== helpMenuText.length - 5)
          return LERROR("Third element of :HELP-TEXT doesn't end in .html.", value);
        helpMenuText = "file://" + replaceFilename(fname, helpMenuText.slice(1));
      } else {
        helpMenuText = s2;
        if (helpMenuText.length && helpMenuText[0] === "@") {
          const retr = fileReader(replaceFilename(fname, helpMenuText.slice(1)));
          if (retr !== null) helpMenuText = retr;
          else return LERROR("Cannot open referenced text help file", s2);
        }
      }
      registerHelpMenuTextCRLF1(helpMenuText, helpMenuTitle);
    } else if (symcmp(p, ":BASIC-HELP-FILE-ID")) {
      const value = v;
      if (!(value instanceof Cons) || !(value.cdr instanceof Cons))
        return LERROR("Value of :BASIC-HELP-FILE-ID is not a list at least two long", value);
      const s1 = value.car;
      const s2 = value.cdr.car;
      if (typeof s1 !== "string") return LERROR("First element of :BASIC-HELP-FILE-ID not a string.", value);
      if (typeof s2 !== "number") return LERROR("Second element of :BASIC-HELP-FILE-ID not a number.", value);
      let url: string | null = null;
      const cddr = value.cdr.cdr;
      if (cddr instanceof Cons) {
        const s3 = cddr.car;
        if (typeof s3 !== "string")
          return LERROR("Present, third element (URL) of :BASIC-HELP-FILE-ID not a string.", value);
        url = s3;
      }
      helpRegistry.urls.push({ title: s1, url });
    }
  }
  return 1;
}

/** Version 2 process load complete. */
function processLoadComplete(): void {
  trackCircuitSystemLoadTimeComplete();
  mapGraphicObjectsOfType(TypeId.SIGNAL, (g) => ((g as PanelSignal).processLoadComplete(), 0));
  mapGraphicObjectsOfType(TypeId.TURNOUT, () => 0); /* V2 turnouts are not graphic objects */
  mapGraphicObjectsOfType(TypeId.EXITLIGHT, (g) => ((g as ExitLight).processLoadComplete(), 0));
  mapGraphicObjectsOfType(TypeId.STOP, (g) => ((g as Stop).processLoadComplete(), 0));
  mapGraphicObjectsOfType(TypeId.TRAFFICLEVER, (g) => ((g as TrafficLever).processLoadComplete(), 0));
  mapGraphicObjectsOfType(TypeId.PANELLIGHT, (g) => ((g as PanelLight).processLoadComplete(), 0));
  switchesLoadComplete();
}

export function reportAllTrafficLeversNormal(): void {
  mapGraphicObjectsOfType(TypeId.TRAFFICLEVER, (g) => ((g as TrafficLever).initState(), 0));
}
