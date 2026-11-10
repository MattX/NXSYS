/*
 * Demo-script (.xdo) runner — port of NXSYS/demo.cpp, driven by the simulated clock.
 *
 * Pacing is exactly the C++'s: SAY n / WAIT n schedule the next impulse n ms later; a mouse-click
 * form "clicks" the object, then (unless NOXES) waits CLICKTIME ms with the big yellow X up, then
 * 100 ms more (X ending), before the next form is read. Demo UI (the caption window, the yellow X)
 * is exposed as hooks (demoUI).
 *
 * Trains (TRAIN forms) are Phase 4 and are reported as demo errors here.
 */
import { LispFileInputSource, readSexp } from "../lisp/reader.js";
import { Cons, LispSentinel, Sym, NIL, type Sexpr } from "../lisp/types.js";
import { host } from "../host.js";
import { nxTimer, killOneTimer } from "../clock/scheduler.js";
import { RlySym } from "../lisp/types.js";
import {
  TypeId,
  WM_LBUTTONDOWN,
  WM_NXGO_LBUTTONSHIFT,
  WM_RBUTTONDOWN,
  findObjectByNomAndType,
  type GraphicObject,
} from "../layout/nxgo.js";
import { findDemoHitCircuit } from "../layout/xtgtrack.js";
import { findDemoHitTurnout } from "../layout/turnout.js";
import {
  SHOW_STOPS_ALWAYS,
  SHOW_STOPS_NEVER,
  SHOW_STOPS_RED,
  implementShowStopPolicy,
} from "../layout/signal.js";
import { relayState } from "../relay/rlyapi.js";
import { getLayout, nxsysHooks } from "./nxsys.js";
import { readFileText, replaceFilename } from "./rdtrkcmn.js";

const CLICK_TIME_DEFAULT_MS = 1200;
const PRODUCT_NAME = "NXSYS/Mac";

/** Demo-time UI hooks (caption window, X marks); defaults match the headless harness (no-ops). */
export const demoUI = {
  say: ((_msg: string): void => {}) as (msg: string) => void,
  hide: ((): void => {}) as () => void,
  /** called with the center of the clicked object (screen coords) */
  showBigYellowX: ((_x: number, _y: number): void => {}) as (x: number, y: number) => void,
  unShowBigYellowX: ((): void => {}) as () => void,
  /** Observer for every top-level form executed (the harness prints these as DEMO lines). */
  trace: null as ((s: Sexpr) => void) | null,
  /** CIRCUIT form: show a relay's circuit (UI) */
  showRelay: ((_name: string): void => {}) as (name: string) => void,
};

class DemoErr extends Error {}

enum XWStates {
  NOT_XWAITING,
  XING,
  XENDING,
}
enum DPStates {
  NOT_PAUSED,
  PAUSE1,
  PAUSE2,
}

class DemoState {
  ClickTimeMs = CLICK_TIME_DEFAULT_MS;
  DontDrawXes = false;
  XWait = XWStates.NOT_XWAITING;
  Paused = DPStates.NOT_PAUSED;
  private file: LispFileInputSource;

  constructor(text: string, readonly RawPath: string) {
    this.file = new LispFileInputSource(text);
  }

  read(): Sexpr | LispSentinel {
    return readSexp(this.file);
  }

  expandPath(path: string): string {
    return replaceFilename(this.RawPath, path);
  }

  processDemoPause(haltsw: boolean): void {
    if (haltsw) state = null;
    else if (this.Paused !== DPStates.NOT_PAUSED) {
      this.Paused = DPStates.NOT_PAUSED;
      demoImpulse();
    } else {
      this.Paused = DPStates.PAUSE1;
      demoSay("Demo pausing...control the interlocking yourself now...");
      demoTimer(1000);
    }
  }

  makeBigX(g: GraphicObject, mousecmd: number): boolean {
    const hit = g.findHitGo(mousecmd);
    if (!this.DontDrawXes) {
      if (hit) demoUI.showBigYellowX(hit.x, hit.y);
      this.XWait = XWStates.XING;
      demoTimer(this.ClickTimeMs);
      return true;
    }
    return false;
  }

  /** returns true = wait (timer already set) */
  processWaitStates(): boolean {
    switch (this.Paused) {
      case DPStates.NOT_PAUSED:
        break;
      case DPStates.PAUSE1:
        demoSay("SPACE to resume, ESC to end demo.  Demo paused.");
        this.Paused = DPStates.PAUSE2;
        return true;
      case DPStates.PAUSE2:
        this.Paused = DPStates.NOT_PAUSED;
        break;
    }
    switch (this.XWait) {
      case XWStates.NOT_XWAITING:
        break;
      case XWStates.XING:
        demoUI.unShowBigYellowX();
        this.XWait = XWStates.XENDING;
        demoTimer(100);
        return true;
      case XWStates.XENDING:
        this.XWait = XWStates.NOT_XWAITING;
        break;
    }
    return false;
  }

