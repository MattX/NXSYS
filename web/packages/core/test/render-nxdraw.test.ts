/*
 * RecordingDC / parseNxdraw / replayNxdraw: format and round trip.
 */
import { describe, expect, it } from "vitest";
import {
  DT_CENTER,
  DT_CALCRECT,
  DT_NOCLIP,
  DT_SINGLELINE,
  PS_SOLID,
  RGB,
  TRANSPARENT,
  RecordingDC,
  createFontIndirect,
  createPen,
  createSolidBrush,
  getStockObject,
  parseNxdraw,
  quoteNxdraw,
  replayNxdraw,
} from "../src/render/index.js";

function sample(dc: RecordingDC): void {
  dc.header("demo.trk", 2500);
  dc.view(0, 0, 640, 480, 1);
  dc.setTextColor(0xffffff);
  dc.setBkMode(TRANSPARENT);
  dc.beginObject(9, 2278);
  dc.selectObject(createPen(PS_SOLID, 4, RGB(128, 128, 128)));
  dc.moveTo(10, 20);
  dc.lineTo(30, -40);
  dc.beginObject(2, 160);
  dc.selectObject(getStockObject("NULL_PEN"));
  dc.selectObject(createSolidBrush(RGB(255, 192, 0)));
  dc.selectObject(null); // ignored
  dc.ellipse(1, 2, 3, 4);
  dc.rectangle(5, 6, 7, 8);
  dc.polygon([
    { x: 1, y: 2 },
    { x: 3, y: 4 },
    { x: 5, y: 6 },
  ]);
  dc.selectObject(createFontIndirect({ height: 12, weight: 0, width: 0, italic: false, face: 'Hel"vet\\ica' }));
  dc.setBkColor(RGB(1, 2, 3));
  dc.fillRect({ left: 0, top: 1, right: 2, bottom: 3 }, createSolidBrush(RGB(0, 0, 255)));
  dc.fillRect({ left: 0, top: 1, right: 2, bottom: 3 }, getStockObject("LTGRAY_BRUSH"));
  dc.drawText("Né\n\"x\"", { left: 1, top: 2, right: 3, bottom: 4 }, DT_CENTER | DT_SINGLELINE | DT_NOCLIP);
  dc.end();
}

describe("nxdraw", () => {
  it("records the documented line format", () => {
    const dc = new RecordingDC();
    sample(dc);
    expect(dc.toString().split("\n")).toEqual([
      "# nxdraw 1 demo.trk @2500",
      "VIEW 0 0 640 480 1",
      "TEXTCOLOR ffffff",
      "BKMODE 32768",
      "OBJ 9 2278",
      "SELECT PEN 131073 4 808080",
      "MOVETO 10 20",
      "LINETO 30 -40",
      "OBJ 2 160",
      "SELECT STOCK NULL_PEN",
      "SELECT BRUSH ffc000",
      "ELLIPSE 1 2 3 4",
      "RECTANGLE 5 6 7 8",
      "POLYGON 3 1 2 3 4 5 6",
      'SELECT FONT 12 0 0 0 "Hel\\"vet\\\\ica"',
      "BKCOLOR 010203",
      "FILLRECT 0 1 2 3 BRUSH 0000ff",
      "FILLRECT 0 1 2 3 STOCK LTGRAY_BRUSH",
      'DRAWTEXT 1 2 3 4 140 "N\\u00e9\\u000a\\"x\\""',
      "END",
      "",
    ]);
  });

  it("does not record DT_CALCRECT, and applies the 7 px/char, 14 px metrics", () => {
    const dc = new RecordingDC();
    const r = { left: 5, top: 6, right: 0, bottom: 0 };
    expect(dc.drawText("abc", r, DT_CALCRECT)).toBe(14);
    expect(r).toEqual({ left: 5, top: 6, right: 26, bottom: 20 });
    expect(dc.getTextExtent("abcd")).toBe(28);
    expect(dc.toString()).toBe("");
  });

  it("tracks text color and bk mode state", () => {
    const dc = new RecordingDC();
    expect(dc.getTextColor()).toBe(0);
    dc.setTextColor(0x123456);
    dc.setBkMode(TRANSPARENT);
    expect(dc.getTextColor()).toBe(0x123456);
    expect(dc.getBkMode()).toBe(TRANSPARENT);
  });

  it("round-trips: record -> parse -> replay into a RecordingDC gives the same text", () => {
    const a = new RecordingDC();
    sample(a);
    const ops = parseNxdraw(a.toString());
    expect(ops[0]).toEqual({ op: "HEADER", version: 1, basename: "demo.trk", ms: 2500 });
    expect(ops[1]).toMatchObject({ op: "VIEW", right: 640, bottom: 480 });
    const b = new RecordingDC();
    b.header("demo.trk", 2500);
    b.view(0, 0, 640, 480, 1);
    replayNxdraw(ops, b);
    b.end();
    expect(b.toString()).toBe(a.toString());
  });

  it("quoteNxdraw escapes as documented", () => {
    expect(quoteNxdraw("a\tb~\u007f")).toBe('"a\\u0009b~\\u007f"');
  });

  it("parse reports the offending line", () => {
    expect(() => parseNxdraw("MOVETO 1 2\nBOGUS 3\n")).toThrow(/line 2/);
  });
});
