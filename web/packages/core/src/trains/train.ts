/*
 * The train system — TS port of NXSYS/traincmn.cpp, NXSYS/v2/xtrains.cpp (Pointpos, FindNextSig, entry
 * track lookup), traindcl.h, trainaut.h, trainapi.h, traindlg.h, with the train-dialog logic of
 * traincmn.cpp (what NXSYSMac/TrainDlgController.mm drives) as a UI-free model with hooks.
 *
 * Fidelity notes (C++ quirks kept on purpose):
 *  - "freewill" as a CREATE option is accepted but has no effect (only HALTED is looked at).
 *  - Observance(): a speed increment below 1.5 ft/s per tick is rounded down to 0, so a stopped
 *    train far (> ~600 ft) from its signal cannot start itself; give it a manual speed.
 *  - Command(TRD_HIDE) is not handled (returns false -> demo error "Could not TRAIN n HIDE").
 *  - Train::SetOccupied tests Occupied.count(front.ts), not ts.
 *  - FREEWILL/OBSERVANT/HALT etc. as in the Mac dialog.
 *  - Trains.clear() destroys the trains in descending train-number order (libstdc++ std::map::clear,
 *    which the golden harness uses); each train is unlinked from the map before it is destroyed.
 */
import { scheduler } from "../clock/scheduler.js";
import { host } from "../host.js";
import { Glb, TSEX, f32, trainCfg } from "../layout/geometry.js";
import { TypeId, mapFindGraphicObjectsOfType, type GraphicObject } from "../layout/nxgo.js";
import { Signal } from "../layout/signal.js";
import { decodeDigitated, type TrackJoint, type TrackSeg } from "../layout/xtgtrack.js";
import { nxsysHooks } from "../interlocking/nxsys.js";
import { trySignalIDBox } from "../interlocking/dynmenu.js";

export const PRODUCT_NAME = "NXSYS/Mac";

/* traindlg.h control ids */
export const TRD_LENGTH = 32;
export const TRD_SPEED = 33;
export const TRD_LOC = 34;
export const TRD_NEXT_SIG_NAME = 35;
export const TRD_NEXT_SIG_STATE = 36;
export const TRD_LAST_SIG_NAME = 37;
export const TRD_LAST_SIG_STATE = 38;
export const TRD_TRAIN_ID = 39;
export const TRD_OBSERVANT = 40;
export const TRD_DEFIANT = 41;
export const TRD_NORTHSOUTH = 42;
export const TRD_MC = 43;
export const TRD_REV = 44;
export const TRD_HALT = 50;
export const TRD_KILL = 51;
export const TRD_COPB = 52;
export const TRD_MINIMIZE = 70;
export const TRD_RESTORE = 71;
export const TRD_CABVIEW = 72;
export const TRD_HIDE = 73;

/* trainaut.h / trainapi.h */
export const TRAIN_CTL_MINDLG = 1;
export const TRAIN_CTL_HIDEDLG = 2;
export const TRAIN_CTL_HALTED = 4;
export const TRAIN_CTL_FREEWILL = 8;
export const TRAIN_HALTCTL_GO = 1;
export const TRAIN_HALTCTL_HALTED = 2;

/* commands.h */
export const CmHaltTrains = 4161;
export const CmKillTrains = 4162;
export const CmHideTrainWindows = 4163;
export const CmShowTrainWindows = 4164;

const INTVL_MS = 500;
const INTVL_SECS = INTVL_MS / 1000;
const MIN_ACCEL = -30.0;
const MAX_ACCEL = 30.0;
const HaltSpaceBeforeStopSignal = 40.0;

/** What the train dialog shows (the TRD_* fields); updated live. */
export interface TrainDialogState {
  id: number;
  title: string;
  length: string;
  /** "%d/%d" speed/cruise */
  speed: string;
  location: string;
  nextSigName: string;
  nextSigState: string;
  lastSigName: string;
  lastSigState: string;
  observant: boolean;
  /** speed as percent of cruise (setSliderValue) */
  sliderOf100: number;
  /** the call-on button (TRD_COPB) is shown */
  callOnShown: boolean;
  /** window state requested by commands */
  window: "normal" | "minimized" | "hidden";
}