  /** ~DemoState */
  destroy(): void {
    killOneTimer(this);
    hideDemoWindow();
  }
}

let state: DemoState | null = null;
let blurbUp = false;

function setState(s: DemoState | null): void {
  if (state && state !== s) state.destroy();
  state = s;
}

export function demoActive(): boolean {
  return state !== null;
}

function demoTimer(intvl: number): void {
  nxTimer(state, demoImpulse, intvl);
}

function demoErrmsg(text: string): void {
  host().messageBox(text, PRODUCT_NAME + " demo script", "ok");
}

export function demoSay(msg: string): void {
  demoUI.say(msg);
}

export function hideDemoWindow(): void {
  blurbUp = false;
  demoUI.hide();
}

function findDemoObjectByID(nomen: number, type: TypeId): GraphicObject | null {
  switch (type) {
    case TypeId.SIGNAL:
    case TypeId.SWITCHKEY:
    case TypeId.EXITLIGHT:
    case TypeId.PLATFORM:
    case TypeId.TRAFFICLEVER:
      return findObjectByNomAndType(nomen, type);
    case TypeId.TURNOUT:
      return findDemoHitTurnout(nomen);
    case TypeId.TRACKSEC:
      return findDemoHitCircuit(nomen);
    default:
      return null;
  }
}

const car = (s: Sexpr): Sexpr => (s instanceof Cons ? s.car : NIL);
const cdr = (s: Sexpr): Sexpr => (s instanceof Cons ? s.cdr : NIL);
const cadr = (s: Sexpr): Sexpr => car(cdr(s));
const isCons = (s: unknown): s is Cons => s instanceof Cons;

function processGOForm(type: TypeId, s: Sexpr, mousecmd: number): boolean {
  if (!isCons(cdr(s))) throw new DemoErr("Mouse hit form too short in demo script.");
  if (typeof cadr(s) !== "number") throw new DemoErr("No item number in mouse hit demo form.");
  if (isCons(cdr(cdr(s)))) {
    /* Allow "no comment" */
    const str = cadr(cdr(s));
    if (typeof str !== "string") throw new DemoErr("No string in mouse hit demo form.");
    demoSay(str);
  } else demoSay("");
  const g = findDemoObjectByID(cadr(s) as number, type);
  if (g !== null) if (state!.makeBigX(g, mousecmd)) return true;
  return false;
}

