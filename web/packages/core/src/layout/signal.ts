/*
 * Signal, SigHead, PanelSignal, Stop.
 * Port of NXSYS/signal.cpp (logic object), fullsig.cpp (ComputeState/SigHead only),
 * v2/xsignal.cpp (PanelSignal geometry), stop.cpp + v2/xstop.cpp (trip stop), and the
 * ProcessLoadComplete methods of rdtrkcmn.cpp.
 *
 * UI-only parts omitted: full-signal window drawing, context menus. Their entry points are
 * hooks (Signal.uiHooks). The panel drawing (PanelSignal::Display/DrawFleeting, Stop::Display,
 * Signal::GetGKBrush) is ported; the full-signal window drawing (fullsig.cpp) is not.
 */
import {
  GraphicObject,
  NXGOLabel,
  TypeId,
  WM_LBUTTONDOWN,
  WM_NXGO_LBUTTONCONTROL,
  WM_NXGO_LBUTTONSHIFT,
  WM_NXGO_RBUTTONCONTROL,
  WM_RBUTTONDOWN,
  WPXtoSC,
  WPYtoSC,
  computeVisibleObjectsLast,
  mapGraphicObjectsOfType,
  nxgoState,
} from "./nxgo.js";
import type { Brush, DC } from "../render/dc.js";
import { getStockObject } from "../render/dc.js";
import { gdiObjs } from "../render/gdiobjects.js";
import { Glb, TSEX, f32, gdi } from "./geometry.js";
import type { TrackSeg } from "./xtgtrack.js";
import { nxCoder, killOneCoder, nxFastCoder, killOneFastCoder } from "../clock/coders.js";
import {
  pulseToRelay,
  relayClicks,
  relayUseDefined,
  reportToRelay,
  createReportingRelay,
  type Relay,
} from "../relay/relay.js";
import {
  createAndSetReporter,
  createQuislingRelay,
  getRelay2NoCreate,
  reportingRelayNoCreate,
  setReporterIfExists,
} from "../relay/rlyapi.js";
import { internRlysym } from "../lisp/types.js";

export const SIGF_CO = 0x001;
export const SIGF_LUNAR = 0x002; /* actual control of light */
export const SIGF_S = 0x004;
export const SIGF_D = 0x008;
export const SIGF_LUNAR_WHEN_RED = 0x010; /* must be and'ed with "red" */
export const SIGF_STR = 0x020; /* must be and'ed with "red" */
export const SIGF_CODING = 0x100;
export const SIGF_HARDWIRE_COCLK = 0x200;

/** Show-stop policy (ssdlg.h). */
export const SHOW_STOPS_RED = 200;
export const SHOW_STOPS_ALWAYS = 201;
export const SHOW_STOPS_NEVER = 202;
export const stopState = { ShowStopPolicy: SHOW_STOPS_RED, StopsChanging: 0 };

const SigWinInterCenter = 25;
const SigWinTopToFirstCenter = 15;
const SigWinInterHead = 5;
const SigWinPipeExtra = 20;
const SigWinHeadWidth = 30;

/** Global set by rdtrkcmn.cpp (CPB0), used by DropAllSignals. */
export const signalGlobals = { CPB0: null as Relay | null };

export class SigHead {
  State = "X";
  height: number;
  constructor(
    public Lights: string,
    public Plate: string,
  ) {
    this.height = Lights.length;
  }
  unitHeight(): number {
    return 2 * SigWinTopToFirstCenter + (this.height - 1) * SigWinInterCenter + (this.Plate[0] ? SigWinHeadWidth : 0);
  }
}

export class Signal {
  Heads: SigHead[] = [];
  PSignal: PanelSignal | null = null;
  Selected = 0;
  Coding = 0;
  NumW = 0;
  Fleeted = false;
  /** the full-signal window (UI); non-null means "open" */
  Window: unknown = null;
  HG = 0;
  HVG = 0;
  DG = 0;
  DivG = 0;
  MiscG = 0;
  PB: Relay | null = null;
  PBS: Relay | null = null;
  FL: Relay | null = null;
  COPB: Relay | null = null;
  TrainLooking: unknown = null;
  TStop: Stop | null = null;
  RealStationPos = 0;

