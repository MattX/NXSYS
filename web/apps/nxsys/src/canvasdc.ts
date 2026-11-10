/*
 * CanvasDC — the DC (GDI subset) backend on CanvasRenderingContext2D.
 * Semantics are ported from NXSYSMac/DeviceContext.mm (the reference look):
 *
 *   SelectObject   pen => havePen/pen color/width; brush => brush color; font => current font;
 *                  null ignored. Stock BLACK_PEN is a 2px black pen; NULL_PEN draws nothing.
 *   MoveTo/LineTo  stroke one segment with the pen (butt caps, miter joins, default Quartz-ish).
 *   Ellipse        FILL ONLY, brush color (no outline stroke).
 *   Rectangle      FILL ONLY, brush color.
 *   Polygon        closed path, FILL with brush, then STROKE with the pen unless the pen is
 *                  absent / NULL_PEN (line width 0 + no stroke).
 *   FillRect       fill with the given brush (stock brushes: black, white, ltgray=200,200,200).
 *   DrawText       Helvetica unless the LOGFONT names a face; size = lfHeight * 0.80, never
 *                  below 10; bold iff weight == FW_BOLD. Text is drawn with its top at rect.top
 *                  (+ (boxH - fontSize)/2 for DT_VCENTER) and centered on the width for DT_CENTER;
 *                  DT_RIGHT/others are ignored, exactly like the Mac. A background run is painted
 *                  only when bkMode != TRANSPARENT. DT_CALCRECT sets left/top = 0 and
 *                  right/bottom = text extent (and draws nothing).
 *
 * Crisp lines: the Mac relies on Quartz antialiasing. Here, when the device-space stroke width of an
 * axis-aligned line rounds to an odd number of device pixels, the line is shifted half a device
 * pixel across so it lands on whole pixels (this matters at devicePixelRatio 1 and at integer zooms).
 */
import {
  DT_CALCRECT,
  DT_CENTER,
  DT_VCENTER,
  FW_BOLD,
  PS_NULL,
  TRANSPARENT,
  type Brush,
  type ColorRef,
  type DC,
  type Font,
  type GdiObject,
  type Pen,
  type Point,
  type Rect,
  type Stock,
} from "@nxsys/core/src/render/dc";

export const WIN_MAC_FONT_RATIO = 0.8;
export const MIN_FONT_SIZE = 10.0;
const DEFAULT_FACE = "Helvetica";

export const cssColor = (c: ColorRef): string => {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  return `rgb(${r},${g},${b})`;
};

/** Font parameters (LOGFONT-like) used both by the DC and by the layout-time metrics hook. */
export interface FontSpec {
  face?: string;
  height?: number;
  weight?: number;
}

export function fontSizeFor(spec: FontSpec | null | undefined): number {
  let fh = spec && spec.height !== undefined && spec.height !== 0 ? Math.abs(spec.height) : 10.0;
  fh *= WIN_MAC_FONT_RATIO;
  return fh < MIN_FONT_SIZE ? MIN_FONT_SIZE : fh;
}

export function cssFontFor(spec: FontSpec | null | undefined): string {
  const face = spec?.face ? spec.face : DEFAULT_FACE;
  const bold = spec?.weight === FW_BOLD;
  const fam = [`"${face.replace(/"/g, "")}"`];
  if (face !== DEFAULT_FACE) fam.push(DEFAULT_FACE);
  fam.push("Arial", '"Liberation Sans"', "sans-serif");
  return `${bold ? "bold " : ""}${fontSizeFor(spec)}px ${fam.join(", ")}`;
}

/* ---- text measurement (shared, on a scratch canvas) ---- */
let scratch: CanvasRenderingContext2D | null = null;
function scratchCtx(): CanvasRenderingContext2D {
  if (!scratch) {
    const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(8, 8) : document.createElement("canvas");
    scratch = c.getContext("2d") as CanvasRenderingContext2D;
  }
  return scratch;
}

export interface TextExtent {
  width: number;
  height: number;
  ascent: number;
}

export function measureWith(ctx: CanvasRenderingContext2D, text: string, spec: FontSpec | null | undefined): TextExtent {
  ctx.font = cssFontFor(spec);
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText(text);
  const size = fontSizeFor(spec);
  const asc = m.fontBoundingBoxAscent ?? size * 0.93;
  const desc = m.fontBoundingBoxDescent ?? size * 0.22;
  return { width: m.width, height: asc + desc, ascent: asc };
}

/**
 * Text metrics for core's setTextMetrics(): extent of `text` in the layout font. Units are layout
 * (screen == world at scale 1) pixels. LogFont fields use the core's names (lfFaceName ...).
 */
export function textMetricsFn(text: string, font?: { lfHeight: number; lfWeight: number; lfFaceName: string }): { width: number; height: number } {
  const spec: FontSpec | undefined = font
    ? { face: font.lfFaceName, height: font.lfHeight, weight: font.lfWeight }
    : undefined;
  const e = measureWith(scratchCtx(), text, spec);
  return { width: Math.trunc(e.width), height: Math.trunc(e.height) };
}

const STOCK_BRUSH: Record<string, ColorRef> = {
  BLACK_BRUSH: 0x000000,
  WHITE_BRUSH: 0xffffff,
  LTGRAY_BRUSH: (200 << 16) | (200 << 8) | 200,
};