/** return true = break interpret loop for either end or wait */
function processForm(s: Sexpr | LispSentinel, mousecmd: number = WM_LBUTTONDOWN): boolean {
  /* top-level forms only */
  if (mousecmd === WM_LBUTTONDOWN && !(s instanceof LispSentinel)) demoUI.trace?.(s);

  if (s instanceof LispSentinel) {
    setState(null);
    return true;
  }
  if (!isCons(s) || !isCons(s.cdr)) throw new DemoErr("Non-list in demo script.");
  if (!(s.car instanceof Sym)) throw new DemoErr("Non-atom at head of Demo command list.");

  const name = s.car.name;
  if (name === "OPTIONS") decodeOptions(s.cdr);
  else if (name === "VERSION") {
    if (!isCons(s) || cadr(s) !== 1) throw new DemoErr("Demo script VERSION not 1.");
  } else if (name === "SAY") {
    if (typeof cadr(s) !== "number") throw new DemoErr("Missing wait # in SAY in demo script.");
    if (!isCons(cdr(cdr(s))) || typeof cadr(cdr(s)) !== "string") throw new DemoErr("Missing string in SAY in demo script.");
    demoSay(cadr(cdr(s)) as string);
    if ((cadr(s) as number) > 0) {
      demoTimer(cadr(s) as number);
      return true;
    }
  } else if (name === "CLICKTIME") state!.ClickTimeMs = numOf(cadr(s));
  else if (name === "WAIT") {
    if (typeof cadr(s) !== "number") throw new DemoErr("Missing number in WAIT.");
    demoTimer(cadr(s) as number);
    return true;
  } else if (name === "LOAD") {
    const arg = cadr(s);
    const path = state!.expandPath(typeof arg === "string" ? arg : "");
    if (!getLayout(path, true)) {
      setState(null); /* should have issued diagnostic already */
      return true;
    }
  } else if (name === "MOUSERIGHT") return processForm(s.cdr, WM_RBUTTONDOWN);
  else if (name === "MOUSELEFTSHIFT" || name === "FLEET") return processForm(s.cdr, WM_NXGO_LBUTTONSHIFT);
  else if (name === "SIGNAL") return processGOForm(TypeId.SIGNAL, s, mousecmd);
  else if (name === "TRACK") return processGOForm(TypeId.TRACKSEC, s, mousecmd);
  else if (name === "EXITLIGHT") return processGOForm(TypeId.EXITLIGHT, s, mousecmd);
  else if (name === "SWITCH") return processGOForm(TypeId.TURNOUT, s, mousecmd);
  else if (name === "TRAIN") demoTrain(s.cdr); /* continue, no time */
  else if (name === "CIRCUIT") {
    for (let q: Sexpr = s.cdr; q !== NIL && isCons(q); q = q.cdr) {
      const e = q.car;
      if (e instanceof RlySym) {
        const rname = e.toString();
        if (e.relay === null) throw new DemoErr("No Relay in relay sym in CIRCUIT " + rname);
        demoUI.showRelay(rname);
      }
    }
  } else if (name === "CHECK") {
    const valrelay = (rs: RlySym, expected: number): void => {
      if (rs.relay === null) throw new DemoErr("No Relay in relay sym in CHECK " + rs.toString());
      if ((relayState(rs.relay) ? 1 : 0) !== expected)
        demoErrmsg(`Relay ${rs.toString()} state is wrong, s/b ${expected}`);
    };
    for (let q: Sexpr = s.cdr; q !== NIL && isCons(q); q = q.cdr) {
      const e = q.car;
      if (e instanceof RlySym) valrelay(e, 1);
      else if (isCons(e) && cadr(e) instanceof RlySym)
        /* "I hope NOT!" */
        valrelay(cadr(e) as RlySym, 0);
      else throw new DemoErr("Bad expression in CHECK.");
    }
  } else throw new DemoErr(`Unknown demo form: ${name}\r\nHalting demo.`);
  return false; /* continue interpreting forms */
}

const numOf = (s: Sexpr): number => (typeof s === "number" ? s : 0);

function demoTrain(_s: Sexpr): void {
  throw new DemoErr("TRAIN forms are not supported yet (trains arrive in Phase 4).");
}

function decodeOptions(S: Sexpr): void {
  for (; isCons(S); S = S.cdr) {
    const O = S.car;
    if (!(O instanceof Sym)) throw new DemoErr("Non-atomic-symbol option in OPTIONS form.");
    const option = O.name;
    if (option === "NOXES") state!.DontDrawXes = true;
    else if (option === "NOSTOPS") implementShowStopPolicy(SHOW_STOPS_NEVER);
    else if (option === "SHOWSTOPS") implementShowStopPolicy(SHOW_STOPS_ALWAYS);
    else if (option === "SHOWSTOPSRED") implementShowStopPolicy(SHOW_STOPS_RED);
    else if (option === "MAXIMIZE") {
      /* window maximize: UI */
    } else throw new DemoErr(`Unknown Demo option: ${O.name}`);
  }
}

function demoImpulse(): void {
  if (!state) {
    /* no demo going on, no state */
    if (blurbUp) {
      blurbUp = false;
      hideDemoWindow();
    }
    return;
  }
  if (state.processWaitStates()) return;

  try {
    while (!processForm(state!.read())) {
      /* keep going */
    }
  } catch (err) {
    if (err instanceof DemoErr) {
      demoErrmsg(err.message);
      setState(null); /* this ends the demo */
    } else throw err;
  }
}

/** C++ DemoPause (SPACE = resume/pause, ESC = halt). */
export function demoPause(haltsw: boolean): void {
  if (state) state.processDemoPause(haltsw);
}

/** C++ Demo(fname): start a demo script. */
export function demo(fname: string): void {
  if (state) {
    demoErrmsg("Demo already in progress!");
    return;
  }
  const text = readFileText(fname);
  if (text === null) {
    host().messageBox(`Can't open demo file ${fname}: No such file or directory.`, "V2 NXSYS", "ok");
    return;
  }
  nxsysHooks.killTrains();
  setState(new DemoState(text, fname));
  demoSay("");
  demoImpulse();
}

/** C++ DemoBlurb */
export function demoBlurb(s: string): void {
  demoSay(s);
  demoTimer(5000);
  blurbUp = true;
}

/** Forget any demo in progress (new process / test isolation). */
export function resetDemo(): void {
  if (state) {
    killOneTimer(state);
    state = null;
  }
  blurbUp = false;
}