  /** UI hooks (Phase 2+): right-click without context-menu mode shows the full-signal window. */
  static uiHooks: {
    showFullsigWindow?: (s: Signal, show: boolean) => void;
    contextMenu?: (s: Signal) => void;
    /** C++ TrainSigHook(Signal*, void* train) — Phase 4 */
    trainSigHook?: (s: Signal, train: unknown) => void;
  } = {};
  /** C++ SignalRIsMenu */
  static SignalRIsMenu = false;

  constructor(
    public XlkgNo: number,
    public StationNo: number,
    headstrings: string[],
  ) {
    let first = true;
    for (const headstring of headstrings) {
      const plate = this.formatPlate(headstring, first);
      this.Heads.push(new SigHead(headstring, plate));
      first = false;
    }
  }

  private formatPlate(lights: string, first: boolean): string {
    if (first) {
      const { routid, trkno, stano } = this.getPlateData();
      if (Glb.IRTStyle) return `${10 * stano + trkno}\n${routid}`;
      else return `${routid}${trkno}\n${stano}`;
    } else if (this.XlkgNo > 0 && lights.length > 2) return `X\n${this.XlkgNo}`;
    return "";
  }

  compactName(): string {
    const { routid, trkno, stano } = this.getPlateData();
    if (Glb.IRTStyle) return `${stano * 10 + trkno}/${routid}`;
    return `${routid}${trkno}-${stano}`;
  }

  getPlateData(): { routid: string; trkno: number; stano: number } {
    let trkno: number;
    let stano: number;
    if (Glb.IRTStyle) {
      trkno = this.StationNo % 10;
      stano = Math.trunc(this.StationNo / 10);
    } else {
      trkno = 0;
      stano = this.StationNo;
      for (let j = 10000; j >= 10; j = Math.trunc(j / 10)) {
        if (this.StationNo >= j) {
          trkno = Math.trunc(this.StationNo / j);
          stano = this.StationNo % j;
          break;
        }
      } /* KLUUUUDGGEEE ++++++++++ */
    }
    return { routid: Glb.RouteIdentifier, trkno, stano };
  }

  aK_p(): number {
    if (this.XlkgNo === 0) return 1;
    for (const h of this.Heads) if (h.height > 1) return 0;
    let reds = 0;
    for (const c of this.Heads[0].Lights) if (c === "R") reds++;
    return reds < 2 ? 1 : 0;
  }

  unitHeight(): number {
    let u = 0;
    for (const h of this.Heads) {
      u += h.unitHeight();
      u += SigWinInterHead;
    }
    u += SigWinPipeExtra / 2;
    return u;
  }

  /** The aspect of each head: 'R','Y','G' for head 0; others lit letter or 'X' (dark). */
  computeState(): string {
    const clear = this.HG;
    this.Heads[0].State = clear ? (this.DG ? "G" : "Y") : "R";
    for (let i = 1; i < this.Heads.length; i++) {
      const h = this.Heads[i];
      if (h.height > 1) h.State = clear ? (this.DivG ? "Y" : "G") : "R";
      else {
        let lit: number | boolean;
        switch (h.Lights[0]) {
          case "S":
            lit = this.MiscG & SIGF_S && clear;
            break;
          case "D":
            lit = this.MiscG & SIGF_D && clear;
            break;
          case "Y":
            lit = this.MiscG & SIGF_CO;
            break;
          case "W":
            lit = this.MiscG & SIGF_LUNAR || (this.MiscG & SIGF_LUNAR_WHEN_RED && !clear);
            break;
          default:
            lit = 0;
        }
        h.State = lit ? h.Lights[0] : "X";
      }
    }
    return this.Heads[0].State;
  }

  homeP(): boolean {
    for (let hn = 1; hn < this.Heads.length; hn++) if (this.Heads[hn].height > 2) return true;
    return false;
  }

  canonicalNumber(): number {
    return this.XlkgNo ? this.XlkgNo : this.StationNo;
  }

