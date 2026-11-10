/*
 * LAYOUT form parser — port of NXSYS/v2/xtgload.cpp (PATH, SIGNAL, EXITLIGHT, SWITCHKEY,
 * TRAFFICLEVER, PANELLIGHT, PANELSWITCH, VIEW-ORIGIN) plus NXSYS/txlayout.cpp (TEXT).
 *
 * The parser creates graphic objects in file order (which fixes the registry order, and with it
 * relay-creation order at load-complete) and, at the end, builds the Turnouts.
 *
 * A Lisp C++ detail kept on purpose: the C++ reads CAR/CDR of non-conses as garbage; here a
 * non-cons reads as NIL (an atom), which flows into the same "bogus" diagnostics.
 */
import { lispBarf } from "../lisp/barf.js";
import { Cons, LFloat, LRational, NIL, Sym, intern, listLength, type Sexpr } from "../lisp/types.js";
import { host } from "../host.js";
import { TypeId, findObjectByNomAndType, type GraphicObject, type LogFont } from "../layout/nxgo.js";
import { CONST_2PI, CONST_3PI_OVER_2, CONST_PI, CONST_PI_OVER_2, TSAX, TSEX } from "../layout/geometry.js";
import { TrackJoint, TrackSeg } from "../layout/xtgtrack.js";
import { ExitLight } from "../layout/exlight.js";
import { PanelSignal, Signal, Stop } from "../layout/signal.js";
import { SwitchKey } from "../layout/swkey.js";
import { TrafficLever } from "../layout/trafficlever.js";
import { PanelLight } from "../layout/plight.js";
import { PanelSwitch } from "../layout/pswitch.js";
import { FW_BOLD, FW_NORMAL, layoutTextString } from "../layout/text.js";
import { createTurnouts } from "../layout/turnout.js";
import {
  switchConsistencyClear,
  switchConsistencyDefine,
  switchConsistencyTotalCheck,
} from "./switchconsistency.js";

/* ---- tiny Lisp helpers with C++ "garbage-in" semantics replaced by NIL ---- */
const CAR = (s: Sexpr): Sexpr => (s instanceof Cons ? s.car : NIL);
const CDR = (s: Sexpr): Sexpr => (s instanceof Cons ? s.cdr : NIL);
const CADR = (s: Sexpr): Sexpr => CAR(CDR(s));
const isCons = (s: Sexpr): s is Cons => s instanceof Cons;
const isNum = (s: Sexpr): s is number => typeof s === "number";
/** (long)Sexpr: u.n of a fixnum; anything else is garbage in C++ — 0 here. */
const toLong = (s: Sexpr): number => (typeof s === "number" ? s : 0);
const NUMBERP = (s: Sexpr): boolean => typeof s === "number" || s instanceof LFloat || s instanceof LRational;

const aPATH = intern("PATH");
const aVIEW_ORIGIN = intern("VIEW-ORIGIN");
const aSWITCH = intern("SWITCH");
const aIJ = intern("IJ");
const aSTEM = intern("STEM");
const aNORMAL = intern("NORMAL");
const aREVERSE = intern("REVERSE");
const aA = intern("A");
const aB = intern("B");
const aL = intern("L");
const aT = intern("T");
const aR = intern("R");
const aNUMFLIP = intern("NUMFLIP");
const aNOSTOP = intern("NOSTOP");
const aTC = intern("TC");
const aPLATENO = intern("PLATENO");
const aID = intern("ID");

/** Mac_SetDisplayWPOrg stand-in: the harness (and C++ in the headless build) ignores it. */
export const layoutHooks = {
  setDisplayWPOrg: ((_x: number, _y: number): void => {}) as (x: number, y: number) => void,
  /** The last VIEW-ORIGIN seen in the layout (for the host to scroll to). */
  viewOrigin: null as { x: number; y: number } | null,
};

let switchJoints: TrackJoint[] = [];
let allJoints: TrackJoint[] = [];

export const switchJointsView = (): readonly TrackJoint[] => switchJoints;
export const allJointsView = (): readonly TrackJoint[] => allJoints;

export function initXTGReader(): void {
  switchJoints = [];
  switchConsistencyClear();
  allJoints = [];
  layoutHooks.viewOrigin = null;
}

