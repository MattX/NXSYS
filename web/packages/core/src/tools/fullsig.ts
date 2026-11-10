/*
 * Full signal displays: port of NXSYS/fullsig.cpp (Signal::WinDisp, SigHead::DisplayWin, DisplayStop, MakeSigWin's
 * title/size) and Stop::SigWinDisplay (stop.cpp, Mac variant), for NXSYSMac/FullSignalView.mm's drawRect.
 * Pure drawing through the DC contract; the UI owns the window. Verified against the C++ recordings
 * (tools/trace-harness/golden/tools/*.fullsig*.nxdraw).
 */
import {
  DT_CALCRECT,
  DT_CENTER,
  DT_NOCLIP,
  DT_TOP,
  FW_BOLD,
  OPAQUE,
  RGB,
  TRANSPARENT,
  createFontIndirect,
  getStockObject,
  type Brush,
  type DC,
  type Font,
  type Rect,
} from "../render/dc.js";
import { gdiObjs } from "../render/gdiobjects.js";
import { Glb } from "../layout/geometry.js";
import { SIGF_STR, type SigHead, type Signal, type Stop } from "../layout/signal.js";

export const SIG_WIN_WIDTH = 60;
const SigWinTopDisp = 10,
  SigWinTopToFirstCenter = 15,
  SigWinInterCenter = 25,
  SigWinRadius = 10,
  SigWinStrokeWidth = 1,
  SigWinInterHead = 5,
  SigWinPipeWidth = 10,
  SigWinPipeExtra = 20,
  SigWinHeadWidth = 30;
const SigWinStopHeight = 16,
  SigWinStopWidth = 15;
const STOP_CODE_CLICKS_MAX = 6,
  STOP_BAR_WIDTH = 5,
  STOP_STEM_WIDTH = 4;

/** Lazily made, like MakeSigWin's Font/SFont (Helvetica bold). */
let fonts: { Font: Font; SFont: Font } | null = null;
function getFonts(): { Font: Font; SFont: Font } {
  if (!fonts)
    fonts = {
      Font: createFontIndirect({ height: Math.trunc(SigWinHeadWidth / 2), weight: FW_BOLD, width: 0, italic: false, face: "Helvetica" }),
      SFont: createFontIndirect({ height: Math.trunc(SigWinHeadWidth / 1.3), weight: FW_BOLD, width: 0, italic: false, face: "Helvetica" }),
    };
  return fonts;
}

/** MakeSigWin's window title (the plate text). */
export function fullSignalTitle(s: Signal): string {
  if (s.XlkgNo) {
    if (s.XlkgNo >= 7000) return `X ${String.fromCharCode(65 + (Math.trunc(s.XlkgNo / 1000) - 7))}${s.XlkgNo % 1000}`;
    return `X ${s.XlkgNo}`;
  }
  return s.compactName();
}

/** Client size of the Mac window: SigWinWidth x (SigWinTopDisp + UnitHeight + 20). */
export function fullSignalClientSize(s: Signal): { w: number; h: number } {
  return { w: SIG_WIN_WIDTH, h: SigWinTopDisp + s.unitHeight() + 20 };
}

function drawPipe(dc: DC, x: number, y: number, length: number): void {
  const r: Rect = { left: x - Math.trunc(SigWinPipeWidth / 2), right: x + Math.trunc(SigWinPipeWidth / 2), top: y + 1, bottom: y + length };
  dc.fillRect(r, getStockObject("LTGRAY_BRUSH"));
  dc.moveTo(r.left, r.top);
  dc.lineTo(r.left, r.bottom);
  dc.moveTo(r.right, r.top);
  dc.lineTo(r.right, r.bottom);
}