  /** C++ Signal::GetGKBrush: the color of the head lamp on the panel */
  getGKBrush(): Brush {
    const yellow = !!this.Selected && !!(this.HG || this.MiscG & SIGF_CO);
    if (this.Coding === 2) return yellow ? gdiObjs.GKYellowBrush : gdiObjs.GKRedBrush;
    else if (this.Coding === 1) return gdiObjs.GKOffBrush;
    else if (!this.Selected) return gdiObjs.GKOffBrush;
    else if (yellow) return gdiObjs.GKYellowBrush;
    return gdiObjs.GKRedBrush;
  }

  invalidate(): void {
    this.PSignal!.invalidate();
    this.updateLights();
  }

  updateLights(): void {
    this.reportToHook();
  }

  reportToHook(): void {
    if (this.TrainLooking !== null) Signal.uiHooks.trainSigHook?.(this, this.TrainLooking);
  }

  updateStop(): void {
    if (this.Window) this.invalidate();
  }

  private shouldBeCoding(): number {
    if (this.MiscG & SIGF_HARDWIRE_COCLK)
      if (!(this.MiscG & SIGF_CO && this.TStop!.Tripping)) Signal.clkReporter(false, this);
    return this.MiscG & SIGF_CODING;
  }

  gkCoder(state: boolean): void {
    if (!this.PSignal!.Visible) return;
    if (this.shouldBeCoding()) {
      this.Coding = state ? 1 : 2;
      this.invalidate();
    } else this.invalidate();
  }

  cancel(): boolean {
    if (this.PB) reportToRelay(this.PB, false);
    if (this.Fleeted) this.fleet(false);
    if (this.PBS) reportToRelay(this.PBS, false);
    return true;
  }

  unHit(): void {
    reportToRelay(this.PB, false);
  }

  initiate(): boolean {
    if (this.XlkgNo === 0) return false;
    pulseToRelay(this.PB);
    return this.initiated();
  }

  initiated(): boolean {
    return !!(this.PBS && this.PBS.state);
  }

  initiateClick(): boolean {
    if (this.XlkgNo === 0) return false;
    const clicks = relayClicks;
    const wasSelected = this.Selected;
    this.PSignal!.wantMouseUp();
    reportToRelay(this.PB, true);
    if (wasSelected)
      /* Whoops - must test for UR exit feature */
      if (relayClicks < clicks + 2) this.cancel();
    return true;
  }

  callOn(): boolean {
    if (!relayUseDefined(this.COPB)) return false;
    pulseToRelay(this.COPB);
    return true;
  }

  fleet(onoff: boolean): boolean {
    if (!relayUseDefined(this.FL)) return false;
    if (this.Fleeted !== onoff) {
      this.Fleeted = onoff;
      reportToRelay(this.FL, this.Fleeted);
      this.invalidate();
    }
    return true;
  }

  resetApproach(): boolean {
    if (!this.XlkgNo) return false;
    const U = getRelay2NoCreate(this.XlkgNo, "U");
    if (U) {
      pulseToRelay(U);
      return true;
    }
    return false;
  }

  /** Mouse commands (WM_ values from nxgo.ts). Right-click UI behaviours go through uiHooks. */
  hit(mb: number): void {
    switch (mb) {
      case WM_LBUTTONDOWN:
        this.initiateClick();
        break;
      case WM_NXGO_LBUTTONSHIFT:
        this.fleet(!this.Fleeted); /* checks FL defined */
        if (this.Fleeted && !this.Selected) this.initiate();
        break;
      case WM_NXGO_LBUTTONCONTROL:
        this.callOn();
        break;
      case WM_NXGO_RBUTTONCONTROL:
        Signal.uiHooks.contextMenu?.(this);
        break;
      case WM_RBUTTONDOWN:
        if (Signal.SignalRIsMenu) Signal.uiHooks.contextMenu?.(this);
        else Signal.uiHooks.showFullsigWindow?.(this, true);
        break;
      default:
        Signal.uiHooks.showFullsigWindow?.(this, true);
        break;
    }
  }

