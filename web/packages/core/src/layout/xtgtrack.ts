/*
 * Track topology: TrackJoint, TrackSegEnd, TrackSeg, TrackCircuit.
 * Port of NXSYS/v2/joint.cpp, v2/trackseg.cpp, v2/tcircuit.cpp (declarations: v2/xtgtrack.h).
 * (NXSYS build only: no TLEDIT branches.)
 *
 * Geometry that a renderer needs: TrackSeg.Ends[i].wpx/wpy (panel coords), Length/CosTheta/SinTheta,
 * GraphicBlips, TrackSeg.wp_x/wp_y/wp_limits; TrackJoint.wp_x/wp_y/Nomenclature/Insulated and its
 * label (Lab, a NXGOLabel with wp_x/wp_y/s); TrackSegEnd.InsulatedP() decides where the
 * interstice gap is drawn (see TrackSeg.getGraphicsCoords).
 */
import {
  GraphicObject,
  allObjectsView,
  NXGOLabel,
  SCXtoWP,
  SCYtoWP,
  TypeId,
  WM_LBUTTONDOWN,
  WM_NXGO_RBUTTONCONTROL,
  WM_RBUTTONDOWN,
  nxgoState,
  WPXtoSC,
  WPYtoSC,
} from "./nxgo.js";
import { CONST_PI, Glb, TSAX, TSEX, f32, gdi } from "./geometry.js";
import type { Turnout } from "./turnout.js";
import { host } from "../host.js";
import type { DC, Pen } from "../render/dc.js";
import { gdiObjs } from "../render/gdiobjects.js";
import { reportToRelay } from "../relay/relay.js";
import type { ExitLight } from "./exlight.js";
import type { Signal } from "./signal.js";
import { createAndSetReporter } from "../relay/rlyapi.js";
import type { Relay } from "../relay/relay.js";

let fBlipLength = 0;

export interface JointOrganizationData {
  Radang: number;
  RRadang: number;
  Interang: number;
  original_index: number;
  SignalExists: boolean;
  TSeg: TrackSeg | null;
  OpposingSeg: TrackSeg | null;
}

const newJOD = (): JointOrganizationData => ({
  Radang: 0,
  RRadang: 0,
  Interang: 0,
  original_index: 0,
  SignalExists: false,
  TSeg: null,
  OpposingSeg: null,
});

/** C++ CircleSub. */
export function circleSub(x: number, y: number): number {
  const result = x - y;
  return result < 0.0 ? result + 2.0 * CONST_PI : result;
}

export class TrackJoint {
  Nomenclature = 0;
  Insulated = false;
  NumFlip = false;
  TurnOut: Turnout | null = null;
  SwitchAB0 = 0;
  TSA: (TrackSeg | null)[] = [null, null, null];
  TSCount = 0;
  Lab: NXGOLabel | null = null;

  constructor(
    public wp_x: number,
    public wp_y: number,
  ) {}

  /** operator[](TSAX) */
  branch(ax: TSAX): TrackSeg | null {
    return this.getBranch(ax);
  }

  getBranch(ax: TSAX): TrackSeg | null {
    if (ax === TSAX.STEM) return this.TSA[0];
    if (ax === TSAX.NORMAL) return this.TSA[1];
    if (ax === TSAX.REVERSE) return this.TSA[2];
    throw new Error("assertion failed: Invalid Branch Index");
  }

  typeID(): TypeId {
    return TypeId.JOINT;
  }
  isNomenclature(x: number): boolean {
    return this.Nomenclature === x;
  }

  availablePorts(): number {
    if (this.Insulated && this.TSCount === 2) return 0; // no "insulated switches"
    return 3 - this.TSCount;
  }

  addBranch(ts: TrackSeg): boolean {
    if (this.availablePorts() <= 0) return false;
    this.TSA[this.TSCount++] = ts;
    return true;
  }

