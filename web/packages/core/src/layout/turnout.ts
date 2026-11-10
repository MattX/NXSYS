/*
 * Turnout (switch machine) — port of NXSYS/v2/xturnout.cpp (creation, routing state, NK lights),
 * NXSYS/turncomn.cpp (movement timing, relay reporters), Turnout::ProcessLoadComplete (rdtrkcmn.cpp).
 * Not a GraphicObject in V2 (the TrackSegs are); the switch-key panel object is swkey.ts.
 */
import { ExitLight } from "./exlight.js";
import { TSAX } from "./geometry.js";
import { WM_NXGO_RBUTTONCONTROL, WM_RBUTTONDOWN, objectUIHooks } from "./nxgo.js";
import type { TrackCircuit, TrackJoint, TrackSeg } from "./xtgtrack.js";
import { nxCoder, killOneCoder } from "../clock/coders.js";
import { getTickCount, nxTimer } from "../clock/scheduler.js";
import { pulseToRelay, relayUseDefined, reportToRelay, type Relay } from "../relay/relay.js";
import { createAndSetReporter, createQuislingRelay, relayState, setReporterIfExists } from "../relay/rlyapi.js";

export const TN_AUXKEY_FORCE_NORMAL = 1;
export const TN_AUXKEY_FORCE_REVERSE = 2;

export const NKX_N = 0;
export const NKX_R = 1;

export const NKS_LineOfLite = 0x01;
export const NKS_IndicatingWhite = 0x02;
export const NKS_FlashingWhite = 0x04;
export const NKS_FlashingRed = 0x08;
export const NKS_Any = NKS_IndicatingWhite | NKS_FlashingWhite | NKS_FlashingRed;

const SwitchMoveTimeMS = 1800;

export class NKData {
  ExLight: ExitLight | null = null;
  Circuit: TrackCircuit | null = null;
  Status = 0;
}

let allTurnouts: Turnout[] = [];

export class Turnout {
  Thrown = false;
  LockSafe = true;
  CLK_Coding = false;
  AuxKeyForce = 0;
  NWP: Relay | null = null;
  RWP: Relay | null = null;
  NWZ: Relay | null = null;
  RWZ: Relay | null = null;
  NL: Relay | null = null;
  RL: Relay | null = null;
  NEnds = 0;
  Joints: [TrackJoint | null, TrackJoint | null] = [null, null];
  NK: NKData[][] = [
    [new NKData(), new NKData()],
    [new NKData(), new NKData()],
  ];
  MoveStartTime = 0;
  MovingPhase = 0;
  CLKCodingPhase = 0;

  constructor(public XlkgNo: number) {}

  segConflict(_other: Turnout): void {
    /* not really great to deal with here (code #if 0'd in C++) */
  }

  assignJoint(tj: TrackJoint): boolean {
    const J = tj;
    let ab0 = J.SwitchAB0;
    if (ab0 === 0) ab0 = 1;
    ab0--; /* now 0 or 1 */
    this.Joints[ab0] = J;
    if (ab0 === 1) this.NEnds = 2;
    else if (this.NEnds === 0) this.NEnds = 1;
    J.TurnOut = this;
    for (const ibx of [TSAX.STEM, TSAX.NORMAL, TSAX.REVERSE]) {
      let nkx = 0;
      const ts = J.branch(ibx)!;
      const endx = ts.findEndIndex(tj);
      const E = ts.getEnd(endx);
      if (!E.ExLight) E.ExLight = new ExitLight(ts, endx, 0);
      switch (ibx) {
        case TSAX.STEM:
          E.FacingSwitch = this;
          E.NextIfSwitchThrown = J.branch(TSAX.REVERSE);
          E.EndIndexReverse = E.NextIfSwitchThrown!.findEndIndex(J);
          E.Next = J.branch(TSAX.NORMAL);
          break;
        case TSAX.REVERSE:
          if (ts.OwningTurnout)
            /* slip switches'll do that to ya .... */
            this.segConflict(ts.OwningTurnout);
          else ts.OwningTurnout = this;
          E.Next = J.branch(TSAX.STEM);
          nkx = NKX_R;
          break;
        case TSAX.NORMAL:
          E.Next = J.branch(TSAX.STEM);
          nkx = NKX_N;
          break;
      }
      if (ibx !== TSAX.STEM) {
        this.NK[ab0][nkx].ExLight = E.ExLight;
        this.NK[ab0][nkx].Circuit = ts.Circuit;
        this.NK[ab0][nkx].Status = 0;
      }
      E.EndIndexNormal = E.Next!.findEndIndex(J);
    }
    return true;
  }