function decodeBranchType(s: Sexpr): TSAX | null {
  if (s === aSTEM) return TSAX.STEM;
  if (s === aNORMAL) return TSAX.NORMAL;
  if (s === aREVERSE) return TSAX.REVERSE;
  return null;
}

function findSwitchJoint(id: number, ab0: number): TrackJoint | null {
  for (const tj of switchJoints) if (tj.Nomenclature === id && tj.SwitchAB0 === ab0) return tj;
  return null;
}

function findTrackJoint(nn: number): TrackJoint | null {
  for (const j of allJoints) if (j.Nomenclature === nn) return j;
  return null;
}

type FormLoader = (s: Sexpr) => GraphicObject | null;
const formLoaders = new Map<string, FormLoader>();
const loaderNames = ["PATH, VIEW-ORIGIN"];

/** C++ XTGLoadInit */
export function xtgLoadInit(): void {
  if (formLoaders.size) return;
  const data: [string, FormLoader][] = [
    ["SIGNAL", processSignalForm],
    ["EXITLIGHT", processExitlightForm],
    ["TRAFFICLEVER", processTrafficleverForm],
    ["PANELLIGHT", processPanelLightForm],
    ["PANELSWITCH", processPanelSwitchForm],
    ["SWITCHKEY", processSwitchkeyForm],
    ["TEXT", processTextForm],
  ];
  for (const [name, fn] of data) {
    loaderNames.push(name);
    formLoaders.set(name, fn);
  }
}

function processNonGraphObjectCreateForm(s: Sexpr): GraphicObject | null {
  const fn = CAR(s);
  const loader = fn instanceof Sym ? formLoaders.get(fn.name) : undefined;
  if (!loader) {
    lispBarf("Element other than " + loaderNames.join(", ") + " found in LAYOUT ", s);
    return null;
  }
  return loader(CDR(s)); /* Process the form. */
}

/** `f` is the cdr of the (LAYOUT ...) form. Returns 1 on success, 0 on failure. */
export function processLayoutForm(f: Sexpr): number {
  for (; isCons(f); f = f.cdr) {
    const s = f.car;
    if (!isCons(s)) {
      lispBarf("Non-list element found in LAYOUT", s);
      return 0;
    }
    const fn = s.car;
    const data = s.cdr;
    if (fn === aPATH) {
      if (processPathForm(data)) continue;
      else return 0;
    }
    if (fn === aVIEW_ORIGIN) {
      if (processViewOriginForm(data)) continue;
      else return 0;
    }
    if (!processNonGraphObjectCreateForm(s)) return 0;
  }

  for (const tj of switchJoints) {
    const r = switchConsistencyDefine(tj.Nomenclature, tj.SwitchAB0);
    if (r !== null) {
      lispBarf(r);
      return 0;
    }
  }

  for (const J of allJoints) {
    for (let i = 0; i < J.TSCount; i++)
      if (J.TSA[i] === null) {
        lispBarf(
          `Corrupt layout. Joint/switch #${J.Nomenclature} (${J.SwitchAB0}) claims ${J.TSCount} branches, but TSA[${i}] is null. ` +
            `Editing and and re-save in TLEdit may or may not help.`,
        );
        return 0;
      }
  }

  const r = switchConsistencyTotalCheck();
  if (r !== null) {
    lispBarf(r);
    return 0;
  }

  for (const j of allJoints) j.positionLabel();
  if (switchJoints.length) if (!createTurnouts(switchJoints)) return 0;
  return 1;
}

class PpfCoords {
  x = 0;
  y = 0;
  last_y = 0;
  last_x = 0;
  flip = false;

  collect(s: Sexpr, f: Sexpr): boolean {
    this.flip = false;
    if (!isCons(s)) {
      lispBarf("Non-list where coordinate subform expected:", f);
      return false;
    }
    if (!isNum(s.car)) {
      lispBarf("Bogus X-coordinate in form", f);
      return false;
    }
    this.x = s.car;
    s = s.cdr;
    if (isCons(s)) {
      if (!isNum(s.car)) {
        lispBarf("Bogus Y-coordinate in switch", f);
        return false;
      }
      this.y = s.car;
    } else this.y = this.last_y;

    s = CDR(s);

    if (isCons(s)) {
      if (s.car === aNUMFLIP) this.flip = true;
    }
    return true;
  }
}