export const trainHooks = {
  /** a train was created (dialog opened) */
  created: null as ((t: Train) => void) | null,
  /** a train was destroyed (dialog closed) */
  removed: null as ((t: Train) => void) | null,
  /** the dialog state of a train changed */
  changed: null as ((t: Train) => void) | null,
  /** window show/minimize/restore request (SW_* of ShowWindow) */
  showWindow: null as ((t: Train, mode: "normal" | "minimized" | "hidden" | "restore", focus: boolean) => void) | null,
  /** a train was tripped by a stop (the Mac shows a modal box with TrainWreck256.png); default = host message box */
  tripped: null as ((t: Train, text: string) => void) | null,
};

function flipEnd(e: TSEX): TSEX {
  if (e === TSEX.E0) return TSEX.E1;
  if (e === TSEX.E1) return TSEX.E0;
  throw new Error("assertion failed: Bad end index to trains' flip_end");
}

/** C++ Pointpos */
export class Pointpos {
  ts: TrackSeg | null = null;
  x = 0;
  x_at_seg_start = 0;
  facing_ex: TSEX = TSEX.E0;
  LastIJID = "";
  FeetSinceLastIJ = 0; // float
  FSLIJatSegStart = 0; // float
  IAmFront = false;
  Trn!: Train;

  clone(): Pointpos {
    const p = new Pointpos();
    p.ts = this.ts;
    p.x = this.x;
    p.x_at_seg_start = this.x_at_seg_start;
    p.facing_ex = this.facing_ex;
    p.LastIJID = this.LastIJID;
    p.FeetSinceLastIJ = this.FeetSinceLastIJ;
    p.FSLIJatSegStart = this.FSLIJatSegStart;
    p.IAmFront = this.IAmFront;
    p.Trn = this.Trn;
    return p;
  }

  passJoint(tj: TrackJoint): void {
    const { tno, sno } = decodeDigitated(tj.Nomenclature);
    if (Glb.IRTStyle) this.LastIJID = `${sno * 10 + tno}/${Glb.RouteIdentifier}`.slice(0, 23);
    else this.LastIJID = `${Glb.RouteIdentifier}${tno}-${sno}`.slice(0, 23);
    this.FeetSinceLastIJ = this.FSLIJatSegStart = 0;
  }

  reverse(newX: number): void {
    if (this.ts) {
      this.LastIJID = "";
      this.FSLIJatSegStart = this.FeetSinceLastIJ = 0;
      this.facing_ex = flipEnd(this.facing_ex);
      this.x_at_seg_start = newX - (this.ts.RWLength - Math.abs(this.x - this.x_at_seg_start));
      this.x = newX;
    }
  }

  findTrackSeg(): number {
    if (this.ts) {
      /* train not moving off end of trk */
      let feetLeft = this.x - this.x_at_seg_start;
      while (feetLeft > 0.0) {
        const segfeet = feetLeft - this.ts!.RWLength;
        if (segfeet < 0.0) {
          this.FeetSinceLastIJ = f32(this.FSLIJatSegStart + feetLeft);
          return +1;
        }
        feetLeft = segfeet;
        /* must move into next track segment */
        if (!this.IAmFront) this.Trn.setUnoccupied(this.ts!);
        const ep = this.ts!.getEnd(this.facing_ex);
        if (ep.Joint && ep.Joint.Insulated && ep.Joint.Nomenclature) {
          this.passJoint(ep.Joint);
          this.FeetSinceLastIJ = 0;
        }
        this.FSLIJatSegStart = this.FeetSinceLastIJ;
        if (ep.Next === null) {
          /* going off track */
          this.FeetSinceLastIJ = f32(feetLeft);
          return -1;
        }
        this.x_at_seg_start += this.ts!.RWLength;
        if (ep.FacingSwitch === null || !ep.FacingSwitch.Thrown) {
          this.ts = ep.Next;
          this.facing_ex = flipEnd(ep.EndIndexNormal);
        } else {
          this.ts = ep.NextIfSwitchThrown;
          this.facing_ex = flipEnd(ep.EndIndexReverse);
        }
        if (this.IAmFront) this.Trn.setOccupied(this.ts!);
      }
    }
    return +1;
  }
}

/* ---- the train map ---- */
const Trains = new Map<number, Train>();
let TrainNoMax = 0;
const FreedTrainNumbers: number[] = [];