  /** (sic) returns the END index of ts at this joint, as cast to TSAX */
  findBranchIndex(ts: TrackSeg | null): number {
    if (ts === null) return TSAX.NOTFOUND;
    for (let i = 0; i < this.TSCount; i++)
      if (this.TSA[i] === ts) for (let j = 0; j < 2; j++) if (ts.Ends[j].Joint === this) return j;
    return TSAX.NOTFOUND;
  }

  /** NXSYS: Nomenclature digitated "track number, station number". */
  stationNumber(): number {
    return decodeDigitated(this.Nomenclature).sno;
  }

  positionLabel(): void {
    const jod: JointOrganizationData[] = [newJOD(), newJOD(), newJOD(), newJOD()];
    if (this.Lab && this.Nomenclature > 10000) {
      this.Lab.setText("");
      this.Lab.invalidate();
      return;
    }
    if (this.Nomenclature === 0 || this.Nomenclature >= 10000) return;
    if (this.Lab === null) this.Lab = new NXGOLabel(null, this.wp_x, this.wp_y, "foo");
    else this.Lab.hide();

    let label = String(this.Nomenclature);
    if (this.TSCount === 3 && this.SwitchAB0 !== 0) label += this.SwitchAB0 === 1 ? "A" : "B";
    this.Lab.setText(label);

    this.getOrganization(jod);
    /* pointer to biggest interangle */
    let jdl = this.TSCount - 1;
    if (this.TSCount !== 1) if (jod[jdl].SignalExists !== this.NumFlip) jdl--;

    let foo = 0;
    if (jod[0].SignalExists && jod[1].SignalExists) {
      jdl++;
      foo++;
    }
    const J = jod[jdl] ?? newJOD();
    let angle = J.Radang + J.Interang / 2;
    if (this.TSCount === 1) angle = J.Radang + CONST_PI * 1.5;
    let rad = this.Lab.radius();
    if (foo) rad = f32(rad / 2);
    const fxc = this.wp_x + rad * Math.cos(angle);
    const fyc = this.wp_y + rad * Math.sin(angle);
    this.Lab.positionCenter(Math.trunc(fxc), Math.trunc(fyc));
    this.Lab.makeSelfVisible();
  }

  getOrganization(jod: JointOrganizationData[]): void {
    let i: number;
    /* Compute positive, clockwise angles from positive X origin */
    for (i = 0; i < this.TSCount; i++) {
      const ts = this.TSA[i];
      jod[i].original_index = i;
      jod[i].TSeg = ts;
      if (ts === null) return;
      const endx = ts.findEndIndex(this);
      const farp = ts.getOtherEnd(endx);
      jod[i].SignalExists = ts.getEnd(endx).SignalProtectingEntrance !== null;
      jod[i].Radang = circleSub(Math.atan2(farp.wpy - this.wp_y, farp.wpx - this.wp_x), 0.0);
    }
    /* Compute Positive, clockwise angles from TSA[0] */
    const r0 = jod[0].Radang;
    for (i = 0; i < this.TSCount; i++) jod[i].RRadang = circleSub(jod[i].Radang, r0);

    /* Get #1 & #2 in clockwise order from 0 */
    if (this.TSCount > 2)
      if (jod[1].RRadang > jod[2].RRadang) {
        const t = jod[1];
        jod[1] = jod[2];
        jod[2] = t;
      }

    /* NOW compute clockwise differences */
    for (i = 0; i < this.TSCount; i++) {
      jod[i].Interang = circleSub(jod[(i + 1) % this.TSCount].RRadang, jod[i].RRadang);
      jod[i].OpposingSeg = jod[(i + this.TSCount - 1) % this.TSCount].TSeg;
    }

    /* qsort (smallest angle (stem) first, biggest (rev) last). glibc/macOS behave stably on <=3
       elements, so use a stable sort with the same comparator (NOTES.md). */
    const head = jod.slice(0, this.TSCount).sort((a, b) => (a.Interang === b.Interang ? 0 : a.Interang < b.Interang ? -1 : 1));
    for (i = 0; i < this.TSCount; i++) jod[i] = head[i];
  }
}

