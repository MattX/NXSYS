/*
 * RecordingDC: a DC that writes the nxdraw display list (format: see dc.ts). Byte-for-byte
 * comparable with the C++ trace harness recording (tools/trace-harness/src/DrawRecorder.cpp).
 */
import type { Brush, Font, GdiObject, Pen, Point, Rect, Stock, DC, ColorRef } from "./dc.js";
import { DT_CALCRECT } from "./dc.js";

/** Same fake fixed-pitch metrics as the C++ harness DrawText(DT_CALCRECT) stub: 7 px/char, height 14. */
export const FAKE_CHAR_WIDTH = 7;
export const FAKE_TEXT_HEIGHT = 14;

export const hex6 = (c: ColorRef): string => (c & 0xffffff).toString(16).padStart(6, "0");

/** nxdraw string quoting: only \ and " are backslash-escaped; chars < 0x20 or >= 0x7f become \u00xx. */
export function quoteNxdraw(s: string): string {
  let r = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22 || c === 0x5c) r += "\\" + s[i];
    else if (c < 0x20 || c >= 0x7f) r += "\\u" + (c & 0xffff).toString(16).padStart(4, "0");
    else r += s[i];
  }
  return r + '"';
}

export class RecordingDC implements DC {
  private lines: string[] = [];
  private textColor: ColorRef = 0;
  private bkMode = 0;

  /** `# nxdraw 1 <basename> @<ms>` */
  header(basename: string, ms: number): void {
    this.lines.push(`# nxdraw 1 ${basename} @${ms}`);
  }
  /** `VIEW l t r b scale` (scale printed like C's %g for the usual values) */
  view(left: number, top: number, right: number, bottom: number, scale: number): void {
    this.lines.push(`VIEW ${left} ${top} ${right} ${bottom} ${scale}`);
  }
  end(): void {
    this.lines.push("END");
  }
  /** The whole display list, each line '\n'-terminated. */
  toString(): string {
    return this.lines.length ? this.lines.join("\n") + "\n" : "";
  }
  get lineCount(): number {
    return this.lines.length;
  }

  beginObject(typeId: number, nomenclature: number): void {
    this.lines.push(`OBJ ${typeId} ${nomenclature}`);
  }

  selectObject(o: GdiObject | null): void {
    if (o === null || o === undefined) return;
    switch (o.kind) {
      case "pen":
        this.lines.push(`SELECT PEN ${(o as Pen).style} ${(o as Pen).width} ${hex6((o as Pen).color)}`);
        break;
      case "brush":
        this.lines.push(`SELECT BRUSH ${hex6((o as Brush).color)}`);
        break;
      case "font": {
        const f = o as Font;
        this.lines.push(`SELECT FONT ${f.height} ${f.weight} ${f.width} ${f.italic ? 1 : 0} ${quoteNxdraw(f.face)}`);
        break;
      }
      case "stock":
        this.lines.push(`SELECT STOCK ${(o as Stock).name}`);
        break;
    }
  }
  moveTo(x: number, y: number): void {
    this.lines.push(`MOVETO ${x} ${y}`);
  }
  lineTo(x: number, y: number): void {
    this.lines.push(`LINETO ${x} ${y}`);
  }
  polygon(points: readonly Point[]): void {
    this.lines.push(`POLYGON ${points.length}` + points.map((p) => ` ${p.x} ${p.y}`).join(""));
  }
  ellipse(l: number, t: number, r: number, b: number): void {
    this.lines.push(`ELLIPSE ${l} ${t} ${r} ${b}`);
  }
  rectangle(l: number, t: number, r: number, b: number): void {
    this.lines.push(`RECTANGLE ${l} ${t} ${r} ${b}`);
  }
  fillRect(r: Rect, brush: Brush | Stock): void {
    const tail = brush.kind === "stock" ? `STOCK ${brush.name}` : `BRUSH ${hex6(brush.color)}`;
    this.lines.push(`FILLRECT ${r.left} ${r.top} ${r.right} ${r.bottom} ${tail}`);
  }
  drawText(s: string, r: Rect, flags: number): number {
    if (flags & DT_CALCRECT) {
      r.right = r.left + s.length * FAKE_CHAR_WIDTH;
      r.bottom = r.top + FAKE_TEXT_HEIGHT;
      return FAKE_TEXT_HEIGHT;
    }
    this.lines.push(`DRAWTEXT ${r.left} ${r.top} ${r.right} ${r.bottom} ${flags} ${quoteNxdraw(s)}`);
    return FAKE_TEXT_HEIGHT;
  }
  getTextExtent(s: string): number {
    return s.length * FAKE_CHAR_WIDTH;
  }
  setTextColor(c: ColorRef): void {
    this.textColor = c;
    this.lines.push(`TEXTCOLOR ${hex6(c)}`);
  }
  getTextColor(): ColorRef {
    return this.textColor;
  }
  setBkColor(c: ColorRef): void {
    this.lines.push(`BKCOLOR ${hex6(c)}`);
  }
  setBkMode(mode: number): void {
    this.bkMode = mode;
    this.lines.push(`BKMODE ${mode}`);
  }
  getBkMode(): number {
    return this.bkMode;
  }
}