function setTCID(ts: TrackSeg, id: number): void {
  if (id) ts.setTrackCircuit(id);
}

function linkTS(lastTs: TrackSeg | null, ts: TrackSeg): TrackSeg {
  if (lastTs) {
    lastTs.Ends[1].EndIndexNormal = TSEX.E0;
    lastTs.Ends[1].Next = ts;
  }
  ts.Ends[0].Next = lastTs;
  ts.Ends[0].EndIndexNormal = TSEX.E1;
  return ts;
}

function processPathForm(f: Sexpr): number {
  let lastJoint: TrackJoint | null = null;
  let first = true;
  let lastWasSwitch = false;
  let lastSwitchArcType: TSAX = TSAX.NOTFOUND;
  const coords = new PpfCoords();
  coords.last_y = 0;
  let lastTs: TrackSeg | null = null;
  let lastTcid = 0;

  /* label create_simple / finish_create_any */
  const createSimple = (insulated: boolean, Nomen: number): void => {
    const tj = insulated ? new TrackJoint(coords.x, coords.y) : null;
    if (tj) {
      tj.NumFlip = coords.flip;
      tj.Insulated = insulated;
      tj.Nomenclature = Nomen;
    }
    if (!first) {
      const ts = new TrackSeg(coords.last_x, coords.last_y, coords.x, coords.y);
      lastTs = linkTS(lastTs, ts);
      setTCID(ts, lastTcid);

      if (tj) tj.addBranch(ts);
      ts.Ends[0].Joint = lastJoint;
      ts.Ends[1].Joint = tj;

      if (lastWasSwitch) lastJoint!.TSA[lastSwitchArcType] = ts;
      else if (lastJoint) lastJoint.addBranch(ts);
    }
    if (tj) allJoints.push(tj);
    lastWasSwitch = false;
    lastJoint = tj;
    finishCreateAny();
  };
  const finishCreateAny = (): void => {
    first = false;
    coords.last_x = coords.x;
    coords.last_y = coords.y;
  };

  for (; isCons(f); f = f.cdr) {
    let s: Sexpr = f.car;
    const wholePathElement = s;
    let Nomen = 0;
    if (isNum(s)) {
      coords.x = s;
      coords.y = coords.last_y;
      createSimple(false, 0);
      continue;
    }
    if (!isCons(s)) {
      lispBarf("Element other than number or list in PATH", s);
      return 0;
    }
    const key = s.car;
    if (isNum(key)) {
      coords.x = key;
      if (isCons(s.cdr)) {
        if (!isNum(CADR(s))) {
          lispBarf("Coordinate-pair form in PATH not a pair of numbers.", s);
          return 0;
        }
      }
      coords.y = toLong(CADR(s));
      createSimple(false, 0);
      continue;
    }

    if (!(key instanceof Sym)) {
      lispBarf("Form with non atomic head in PATH ", key);
      return 0;
    }
    s = s.cdr;
    if (key === aIJ) {
      if (listLength(s) < 2) {
        lispBarf("Not enough data in IJ description ", s);
        return 0;
      }
      Nomen = toLong(CAR(s));
      if (!coords.collect(CDR(s), wholePathElement)) return 0;
      createSimple(true, Nomen);
      continue;
    } else if (key === aTC) {
      if (listLength(s) < 1) {
        lispBarf("Not enough data in TC description ", wholePathElement);
        return 0;
      }
      lastTcid = toLong(CAR(s));
      continue;
    } else if (key !== aSWITCH) {
      lispBarf("Unrecognized subform in PATH ", wholePathElement);
      return 0;
    }

    /* (SWITCH) BRANCHTYPE swID x y */
    if (!isCons(s) || !(CAR(s) instanceof Sym)) {
      lispBarf("Invalid SWITCH subform", s);
      return 0;
    }
    const brtype = decodeBranchType(CAR(s));
    if (brtype === null) {
      lispBarf("Unknown switch branch type", CAR(s));
      return 0;
    }

    s = CDR(s);

    if (!isNum(CAR(s))) {
      lispBarf("Bogus Nomenclature ID switch", wholePathElement);
      return 0;
    }
    Nomen = CAR(s) as number;
    s = CDR(s);

    let ab0: number;
    const e = CAR(s);

    if (isNum(e)) {
      if (e !== 0) {
        lispBarf(`Switch ${Nomen}: bad numeric Switch A/B/0 tag:`, e);
        return 0;
      }
      ab0 = 0;
    } else if (e === aA) ab0 = 1;
    else if (e === aB) ab0 = 2;
    else {
      lispBarf(`Switch ${Nomen}: unknown numeric Switch A/B/0 tag:`, e);
      return 0;
    }
    s = CDR(s);

    let haveCoords = false;

    if (isCons(s)) {
      if (!coords.collect(s, wholePathElement)) return 0;
      haveCoords = true;
    }

    let swj = findSwitchJoint(Nomen, ab0);
    if (swj !== null) {
      if (!(first || f.cdr === NIL)) {
        lispBarf("Previously-defined switch neither first nor last in path", wholePathElement);
        return 0;
      }
    }
    if (swj === null) {
      if (!haveCoords) {
        lispBarf("Switch Undefined: point coordinates missing", wholePathElement);
        return 0;
      }
      swj = new TrackJoint(coords.x, coords.y);
      allJoints.push(swj);
      swj.Nomenclature = Nomen;
      swj.SwitchAB0 = ab0;
      switchJoints.push(swj);
      swj.TSCount = 3;
      swj.TSA[0] = swj.TSA[1] = swj.TSA[2] = null;
      swj.NumFlip = coords.flip;
    } else {
      coords.x = swj.wp_x;
      coords.y = swj.wp_y;
    }

    if (first) lastSwitchArcType = brtype;
    else {
      const ts = new TrackSeg(coords.last_x, coords.last_y, coords.x, coords.y);
      lastTs = linkTS(lastTs, ts);
      setTCID(ts, lastTcid);
      swj.TSA[brtype] = ts;
      ts.Ends[1].Joint = swj;
      ts.Ends[0].Joint = lastJoint;
      if (lastWasSwitch) lastJoint!.TSA[lastSwitchArcType] = ts;
      else if (lastJoint) lastJoint.addBranch(ts);
      lastSwitchArcType = brtype === TSAX.STEM ? TSAX.NORMAL : TSAX.STEM;
    }
    /* NEED WHOLE BUSINESS FOR LINKING THESE JOINTS WITHOUT TJ NODES */
    lastJoint = swj;
    lastWasSwitch = true;
    finishCreateAny();
  }
  return 1;
}