/** C++ DecodeDigitated. */
export function decodeDigitated(input: number): { tno: number; sno: number } {
  if (input === 0) return { tno: 0, sno: 0 };
  if (Glb.IRTStyle) return { tno: input % 10, sno: Math.trunc(input / 10) };
  const nDigitsMinus1 = String(Math.trunc(Math.abs(input))).length - 1; // (int)log10(input)
  const power = Math.pow(10, nDigitsMinus1);
  return { tno: Math.trunc(input / power), sno: input % power };
}

export class TrackSegEnd {
  wpx = 0;
  wpy = 0;
  /** if there is a switch, "normal" next */
  Next: TrackSeg | null = null;
  /** "reverse" next, if switch */
  NextIfSwitchThrown: TrackSeg | null = null;
  FacingSwitch: Turnout | null = null;
  SignalProtectingEntrance: Signal | null = null;
  EndIndexNormal: TSEX = TSEX.E0;
  EndIndexReverse: TSEX = TSEX.E0;
  ExLight: ExitLight | null = null;
  Joint: TrackJoint | null = null;

  reposition(): void {
    if (this.SignalProtectingEntrance) this.SignalProtectingEntrance.PSignal!.reposition();
    if (this.ExLight) this.ExLight.reposition();
  }

  insulatedP(): boolean {
    if (this.Joint && this.Joint.TSCount === 3) return false; // no insulated switches today
    if (this.Next === null) return true;
    return this.Next.Circuit !== this.Next.getEnd(this.EndIndexNormal).Next!.Circuit;
  }

  offExitLight(): void {
    if (this.ExLight) this.ExLight.off();
  }

  spreadRWFactor(factor: number): void {
    if (this.Joint && this.Joint.Insulated) return;
    if (this.Next) this.Next.spreadRWFactor(factor);
    if (this.NextIfSwitchThrown) this.NextIfSwitchThrown.spreadRWFactor(factor);
  }
}

export class TrackSeg extends GraphicObject {
  Ends: [TrackSegEnd, TrackSegEnd] = [new TrackSegEnd(), new TrackSegEnd()];
  Circuit: TrackCircuit | null = null;
  /** pythagoric, useful for drawing (float) */
  Length = 0;
  CosTheta = 0;
  SinTheta = 0;
  /** "not the deselected end of a trailing pt sw": lit red/white in curr. sw. pos. */
  Routed = true;
  OwningTurnout: Turnout | null = null;
  /** real-world length for train sys */
  RWLength = -1.0;
  TrainCount = 0;
  GraphicBlips = 0;

  constructor(wpx1: number, wpy1: number, wpx2: number, wpy2: number) {
    super();
    fBlipLength = f32(2 * gdi.GU2);
    this.align(wpx1, wpy1, wpx2, wpy2);
    this.makeSelfVisible();
  }

  get TCNO(): number {
    return this.Circuit ? this.Circuit.StationNo : 0;
  }

  override typeID(): TypeId {
    return TypeId.TRACKSEG;
  }
  override isNomenclature(_x: number): boolean {
    return false;
  }
  override wpPoint() {
    return {
      x: Math.trunc((this.Ends[0].wpx + this.Ends[1].wpx) / 2),
      y: Math.trunc((this.Ends[0].wpy + this.Ends[1].wpy) / 2),
    };
  }

