/*
 * TextString (TEXT layout form). Port of NXSYS/text.cpp (+ the form parser of txlayout.cpp lives
 * in interlocking/xtgload.ts), including Display().
 */
import { GraphicObject, TypeId, WPXtoSC, WPYtoSC, nxgoState, textMetrics, type LogFont } from "./nxgo.js";
import {
  DT_CENTER,
  DT_NOCLIP,
  DT_SINGLELINE,
  DT_VCENTER,
  FW_BOLD as DC_FW_BOLD,
  FW_NORMAL as DC_FW_NORMAL,
  createFontIndirect,
  type DC,
  type Font,
  type Rect,
} from "../render/dc.js";
import { gdiObjs, TrackDftCol } from "../render/gdiobjects.js";

/* values of the Mac windows.h (what the layout loader stores in LOGFONT.lfWeight) */
export const FW_NORMAL = DC_FW_NORMAL;
export const FW_BOLD = DC_FW_BOLD;
export const NXSYS_DEFAULT_TEXT_HEIGHT = 20;
export const NXSYS_DEFAULT_TEXT_WEIGHT = FW_BOLD;

export class TextString extends GraphicObject {
  S: {
    AssumedScale: number;
    String: string;
    /** the LOGFONT as given in the layout (unscaled; 0 height/weight = defaults) */
    Logfont: LogFont;
    Color: number;
    ColorGiven: boolean;
  };

  constructor(str: string, lf: LogFont, x: number, y: number, color: number, colorGiven: boolean) {
    super();
    this.S = { AssumedScale: 0, String: str, Logfont: { ...lf }, Color: color, ColorGiven: colorGiven };
    this.wp_x = x;
    this.wp_y = y;
    this.setNewLogfont(lf);
  }

  setNewLogfont(lf: LogFont): void {
    this.S.Logfont = { ...lf };
    this.S.AssumedScale = nxgoState.NXGO_Scale;
    this.scaleSelf();
    this.invalidate();
  }

  /** Effective (scaled) font used for drawing at the current NXGO_Scale. */
  scaledFont(): LogFont {
    const lf: LogFont = { ...this.S.Logfont };
    if (lf.lfHeight === 0) lf.lfHeight = NXSYS_DEFAULT_TEXT_HEIGHT;
    if (lf.lfWeight === 0) lf.lfWeight = NXSYS_DEFAULT_TEXT_WEIGHT;
    lf.lfHeight = Math.trunc(nxgoState.NXGO_Scale * lf.lfHeight + 0.5);
    lf.lfWidth = Math.trunc(nxgoState.NXGO_Scale * lf.lfWidth + 0.5);
    return lf;
  }

  scaleSelf(): void {
    const m = textMetrics(this.S.String, this.scaledFont());
    const height = m.height;
    this.wp_limits.left = -Math.trunc(m.width / 2) - 1;
    this.wp_limits.right = Math.trunc(m.width / 2) + 1;
    this.wp_limits.top = -Math.trunc(height / 2) - 1;
    /* Descender issues here ... kludge it for now.*/
    this.wp_limits.bottom = Math.trunc(height * 0.7);
    this.S.AssumedScale = nxgoState.NXGO_Scale;
  }

  override typeID(): TypeId {
    return TypeId.TEXT;
  }

  /** The canonical HFONT for the current scale (S.HFont in C++). */
  scaledHFont(): Font {
    const lf = this.scaledFont();
    return createFontIndirect({
      height: lf.lfHeight,
      weight: lf.lfWeight,
      width: lf.lfWidth,
      italic: lf.lfItalic,
      face: lf.lfFaceName,
    });
  }

  /** C++ TextString::Display */
  override display(hdc: DC): void {
    if (nxgoState.NXGO_Scale !== this.S.AssumedScale) this.scaleSelf();

    const r: Rect = {
      left: WPXtoSC(this.wp_x + this.wp_limits.left),
      right: WPXtoSC(this.wp_x + this.wp_limits.right),
      top: WPYtoSC(this.wp_y + this.wp_limits.top),
      bottom: WPYtoSC(this.wp_y + this.wp_limits.bottom),
    };
    const font = this.scaledHFont();
    hdc.selectObject(font);
    const tc = hdc.getTextColor();
    hdc.setTextColor(this.S.ColorGiven ? this.S.Color : TrackDftCol);
    /* whoops have to scale the damned thing for screen scaling*/
    hdc.selectObject(font);
    hdc.drawText(this.S.String, r, DT_VCENTER | DT_CENTER | DT_SINGLELINE | DT_NOCLIP);
    hdc.setTextColor(tc);
    hdc.selectObject(gdiObjs.Fnt);
  }
  override mouseSensitive(): boolean {
    return false;
  }
  override hitP(x: number, y: number): boolean {
    return this.mouseSensitive() ? super.hitP(x, y) : false;
  }
}

/** C++ LayoutTextString */
export function layoutTextString(
  str: string,
  lf: LogFont,
  x: number,
  y: number,
  color: number,
  colorGiven: boolean,
): GraphicObject {
  return new TextString(str, lf, x, y, color, colorGiven);
}