/** Trains in train-number order (what a std::map iteration gives). */
export function allTrains(): Train[] {
  return [...Trains.keys()].sort((a, b) => a - b).map((k) => Trains.get(k)!);
}
export function getTrain(n: number): Train | undefined {
  return Trains.get(n);
}

function usermsgstop(text: string): void {
  host().messageBox(text, PRODUCT_NAME, "ok");
}

export class Train {
  id: number;
  dlg: TrainDialogState;
  /** bumped on every dialog-visible change (for UI re-render) */
  version = 0;
  private TimerPending = false;
  private observant: boolean;
  private front = new Pointpos();
  private back = new Pointpos();
  private Speed: number;
  private Cruise: number;
  private Length: number;
  private LastTargetSpeed: number;
  private Time: number;
  NextSig: Signal | null = null;
  private Occupied: TrackSeg[] = [];
  private X_Of_Next_Signal = 0;
  private CODisplay = false;
  /** false once vanish() ran */
  alive = true;

  constructor(trainNo: number, g: GraphicObject, options: number) {
    this.id = trainNo;
    TrainNoMax = Math.max(TrainNoMax, trainNo);
    this.observant = (options & TRAIN_CTL_HALTED) === 0;
    this.dlg = {
      id: trainNo,
      title: `Train #${trainNo}`,
      length: "",
      speed: "",
      location: "",
      nextSigName: "",
      nextSigState: "",
      lastSigName: "",
      lastSigState: "",
      observant: this.observant,
      sliderOf100: 0,
      callOnShown: false,
      window: "normal",
    };
    this.Length = Glb.TrainLengthFeet;
    this.Cruise = trainCfg.CruisingSpeed;
    this.Speed = this.observant ? this.Cruise : 0.0;
    this.LastTargetSpeed = this.Speed;
    const ts = g as TrackSeg;
    this.initPositionTracking(ts);
    this.dlg.title = `#${trainNo} Train Control`;
    this.Time = scheduler.now;
    this.dlg.length = String(Math.trunc(this.Length));
    this.initPosition();
    if (options & TRAIN_CTL_MINDLG) this.dlg.window = "minimized";
    else if (options & TRAIN_CTL_HIDEDLG) this.dlg.window = "hidden";
  }

  /* ---- dialog model ---- */
  private touch(): void {
    this.version++;
    trainHooks.changed?.(this);
  }

  get isObservant(): boolean {
    return this.observant;
  }
  get speed(): number {
    return this.Speed;
  }
  get cruise(): number {
    return this.Cruise;
  }
  /** can the dialog's Reverse button be used (never disabled on the Mac) */
  get reverseEnabled(): boolean {
    return true;
  }

  private reportSig(g: Signal | null, which: "next" | "last"): void {
    void which;
    let name: string;
    let state: string;
    let callOn = false;
    if (g === null) {
      name = "None";
      state = "";
    } else {
      name = g.compactName();
      g.computeState();
      let aspect = "";
      for (const head of g.Heads) {
        if (head.State !== "X") {
          if (aspect.length) aspect += " ";
          aspect += head.State;
        }
        if (head.height === 1 && head.Lights[0] === "Y") callOn = head.State === "Y";
      }
      state = aspect;
    }
    this.dlg.nextSigName = name;
    this.dlg.nextSigState = state;
    if (this.NextSig !== null && this.NextSig.TStop !== null && !this.NextSig.TStop.Tripping) callOn = false;
    if (callOn !== this.CODisplay) {
      this.CODisplay = callOn;
      this.dlg.callOnShown = callOn;
    }
    this.touch();
  }

  private updateSwitches(): void {
    this.dlg.observant = this.observant;
    this.touch();
  }

  private updatePositionReport(): void {
    const feet = Math.trunc(100.0 * this.front.FeetSinceLastIJ);
    this.dlg.location = `${this.front.LastIJID}+${feet < 0 ? "-" + String(-feet).padStart(1, "0") : String(feet).padStart(2, "0")}`;
    this.dlg.sliderOf100 = Math.trunc(100.0 * (this.Speed / this.Cruise));
    this.dlg.speed = `${Math.trunc(this.Speed)}/${Math.trunc(this.Cruise)}`;
    this.reportSig(this.NextSig, "next");
  }