  align(wpx1: number, wpy1: number, wpx2: number, wpy2: number): void {
    const deltay = wpy2 - wpy1;
    const deltax = wpx2 - wpx1;
    const theta = Math.atan2(deltay, deltax);
    this.CosTheta = f32(Math.cos(theta));
    this.SinTheta = f32(Math.sin(theta));
    this.Length = f32(Math.sqrt(deltax * deltax + deltay * deltay));
    this.GraphicBlips = Math.trunc(f32(f32(this.Length - 1 * fBlipLength) / gdi.Track_Seg_Len));

    const higherY = Math.min(wpy1, wpy2);
    const lowerY = Math.max(wpy1, wpy2);
    const lefterX = Math.min(wpx1, wpx2);
    const righterX = Math.max(wpx1, wpx2);

    this.Ends[0].wpx = wpx1;
    this.Ends[1].wpx = wpx2;
    this.Ends[0].wpy = wpy1;
    this.Ends[1].wpy = wpy2;

    this.wp_x = lefterX;
    this.wp_y = higherY;
    const d = 2 * gdi.Track_Width_Delta;
    this.wp_limits.left = -d;
    this.wp_limits.right = righterX - lefterX + d;
    this.wp_limits.top = -d;
    this.wp_limits.bottom = lowerY - higherY + d;

    this.Ends[0].reposition();
    this.Ends[1].reposition();
  }

  alignSelf(): void {
    this.align(this.Ends[0].wpx, this.Ends[0].wpy, this.Ends[1].wpx, this.Ends[1].wpy);
  }

  getEnd(endx: TSEX): TrackSegEnd {
    return endx === TSEX.E1 ? this.Ends[1] : this.Ends[0]; // (invalid index: C++ returns Ends[0])
  }
  getOtherEnd(endx: TSEX): TrackSegEnd {
    return endx === TSEX.E0 ? this.Ends[1] : this.Ends[0];
  }
  findEndIndex(tj: TrackJoint): TSEX {
    if (tj === this.Ends[0].Joint) return TSEX.E0;
    if (tj === this.Ends[1].Joint) return TSEX.E1;
    return TSEX.NOTFOUND;
  }

  /** C++ HasCircuitBrothers is declared only. */

  /** Screen coords of end `ex`, set back from insulated joints (for drawing). */
  getGraphicsCoords(ex: number): { x: number; y: number } {
    const si = gdi.SectionInterstice * 3;
    const flip = ex === 0 ? 1 : -1;
    let x = WPXtoSC(this.Ends[ex].wpx);
    let y = WPYtoSC(this.Ends[ex].wpy);
    if (this.Ends[ex].insulatedP()) {
      /* int * float is a float product */
      x += roundSigned(f32(si * this.CosTheta)) * flip;
      y += roundSigned(f32(si * this.SinTheta)) * flip;
    }
    return { x, y };
  }

  override drawNomenclature(): number {
    return this.TCNO;
  }

  /** C++ TrackSeg::Display */
  override display(dc: DC): void {
    /* figure out correct state from track sec and containing switch */
    this.displayInState(dc, 0);
  }

  /** C++ TrackSeg::DisplayInState */
  displayInState(dc: DC, _control: number): void {
    const p1 = this.getGraphicsCoords(0);
    const p2 = this.getGraphicsCoords(1);
    const scx1 = p1.x;
    const scy1 = p1.y;
    const scx2 = p2.x;
    const scy2 = p2.y;

    dc.selectObject(gdiObjs.TrackPen);
    dc.moveTo(scx1, scy1);
    dc.lineTo(scx2, scy2);

    let pen: Pen | null;
    if (!this.Routed || !this.Circuit) pen = null;
    else if (this.Circuit.Occupied) pen = gdiObjs.TrackOccupiedPen;
    else if (this.Circuit.Routed) pen = gdiObjs.TrackRoutedPen;
    else if (this.OwningTurnout && this.OwningTurnout.Thrown) pen = gdiObjs.TrackDftPenThrown;
    else pen = null;

    if (pen) {
      /* Track_Seg_Len*CosTheta is int*float = float; then times the double scale */
      const scale = nxgoState.NXGO_Scale;
      const incXSegLen = f32(gdi.Track_Seg_Len * this.CosTheta) * scale;
      const incYSegLen = f32(gdi.Track_Seg_Len * this.SinTheta) * scale;
      const incXBlipLen = f32(fBlipLength * this.CosTheta) * scale;
      const incYBlipLen = f32(fBlipLength * this.SinTheta) * scale;

      dc.selectObject(pen);
      let xf = scx1 + incXBlipLen;
      let yf = scy1 + incYBlipLen;
      for (let step = 0; step < this.GraphicBlips; step++) {
        const ixf = Math.trunc(xf + 0.5);
        const iyf = Math.trunc(yf + 0.5);
        const ixdest = Math.trunc(xf + incXBlipLen + 0.5);
        const iydest = Math.trunc(yf + incYBlipLen + 0.5);
        dc.moveTo(ixf, iyf);
        dc.lineTo(ixdest, iydest);
        xf += incXSegLen;
        yf += incYSegLen;
      }
    }

    if (this.Ends[0].ExLight) this.Ends[0].ExLight.display(dc);
    if (this.Ends[1].ExLight) this.Ends[1].ExLight.display(dc);
  }

