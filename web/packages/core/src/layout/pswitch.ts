/*
 * PanelSwitch — two-position panel toggle that reports to a relay. Port of NXSYS/pswitch.cpp.
 * Note the relay is created when the object is constructed (during layout parsing), not at load-complete.
 */
import { GraphicObject, TypeId, nxgoState } from "./nxgo.js";
import { RGB, createPen, getStockObject, PS_SOLID, type DC, type Pen, type Point } from "../render/dc.js";
import { gdiObjs } from "../render/gdiobjects.js";
import { reportToRelay, type Relay } from "../relay/relay.js";
import { createQuislingRelay } from "../relay/rlyapi.js";

const PSW_TOP_WIDTH = 8;
const PSW_MID_WIDTH = 12;
const PSW_HALF_HEIGHT = 20;

/** static HPEN Pen, created on first Display */
let pen: Pen | null = null;

export class PanelSwitch extends GraphicObject {
  NumStr = "";
  XlkgNo = 0;
  State = false;
  Rly: Relay;

  constructor(xno: number, p_wpx: number, p_wpy: number, relayNomenclature: string) {
    super();
    this.wp_x = p_wpx;
    this.wp_y = p_wpy;
    this.Rly = createQuislingRelay(xno, relayNomenclature);
    this.wp_limits.left = -PSW_MID_WIDTH - 1;
    this.wp_limits.right = PSW_MID_WIDTH + 1;
    this.wp_limits.top = -PSW_HALF_HEIGHT - 2;
    this.wp_limits.bottom = +PSW_HALF_HEIGHT + 2;
    this.State = false;
    this.setXlkgNo(xno);
  }

  setXlkgNo(xno: number): void {
    this.XlkgNo = xno;
    this.NumStr = String(xno);
  }

  override typeID(): TypeId {
    return TypeId.PANELSWITCH;
  }

  override drawNomenclature(): number {
    return this.XlkgNo;
  }

  /** C++ PanelSwitch::Display */
  override display(hdc: DC): void {
    const scale = nxgoState.NXGO_Scale;
    const midwidth = Math.trunc(PSW_MID_WIDTH * scale + 0.8);
    const topwidth = Math.trunc(PSW_TOP_WIDTH * scale + 0.8);
    const height = Math.trunc(PSW_HALF_HEIGHT * scale + 0.8);

    if (pen === null) pen = createPen(PS_SOLID, 1, RGB(192, 192, 192));
    const P: Point[] = [
      { x: this.sc_x - midwidth, y: this.sc_y },
      { x: this.sc_x - topwidth, y: 0 },
      { x: this.sc_x + topwidth, y: 0 },
      { x: this.sc_x + midwidth, y: this.sc_y },
    ];

    hdc.selectObject(pen);
    for (let s = 0; s < 2; s++) {
      if (s === 0)
        /* off, lower */
        P[1].y = P[2].y = this.sc_y + height; /* screen down is more ## */
      else P[1].y = P[2].y = this.sc_y - height;
      const fill = s !== 0 === this.State;
      if (fill) hdc.selectObject(gdiObjs.GKOffBrush);
      else hdc.selectObject(getStockObject("BLACK_BRUSH"));
      hdc.polygon(P.map((p) => ({ ...p })));
    }
  }
  override isNomenclature(id: number): boolean {
    return this.XlkgNo === id;
  }

  override hit(_mb: number): void {
    const upperHalf = nxgoState.NXGOHitY <= this.sc_y;
    if (upperHalf) {
      if (this.State) this.State = false;
    } else if (!this.State) this.State = true;
    reportToRelay(this.Rly, this.State);
    this.invalidate();
  }
}