  invalidateAndTurnouts(): void {
    for (let ab0 = 0; ab0 < 2; ab0++)
      for (let nr = 0; nr < 2; nr++) {
        const np = this.NK[ab0][nr];
        const xl = np.ExLight;
        if (xl === null) continue;
        const thrownx = this.Thrown ? NKX_R : NKX_N;

        const lol = np.Circuit !== null && (np.Circuit.Occupied || np.Circuit.Routed);
        let moving = this.MovingPhase !== 0 && !lol;
        const steadyWhite =
          thrownx === nr &&
          (nr === NKX_N ? this.AuxKeyForce === TN_AUXKEY_FORCE_NORMAL : this.AuxKeyForce === TN_AUXKEY_FORCE_REVERSE) &&
          !lol &&
          !moving;
        const flashingWhite = thrownx === nr && this.CLKCodingPhase !== 0 && !lol && !moving && !steadyWhite;

        if (nr === NKX_N) moving = false;

        let newstat = 0;
        if (moving) newstat = NKS_FlashingRed;
        if (steadyWhite) newstat = NKS_IndicatingWhite;
        if (flashingWhite) newstat = NKS_FlashingWhite;
        if (lol) newstat |= NKS_LineOfLite;

        if (np.Status !== newstat) {
          if (np.Status & NKS_Any) {
            xl.setLit(false);
            xl.setRedFlash(false);
            if (lol) xl.Seg.invalidate();
          }
        }
        np.Status = newstat;
        if (steadyWhite) xl.setLit(true);
        else if (flashingWhite) xl.setLit(this.CLKCodingPhase === 2);
        else if (moving) xl.setRedFlash(this.MovingPhase === 2);
      }
  }

  displayNoDC(): void {
    this.invalidateAndTurnouts();
  }

  /** `mousewhat` is WM_RBUTTONDOWN (toggle) or WM_NXGO_RBUTTONCONTROL (context menu: UI chooses throwSwitch). */
  hit(mousewhat: number, ht: TrackSeg): void {
    if (mousewhat === WM_RBUTTONDOWN) this.throwSwitch(!this.Thrown);
    else if (mousewhat === WM_NXGO_RBUTTONCONTROL) {
      objectUIHooks.contextMenu?.(ht); /* RunContextMenu: UI. Menu actions are throwSwitch(false/true). */
    }
  }

  updateRoutings(): void {
    for (let i = 0; i < this.NEnds; i++) {
      const tj = this.Joints[i]!;
      const circuit = tj.branch(TSAX.STEM)!.Circuit;
      if (circuit && circuit.multipleSegmentsP()) circuit.computeSwitchRoutedState();
    }
  }

  getOwningSeg(): TrackSeg {
    const tj = this.Joints[0]!;
    return tj.branch(TSAX.REVERSE)!;
  }

  /* ---- turncomn.cpp ---- */

  static lsReporter(state: boolean, v: unknown): void {
    (v as Turnout).LockSafe = state;
  }
  static timeReporter(v: unknown): void {
    (v as Turnout).timer();
  }
  static rwzReporter(state: boolean, v: unknown): void {
    const t = v as Turnout;
    if (state && !t.Thrown) t.startMove();
  }
  static nwzReporter(state: boolean, v: unknown): void {
    const t = v as Turnout;
    if (state && t.Thrown) t.startMove();
  }
  static coderReporter(v: unknown, codestate: boolean): void {
    (v as Turnout).codingFlash(codestate);
  }
  static clkReporter(state: boolean, v: unknown): void {
    (v as Turnout).clkReport(state);
  }

  startMove(): void {
    if (this.MovingPhase > 0) return;
    this.MovingPhase = 1;
    reportToRelay(this.RWP, false);
    reportToRelay(this.NWP, false);
    this.MoveStartTime = getTickCount();
    nxTimer(this, Turnout.timeReporter, SwitchMoveTimeMS);
    nxCoder(this, Turnout.coderReporter);
    this.invalidateAndTurnouts();
  }