function drawAlphanumericAspect(dc: DC, sd: string, x: number, y: number): void {
  const { Font, SFont } = getFonts();
  const r: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  dc.selectObject(SFont);
  dc.drawText(sd, r, DT_NOCLIP | DT_CENTER | DT_TOP | DT_CALCRECT);
  const w = Math.trunc(r.right / 2);
  const h = Math.trunc(r.bottom / 2);
  r.left = x - w;
  r.right = x + w;
  r.top = y - h;
  r.bottom = y + h;
  dc.setTextColor(RGB(255, 255, 255));
  dc.setBkMode(TRANSPARENT);
  dc.drawText(sd, r, DT_NOCLIP | DT_CENTER | DT_TOP);
  dc.setTextColor(RGB(0, 0, 0));
  dc.setBkMode(OPAQUE);
  dc.selectObject(Font);
  dc.setBkMode(TRANSPARENT);
}

function drawLens(dc: DC, x: number, y: number, c: string): void {
  let brush: Brush;
  switch (c) {
    case "Y":
      brush = gdiObjs.GKYellowBrush;
      break;
    case "R":
      brush = gdiObjs.GKRedBrush;
      break;
    case "G":
      brush = gdiObjs.GKGreenBrush;
      break;
    case "W":
      brush = gdiObjs.GKWhiteBrush;
      break;
    default: /* X, S, D */
      brush = gdiObjs.GKOffBrush;
      break;
  }
  dc.selectObject(brush);
  dc.ellipse(x - SigWinRadius, y - SigWinRadius, x + SigWinRadius, y + SigWinRadius);
  if (c === "S" || c === "D") drawAlphanumericAspect(dc, c, x, y);
}

function drawSTBox(dc: DC, x: number, y: number): void {
  const top = y - Math.trunc(SigWinInterCenter / 2);
  dc.fillRect(
    { left: x - Math.trunc(SigWinHeadWidth / 2), right: x + Math.trunc(SigWinHeadWidth / 2), top, bottom: top + SigWinInterCenter },
    gdiObjs.GKOffBrush,
  );
}

function drawPlate(dc: DC, x: number, y: number, height: number, plate: string, fillPlate?: (r: Rect) => void): void {
  const { Font } = getFonts();
  const hw = Math.trunc(SigWinHeadWidth / 2);
  const yb = y + height;
  dc.moveTo(x - hw, y);
  dc.lineTo(x - hw, yb);
  dc.lineTo(x + hw, yb);
  dc.lineTo(x + hw, y);

  const r: Rect = { left: x - hw, top: y + SigWinStrokeWidth, bottom: yb, right: x + hw };
  dc.setBkColor(RGB(255, 255, 255));
  dc.selectObject(Font);
  fillPlate?.(r); // MacFillPlateSexily: only the floating-view variant paints (translucent) behind the plate
  const nl = plate.indexOf("\n");
  if (nl >= 0) {
    const r1: Rect = { ...r };
    const toth = r.bottom - r.top;
    r1.bottom = r1.top + Math.trunc(toth / 2);
    dc.drawText(plate.slice(0, nl), r1, DT_TOP | DT_CENTER);
    r1.top = r1.bottom;
    r1.bottom = r.bottom;
    dc.drawText(plate.slice(nl + 1), r1, DT_TOP | DT_CENTER);
  } else dc.drawText(plate, r, DT_TOP | DT_CENTER);
  if (Glb.IRTStyle) {
    const xw = Math.trunc(0.75 * hw);
    const yl = y + Math.trunc(height / 2);
    dc.moveTo(x - xw, yl);
    dc.lineTo(x + xw, yl);
  }
}