  /* ---- positions ---- */
  private initPositionTracking(ts: TrackSeg): void {
    let endx = TSEX.E0;
    if (ts.Ends[0].Next === null) endx = TSEX.E1;
    else if (ts.Ends[1].Next === null) endx = TSEX.E0;
    const f = this.front;
    f.ts = ts;
    f.x = 0.0;
    f.x_at_seg_start = 0.0;
    f.facing_ex = endx;
    f.IAmFront = true;
    f.Trn = this;
    f.passJoint(ts.getOtherEnd(endx).Joint!);
    this.setOccupied(ts);
    /* now figure out the back of the train. */
    this.back = f.clone();
    this.back.x = -this.Length;
    this.back.IAmFront = false;
  }

  private findNextSig(): Signal | null {
    this.front.findTrackSeg();
    this.X_Of_Next_Signal = this.front.x_at_seg_start;
    let ts = this.front.ts;
    let endx = this.front.facing_ex;
    while (ts) {
      const ep = ts.getEnd(endx);
      this.X_Of_Next_Signal += ts.RWLength;
      if (ep.Next === null) return null;
      if (ep.FacingSwitch === null || !ep.FacingSwitch.Thrown) {
        ts = ep.Next;
        endx = flipEnd(ep.EndIndexNormal);
      } else {
        ts = ep.NextIfSwitchThrown!;
        endx = flipEnd(ep.EndIndexReverse);
      }
      const s = ts.getOtherEnd(endx).SignalProtectingEntrance;
      if (s) return s;
    }
    return null;
  }

  private computeOccupations(): number {
    this.front.findTrackSeg();
    this.back.x = this.front.x - this.Length / 100.0;
    if (this.back.x >= 0.0) {
      if (this.back.findTrackSeg() < 0) return 0; /* train has run off map */
    }
    return 1;
  }

  setUnoccupied(ts: TrackSeg): void {
    const i = this.Occupied.indexOf(ts);
    if (i >= 0) {
      this.Occupied.splice(i, 1);
      ts.decrementTrainOccupation();
    }
  }

  setOccupied(ts: TrackSeg): void {
    if (this.Occupied.includes(this.front.ts!)) return; /* sic: front.ts, not ts */
    if (!this.Occupied.includes(ts)) this.Occupied.push(ts);
    ts.incrementTrainOccupation();
  }

  private installNextSig(): void {
    const g = this.findNextSig();
    if (g !== this.NextSig) {
      this.dlg.lastSigName = this.dlg.nextSigName;
      this.dlg.lastSigState = this.dlg.nextSigState;
      if (g !== null) g.TrainLooking = this;
      if (this.NextSig !== null) this.NextSig.TrainLooking = null;
      this.NextSig = g;
    }
  }

  private initPosition(): void {
    if (this.NextSig !== null) this.NextSig.TrainLooking = null;
    this.NextSig = null;
    this.installNextSig();
    this.dlg.lastSigName = "None";
    this.dlg.lastSigState = "";
    this.updateSwitches();
    this.updatePositionReport();
    this.computeNextMotion();
    this.checkHalted();
  }

  private checkHalted(): void {
    /* Mac: nothing to do (Reverse is never disabled) */
  }

  /* ---- motion ---- */
  private observance(): void {
    let targetSpeed = 0.0;
    if (this.NextSig === null) targetSpeed = this.LastTargetSpeed;
    else
      switch (this.NextSig.computeState()) {
        case "G":
          targetSpeed = this.Cruise;
          break;
        case "Y":
          targetSpeed = trainCfg.YellowFeetPerSecond;
          break;
        case "R":
          targetSpeed = 0;
          break;
        default:
          throw new Error("No signal state at train Observance time?");
      }
    this.LastTargetSpeed = targetSpeed;
    if (targetSpeed === this.Speed) return;

    const nextLoc = this.NextSig === null ? this.front.x + 100.0 : this.X_Of_Next_Signal;
    let s = (nextLoc - this.front.x) * 100.0;
    if (targetSpeed === 0.0) s -= HaltSpaceBeforeStopSignal;
    if (s < 0.0) {
      this.setSpeed(0.0);
      return;
    }
    let accel = (targetSpeed * targetSpeed - this.Speed * this.Speed) / (2.0 * s);
    if (accel > MAX_ACCEL) accel = MAX_ACCEL;
    else if (accel < MIN_ACCEL) accel = MIN_ACCEL;
    let newSpeed = this.Speed + accel * INTVL_SECS;
    if (newSpeed < 1.5) newSpeed = 0;
    if (newSpeed !== this.Speed) this.setSpeed(newSpeed);
  }