export class CanvasDC implements DC {
  private pen: Pen | null = null; // null: none selected
  private nullPen = false;
  private brush: ColorRef | null = null;
  private font: Font | null = null;
  private bkMode = TRANSPARENT; // MainView sets TRANSPARENT before painting
  private bkColor: ColorRef = 0xffffff;
  private textColor: ColorRef = 0xffffff; // MainView: SetTextColor(0xFFFFFF)
  private mx = 0;
  private my = 0;
  /** device pixels per logical unit, for crisp-line snapping (0 disables). */
  deviceScale = 0;

  constructor(readonly ctx: CanvasRenderingContext2D) {}

  selectObject(o: GdiObject | null): void {
    if (o === null) return;
    switch (o.kind) {
      case "pen":
        this.pen = o;
        this.nullPen = o.style === PS_NULL;
        break;
      case "brush":
        this.brush = o.color;
        break;
      case "font":
        this.font = o;
        break;
      case "stock":
        if (o.name === "BLACK_PEN") {
          this.pen = { kind: "pen", style: 0x20001, width: 2, color: 0 };
          this.nullPen = false;
        } else if (o.name === "NULL_PEN") {
          this.pen = null;
          this.nullPen = true;
        } else this.brush = STOCK_BRUSH[o.name];
        break;
    }
  }

  moveTo(x: number, y: number): void {
    this.mx = x;
    this.my = y;
  }

  lineTo(x: number, y: number): void {
    const p = this.pen;
    if (p && !this.nullPen) {
      const { ctx } = this;
      let x0 = this.mx, y0 = this.my, x1 = x, y1 = y;
      const ds = this.deviceScale;
      if (ds > 0) {
        const wdev = Math.round(p.width * ds);
        if (wdev % 2 === 1) {
          const half = 0.5 / ds;
          if (x0 === x1) x0 = x1 = x0 + half;
          else if (y0 === y1) y0 = y1 = y0 + half;
        }
      }
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.lineWidth = p.width;
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";
      ctx.strokeStyle = cssColor(p.color);
      ctx.stroke();
    }
    this.mx = x;
    this.my = y;
  }

  polygon(points: readonly Point[]): void {
    if (points.length === 0) return;
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
    if (this.brush !== null) {
      ctx.fillStyle = cssColor(this.brush);
      ctx.fill();
    }
    if (this.pen && !this.nullPen) {
      ctx.lineWidth = this.pen.width;
      ctx.lineJoin = "miter";
      ctx.strokeStyle = cssColor(this.pen.color);
      ctx.stroke();
    }
  }

  ellipse(left: number, top: number, right: number, bottom: number): void {
    if (this.brush === null) return;
    const { ctx } = this;
    ctx.beginPath();
    ctx.ellipse((left + right) / 2, (top + bottom) / 2, Math.abs(right - left) / 2, Math.abs(bottom - top) / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = cssColor(this.brush);
    ctx.fill();
  }

  rectangle(left: number, top: number, right: number, bottom: number): void {
    if (this.brush === null) return;
    this.ctx.fillStyle = cssColor(this.brush);
    this.ctx.fillRect(left, top, right - left, bottom - top);
  }

  fillRect(r: Rect, brush: Brush | Stock): void {
    const c = brush.kind === "brush" ? brush.color : STOCK_BRUSH[brush.name];
    if (c === undefined) return;
    this.ctx.fillStyle = cssColor(c);
    this.ctx.fillRect(r.left, r.top, r.right - r.left, r.bottom - r.top);
  }

  private spec(): FontSpec | null {
    return this.font ? { face: this.font.face, height: this.font.height, weight: this.font.weight } : null;
  }

  drawText(s: string, r: Rect, flags: number): number {
    const { ctx } = this;
    const spec = this.spec();
    const e = measureWith(ctx, s, spec);
    if (flags & DT_CALCRECT) {
      r.top = 0;
      r.left = 0;
      r.right = Math.trunc(e.width);
      r.bottom = Math.trunc(e.height);
      return r.bottom;
    }
    const fh = fontSizeFor(spec);
    let x = r.left;
    let y = r.top;
    if (flags & DT_VCENTER) y += (r.bottom - r.top) / 2 - fh / 2;
    if (flags & DT_CENTER) x += (r.right - r.left) / 2 - e.width / 2;
    if (this.bkMode !== TRANSPARENT) {
      ctx.fillStyle = cssColor(this.bkColor);
      ctx.fillRect(x, y, e.width, e.height);
    }
    ctx.fillStyle = cssColor(this.textColor);
    ctx.fillText(s, x, y + e.ascent);
    return Math.trunc(e.height);
  }

  getTextExtent(s: string): number {
    return Math.trunc(measureWith(this.ctx, s, this.spec()).width);
  }
  setTextColor(c: ColorRef): void {
    this.textColor = c;
  }
  getTextColor(): ColorRef {
    return this.textColor;
  }
  setBkColor(c: ColorRef): void {
    this.bkColor = c;
  }
  setBkMode(mode: number): void {
    this.bkMode = mode;
  }
  getBkMode(): number {
    return this.bkMode;
  }
}