  /**
   * C++ SnapIntoLine (the 29 June 1999 version). On success returns the snapped panel point.
   */
  snapIntoLine(wpx1: number, wpy1: number): { x: number; y: number } | null {
    const ptx = wpx1 - this.Ends[0].wpx;
    const pty = wpy1 - this.Ends[0].wpy;
    const relx = this.CosTheta * ptx + this.SinTheta * pty;
    if (relx < 0.0) return null;
    const rely = this.CosTheta * pty - this.SinTheta * ptx;
    if (Math.abs(rely) > gdi.Track_Width_Delta) return null;
    if (relx > this.Length) return null;
    return {
      x: Math.trunc(relx * this.CosTheta + this.Ends[0].wpx + 0.5),
      y: Math.trunc(relx * this.SinTheta + this.Ends[0].wpy + 0.5),
    };
  }

  override hitP(x: number, y: number): boolean {
    if (!super.hitP(x, y)) return false;
    const wpxx = SCXtoWP(x);
    const wpyy = SCYtoWP(y);
    if (this.snapIntoLine(wpxx, wpyy)) {
      if (this.Ends[0].ExLight) if (this.Ends[0].ExLight.hitP(x, y)) return false;
      if (this.Ends[1].ExLight) if (this.Ends[1].ExLight.hitP(x, y)) return false;
      return true;
    }
    return false;
  }

  setTrackCircuit(tcid: number): TrackCircuit | null {
    if (tcid === 0) {
      if (this.Circuit) {
        this.Circuit.deleteSeg(this);
        this.Circuit = null;
        this.invalidate();
      }
      return null;
    }
    const tc = getTrackCircuit(tcid);
    this.setTrackCircuit0(tc);
    this.invalidate();
    return tc;
  }

  setTrackCircuit0(tc: TrackCircuit | null): void {
    if (this.Circuit !== tc) {
      if (this.Circuit) this.Circuit.deleteSeg(this);
      if (tc) tc.addSeg(this);
      else this.Circuit = null;
      this.invalidate();
    }
  }

  /** left click toggles occupancy, right click on a switch segment throws the switch. */
  override hit(mb: number): void {
    if (this.OwningTurnout && (mb === WM_RBUTTONDOWN || mb === WM_NXGO_RBUTTONCONTROL)) this.OwningTurnout.hit(mb, this);
    else if (mb === WM_LBUTTONDOWN && this.Circuit) this.Circuit.setOccupied(!this.Circuit.Occupied);
    /* WM_NXGO_RBUTTONCONTROL on a plain circuit raises a context menu (UI); the menu's actions
       are Circuit.setOccupied(true/false), and relay display commands. */
  }

  computeSwitchRoutedState(): void {
    const oldstate = this.Routed;
    this.Routed = this.computeSwitchRoutedEndState(0) && this.computeSwitchRoutedEndState(1);
    if (oldstate !== this.Routed) this.invalidate();
  }

