/*
 * SwitchKey — the N/R switch lever on the panel. Port of NXSYS/swkey.cpp (non-TLEDIT).
 * Display omitted; metrics for a renderer are in swkeyMetrics (set by initSwitchKeyData).
 */
import { GraphicObject, TypeId, WM_NXGO_RBUTTONCONTROL, WM_RBUTTONDOWN, mapGraphicObjectsOfType, nxgoState, textMetrics } from "./nxgo.js";
import { gdi } from "./geometry.js";
import { TN_AUXKEY_FORCE_NORMAL, TN_AUXKEY_FORCE_REVERSE, Turnout } from "./turnout.js";
import { reportToRelay, type Relay } from "../relay/relay.js";
import { relayState, setReporterIfExists } from "../relay/rlyapi.js";

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
      /* RunContextMenu: UI. The menu's actions are press(false/true, lock) and clearAux(). */
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