  /* ---- relay reporters ---- */
  static hReporter(state: boolean, v: unknown): void {
    const g = v as Signal;
    g.HG = state ? 1 : 0;
    g.invalidate();
  }
  static dReporter(state: boolean, v: unknown): void {
    const g = v as Signal;
    g.DG = state ? 1 : 0;
    g.updateLights();
  }
  static divReporter(state: boolean, v: unknown): void {
    const g = v as Signal;
    g.DivG = state ? 1 : 0;
    g.updateLights();
  }
  static rReporter(state: boolean, v: unknown): void {
    const g = v as Signal;
    g.Selected = state ? 1 : 0;
    g.invalidate();
  }
  flagReporterCommon(flag: number, state: boolean): void {
    if (state) this.MiscG |= flag;
    else this.MiscG &= ~flag;
    this.updateLights();
  }
  static skReporter(state: boolean, v: unknown): void {
    (v as Signal).flagReporterCommon(SIGF_S, state);
  }
  static dkReporter(state: boolean, v: unknown): void {
    (v as Signal).flagReporterCommon(SIGF_D, state);
  }
  static strReporter(state: boolean, v: unknown): void {
    (v as Signal).flagReporterCommon(SIGF_STR, state);
  }
  static clkReporter(state: boolean, v: unknown): void {
    const g = v as Signal;
    if (state) {
      g.MiscG |= SIGF_CODING;
      nxCoder(g, Signal.gkCoderReporter);
    } else {
      if (g.MiscG & SIGF_CODING) killOneCoder(g);
      g.MiscG &= ~SIGF_CODING;
      g.Coding = 0;
    }
    g.invalidate();
  }
  static coReporter(state: boolean, v: unknown): void {
    const g = v as Signal;
    if (state) g.MiscG |= SIGF_CO;
    else g.MiscG &= ~SIGF_CO;
    if (g.MiscG & SIGF_HARDWIRE_COCLK)
      /* older implementation. */
      Signal.clkReporter(state, g);
    g.invalidate();
  }
  static lunarReporter(state: boolean, v: unknown): void {
    (v as Signal).flagReporterCommon(SIGF_LUNAR, state);
  }
  static lunarWhenRedReporter(state: boolean, v: unknown): void {
    const g = v as Signal;
    if (state) g.MiscG |= SIGF_LUNAR_WHEN_RED;
    else g.MiscG &= ~SIGF_LUNAR_WHEN_RED;
    if (g.computeState() === "R") g.updateLights();
  }
  static gkCoderReporter(v: unknown, state: boolean): void {
    (v as Signal).gkCoder(state);
  }
  static sigStateExt(s: Signal): void {
    s.computeState();
  }

  /** Signal::ProcessLoadComplete (rdtrkcmn.cpp). */
  processLoadComplete(): void {
    const gno = this.canonicalNumber();
    /*pbs/bpbs gets done below */
    if (this.XlkgNo) {
      this.PB = createQuislingRelay(gno, "PB");
      this.FL = createQuislingRelay(gno, "FL");
    } else this.Selected = 1; /* auto: interlocking, not NXGO sense */

    const interlocked = this.XlkgNo !== 0;

    for (let hn = 1; hn < this.Heads.length - 1; hn++) {
      if (this.Heads[hn].height > 2) {
        createAndSetReporter(gno, "DR", Signal.divReporter, this);
        this.COPB = createQuislingRelay(gno, "COPB");
        createAndSetReporter(gno, "CO", Signal.coReporter, this);
      }
      switch (this.Heads[hn].Lights[0]) {
        case "S":
          createAndSetReporter(gno, "SK", Signal.skReporter, this);
          break;
        case "D":
          createAndSetReporter(gno, "DK", Signal.dkReporter, this);
          break;
      }
    }
    if (this.TStop) this.TStop.processLoadComplete();

    if (interlocked) {
      if (!setReporterIfExists(gno, "CLK", Signal.clkReporter, this))
        if (gno && getRelay2NoCreate(gno, "CO")) this.MiscG |= SIGF_HARDWIRE_COCLK;
    }
    setReporterIfExists(gno, "LH", Signal.lunarReporter, this);

    /* use HV/DV if we've got 'em */
    if (!setReporterIfExists(gno, "HV", Signal.hReporter, this)) setReporterIfExists(gno, "H", Signal.hReporter, this);

    if (!setReporterIfExists(gno, "DV", Signal.dReporter, this)) setReporterIfExists(gno, "D", Signal.dReporter, this);

    /* If PBS is not defined, search for BPBS; if neither, create PBS */
    if (interlocked && this.PBS === null) {
      let r = reportingRelayNoCreate(gno, "PBS");
      if (r === null) r = reportingRelayNoCreate(gno, "BPBS");
      if (r === null) r = createReportingRelay(internRlysym(gno, "PBS"));
      r.setReporter(Signal.rReporter, this);
      this.PBS = r;
    }
    setReporterIfExists(gno, "SH", Signal.lunarWhenRedReporter, this);
    setReporterIfExists(gno, "STR", Signal.strReporter, this);
  }
}

