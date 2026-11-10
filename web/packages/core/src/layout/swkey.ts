/*
 * SwitchKey — the N/R switch lever on the panel. Port of NXSYS/swkey.cpp (non-TLEDIT).
 * Includes Display(); metrics are in swkeyMetrics (set by initSwitchKeyData).
 */
import { GraphicObject, TypeId, objectUIHooks, WM_NXGO_RBUTTONCONTROL, WM_RBUTTONDOWN, mapGraphicObjectsOfType, nxgoState, textMetrics } from "./nxgo.js";
import { gdi } from "./geometry.js";
import { DT_CENTER, DT_NOCLIP, DT_SINGLELINE, DT_VCENTER, RGB, TRANSPARENT, getStockObject, type DC, type Rect } from "../render/dc.js";
import { gdiObjs } from "../render/gdiobjects.js";
import { TN_AUXKEY_FORCE_NORMAL, TN_AUXKEY_FORCE_REVERSE, Turnout } from "./turnout.js";
import { reportToRelay, type Relay } from "../relay/relay.js";
import { relayState, setReporterIfExists } from "../relay/rlyapi.js";

const LIGHT_LEGEND_DT_OPTS = DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOCLIP;
const NUM_DT_OPTS = DT_CENTER | DT_SINGLELINE | DT_NOCLIP;

const Margin = 3;
const BottomMargin = 2;
export const swkeyMetrics = { Top: 0, Bottom: 0, Width: 0, Height: 0, NumHeight: 0, LKRadius: 0, LKOffset: 0, Margin, BottomMargin };

/** C++ InitSwitchKeyData (called at the start of every layout load). */
export function initSwitchKeyData(): void {
  const m = swkeyMetrics;
  const gu = gdi.GU2; /* expected to be about 3 */
  m.Width = 6 * gu;
  m.Height = m.Width * 2;
  m.LKRadius = Math.trunc(1.7 * gu);
  m.LKOffset = Math.trunc(1.5 * m.LKRadius);
  m.Top = 0;
  m.Bottom = m.Top + m.Height;
  m.NumHeight = textMetrics("1").height;
  m.Bottom += m.NumHeight + BottomMargin;
}

export class SwitchKey extends GraphicObject {
  NumStr = "";
  XlkgNo = 0;
  Normal = false;
  Reverse = false;
  HitWasControl = false;
  LSState = true;
  Turn: Turnout | null;
  ReporterRelay: Relay | null = null;

  constructor(t: Turnout | null, p_wpx: number, p_wpy: number) {
    super();
    this.Turn = t;
    const m = swkeyMetrics;
    this.wp_x = p_wpx;
    this.wp_y = p_wpy;
    this.wp_limits.left = -Margin;
    this.wp_limits.right = m.Width + Margin;
    this.wp_limits.top = -(m.LKRadius + m.LKOffset);
    this.wp_limits.bottom = m.Height + m.NumHeight + BottomMargin;

    if (this.Turn) this.setXlkgNo(this.Turn.XlkgNo);
    else this.setXlkgNo(0);
    this.associateTurnout(this.Turn);
  }

  static lsReporter(state: boolean, v: unknown): void {
    (v as SwitchKey).lsReport(state);
  }

  lsReport(state: boolean): void {
    this.LSState = state;
    Turnout.lsReporter(state, this.Turn);
    this.invalidate();
  }

  associateTurnout(t: Turnout | null): void {
    if (t) {
      this.ReporterRelay = setReporterIfExists(t.XlkgNo, "LK", SwitchKey.lsReporter, this);
      if (!this.ReporterRelay) this.ReporterRelay = setReporterIfExists(t.XlkgNo, "LS", SwitchKey.lsReporter, this);
      // Might still be null.
      this.setXlkgNo(t.XlkgNo);
    }
    this.Turn = t;
  }

  setXlkgNo(xno: number): void {
    this.XlkgNo = xno;
    this.NumStr = String(xno);
  }

  override drawNomenclature(): number {
    return this.XlkgNo;
  }