function sigMatchOrientation(orient: string, ts: TrackSeg, endIndex: number): boolean {
  let angle = Math.atan2(ts.SinTheta, ts.CosTheta);
  if (endIndex) angle += CONST_PI;
  if (angle > CONST_2PI) angle -= CONST_2PI;
  if (angle < 0.0) angle += CONST_2PI;
  orient = orient.toUpperCase();
  if ((angle < CONST_PI_OVER_2 || angle > CONST_3PI_OVER_2) && orient === "R") return true;
  if (angle < CONST_PI && angle > 0.0 && orient === "B") return true;
  if (angle > CONST_PI_OVER_2 && angle < CONST_3PI_OVER_2 && orient === "L") return true;
  if (angle > CONST_PI && orient === "T") return true;
  return false;
}

function findBranchFromOrientation(tj: TrackJoint, orient: string): { ts: TrackSeg | null; endx: TSEX } {
  let endx: TSEX = TSEX.E0;
  for (let i = 0; i < tj.TSCount; i++) {
    const ts = tj.TSA[i]!;
    endx = ts.findEndIndex(tj);
    if (tj.TSCount === 1 || sigMatchOrientation(orient, ts, endx)) return { ts, endx };
  }
  return { ts: null, endx };
}

function processExitlightForm(s: Sexpr): GraphicObject | null {
  if (!isCons(s)) {
    lispBarf("EXITLIGHT form missing data.");
    return null;
  }
  if (!isNum(s.car)) {
    lispBarf("EXITLIGHT form missing lever number.");
    return null;
  }
  const xno = s.car;
  s = s.cdr;
  if (s === NIL) {
    const ps = findObjectByNomAndType(xno, TypeId.SIGNAL) as PanelSignal | null;
    if (!ps) {
      lispBarf("Cannot find signal for EXITLIGHT", xno);
      return null;
    }
    const xl = new ExitLight(ps.Seg, ps.EndIndex, xno);
    ps.Seg.getEnd(ps.EndIndex).ExLight = xl;
    return xl;
  }
  /* (xno orient ij) */
  const e = CAR(s);
  if (e instanceof Sym) {
    if (e !== aL && e !== aR && e !== aT && e !== aB) {
      lispBarf("Unrecognized orientation symbol in EXITLIGHT", xno, e);
      return null;
    }
    const orient = e.name[0];
    s = CDR(s);
    const nn = toLong(CAR(s));
    const tj = findTrackJoint(nn);
    if (!tj) {
      lispBarf("Cannot find Joint for EXITLIGHT", CAR(s));
      return null;
    }
    const { ts, endx } = findBranchFromOrientation(tj, orient);
    if (!ts) {
      lispBarf("Cannot find EXITLIGHT IJ/orient reference.");
      return null;
    }
    const xl = new ExitLight(ts, endx, xno);
    ts.getEnd(endx).ExLight = xl;
    return xl;
  }
  lispBarf("Bogus EXITLIGHT item", s);
  return null;
}