  /** This method will DELETE THIS TRAIN when tripped (or run off the map). */
  private computeNextMotion(): void {
    const now = scheduler.now;
    const interval = (now - this.Time) | 0;
    const move = (interval * (this.Speed / 100.0)) / 1000.0;
    const flength = this.Length / 100.0;
    this.front.x += move;
    this.back.x = this.front.x - flength;
    this.Time = now;
    const tripstop = this.NextSig !== null && this.NextSig.TStop !== null && this.NextSig.TStop.Tripping;
    const wasNextSig = this.NextSig;
    this.installNextSig();
    if (!this.computeOccupations()) {
      this.vanish();
      return;
    }
    if (this.observant) this.observance();
    this.updatePositionReport();
    if (wasNextSig !== this.NextSig && tripstop) {
      if (!(wasNextSig!.aK_p() && this.Speed < 5.0)) {
        this.trip(wasNextSig!);
        return; /* deleted THIS */
      }
    }
    if (this.Speed > 0.0) {
      if (!this.TimerPending) {
        this.TimerPending = true;
        scheduler.nxTimer(this, Train.staticTimerHandler, INTVL_MS);
      }
    }
  }

  private trip(g: Signal): void {
    this.observant = false;
    this.updateSwitches();
    this.setSpeed(0.0);
    const msg =
      `Train #${this.id} has overrun signal ${g.compactName()} and been tripped ` +
      "by its automatic train stop. This train will be destroyed.";
    if (trainHooks.tripped) trainHooks.tripped(this, msg);
    else host().messageBox(msg, PRODUCT_NAME + " Train Manager", "ok");
    this.vanish();
  }

  static staticTimerHandler(o: unknown): void {
    const t = o as Train;
    if (!t.alive) return;
    t.timerHandler();
  }

  timerHandler(): void {
    if (!this.TimerPending) throw new Error("assertion failed: Timer handler called with no apparent timer pending on this train.");
    this.TimerPending = false;
    this.computeNextMotion(); /* can vanish the Train */
  }

  /** Signal hook callback (C++ Train::MaybeNoticeSignalChange) */
  maybeNoticeSignalChange(g: Signal): void {
    if (this.findNextSig() !== g) return; /* the great void (as it were) is unsignalled ... */
    this.reportSig(g, "next");
    if (this.observant) this.computeNextMotion(); /* MUST BE LAST CALL */
  }

  checkNextSigEQ(g: Signal): boolean {
    return this.NextSig === g;
  }

  private killTimer(): void {
    scheduler.killOneTimer(this);
    this.TimerPending = false;
  }

  /** C++ Train::vanish(): erase from the map, which destroys the train. */
  vanish(): void {
    if (!this.alive) return;
    if (Trains.get(this.id) === this) Trains.delete(this.id);
    this.destroy();
  }

  /** C++ ~Train() */
  destroy(): void {
    this.alive = false;
    for (const ts of [...this.Occupied]) ts.decrementTrainOccupation();
    this.Occupied = [];
    if (this.NextSig !== null) this.NextSig.TrainLooking = null;
    this.killTimer();
    FreedTrainNumbers.push(this.id);
    trainHooks.removed?.(this);
  }

  private reverse(): void {
    const t = this.front;
    this.front = this.back;
    this.back = t;
    this.front.IAmFront = true;
    this.back.IAmFront = false;
    this.front.reverse(0.0);
    this.back.reverse(this.front.x - this.Length / 100.0);
    this.initPosition();
    if (this.alive && this.NextSig && this.NextSig.XlkgNo !== 0) trySignalIDBox(this.NextSig.XlkgNo);
  }

