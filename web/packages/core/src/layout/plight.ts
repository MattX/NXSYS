/*
 * PanelLight (panel indicator lamp with colored aspects). Port of NXSYS/plight.cpp +
 * plight_apponly.cpp, including Display()/Paint().
 */
import { GraphicObject, TypeId, nxgoState } from "./nxgo.js";
import { getStockObject, type Brush, type DC } from "../render/dc.js";
import { gdiObjs } from "../render/gdiobjects.js";
import { createAndSetReporter } from "../relay/rlyapi.js";
import type { Relay } from "../relay/relay.js";

export class PanelLightAspect {
  active = false;
  ReporterRelay: Relay | null = null;
  /** "R"/"G"/"Y"/"W" or "" (C++ picks the GK brush; unknown names get the off brush) */
  readonly colorName: string;
  readonly relay_type_name: string;

  constructor(
    colorName: string | null,
    relayNomenclature: string,
    public PLight: PanelLight,
  ) {
    this.colorName = colorName === null ? "" : colorName.toUpperCase();
    this.relay_type_name = relayNomenclature;
  }

  /** Brush: GK{Red,Green,Yellow,White} by letter, else the off (grey) brush. */
  get brush(): "red" | "green" | "yellow" | "white" | "off" {
    switch (this.colorName) {
      case "R":
        return "red";
      case "G":
        return "green";
      case "Y":
        return "yellow";
      case "W":
        return "white";
      default:
        return "off";
    }
  }

  /** The GDI brush chosen at construction in C++ (BrushesByColorLetter, else GKOffBrush). */
  gdiBrush(): Brush {
    switch (this.colorName) {
      case "R":
        return gdiObjs.GKRedBrush;
      case "G":
        return gdiObjs.GKGreenBrush;
      case "Y":
        return gdiObjs.GKYellowBrush;
      case "W":
        return gdiObjs.GKWhiteBrush;
      default:
        return gdiObjs.GKOffBrush;
    }
  }

  static reporter(state: boolean, v: unknown): void {
    (v as PanelLightAspect).report(state);
  }

  report(state: boolean): void {
    if (state)
      // if we're turning "off", don't clear what might be on.
      this.PLight.clearAllActives();
    this.active = state;
    this.PLight.invalidate();
  }

  processLoadComplete(): void {
    this.ReporterRelay = createAndSetReporter(this.PLight.XlkgNo, this.relay_type_name, PanelLightAspect.reporter, this);
  }
}

export class PanelLight extends GraphicObject {
  Aspects: PanelLightAspect[] = [];
  Radius = 0;

  constructor(
    public XlkgNo: number,
    radius: number,
    p_wpx: number,
    p_wpy: number,
    _desc: string,
  ) {
    super();
    this.wp_x = p_wpx;
    this.wp_y = p_wpy;
    this.setRadius(radius);
  }

  setRadius(r: number): void {
    this.Radius = r;
    this.wp_limits.left = -r - 1;
    this.wp_limits.right = +r + 1;
    this.wp_limits.top = -r - 1;
    this.wp_limits.bottom = +r + 1;
  }

  override typeID(): TypeId {
    return TypeId.PANELLIGHT;
  }

  override drawNomenclature(): number {
    return this.XlkgNo;
  }

  /** C++ PanelLight::Display */
  override display(hdc: DC): void {
    for (const aspect of this.Aspects)
      if (aspect.active) {
        this.paint(hdc, aspect.gdiBrush());
        return;
      }
    /* none selected, draw off-state grey */
    this.paint(hdc, gdiObjs.GKOffBrush);
  }

  /** C++ PanelLight::Paint */
  paint(hdc: DC, brush: Brush): void {
    const rad = Math.trunc(this.Radius * nxgoState.NXGO_Scale + 0.8);
    hdc.selectObject(getStockObject("NULL_PEN"));
    hdc.selectObject(brush);
    hdc.ellipse(this.sc_x - rad, this.sc_y - rad, this.sc_x + rad, this.sc_y + rad);
  }
  override isNomenclature(id: number): boolean {
    return this.XlkgNo === id;
  }

  addAspect(colorName: string, relayName: string): void {
    this.Aspects.push(new PanelLightAspect(colorName, relayName, this));
  }

  clearAllActives(): void {
    for (const a of this.Aspects) a.active = false;
  }

  /** The aspect that Display() would paint, or null for the "off" grey. */
  activeAspect(): PanelLightAspect | null {
    for (const a of this.Aspects) if (a.active) return a;
    return null;
  }

  processLoadComplete(): void {
    for (const a of this.Aspects) a.processLoadComplete();
  }
}
