/*
 * ExitLight — port of NXSYS/v2/xexlight.cpp (+ ExitLight::ProcessLoadComplete from rdtrkcmn.cpp).
 * Display() omitted. A renderer draws, for a Lit/RedFlash/Blacking exit light, the line from
 * (wp_x+limits) along the segment end described by Seg/EndIndex, length 2*Track_Seg_Len (see reposition()).
 */
import { GraphicObject, TypeId } from "./nxgo.js";
import { TSEX, gdi } from "./geometry.js";
import type { TrackSeg } from "./xtgtrack.js";
import { createAndSetReporter, createQuislingRelay } from "../relay/rlyapi.js";
import { reportToRelay, type Relay } from "../relay/relay.js";

export class ExitLight extends GraphicObject {
  Lit = false;
  RedFlash = false;
  Blacking = false;
  XPB: Relay | null = null;

  constructor(
    public Seg: TrackSeg,
    public EndIndex: TSEX,
    public XlkgNo: number,
  ) {
    super();
    Seg.getEnd(EndIndex).ExLight = this;
    this.reposition();
  }

  /** Recomputes wp_x/wp_y/wp_limits (a box around the lit stretch of track at this end). */
  reposition(): void {
    const Seg = this.Seg;
    let wpx1 = Seg.Ends[0].wpx;
    let wpy1 = Seg.Ends[0].wpy;
    let wpx2 = Seg.Ends[1].wpx;
    let wpy2 = Seg.Ends[1].wpy;
    const delx = wpx2 - wpx1;
    const dely = wpy2 - wpy1;
    const len = Math.sqrt(delx * delx + dely * dely);
    const ulen = 2.0 * gdi.Track_Seg_Len;
    if (ulen < len) {
      if (this.EndIndex === TSEX.E0) {
        wpx2 = Math.trunc(wpx1 + ulen * Seg.CosTheta);
        wpy2 = Math.trunc(wpy1 + ulen * Seg.SinTheta);
      } else {
        wpx1 = Math.trunc(wpx2 - ulen * Seg.CosTheta);
        wpy1 = Math.trunc(wpy2 - ulen * Seg.SinTheta);
      }
    }
    const del = 5;
    this.wp_x = Math.min(wpx1, wpx2) - del;
    this.wp_y = Math.min(wpy1, wpy2) - del;
    this.wp_limits.top = this.wp_limits.left = 0;
    this.wp_limits.right = Math.trunc(Math.max(wpx1, wpx2) - this.wp_x + del);
    this.wp_limits.bottom = Math.trunc(Math.max(wpy1, wpy2) - this.wp_y + del);
    this.computeVisibleLast();
  }

  off(): void {
    this.RedFlash = this.Lit = false;
    this.Seg.invalidate();
  }

  setRedFlash(onoff: boolean): void {
    if (this.RedFlash !== onoff) {
      this.RedFlash = onoff;
      this.invalidate();
    }
  }

  setLit(onoff: boolean): void {
    if (this.Lit !== onoff) {
      this.Lit = onoff;
      this.invalidate();
    }
  }

  /** Clicking an exit light pulses its XPB ("exit pushbutton") relay. */
  override hit(_mb: number): void {
    if (this.XPB !== null) {
      reportToRelay(this.XPB, true);
      reportToRelay(this.XPB, false);
    }
  }

  override hitP(x: number, y: number): boolean {
    return (this.Lit || this.Selected) && super.hitP(x, y);
  }

  override typeID(): TypeId {
    return TypeId.EXITLIGHT;
  }
  override isNomenclature(id: number): boolean {
    return id === this.XlkgNo;
  }

  static kReporter(state: boolean, v: unknown): void {
    (v as ExitLight).setLit(state);
  }

  processLoadComplete(): void {
    createAndSetReporter(this.XlkgNo, "K", ExitLight.kReporter, this);
    this.XPB = createQuislingRelay(this.XlkgNo, "XPB");
  }
}