/** C++ DropAllSignals */
export function dropAllSignals(): void {
  mapGraphicObjectsOfType(TypeId.SIGNAL, (go) => {
    (go as PanelSignal).Sig.cancel();
    return 0;
  });
  if (signalGlobals.CPB0 !== null) pulseToRelay(signalGlobals.CPB0);
}

/* ------------------------------------------------------------------------------------------ */

export class PanelSignal extends GraphicObject {
  /** track-aligned rel to IJ */
  TRelX = 20;
  TRelY = 15;
  /** head radius */
  Radius = 8;
  Label: NXGOLabel | null = null;

  constructor(
    public Seg: TrackSeg,
    public EndIndex: TSEX,
    public Sig: Signal,
  ) {
    super();
    Sig.PSignal = this;
    this.reposition();
    this.setXlkgNo(Sig.XlkgNo, false);
    this.makeSelfVisible();
    if (Sig.TStop) Sig.TStop.reposition();
  }

  override typeID(): TypeId {
    return TypeId.SIGNAL;
  }

  override drawNomenclature(): number {
    return this.Sig ? this.Sig.XlkgNo : 0;
  }

  /** C++ PanelSignal::Display */
  override display(dc: DC): void {
    const ra = Math.trunc(this.Radius * nxgoState.NXGO_Scale);
    const rLeft = this.sc_x - ra;
    const rRight = this.sc_x + ra;
    const rTop = this.sc_y - ra;
    const rBottom = this.sc_y + ra;

    if (!this.Sig.Fleeted) this.drawFleeting(dc, false);
    dc.selectObject(getStockObject("NULL_PEN"));
    dc.selectObject(this.Sig.getGKBrush());
    dc.ellipse(rLeft, rTop, rRight, rBottom);

    const { costheta, sintheta } = this.getAngles();
    const fxc = this.wp_x;
    const fyc = this.wp_y;
    const p = this.getDispPoints();
    /* costheta * Radius: float * long is a float product */
    const x0 = Math.trunc(fxc - f32(costheta * this.Radius));
    const y0 = Math.trunc(fyc - f32(sintheta * this.Radius));
    dc.selectObject(gdiObjs.SigPen);
    dc.moveTo(WPXtoSC(x0), WPYtoSC(y0));
    dc.lineTo(WPXtoSC(p.x2), WPYtoSC(p.y2));
    dc.moveTo(WPXtoSC(p.x1), WPYtoSC(p.y1));
    dc.lineTo(WPXtoSC(p.x3), WPYtoSC(p.y3));
    if (this.Sig.Fleeted) this.drawFleeting(dc, true);
  }

  /** C++ PanelSignal::DrawFleeting (the little triangle behind a fleeted signal) */
  drawFleeting(dc: DC, enabled: boolean): void {
    const { costheta, sintheta } = this.getAngles();
    const R = this.Radius;
    /* long - float: the subtraction itself is done in float */
    const fx0 = f32(this.wp_x - f32(costheta * R));
    const fy0 = f32(this.wp_y - f32(sintheta * R));
    const x0 = WPXtoSC(Math.trunc(fx0));
    const y0 = WPYtoSC(Math.trunc(fy0));
    /* costheta * Radius * FRAC: (float*long)=float, then * double constant */
    const dx4 = fx0 - f32(costheta * R) * FLEETING_TRIANGLE_HEIGHT_FRAC;
    const dy4 = fy0 - f32(sintheta * R) * FLEETING_TRIANGLE_HEIGHT_FRAC;
    const fb = (R * FLEETING_TRIANGLE_BASE_FRAC) / 2.0;
    const x1 = WPXtoSC(Math.trunc(dx4 + sintheta * fb));
    const y1 = WPYtoSC(Math.trunc(dy4 - costheta * fb));
    const x2 = WPXtoSC(Math.trunc(dx4 - sintheta * fb));
    const y2 = WPYtoSC(Math.trunc(dy4 + costheta * fb));
    dc.selectObject(getStockObject("NULL_PEN"));
    dc.selectObject(enabled ? gdiObjs.GKGreenBrush : getStockObject("BLACK_BRUSH"));
    dc.polygon([
      { x: x0, y: y0 },
      { x: x1, y: y1 },
      { x: x2, y: y2 },
    ]);
  }

