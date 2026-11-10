/*
 * PanelSwitch — two-position panel toggle that reports to a relay. Port of NXSYS/pswitch.cpp.
 * Note the relay is created when the object is constructed (during layout parsing), not at load-complete.
 */
import { GraphicObject, TypeId, nxgoState } from "./nxgo.js";
import { reportToRelay, type Relay } from "../relay/relay.js";
import { createQuislingRelay } from "../relay/rlyapi.js";

const PSW_MID_WIDTH = 12;
const PSW_HALF_HEIGHT = 20;

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