  /** C++ SwitchKey::Display */
  override display(hdc: DC): void {
    const m = swkeyMetrics;
    let width = m.Width;
    let height = m.Height;
    const scale = nxgoState.NXGO_Scale;
    if (scale < 1.0) {
      width = Math.trunc(width * scale);
      height = Math.trunc(height * scale);
    }
    const r: Rect = { left: this.sc_x, right: this.sc_x + width, top: this.sc_y, bottom: this.sc_y + height };
    const rr: Rect = { ...r };
    const rn: Rect = { ...r };
    rn.bottom = rr.top = this.sc_y + Math.trunc(height / 2);

    const dftbrush = gdiObjs.GKOffBrush;
    hdc.selectObject(getStockObject("NULL_PEN"));
    if (!this.Normal && !this.Reverse) {
      hdc.selectObject(dftbrush);
      hdc.rectangle(r.left, r.top, r.right, r.bottom);
    } else {
      hdc.selectObject(this.Normal ? gdiObjs.GKGreenBrush : dftbrush);
      hdc.rectangle(rn.left, rn.top, rn.right, rn.bottom);
      hdc.selectObject(this.Reverse ? gdiObjs.GKYellowBrush : dftbrush);
      hdc.rectangle(rr.left, rr.top, rr.right, rr.bottom);
    }
    const tcold = hdc.getTextColor();
    const bm = hdc.getBkMode();
    hdc.setBkMode(TRANSPARENT);
    hdc.setTextColor(RGB(0, 0, 0));
    hdc.drawText("N", rn, LIGHT_LEGEND_DT_OPTS);
    hdc.drawText("R", rr, LIGHT_LEGEND_DT_OPTS);
    hdc.setTextColor(tcold);
    hdc.setBkMode(bm);
    hdc.selectObject(getStockObject("BLACK_PEN"));
    hdc.moveTo(rn.left, rn.top);
    hdc.lineTo(rn.right, rn.top);
    hdc.selectObject(gdiObjs.GKOffBrush);

    const tr: Rect = { ...r };
    tr.top = r.bottom + BottomMargin;
    tr.bottom = tr.top + m.NumHeight;
    hdc.drawText(this.NumStr, tr, NUM_DT_OPTS);

    /* Lock light */
    hdc.selectObject(this.LSState ? gdiObjs.GKOffBrush : gdiObjs.GKRedBrush);
    const rad = Math.trunc(m.LKRadius * scale + 0.8);
    const xcen = this.sc_x + Math.trunc(width / 2);
    const ycen = this.sc_y - Math.trunc(m.LKOffset * scale + 0.8);
    hdc.ellipse(xcen - rad, ycen - rad, xcen + rad, ycen + rad);
  }

  override typeID(): TypeId {
    return TypeId.SWITCHKEY;
  }
  override isNomenclature(id: number): boolean {
    return this.XlkgNo === id;
  }

  /** Scaled key height as in Display/Hit. */
  private scaledHeight(): number {
    let height = swkeyMetrics.Height;
    if (nxgoState.NXGO_Scale < 1.0) height = Math.trunc(height * nxgoState.NXGO_Scale);
    return height;
  }

  override hit(mb: number): void {
    const height = this.scaledHeight();
    if (nxgoState.NXGOHitY > this.sc_y + height) return;

    if (mb === WM_NXGO_RBUTTONCONTROL) {
      objectUIHooks.contextMenu?.(this); /* RunContextMenu: UI. Actions: press(false/true, lock), clearAux(). */
      return;
    }

    this.HitWasControl = mb === WM_RBUTTONDOWN;
    const wantReverse = nxgoState.NXGOHitY > this.sc_y + Math.trunc(height / 2);
    this.press(wantReverse, this.HitWasControl);
  }

  press(wantReverse: boolean, lockIt: boolean): boolean {
    const Turn = this.Turn!;
    if (wantReverse) {
      if (this.Normal) reportToRelay(Turn.NL, (this.Normal = false));
      reportToRelay(Turn.RL, (this.Reverse = !this.Reverse));
    } else {
      if (this.Reverse) reportToRelay(Turn.RL, (this.Reverse = false));
      reportToRelay(Turn.NL, (this.Normal = !this.Normal));
    }

    if (!lockIt && (this.Normal || this.Reverse)) this.wantMouseUp();

    this.setTurnSwkeyFlags();
    return true; /* for now */
  }

  setTurnSwkeyFlags(): void {
    this.invalidate();
    let newkeys = 0;
    if (this.Normal) newkeys |= TN_AUXKEY_FORCE_NORMAL;
    else if (this.Reverse) newkeys |= TN_AUXKEY_FORCE_REVERSE;
    if (newkeys !== this.Turn!.AuxKeyForce) {
      this.Turn!.AuxKeyForce = newkeys;
      this.Turn!.invalidateAndTurnouts();
    }
  }

  override unHit(): void {
    if (!this.HitWasControl) {
      const Turn = this.Turn!;
      if (this.Reverse) reportToRelay(Turn.RL, (this.Reverse = false));
      if (this.Normal) reportToRelay(Turn.NL, (this.Normal = false));
      this.setTurnSwkeyFlags();
    }
  }

  clearAux(): void {
    this.HitWasControl = false;
    this.unHit(); /* WOW that was clever!! */
  }

  /** Menu enablement state (SwitchKey::EditContextMenu), for a UI. */
  menuState(): { normal: boolean; reverse: boolean; normalHold: boolean; reverseHold: boolean; unhold: boolean } {
    const nhold = relayState(this.Turn!.NL);
    const rhold = relayState(this.Turn!.RL);
    return {
      normal: !(!this.Turn!.Thrown || this.Normal || nhold),
      reverse: !(this.Turn!.Thrown || this.Reverse || rhold),
      normalHold: !nhold,
      reverseHold: !rhold,
      unhold: rhold || nhold,
    };
  }
}

/** C++ ClearAllAuxLevers */
export function clearAllAuxLevers(): void {
  mapGraphicObjectsOfType(TypeId.SWITCHKEY, (g) => {
    (g as SwitchKey).clearAux();
    return 0;
  });
}