/** SigHead::DisplayWin: returns the y below the head. */
function displayHead(h: SigHead, dc: DC, xc: number, headtop: number, lightsOnly: boolean, stp: boolean, fillPlate?: (r: Rect) => void): number {
  let y = headtop + SigWinTopToFirstCenter;
  const hw = Math.trunc(SigWinHeadWidth / 2);

  if (!lightsOnly) {
    const hr: Rect = {
      left: xc - hw,
      right: xc + hw,
      top: headtop,
      bottom: headtop + (h.height - 1) * SigWinInterCenter + 2 * SigWinTopToFirstCenter,
    };
    dc.fillRect(hr, getStockObject("LTGRAY_BRUSH"));
  }

  for (let l = 0; l < h.height; l++) {
    const c = h.Lights[l];
    if (c === "T") {
      drawSTBox(dc, xc, y);
      if (stp) drawAlphanumericAspect(dc, "20", xc, y);
    } else if (c === "Z") {
      /* nothing */
    } else if (c === h.State) drawLens(dc, xc, y, c);
    else drawLens(dc, xc, y, "X");
    y += SigWinInterCenter;
  }
  y += SigWinTopToFirstCenter - SigWinInterCenter;

  if (!lightsOnly) {
    dc.moveTo(xc - hw, headtop);
    dc.lineTo(xc - hw, y);
    dc.lineTo(xc + hw, y);
    dc.lineTo(xc + hw, headtop);
    dc.lineTo(xc - hw, headtop);
  }

  if (h.Plate[0]) {
    if (!lightsOnly) drawPlate(dc, xc, y, 2 * hw, h.Plate, fillPlate);
    y += 2 * hw;
  }
  return y;
}

/** Stop::SigWinDisplay (Mac variant) */
export function stopSigWinDisplay(stop: Stop, dc: DC, rp: Rect): void {
  const stopstem = gdiObjs.GKYellowBrush;
  let points = stop.coding ? stop.code_clicks : STOP_CODE_CLICKS_MAX;
  if (!stop.Tripping) points = STOP_CODE_CLICKS_MAX - points;
  const bar: Rect = { ...rp };
  /* leave down stop lying on bottom of box ... */
  const totHeight = bar.bottom - bar.top - STOP_BAR_WIDTH;
  bar.top += Math.trunc(((STOP_CODE_CLICKS_MAX - points) * totHeight) / STOP_CODE_CLICKS_MAX);
  bar.bottom = bar.top + STOP_BAR_WIDTH;
  dc.fillRect(bar, gdiObjs.GKYellowBrush);
  dc.moveTo(bar.left, bar.top);
  dc.lineTo(bar.right - 1, bar.top);
  dc.lineTo(bar.right - 1, bar.bottom);
  dc.lineTo(bar.left, bar.bottom);
  dc.lineTo(bar.left, bar.top);
  const stem: Rect = { ...rp };
  stem.top = bar.bottom;
  stem.left = Math.trunc((stem.left + stem.right) / 2) - Math.trunc(STOP_STEM_WIDTH / 2);
  stem.right = stem.left + STOP_STEM_WIDTH;
  dc.fillRect(stem, stopstem);
  dc.fillRect(stem, gdiObjs.GKYellowBrush);
}

/** Signal::WinDisp (+ DisplayStop), with the client height of the window (for the stop box at the bottom). */
export function signalWinDisp(s: Signal, dc: DC, lightsOnly = false, fillPlate?: (r: Rect) => void): void {
  s.computeState();
  let y = SigWinTopDisp;
  const xc = Math.trunc(SIG_WIN_WIDTH / 2);
  const stp = !!(s.MiscG & SIGF_STR) && s.Heads[0].State === "R";
  let i = 0;
  for (const h of s.Heads) {
    y = displayHead(h, dc, xc, y, lightsOnly, stp, fillPlate);
    let pipel = SigWinInterHead;
    if (i === s.Heads.length - 1) pipel += SigWinPipeExtra;
    if (!lightsOnly) drawPipe(dc, xc, y, pipel);
    y += pipel;
    i += 1;
  }
  if (!lightsOnly && s.TStop) {
    const cli = fullSignalClientSize(s);
    const sb: Rect = { top: cli.h - SigWinStopHeight, bottom: cli.h, left: 0, right: SigWinStopWidth };
    stopSigWinDisplay(s.TStop, dc, sb);
  }
}

/** FullSignalView.mm drawRect: fresh DC, BLACK_PEN, black text, transparent background, then Signal::WinDisp. */
export function paintFullSignal(s: Signal, dc: DC, fillPlate?: (r: Rect) => void): void {
  dc.selectObject(getStockObject("BLACK_PEN"));
  dc.setTextColor(0x000000);
  dc.setBkMode(TRANSPARENT);
  signalWinDisp(s, dc, false, fillPlate);
}