  override isNomenclature(id: number): boolean {
    /* +++++ gonna need a lot of work with symbolic object names */
    return this.Sig.XlkgNo === id || (this.Sig.StationNo !== 0 && this.Sig.StationNo === id);
  }

  /** float cos/sin of the direction this signal faces away from (toward the track) */
  getAngles(): { costheta: number; sintheta: number } {
    if (this.EndIndex === TSEX.E0) return { costheta: this.Seg.CosTheta, sintheta: this.Seg.SinTheta };
    return { costheta: -this.Seg.CosTheta, sintheta: -this.Seg.SinTheta };
  }

  /** Points of the stem/crossbar glyph: stem x0,y0 -> x2,y2; bar x1,y1 -> x3,y3 (x0,y0 as in Display). */
  getDispPoints(): { x1: number; y1: number; x2: number; y2: number; x3: number; y3: number } {
    const { costheta, sintheta } = this.getAngles();
    const fxc = this.wp_x;
    const fyc = this.wp_y;
    const bu = Math.trunc(0.75 * this.Radius);
    const x2 = Math.trunc(fxc - costheta * (this.Radius + 1.5 * bu));
    const y2 = Math.trunc(fyc - sintheta * (this.Radius + 1.5 * bu));
    const x1 = Math.trunc(f32(x2 + f32(bu * sintheta)));
    const y1 = Math.trunc(f32(y2 - f32(bu * costheta)));
    const x3 = Math.trunc(f32(x2 - f32(bu * sintheta)));
    const y3 = Math.trunc(f32(y2 + f32(bu * costheta)));
    return { x1, y1, x2, y2, x3, y3 };
  }

  reposition(): void {
    const { costheta, sintheta } = this.getAngles();
    const E = this.Seg.getEnd(this.EndIndex);
    let fxc = E.wpx;
    let fyc = E.wpy;
    fxc += f32(costheta * this.TRelX);
    fyc += f32(sintheta * this.TRelX); /* point on tk corresp to sig head */
    const downcostheta = -sintheta;
    const downsintheta = costheta;
    fxc += f32(downcostheta * this.TRelY);
    fyc += f32(downsintheta * this.TRelY); /* signal head */
    this.moveWP(Math.trunc(fxc), Math.trunc(fyc));
    this.positionLabel(false);
    if (this.Sig && this.Sig.TStop) this.Sig.TStop.reposition();
  }

  override computeWPRect(): void {
    const L = this.wp_limits;
    L.right = L.left = L.top = L.bottom = 0;
    const R = this.Radius;
    this.limWPCoord(this.wp_x - R, this.wp_y - R);
    this.limWPCoord(this.wp_x - R, this.wp_y + R);
    this.limWPCoord(this.wp_x + R, this.wp_y + R);
    this.limWPCoord(this.wp_x + R, this.wp_y - R);
    const p = this.getDispPoints();
    this.limWPCoord(p.x1, p.y1);
    this.limWPCoord(p.x2, p.y2);
    this.limWPCoord(p.x3, p.y3);
  }

  limWPCoord(xw: number, yw: number): void {
    const x = xw - this.wp_x;
    const y = yw - this.wp_y;
    const L = this.wp_limits;
    if (x - 1 < L.left) L.left = x - 1;
    if (x + 1 > L.right) L.right = x + 1;
    if (y - 1 < L.top) L.top = y - 1;
    if (y + 1 > L.bottom) L.bottom = y + 1;
  }

