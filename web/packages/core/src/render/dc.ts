/*
 * Drawing contract for the NXSYS core — the subset of Win32 GDI that the shared
 * C++ Display() code uses (as emulated on the Mac by NXSYSMac/DeviceContext.mm and
 * declared in NXSYSMac/windows.h). Ported Display() methods draw ONLY through this.
 *
 * Backends:
 *   - RecordingDC: emits the "nxdraw" display-list text format (below), compared
 *     byte-for-byte with the C++ trace harness's recording of the original code.
 *   - CanvasDC (apps/nxsys): Canvas2D, semantics ported from DeviceContext.mm.
 *
 * Coordinates are integer screen (SC) coordinates, as in GDI.
 */

/** Mac-NXSYS COLORREF convention: RGB(r,g,b) = (r << 16) | (g << 8) | b. */
export type ColorRef = number;
export const RGB = (r: number, g: number, b: number): ColorRef => ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);

/* Constants: values exactly as in NXSYSMac/windows.h */
export const DT_TOP = 1;
export const DT_BOTTOM = 2;
export const DT_SINGLELINE = 4;
export const DT_NOCLIP = 8;
export const DT_CALCRECT = 16;
export const DT_LEFT = 32;
export const DT_RIGHT = 64;
export const DT_CENTER = 128;
export const DT_VCENTER = 256;
export const DT_EXPANDTABS = 0;
export const PS_SOLID = 0x20001;
export const PS_NULL = 0x20000;
export const FW_NORMAL = 2;
export const FW_BOLD = 4;
export const OPAQUE = 0x4000;
export const TRANSPARENT = 0x8000;

export interface Pen {
  readonly kind: "pen";
  readonly style: number;
  readonly width: number;
  readonly color: ColorRef;
}
export interface Brush {
  readonly kind: "brush";
  readonly color: ColorRef;
}
export interface Font {
  readonly kind: "font";
  readonly height: number;
  readonly weight: number;
  readonly width: number;
  readonly italic: boolean;
  readonly face: string;
}
export type StockName = "BLACK_BRUSH" | "WHITE_BRUSH" | "LTGRAY_BRUSH" | "BLACK_PEN" | "NULL_PEN";
export interface Stock {
  readonly kind: "stock";
  readonly name: StockName;
}
export type GdiObject = Pen | Brush | Font | Stock;

export const createPen = (style: number, width: number, color: ColorRef): Pen => ({ kind: "pen", style, width, color });
export const createSolidBrush = (color: ColorRef): Brush => ({ kind: "brush", color });
export const createFontIndirect = (f: Omit<Font, "kind">): Font => ({ kind: "font", ...f });
export const getStockObject = (name: StockName): Stock => ({ kind: "stock", name });

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface Point {
  x: number;
  y: number;
}

export interface DC {
  /** null is ignored, as on the Mac. */
  selectObject(o: GdiObject | null): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  polygon(points: readonly Point[]): void;
  ellipse(left: number, top: number, right: number, bottom: number): void;
  rectangle(left: number, top: number, right: number, bottom: number): void;
  fillRect(r: Rect, brush: Brush | Stock): void;
  /** Returns text height like GDI. With DT_CALCRECT, updates `r` and draws nothing. */
  drawText(s: string, r: Rect, flags: number): number;
  getTextExtent(s: string): number;
  setTextColor(c: ColorRef): void;
  getTextColor(): ColorRef;
  setBkColor(c: ColorRef): void;
  setBkMode(mode: number): void;
  getBkMode(): number;
}

/*
 * ---------------- "nxdraw" display-list format (version 1) ----------------
 * One record per line; integers in decimal; colors as 6 lowercase hex digits (rrggbb);
 * strings JSON-escaped in double quotes. GDI objects are written by CONTENT, not handle:
 *
 *   # nxdraw 1 <basename> @<ms>
 *   VIEW <left> <top> <right> <bottom> <scale>     (SC viewport painted; scale as %g)
 *   OBJ <typeid> <nomenclature-or-0>               (start of a GraphicObject's Display())
 *   SELECT PEN <style> <width> <rrggbb>
 *   SELECT BRUSH <rrggbb>
 *   SELECT FONT <height> <weight> <width> <0|1> "<face>"
 *   SELECT STOCK <NAME>
 *   MOVETO x y | LINETO x y
 *   POLYGON <n> x1 y1 ... xn yn
 *   ELLIPSE l t r b | RECTANGLE l t r b
 *   FILLRECT l t r b BRUSH <rrggbb> | FILLRECT l t r b STOCK <NAME>
 *   DRAWTEXT l t r b <flags> "<text>"              (non-CALCRECT calls only)
 *   TEXTCOLOR <rrggbb> | BKCOLOR <rrggbb> | BKMODE <n>
 *   END
 */