  command(cmd: number): boolean {
    switch (cmd) {
      case TRD_HALT:
        this.observant = false;
        this.updateSwitches();
        this.setSpeed(0.0);
        return true;
      case TRD_REV:
        this.reverse();
        return true;
      case TRD_KILL:
        this.vanish();
        return true;
      case TRD_OBSERVANT:
        this.observant = true;
        this.updateSwitches();
        this.computeNextMotion(); /* MUST BE LAST CALL */
        return true;
      case TRD_DEFIANT:
        this.observant = false;
        this.updateSwitches();
        this.computeNextMotion(); /* MUST BE LAST CALL */
        return true;
      case TRD_COPB:
        if (this.NextSig !== null && this.NextSig.TStop !== null) {
          this.NextSig.TStop.pressStopPB();
          this.computeNextMotion(); // 9-9-2014
        }
        return true;
      case TRD_MINIMIZE:
        this.dlg.window = "minimized";
        trainHooks.showWindow?.(this, "minimized", false);
        this.touch();
        return true;
      case TRD_RESTORE:
        this.dlg.window = "normal";
        trainHooks.showWindow?.(this, "restore", false);
        this.touch();
        return true;
      default:
        return false;
    }
  }

  setSpeedFractional(fraction: number): void {
    this.explicitSpeed(fraction * this.Cruise);
  }

  explicitSpeed(speed: number): void {
    const wasSpeed = this.Speed;
    speed = Math.min(this.Cruise, Math.max(0.0, speed));
    if (speed < this.Cruise / 100.0) speed = 0.0;
    this.Speed = speed;
    this.updatePositionReport();
    this.checkHalted();
    if (this.Speed === 0.0 && wasSpeed !== 0.0) this.killTimer();
    if (wasSpeed === 0.0 && this.Speed !== 0.0) this.computeNextMotion(); /* must be LAST CALL */
  }

  setSpeed(spd: number): void {
    if (Math.abs(spd) < 1.0) spd = 0.0;
    this.Speed = spd;
    if (this.Speed === 0.0) this.killTimer();
    this.checkHalted();
    this.updatePositionReport();
  }

  /** C++ ShowWindowIfOwnTU */
  showWindowIfOwnTU(tu: TrackSeg): boolean {
    if (this.Occupied.includes(tu)) {
      this.dlg.window = "normal";
      trainHooks.showWindow?.(this, "restore", true);
      this.touch();
      return true;
    }
    return false;
  }
}

/* ---- C++ free functions ---- */

/** TrainSigHook */
function trainSigHook(g: Signal, v: unknown): void {
  const t = v as Train;
  if (!t || !t.alive || Trains.get(t.id) !== t || !t.checkNextSigEQ(g)) {
    /* I don't know how this happens (hook gets left over), but program around it. */
    g.TrainLooking = null;
  } else t.maybeNoticeSignalChange(g);
}
Signal.uiHooks.trainSigHook = trainSigHook;

export function verifyTrackSelectionAcceptability(ts: TrackSeg): boolean {
  if (ts.Ends[0].Next !== null && ts.Ends[1].Next !== null) {
    host().messageBox(
      "Selected track section is not an end-of-track; one is required.",
      PRODUCT_NAME + " train manager",
      "ok",
    );
    return false;
  }
  return true;
}

export function findTrainEntryTrackSectionByNomenclature(id: number): TrackSeg | null {
  return mapFindGraphicObjectsOfType(TypeId.TRACKSEG, (g) => {
    const ts = g as TrackSeg;
    if (ts.Ends[0].Joint && ts.Ends[0].Joint.Nomenclature === id) return 1;
    if (ts.Ends[1].Joint && ts.Ends[1].Joint.Nomenclature === id) return 1;
    return 0;
  }) as TrackSeg | null;
}

function makeTrainN(trainNo: number, tk: GraphicObject, options: number): Train {
  if (trainNo === 0) throw new Error("assertion failed: train_no != 0");
  if (Trains.has(trainNo)) throw new Error("assertion failed: Trains.count(train_no) == 0");
  /* In C++ the map slot exists (null) while the constructor runs. */
  const t = new Train(trainNo, tk, options);
  if (t.alive) {
    Trains.set(trainNo, t);
    trainHooks.created?.(t);
  }
  return t;
}