  throwSwitch(throwit: boolean): void {
    if (relayUseDefined(this.NL) && relayUseDefined(this.RL)) {
      /* new way is best */
      if (this.MovingPhase === 0) pulseToRelay(throwit ? this.RL : this.NL);
    } else if (this.LockSafe) {
      reportToRelay(throwit ? this.NWZ : this.RWZ, false);
      reportToRelay(throwit ? this.RWZ : this.NWZ, true);
    }
  }

  codingFlash(state: boolean): void {
    if (this.MovingPhase > 0) this.MovingPhase = state ? 1 : 2;
    else if (this.CLKCodingPhase > 0) this.CLKCodingPhase = state ? 1 : 2;
    this.displayNoDC();
  }

  clkReport(state: boolean): void {
    if (state) {
      this.CLK_Coding = true;
      if (this.CLKCodingPhase === 0) {
        nxCoder(this, Turnout.coderReporter);
        this.CLKCodingPhase = 2;
      }
    } else {
      if (this.MovingPhase === 0) killOneCoder(this);
      this.CLKCodingPhase = 0;
      this.displayNoDC();
      this.CLK_Coding = false;
    }
    this.invalidateAndTurnouts();
  }

  timer(): void {
    this.MovingPhase = 0;
    if (this.CLKCodingPhase === 0) killOneCoder(this);
    this.Thrown = !this.Thrown;

    if ((this.Thrown && relayState(this.NWZ)) || (!this.Thrown && relayState(this.RWZ))) this.startMove();
    else {
      reportToRelay(this.Thrown ? this.RWP : this.NWP, true);
      this.updateRoutings();
      this.invalidateAndTurnouts();
    }
  }

  /** Turnout::ProcessLoadComplete (rdtrkcmn.cpp). */
  processLoadComplete(): void {
    this.NWP = createQuislingRelay(this.XlkgNo, "NWP");
    this.NWP.state = true;
    this.RWP = createQuislingRelay(this.XlkgNo, "RWP");
    createQuislingRelay(this.XlkgNo, "NWC").state = true;

    createAndSetReporter(this.XlkgNo, "LS", Turnout.lsReporter, this);

    /* Support both behaviors (buggy NWZ control and real lever sim) */
    this.NL = createQuislingRelay(this.XlkgNo, "NL");
    this.RL = createQuislingRelay(this.XlkgNo, "RL");

    this.NWZ = createAndSetReporter(this.XlkgNo, "NWZ", Turnout.nwzReporter, this);
    this.NWZ.state = true;

    this.RWZ = createAndSetReporter(this.XlkgNo, "RWZ", Turnout.rwzReporter, this);
    this.RWZ.state = false;
    setReporterIfExists(this.XlkgNo, "CLK", Turnout.clkReporter, this);
  }
}

/** C++ CreateTurnouts. */
export function createTurnouts(joints: TrackJoint[]): boolean {
  const njoints = joints.length;
  allTurnouts = new Array<Turnout>(njoints);
  for (let i = 0; i < njoints; i++) {
    const tj = joints[i];
    if (tj.TurnOut === null) {
      const tn = new Turnout(tj.Nomenclature);
      if (!tn.assignJoint(tj)) return false;
      for (let j = 0; j < njoints; j++) {
        const tj2 = joints[j];
        if (tj2 !== tj && tj2.Nomenclature === tj.Nomenclature) if (!tn.assignJoint(tj2)) return false;
      }
    }
  }
  for (let i = 0; i < njoints; i++) {
    const tj = joints[i];
    if (tj.TurnOut) {
      allTurnouts[i] = tj.TurnOut;
      tj.TurnOut.updateRoutings();
    }
  }
  return true; /* success */
}

export function resetTurnouts(): void {
  allTurnouts = [];
}

export const allTurnoutsView = (): readonly Turnout[] => allTurnouts;

/** C++ NormalAllSwitches */
export function normalAllSwitches(): void {
  for (const tn of allTurnouts) if (tn && tn.Thrown) tn.throwSwitch(false);
}

/** C++ FindDemoHitTurnout */
export function findDemoHitTurnout(id: number): TrackSeg | null {
  for (const t of allTurnouts) if (t.XlkgNo === id) return t.getOwningSeg();
  return null;
}

