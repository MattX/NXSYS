/*
 * TrafficLever — port of NXSYS/trafficlever.cpp (non-TLEDIT) + TrafficLever::ProcessLoadComplete.
 * Display/knob drawing omitted. Geometry for a renderer: wp_x/wp_y (center), tlMetrics
 * (KnobRadius, IndicatorRadius, IndicatorOffset), Indicators[i].PlusMinusOne (-1 = left, +1 = right),
 * NormalIndex/ReverseIndex, knob angle rules in the C++ DrawKnob (KnobAngle = PI/4).
 */
import { GraphicObject, TypeId, nxgoState, textMetrics } from "./nxgo.js";
import { Glb, gdi } from "./geometry.js";
import { pulseToRelay, reportToRelay, type Relay } from "../relay/relay.js";
import { createQuislingRelay, relayState, setReporterIfExists } from "../relay/rlyapi.js";

export const TRAFLEV_LEFT = 0;
export const TRAFLEV_RIGHT = 1;

const BottomMargin = 2;
const Fuzz = 2;
export const tlMetrics = { NumHeight: 0, KnobRadius: 0, IndicatorRadius: 0, IndicatorOffset: 0, KnobAngle: Math.PI / 4 };

/** C++ InitTrafficLeverData */
export function initTrafficLeverData(): void {
  const gu = gdi.GU2; /* expected to be about 3 */
  tlMetrics.KnobRadius = 6 * gu;
  tlMetrics.IndicatorRadius = 3 * gu;
  tlMetrics.IndicatorOffset = 2 * tlMetrics.KnobRadius;
  tlMetrics.KnobAngle = Math.PI / 4;
  tlMetrics.NumHeight = textMetrics("1").height;
}

export class TrafficLeverIndicator {
  White = false;
  Red = false;
  Coding = false;
  Lever: TrafficLever | null = null;
  constructor(public PlusMinusOne: number) {}

  static whiteReporter(state: boolean, v: unknown): void {
    (v as TrafficLeverIndicator).setWhite(state);
  }
  static redReporter(state: boolean, v: unknown): void {
    (v as TrafficLeverIndicator).setRed(state);
  }
  setWhite(on: boolean): void {
    if (this.White !== on) this.Lever!.invalidate();
    this.White = on;
  }
  setRed(on: boolean): void {
    if (this.Red !== on) this.Lever!.invalidate();
    this.Red = on;
  }
}

export class TrafficLever extends GraphicObject {
  XlkgNo = 0;
  NormalIndex = 0;
  ReverseIndex = 0;
  Normal: boolean;
  Reverse: boolean;
  Indicators: TrafficLeverIndicator[] = [new TrafficLeverIndicator(-1), new TrafficLeverIndicator(1)];
  KnobLeft = false;
  KnobRight = false;
  TriState: boolean;
  NumString = "";
  NL: Relay | null = null;
  RL: Relay | null = null;

  constructor(xno: number, p_wpx: number, p_wpy: number, rightNormal: number) {
    super();
    this.Reverse = false;
    this.Normal = true;
    /* This is an optional route parameter, not a traffic lever parameter, in order
       to keep compatibly-coded interlockings and NXSYS versions compatible. */
    this.TriState = Glb.TrafficLeversTristate;
    const m = tlMetrics;
    this.wp_x = p_wpx;
    this.wp_y = p_wpy;
    this.wp_limits.left = -m.IndicatorOffset - m.IndicatorRadius - Fuzz;
    this.wp_limits.right = +m.IndicatorOffset + m.IndicatorRadius + Fuzz;
    this.wp_limits.top = -m.KnobRadius - Fuzz;
    this.wp_limits.bottom = m.KnobRadius + m.NumHeight + BottomMargin + Fuzz;

    for (const tli of this.Indicators) tli.Lever = this;
    this.setNormalReverseStatus(rightNormal);
    this.Normal = !this.TriState;
    this.Reverse = false;
    this.NL = this.RL = null;
    this.XlkgNo = 0;
    this.setXlkgNo(xno);
    this.KnobLeft = this.KnobRight = false;
  }

  private setNormalReverseStatus(rightNormal: number): void {
    this.NormalIndex = rightNormal ? TRAFLEV_RIGHT : TRAFLEV_LEFT;
    this.ReverseIndex = 1 - this.NormalIndex;
  }

  setXlkgNo(xno: number): void {
    this.XlkgNo = xno;
    this.NumString = String(xno);
  }

  initState(): void {
    if (this.TriState) pulseToRelay(this.NL);
    else reportToRelay(this.NL, true);
  }

  override typeID(): TypeId {
    return TypeId.TRAFFICLEVER;
  }
  override isNomenclature(id: number): boolean {
    return this.XlkgNo === id;
  }

  override hit(_mb: number): void {
    if (this.TriState) {
      this.wantMouseUp();
      const left = this.NormalIndex === TRAFLEV_LEFT;
      if (nxgoState.NXGOHitX < this.sc_x) {
        reportToRelay(left ? this.NL : this.RL, true);
        this.KnobLeft = true;
      } else {
        reportToRelay(left ? this.RL : this.NL, true);
        this.KnobRight = true;
      }
      this.invalidate();
    } else this.throwLever(!this.Reverse);
  }

  override unHit(): void {
    if (!this.TriState) throw new Error("assertion failed: TriState");
    this.KnobLeft = this.KnobRight = false;
    reportToRelay(this.NL, false);
    reportToRelay(this.RL, false);
    this.invalidate();
  }

  /** C++ TrafficLever::Throw (name "throw" is a TS keyword-ish; kept distinct). */
  throwLever(wantReverse: boolean): boolean {
    if (this.TriState) throw new Error("assertion failed: !TriState");
    if (wantReverse !== this.Reverse) {
      this.Reverse = wantReverse;
      if (this.Reverse) {
        reportToRelay(this.NL, false);
        reportToRelay(this.RL, true);
      } else {
        reportToRelay(this.RL, false);
        reportToRelay(this.NL, true);
      }
      this.invalidate();
    }
    return true;
  }

  /** Knob angle sign logic from DrawKnob, for a renderer. */
  knobAngle(): number {
    let angle = 0.0;
    if (relayState(this.NL)) angle = tlMetrics.KnobAngle;
    else if (relayState(this.RL)) angle = -tlMetrics.KnobAngle;
    else angle = 0.0;
    if (this.KnobLeft) angle = -tlMetrics.KnobAngle;
    else if (this.KnobRight) angle = tlMetrics.KnobAngle;
    else if (this.NormalIndex === TRAFLEV_LEFT) angle = -angle;
    return angle;
  }

  /** TrafficLever::ProcessLoadComplete (rdtrkcmn.cpp). */
  processLoadComplete(): void {
    this.RL = createQuislingRelay(this.XlkgNo, "RL");
    this.RL.state = false;
    this.NL = createQuislingRelay(this.XlkgNo, "NL");
    this.NL.state = false;
    const norm = this.Indicators[this.NormalIndex];
    const rev = this.Indicators[this.ReverseIndex];
    setReporterIfExists(this.XlkgNo, "NFK", TrafficLeverIndicator.whiteReporter, norm);
    setReporterIfExists(this.XlkgNo, "NFKR", TrafficLeverIndicator.redReporter, norm);
    setReporterIfExists(this.XlkgNo, "RFK", TrafficLeverIndicator.whiteReporter, rev);
    setReporterIfExists(this.XlkgNo, "RFKR", TrafficLeverIndicator.redReporter, rev);
    /* coding for some other day*/
  }
}