/** Track sections where a train may be started (one end is the end of the track). */
export function trainEntryPoints(): { seg: TrackSeg; ij: number; tc: number }[] {
  const out: { seg: TrackSeg; ij: number; tc: number }[] = [];
  mapFindGraphicObjectsOfType(TypeId.TRACKSEG, (g) => {
    const ts = g as TrackSeg;
    for (const e of ts.Ends) {
      if (e.Next === null && e.Joint && e.Joint.Nomenclature) {
        out.push({ seg: ts, ij: e.Joint.Nomenclature, tc: ts.TCNO });
        break;
      }
    }
    return 0;
  });
  return out.filter((e) => e.tc !== 0);
}

/** C++ TrainDialog(g, haltctl): the interactive "new train" at a chosen track section. */
export function trainDialog(g: GraphicObject, haltctl: number): Train | null {
  if (!verifyTrackSelectionAcceptability(g as TrackSeg)) return null;
  const n = FreedTrainNumbers.length ? FreedTrainNumbers.pop()! : TrainNoMax + 1;
  return makeTrainN(n, g, haltctl & TRAIN_HALTCTL_HALTED ? TRAIN_CTL_HALTED : 0);
}

/** C++ TrainMiscCtl */
export function trainMiscCtl(cmd: number): void {
  if (cmd === CmKillTrains) {
    for (const k of [...Trains.keys()].sort((a, b) => b - a)) {
      const t = Trains.get(k);
      if (t) t.vanish();
    }
  } else {
    for (const t of allTrains()) {
      switch (cmd) {
        case CmHaltTrains:
          t.setSpeed(0.0);
          break;
        case CmHideTrainWindows:
          t.dlg.window = "minimized";
          trainHooks.showWindow?.(t, "minimized", false);
          break;
        case CmShowTrainWindows:
          t.dlg.window = "normal";
          trainHooks.showWindow?.(t, "normal", false);
          break;
        default:
          break;
      }
    }
  }
}

/** Forget every train without side effects (fresh "process" for tests). */
export function discardTrains(): void {
  for (const t of Trains.values()) {
    t.alive = false;
    scheduler.killOneTimer(t);
  }
  Trains.clear();
  FreedTrainNumbers.length = 0;
  TrainNoMax = 0;
}

/** C++ WindowToTopFromTrackUnit */
export function windowToTopFromTrackUnit(tu: TrackSeg): boolean {
  for (const t of allTrains()) if (t.showWindowIfOwnTU(tu)) return true;
  return false;
}

/* ---- automation (trainaut.h) ---- */
const TrainAutoCmds: [string, number][] = [
  ["OBSERVANT", TRD_OBSERVANT],
  ["FREEWILL", TRD_DEFIANT],
  ["REVERSE", TRD_REV],
  ["HALT", TRD_HALT],
  ["KILL", TRD_KILL],
  ["CALLON", TRD_COPB],
  ["MINIMIZE", TRD_MINIMIZE],
  ["HIDE", TRD_HIDE],
  ["RESTORE", TRD_RESTORE],
];

export function trainAutoCreate(trainNo: number, trackIdNo: number, options: number): number {
  const tk = findTrainEntryTrackSectionByNomenclature(trackIdNo);
  if (!tk) {
    usermsgstop(`Invalid train starting track end IJ # in demo form: ${trackIdNo}`);
    return 0;
  }
  if (Trains.has(trainNo)) {
    usermsgstop(`Train number already in use: ${trainNo}`);
    return 0;
  }
  makeTrainN(trainNo, tk, options);
  return trainNo;
}

export const trainAutoValidateTrainNo = (n: number): boolean => Trains.has(n);

export function trainAutoCmd(n: number, cmd: number): boolean {
  return trainAutoValidateTrainNo(n) && Trains.get(n)!.command(cmd);
}

export function trainAutoSetSpeed(n: number, speed: number): boolean {
  if (!trainAutoValidateTrainNo(n)) return false;
  Trains.get(n)!.explicitSpeed(speed);
  return true;
}

export function trainAutoGetSpeed(n: number): number {
  return trainAutoValidateTrainNo(n) ? Trains.get(n)!.speed : 0.0;
}

export function trainAutoLookupCommand(scmd: string): number | null {
  for (const [name, cmd] of TrainAutoCmds) if (name === scmd) return cmd;
  return null;
}

nxsysHooks.killTrains = () => trainMiscCtl(CmKillTrains);
nxsysHooks.discardTrains = discardTrains;