  computeSwitchRoutedEndState(ex: number): boolean {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let seg: TrackSeg = this;
    for (;;) {
      const ep = seg.Ends[ex];
      if (ep.insulatedP()) return true;
      if (ep.Next === null) return true;
      const tj = ep.Joint;
      let goNext = false;
      if (tj === null) goNext = true;
      else {
        if (tj.TSCount < 3) return true;
        if (tj.TurnOut === null) return true;
        const thrown = tj.TurnOut.Thrown;
        if (seg === tj.branch(TSAX.REVERSE)) {
          if (thrown) goNext = true;
          else return false;
        } else if (seg === tj.branch(TSAX.NORMAL)) {
          if (thrown) return false;
          else goNext = true;
        } else {
          if (thrown) {
            const nseg = ep.NextIfSwitchThrown!;
            ex = 1 - ep.EndIndexReverse;
            seg = nseg;
            continue;
          } else goNext = true;
        }
      }
      if (goNext) {
        const nseg = ep.Next;
        ex = 1 - ep.EndIndexNormal;
        seg = nseg;
      }
    }
  }

  /** Returns the station number reached; `wpcordlen` accumulates panel length. */
  stationPointsEnd(endIndex: TSEX, loopCheck: number): { sno: number; wpcordlen: number } {
    if (loopCheck >= 200) {
      host().messageBox("Chasing infinite track loop.", "Train system init", "ok");
      return { sno: 0, wpcordlen: 0 };
    }
    const tse = endIndex === TSEX.E0 ? TSEX.E1 : TSEX.E0;
    const distant = this.getEnd(tse);
    let wpcordlen = Math.trunc(this.Length);
    if (distant.Joint) {
      const tj = distant.Joint;
      if (tj.Insulated) {
        const sno = tj.stationNumber();
        if (sno) return { sno, wpcordlen };
      }
    }
    const far = distant.Next!.stationPointsEnd(distant.EndIndexNormal, loopCheck + 1);
    wpcordlen += far.wpcordlen;
    return { sno: far.sno, wpcordlen };
  }

  spreadRWFactor(factor: number): void {
    if (this.RWLength >= 0.0) return;
    this.RWLength = f32(this.Length * factor);
    this.Ends[0].spreadRWFactor(factor);
    this.Ends[1].spreadRWFactor(factor);
  }

  incrementTrainOccupation(): void {
    this.TrainCount += 1;
    this.updateCircuitOccupation();
  }
  decrementTrainOccupation(): void {
    if (!this.TrainCount) throw new Error("assertion failed: TrainCount");
    this.TrainCount -= 1;
    this.updateCircuitOccupation();
  }
  private updateCircuitOccupation(): void {
    if (this.Circuit) this.Circuit.computeOccupiedFromTrains();
  }
}

/** C++ RoundSigned. */
export function roundSigned(f: number): number {
  return f < 0.0 ? Math.trunc(f - 0.5) : Math.trunc(f + 0.5);
}

/* ------------------------------------------------------------------------------------------ */
/* Track circuits (v2/tcircuit.cpp) — not graphic objects                                      */
/* ------------------------------------------------------------------------------------------ */

let allTrackCircuits: TrackCircuit[] = [];

export class TrackCircuit {
  Occupied = false;
  Routed = false;
  Coding = false;
  TrackRelay: Relay | null = null;
  Segments: TrackSeg[] = [];

  constructor(public StationNo: number) {
    if (!StationNo) throw new Error("assertion failed: Attempt to create track circuit 0");
  }

  addSeg(ts: TrackSeg): void {
    ts.Circuit = this;
    for (const ats of this.Segments) if (ats === ts) return; // shouldn't really be in array
    this.Segments.push(ts);
  }

  /**
   * C++ VEDEL takes its vector BY VALUE, so DeleteSeg never actually removes anything. Emulated
   * (it has no effect during a load, the only time circuits exist in NXSYS).
   */
  deleteSeg(_ts: TrackSeg): void {}

  setOccupied(sta: boolean, force = false): void {
    if (this.Occupied !== sta || force) {
      this.Occupied = sta;
      this.invalidate();
      if (this.TrackRelay) reportToRelay(this.TrackRelay, !this.Occupied);
    }
  }

