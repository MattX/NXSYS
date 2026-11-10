/*
 * TrafficLever — port of NXSYS/trafficlever.cpp (non-TLEDIT) + TrafficLever::ProcessLoadComplete.
 * Includes Display(), DrawKnob() and TrafficLeverIndicator::Draw(). Geometry: wp_x/wp_y (center),
 * tlMetrics (KnobRadius, IndicatorRadius, IndicatorOffset, ...), Indicators[i].PlusMinusOne
 * (-1 = left, +1 = right), NormalIndex/ReverseIndex.
 */
import { GraphicObject, TypeId, nxgoState, textMetrics } from "./nxgo.js";
import { Glb, gdi } from "./geometry.js";
import { pulseToRelay, reportToRelay, type Relay } from "../relay/relay.js";
import { createQuislingRelay, relayState, setReporterIfExists } from "../relay/rlyapi.js";
import {
  DT_CENTER,
  DT_NOCLIP,
  DT_SINGLELINE,
  RGB,
  PS_SOLID,
  createPen,
  createSolidBrush,
  getStockObject,
  type Brush,
  type DC,
  type Pen,
  type Rect,
} from "../render/dc.js";
import { gdiObjs } from "../render/gdiobjects.js";

const NUM_DT_OPTS = DT_CENTER | DT_SINGLELINE | DT_NOCLIP;

export const TRAFLEV_LEFT = 0;
export const TRAFLEV_RIGHT = 1;

const BottomMargin = 2;
const Fuzz = 2;
export const tlMetrics = {
  NumHeight: 0,
  KnobRadius: 0,
  IndicatorRadius: 0,
  IndicatorOffset: 0,
  KnobAngle: Math.PI / 4,
  /** (int)ceil(KnobRadius * NXGO_Scale), fixed at InitTrafficLeverData time */
  BigRadius: 0,
  /** (int)ceil(IndicatorOffset * NXGO_Scale) */
  IndicOffsAdj: 0,
  /** TrafficLeverIndicator::DataInit results */
  rad: 0,
  doff: 0,
  arht: 0,
};
let BrightGray: Brush = createSolidBrush(RGB(192, 192, 192));
let LinePen: Pen = createPen(PS_SOLID, 1, RGB(0, 0, 0));

/** C++ InitTrafficLeverData */
export function initTrafficLeverData(): void {
  const gu = gdi.GU2; /* expected to be about 3 */
  tlMetrics.KnobRadius = 6 * gu;
  tlMetrics.IndicatorRadius = 3 * gu;
  tlMetrics.IndicatorOffset = 2 * tlMetrics.KnobRadius;
  tlMetrics.KnobAngle = Math.PI / 4;
  tlMetrics.BigRadius = Math.ceil(tlMetrics.KnobRadius * nxgoState.NXGO_Scale);
  tlMetrics.IndicOffsAdj = Math.ceil(tlMetrics.IndicatorOffset * nxgoState.NXGO_Scale);
  BrightGray = createSolidBrush(RGB(192, 192, 192));
  LinePen = createPen(PS_SOLID, 1, RGB(0, 0, 0));
  tlMetrics.NumHeight = textMetrics("1").height;
  /* TrafficLeverIndicator::DataInit */
  tlMetrics.rad = Math.ceil(tlMetrics.IndicatorRadius * nxgoState.NXGO_Scale);
  tlMetrics.doff = Math.ceil(tlMetrics.rad * 0.6 + 1);
  tlMetrics.arht = Math.ceil(tlMetrics.rad / 4.0);
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
  /** C++ TrafficLeverIndicator::Draw */
  draw(hdc: DC, l_xcen: number, y: number): void {
    const m = tlMetrics;
    const brush = this.White ? gdiObjs.GKWhiteBrush : this.Red ? gdiObjs.GKRedBrush : gdiObjs.GKOffBrush;
    hdc.selectObject(brush);
    const x = l_xcen + m.IndicOffsAdj * this.PlusMinusOne;
    const rad = m.rad;
    hdc.ellipse(x - rad, y - rad, x + rad, y + rad);
    hdc.selectObject(getStockObject("BLACK_BRUSH"));
    const rectht = m.arht;
    const xvleft = Math.trunc(x + this.PlusMinusOne * Math.floor(m.doff * 0.6)); // "virtual" left...
    const xvright = Math.trunc(x - this.PlusMinusOne * m.doff);
    hdc.rectangle(xvleft, y - rectht + 1, xvright, y + rectht - 1);
    hdc.polygon([
      { x: Math.trunc(xvleft + this.PlusMinusOne * Math.floor(m.doff / 2)), y },
      { x: xvleft, y: y + m.arht },
      { x: xvleft, y: y - m.arht },
    ]);
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

  override drawNomenclature(): number {
    return this.XlkgNo;
  }

  /** C++ TrafficLever::Display */
  override display(hdc: DC): void {
    const m = tlMetrics;
    const brush = BrightGray;
    const rad = m.BigRadius;
    const tr: Rect = { left: 0, right: 0, top: 0, bottom: 0 };
    tr.top = this.sc_y + rad + BottomMargin;
    tr.bottom = tr.top + m.NumHeight;
    tr.left = this.sc_x - rad;
    tr.right = this.sc_x + rad;
    hdc.drawText(this.NumString, tr, NUM_DT_OPTS);

    hdc.selectObject(brush);
    hdc.selectObject(getStockObject("NULL_PEN")); /* moved up 12 May 2001 */
    hdc.ellipse(this.sc_x - rad, this.sc_y - rad, this.sc_x + rad, this.sc_y + rad);

    this.drawKnob(hdc);

    for (const indic of this.Indicators) indic.draw(hdc, this.sc_x, this.sc_y);
  }

  /** C++ TrafficLever::LocateKnobPoint */
  private locateKnobPoint(radius: number, angle: number): { x: number; y: number } {
    return {
      x: Math.trunc(this.sc_x + radius * Math.sin(angle)),
      y: Math.trunc(this.sc_y - radius * Math.cos(angle)),
    };
  }

  /** C++ TrafficLever::DrawKnob */
  drawKnob(hdc: DC): void {
    const m = tlMetrics;
    const angle = this.knobAngle();
    hdc.selectObject(getStockObject("BLACK_BRUSH"));
    const trad = Math.trunc(m.KnobRadius * 0.25 * nxgoState.NXGO_Scale + 0.8);
    const irad = m.BigRadius - trad;
    const c = this.locateKnobPoint(irad, angle);
    hdc.ellipse(c.x - trad, c.y - trad, c.x + trad, c.y + trad);
    const botang = angle + Math.PI;
    const bot = this.locateKnobPoint(m.BigRadius, botang);
    hdc.selectObject(LinePen);
    const PZ = 2 * m.BigRadius - trad;
    // PU::PT = PT::PZ  (trad = PT)
    const PU = trad * (trad / PZ);
    const UO = m.BigRadius - trad - PU;
    const UZ = UO + m.BigRadius;
    const TU = Math.sqrt(PU * UZ); // rt tri PTZ altitude
    const ctrangtap = Math.atan2(TU, UO);
    const tradhyp = Math.hypot(TU, UO);
    let tp = this.locateKnobPoint(tradhyp, angle + ctrangtap);
    hdc.moveTo(bot.x, bot.y);
    hdc.lineTo(tp.x, tp.y);
    tp = this.locateKnobPoint(tradhyp, angle - ctrangtap);
    hdc.moveTo(bot.x, bot.y);
    hdc.lineTo(tp.x, tp.y);
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