function processSignalForm(s: Sexpr): GraphicObject | null {
  const ss = s;
  let Heads: Sexpr = NIL;
  let xlno = 0;
  let orient = " ";
  let hasStop = true;

  if (!isNum(CAR(s))) {
    lispBarf("IJ id number missing in SIGNAL form", ss);
    return null;
  }
  const ijid = CAR(s) as number;
  s = CDR(s);
  if (isNum(CAR(s))) {
    xlno = CAR(s) as number; // conv opr
    s = CDR(s);
  }
  const e = CAR(s);
  if (e instanceof Sym) {
    if (e !== aL && e !== aR && e !== aT && e !== aB) {
      lispBarf("Unrecognized orientation symbol in SIGNAL", e, ss);
      return null;
    }
    orient = e.name[0];
    s = CDR(s);
  }
  if (!isCons(CAR(s))) {
    lispBarf("Missing heads list in SIGNAL", ss);
    return null;
  }
  Heads = CAR(s);
  let StaNo = 0;
  const tj = findTrackJoint(ijid);
  if (tj === null) {
    lispBarf("Signal creation cannot find Insulated Joint", ss);
    return null;
  }
  while (isCons(s)) {
    s = s.cdr;
    if (isCons(s) && s.car === aNOSTOP) hasStop = false;
    if (isCons(s) && (s.car === aPLATENO || s.car === aID)) {
      /* for the time being 12 January 1998 */
      s = s.cdr;
      StaNo = toLong(CAR(s));
    }
  }

  const { ts, endx } = findBranchFromOrientation(tj, orient);
  if (!ts) {
    lispBarf("Failed to find signal from orientation:", ss);
    return null;
  }

  const headStrings: string[] = [];
  for (; isCons(Heads); Heads = Heads.cdr) {
    const h = Heads.car;
    headStrings.push(h instanceof Sym ? h.name : "");
  }

  if (StaNo === 0) {
    const end = ts.getEnd(endx);
    const tj2 = end.Joint;
    if (tj2) StaNo = tj2.Nomenclature;
  }
  const sig = new Signal(xlno, StaNo, headStrings);

  ts.getEnd(endx).SignalProtectingEntrance = sig;
  new PanelSignal(ts, endx, sig);
  if (hasStop) sig.TStop = new Stop(sig); /* looks at PanelSignal */

  return sig.PSignal;
}

function processSwitchkeyForm(s: Sexpr): GraphicObject | null {
  if (listLength(s) < 3) {
    lispBarf("Not enough stuff in SWITCHKEY:", s);
    return null;
  }
  const xno = toLong(CAR(s));
  s = CDR(s);
  const wpx = toLong(CAR(s));
  s = CDR(s);
  const wpy = toLong(CAR(s));
  const sk = new SwitchKey(null, wpx, wpy);
  sk.setXlkgNo(xno);
  return sk;
}