  setXlkgNo(xlkgno: number, compvisible: boolean): void {
    if (this.Sig) this.Sig.XlkgNo = xlkgno;
    if (xlkgno === 0) {
      this.Label = null;
    } else {
      let lab = "";
      if (xlkgno >= 7000) {
        lab += String.fromCharCode(65 + (Math.trunc(xlkgno / 1000) - 7));
        lab += String(xlkgno % 1000);
      } else lab = String(xlkgno);
      if (this.Label === null) this.Label = new NXGOLabel(this, this.wp_x, this.wp_y, lab);
      else this.Label.setText(lab);
      this.positionLabel(compvisible);
    }
  }

  positionLabel(compvisible: boolean): void {
    if (this.Label === null) return;
    this.Label.invalidate();
    const { costheta, sintheta } = this.getAngles();
    const fullrad = this.Label.radius() + this.Radius + 1.5 * Math.trunc(0.75 * this.Radius);
    this.Label.positionCenter(Math.trunc(this.wp_x - costheta * fullrad), Math.trunc(this.wp_y - sintheta * fullrad));
    if (compvisible) {
      this.Label.computeVisibleLast();
      if (this.Label.Visible) computeVisibleObjectsLast();
    } else this.Label.computeVisibleLast();
    this.Label.invalidate();
  }

  override hit(mb: number): void {
    if (this.Sig) this.Sig.hit(mb);
  }
  override unHit(): void {
    if (this.Sig) this.Sig.unHit();
  }
  processLoadComplete(): void {
    this.Sig.processLoadComplete();
  }
}

/* ------------------------------------------------------------------------------------------ */

const FLEETING_TRIANGLE_BASE_FRAC = 0.75;
const FLEETING_TRIANGLE_HEIGHT_FRAC = 0.75;

const STOP_CODE_CLICKS_MAX = 6;

export class Stop extends GraphicObject {
  Tripping = true;
  NVP: Relay | null = null;
  RVP: Relay | null = null;
  VPB: Relay | null = null;
  coding = 0;
  code_clicks = 0;
  /** triangle vertices (panel coords) */
  x1 = 0;
  y1 = 0;
  x2 = 0;
  y2 = 0;
  x3 = 0;
  y3 = 0;

  constructor(public Sig: Signal) {
    super();
    Sig.TStop = this;
    this.reposition();
    this.makeSelfVisible();
  }

  override typeID(): TypeId {
    return TypeId.STOP;
  }

  override drawNomenclature(): number {
    return this.Sig ? this.Sig.XlkgNo : 0;
  }

  /** C++ Stop::Display (v2/xstop.cpp) */
  override display(dc: DC): void {
    const policy = stopState.ShowStopPolicy;
    if (policy === SHOW_STOPS_NEVER && !stopState.StopsChanging) return;

    let brush: Brush | ReturnType<typeof getStockObject> = this.Tripping ? gdiObjs.GKRedBrush : gdiObjs.GKYellowBrush;

    if (policy === SHOW_STOPS_NEVER) brush = getStockObject("BLACK_BRUSH");
    else if (this.coding) {
      if (this.code_clicks & 1) brush = getStockObject("BLACK_BRUSH");
    } else if (policy === SHOW_STOPS_RED && !this.Tripping) brush = getStockObject("BLACK_BRUSH");

    dc.selectObject(gdiObjs.NullPen);
    dc.selectObject(brush);
    dc.polygon([
      { x: WPXtoSC(this.x1), y: WPYtoSC(this.y1) },
      { x: WPXtoSC(this.x2), y: WPYtoSC(this.y2) },
      { x: WPXtoSC(this.x3), y: WPYtoSC(this.y3) },
    ]);
  }
  override isNomenclature(_n: number): boolean {
    return false;
  }
  /* stops should not get hit, or they make parts of exit lights invisible */
  override hitP(_x: number, _y: number): boolean {
    return false;
  }
  override mouseSensitive(): boolean {
    return false;
  }