  setRouted(sta: boolean): void {
    if (this.Routed !== sta) {
      this.Routed = sta;
      this.invalidate();
    }
  }

  invalidate(): void {
    for (const ts of this.Segments) {
      if (ts.Ends[0].Joint && ts.Ends[0].Joint.TurnOut) ts.Ends[0].Joint.TurnOut.invalidateAndTurnouts();
      if (ts.Ends[1].Joint && ts.Ends[1].Joint.TurnOut) ts.Ends[1].Joint.TurnOut.invalidateAndTurnouts();
      ts.invalidate();
    }
  }

  processLoadComplete(): void {
    this.TrackRelay = createAndSetReporter(this.StationNo, "T", TrackCircuit.trackReportFcn, this);
    createAndSetReporter(this.StationNo, "K", TrackCircuit.trackKRptFcn, this);
  }

  static trackReportFcn(state: boolean, v: unknown): void {
    const t = v as TrackCircuit;
    t.Occupied = !state;
    t.invalidate();
  }
  static trackKRptFcn(state: boolean, v: unknown): void {
    (v as TrackCircuit).setRouted(state);
  }

  computeSwitchRoutedState(): void {
    for (const ts of this.Segments) ts.computeSwitchRoutedState();
  }

  findDemoHitSeg(): TrackSeg {
    for (const ts of this.Segments) if (!ts.OwningTurnout) return ts;
    return this.Segments[0];
  }

  computeOccupiedFromTrains(): void {
    let occ = 0;
    for (const ts of this.Segments) occ += ts.TrainCount;
    this.setOccupied(occ !== 0);
  }

  multipleSegmentsP(): boolean {
    return this.Segments.length > 1;
  }
}

export function findTrackCircuit(sno: number): TrackCircuit | null {
  for (const tc of allTrackCircuits) if (tc.StationNo === sno) return tc;
  return null;
}

export function getTrackCircuit(sno: number): TrackCircuit {
  if (!sno) throw new Error("assertion failed: GetTrackCircuit called on 0");
  const tc = findTrackCircuit(sno);
  if (tc) return tc;
  const n = new TrackCircuit(sno);
  allTrackCircuits.push(n);
  return n;
}

export const allTrackCircuitsView = (): readonly TrackCircuit[] => allTrackCircuits;

export function reportAllTrackSecsClear(): void {
  for (const tc of allTrackCircuits) tc.setOccupied(false, true); // force
}

export function clearAllTrackSecs(): void {
  for (const tc of allTrackCircuits) tc.setOccupied(false);
}

export function trackCircuitSystemLoadTimeComplete(): void {
  for (const tc of allTrackCircuits) tc.processLoadComplete();
}

export function trackCircuitSystemReInit(): void {
  allTrackCircuits = [];
}

/** C++ FindDemoHitCircuit */
export function findDemoHitCircuit(id: number): TrackSeg | null {
  const tc = findTrackCircuit(id);
  if (tc === null) return null;
  return tc.findDemoHitSeg();
}

/** C++ SnapToTrackSeg: find the track segment under panel point (wpx, wpy), snapping the point to it. */
export function snapToTrackSeg(wpx: number, wpy: number): { seg: TrackSeg; x: number; y: number } | null {
  const scx = WPXtoSC(wpx);
  const scy = WPYtoSC(wpy);
  // MapGraphicObjectsOfType(TRACKSEG, SnapMapper), in registry order
  let found: { seg: TrackSeg; x: number; y: number } | null = null;
  for (const g of allObjectsView()) {
    if (g.typeID() !== TypeId.TRACKSEG) continue;
    const ts = g as TrackSeg;
    if (GraphicObject.prototype.hitP.call(ts, scx, scy)) {
      const s = ts.snapIntoLine(wpx, wpy);
      if (s) {
        found = { seg: ts, x: s.x, y: s.y };
        break;
      }
    }
  }
  return found;
}