function processTrafficleverForm(s: Sexpr): GraphicObject | null {
  if (listLength(s) < 5) {
    lispBarf("Not enough stuff in TRAFFICLEVER:", s);
    return null;
  }
  const first = CAR(s);
  s = CDR(s);
  if (!isNum(first) || first !== 1) {
    lispBarf("TRAFFICLEVER version unknown:", s);
    return null;
  }
  const xno = toLong(CAR(s));
  s = CDR(s);
  const wpx = toLong(CAR(s));
  s = CDR(s);
  const wpy = toLong(CAR(s));
  s = CDR(s);
  const rightnormal = toLong(CAR(s));
  return new TrafficLever(xno, wpx, wpy, rightnormal);
}

function processPanelLightForm(s: Sexpr): GraphicObject | null {
  if (listLength(s) < 6) {
    lispBarf("Not enough stuff in PanelLight:", s);
    return null;
  }
  const first = CAR(s);
  s = CDR(s); /* 1 */

  if (!isNum(first) || first !== 1) {
    lispBarf("PanelLight version unknown:", s);
    return null;
  }
  const xno = toLong(CAR(s));
  s = CDR(s); /* 2 */
  const radius = toLong(CAR(s));
  s = CDR(s); /* 3 */
  const desc = strOrAtom(CAR(s));
  s = CDR(s); /* 4 */
  const wpx = toLong(CAR(s));
  s = CDR(s); /* 5 */
  const wpy = toLong(CAR(s));
  s = CDR(s); /* 6 */

  const p = new PanelLight(xno, radius, wpx, wpy, desc);
  for (; isCons(s); s = s.cdr) {
    const item = s.car;
    if (isCons(item)) {
      const color = item.car;
      const namesym = CADR(item);
      p.addAspect(color instanceof Sym ? color.name : "", namesym instanceof Sym ? namesym.name : "");
    }
    /* else diagnose */
  }
  return p;
}

function processPanelSwitchForm(s: Sexpr): GraphicObject | null {
  if (listLength(s) < 7) {
    lispBarf("Not enough stuff in PanelSwitch:", s);
    return null;
  }
  const first = CAR(s);
  s = CDR(s); /* 1 */

  if (!isNum(first) || first !== 1) {
    lispBarf("PanelSwitch version unknown:", s);
    return null;
  }
  const xno = toLong(CAR(s));
  s = CDR(s); /* 2 */
  s = CDR(s); /* 3 "posns" (fixnum)*/
  s = CDR(s); /* 4 "desc" (string)*/

  const wpx = toLong(CAR(s));
  s = CDR(s); /* 5 */
  const wpy = toLong(CAR(s));
  s = CDR(s); /* 6 */

  /* just the nomenclature alphas, not a rlysym */
  const rlyname = strOrAtom(CAR(s)); /* (an atom's u.s is its name, so BLZ works as well as "BLZ") */
  s = CDR(s); /* 7 */
  return new PanelSwitch(xno, wpx, wpy, rlyname);
}

function processViewOriginForm(s: Sexpr): number {
  if (listLength(s) < 2) {
    lispBarf("Not enough stuff in VIEW-ORIGIN:", s);
    return 0;
  }
  const x = toLong(CAR(s));
  const y = toLong(CADR(s));
  layoutHooks.viewOrigin = { x, y };
  layoutHooks.setDisplayWPOrg(x, y);
  return 1;
}

/** C++ SwitchesLoadComplete */
export function switchesLoadComplete(): void {
  for (const joint of switchJoints) {
    if (joint.TurnOut)
      /* ok if happens more than once.for each switch, which it will when gets 53A, 53B, etc */
      joint.TurnOut.processLoadComplete();
  }
}

/** C++ AuxKeysLoadComplete */
export function auxKeysLoadComplete(): void {
  for (const joint of switchJoints) {
    const turnout = joint.TurnOut;
    if (turnout) {
      const xno = turnout.XlkgNo;
      const sk = findObjectByNomAndType(xno, TypeId.SWITCHKEY) as SwitchKey | null;
      if (sk) sk.associateTurnout(turnout);
    }
  }
}

/* ------------------------------------------------------------------------------------------ */
/* TEXT form (txlayout.cpp)                                                                    */
/* ------------------------------------------------------------------------------------------ */