  reposition(): void {
    const side = f32(10.0);
    const disp = f32(6.0);
    const alt = f32(side * f32(0.866));
    const coff = f32(alt / 3);
    const rad = f32(2 * coff);

    const ps = this.Sig.PSignal;
    if (ps === null) return;
    const { costheta, sintheta } = ps.getAngles();
    const ep = ps.Seg.getEnd(ps.EndIndex);

    let fx = f32(ep.wpx + f32(disp * costheta));
    let fy = f32(ep.wpy + f32(disp * sintheta));

    fx = f32(fx - f32(gdi.Track_Normal_Halfwidth * sintheta));
    fy = f32(fy + f32(gdi.Track_Normal_Halfwidth * costheta));

    this.x1 = Math.trunc(fx);
    this.y1 = Math.trunc(fy);

    const fx2 = f32(fx + f32(side * costheta));
    const fy2 = f32(fy + f32(side * sintheta));
    this.x2 = Math.trunc(fx2);
    this.y2 = Math.trunc(fy2);

    const fx3 = f32(f32(fx + fx2) / 2);
    const fy3 = f32(f32(fy + fy2) / 2);

    this.x3 = Math.trunc(f32(fx3 - f32(alt * sintheta)));
    this.y3 = Math.trunc(f32(fy3 + f32(alt * costheta)));

    this.wp_x = Math.trunc(f32(fx3 - f32(coff * sintheta)));
    this.wp_y = Math.trunc(f32(fy3 + f32(coff * costheta)));

    this.wp_limits.left = Math.trunc(-rad);
    this.wp_limits.right = Math.trunc(rad);
    this.wp_limits.top = Math.trunc(-rad);
    this.wp_limits.bottom = Math.trunc(rad);
    this.computeVisibleLast();
  }

  vReporter(state: boolean): void {
    this.Tripping = !state;

    if (this.NVP !== null) reportToRelay(this.NVP, false);
    if (this.RVP !== null) reportToRelay(this.RVP, false);
    this.code_clicks = 0;
    if (!this.coding) {
      this.coding = 1;
      nxFastCoder(this, Stop.stopCoderReporter);
    }
    this.invalidate();
    this.Sig.updateStop();
  }

  static vReporterReporter(state: boolean, v: unknown): void {
    (v as Stop).vReporter(state);
  }

  pressStopPB(): number {
    if (relayUseDefined(this.VPB)) {
      pulseToRelay(this.VPB);
      return 1;
    }
    return 0;
  }

  codingDisplay(): void {
    if (stopState.ShowStopPolicy !== SHOW_STOPS_NEVER) this.invalidate();
    this.Sig.updateStop();
  }

  stopCoder(_codestate: boolean): void {
    if (!this.coding) {
      killOneFastCoder(this);
      return;
    }
    if (this.code_clicks++ >= STOP_CODE_CLICKS_MAX) {
      killOneFastCoder(this);
      this.code_clicks = 0;
      this.coding = 0;
      this.codingDisplay();
      if (this.Tripping) {
        if (this.NVP) reportToRelay(this.NVP, true);
      } else if (this.RVP) reportToRelay(this.RVP, true);
    } else this.codingDisplay();
  }

  static stopCoderReporter(v: unknown, codestate: boolean): void {
    (v as Stop).stopCoder(codestate);
  }

  /** Stop::ProcessLoadComplete (rdtrkcmn.cpp). Runs twice per stop (from Signal's, then Stop's own pass). */
  processLoadComplete(): void {
    const gno = this.Sig.canonicalNumber();
    createAndSetReporter(gno, "V", Stop.vReporterReporter, this);
    /* now we need NVP/RVP even for autos ... */
    this.NVP = createQuislingRelay(gno, "NVP");
    this.RVP = createQuislingRelay(gno, "RVP");
    this.NVP.state = true;
    if (this.Sig.homeP()) this.VPB = createQuislingRelay(gno, "VPB");
  }
}

/** C++ ImplementShowStopPolicy (policy is SHOW_STOPS_*). */
export function implementShowStopPolicy(policy: number): void {
  if (policy > 0) {
    if (policy !== stopState.ShowStopPolicy)
      mapGraphicObjectsOfType(TypeId.STOP, (go) => {
        if (go.Visible) go.invalidate();
        return 0;
      });
    stopState.ShowStopPolicy = policy;
    stopState.StopsChanging = 1;
    stopState.StopsChanging = 0;
  }
}

