/*
 * TextString (TEXT layout form). Port of NXSYS/text.cpp (+ the form parser of txlayout.cpp lives
 * in interlocking/xtgload.ts). Display omitted; S.* has everything a renderer needs.
 */
import { GraphicObject, TypeId, nxgoState, textMetrics, type LogFont } from "./nxgo.js";

export const FW_NORMAL = 400;
export const FW_BOLD = 700;
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