function processTextForm(s: Sexpr): GraphicObject | null {
  const BARF = (msg: string): null => {
    host().messageBox(msg, "V2 NXSYS", "ok");
    return null;
  };
  if (!isCons(s) || typeof s.car !== "string") return BARF("Text string missing or not a string in TEXT layout form.");
  const str = s.car;
  s = s.cdr;
  const pcnn = "Panel coordinates missing, or not numbers, in TEXT layout form.";
  if (!isCons(s) || !NUMBERP(s.car)) return BARF(pcnn);
  const x = numVal(s.car);
  s = s.cdr;
  if (!isCons(s) || !NUMBERP(s.car)) return BARF(pcnn);
  const y = numVal(s.car);
  s = s.cdr;

  const lf: LogFont = { lfHeight: 0, lfWidth: 0, lfWeight: 0, lfItalic: false, lfFaceName: "" };
  let Color = 0;
  let ColorGiven = false;

  while (isCons(s)) {
    if (!isCons(s.cdr)) return BARF("Value missing (odd # of items) in Keyword/Value list in TEXT layout form.");
    const Keyword = s.car;
    s = s.cdr;
    const Value = s.car;
    s = s.cdr;
    if (!(Keyword instanceof Sym)) return BARF("Keyword in Keyword/Value list in TEXT not a symbol.");
    const kw = Keyword.name;
    if (kw === "HEIGHT") {
      if (!NUMBERP(Value)) return BARF("Font height in TEXT form not a number.");
      const height = numVal(Value);
      if (height > 0 && height < 100) lf.lfHeight = height;
    } else if (kw === "WEIGHT") {
      if (Value instanceof Sym && Value.name === "BOLD") lf.lfWeight = FW_BOLD;
      else if (Value instanceof Sym && Value.name === "NORMAL") lf.lfWeight = FW_NORMAL;
      else if (NUMBERP(Value)) lf.lfWeight = numVal(Value);
      else return BARF("Font weight in TEXT form not a number, BOLD, or NORMAL.");
    } else if (kw === "WIDTH") {
      if (!NUMBERP(Value)) return BARF("Font width in TEXT form not a number.");
      const width = numVal(Value);
      if (width > 0 && width < 100) lf.lfWidth = width;
    } else if (kw === "FACE") {
      if (typeof Value !== "string") return BARF("Face name in TEXT form not a string.");
      if (Value.length > 10 || !/^[A-Za-z]{2}/.test(Value)) {
        // bad stuff in file
      } else lf.lfFaceName = Value;
    } else if (kw === "ITALIC") {
      if (Value === NIL) lf.lfItalic = false;
      else if (Value instanceof Sym && Value.name === "T") lf.lfItalic = true;
      else return BARF("Font width in TEXT form not T or NIL.");
    } else if (kw === "COLOR") {
      const badcol = "Font color in TEXT form not list of 3 numbers (RGB).";
      if (!isCons(Value) || listLength(Value) !== 3) return BARF(badcol);
      let v: Sexpr = Value;
      if (!NUMBERP(CAR(v))) return BARF(badcol);
      const r = numVal(CAR(v));
      v = CDR(v);
      if (!NUMBERP(CAR(v))) return BARF(badcol);
      const g = numVal(CAR(v));
      v = CDR(v);
      if (!NUMBERP(CAR(v))) return BARF(badcol);
      const b = numVal(CAR(v));
      Color = (r << 16) | (g << 8) | b; /* RGB() of the Mac windows.h: (r << 16) | (g << 8) | b, unmasked like the C macro */
      ColorGiven = true;
    } else return BARF(`Unknown Font keyword in TEXT form: ${kw}`);
  }

  return layoutTextString(str, lf, x, y, Color, ColorGiven);
}

/** `.u.s` of a string, or of an atom (same union slot in C++). */
function strOrAtom(s: Sexpr): string {
  return typeof s === "string" ? s : s instanceof Sym ? s.name : "";
}

function numVal(s: Sexpr): number {
  if (typeof s === "number") return s;
  if (s instanceof LFloat) return Math.trunc(s.value);
  if (s instanceof LRational) return Math.trunc(s.num / s.den);
  return 0;
}

