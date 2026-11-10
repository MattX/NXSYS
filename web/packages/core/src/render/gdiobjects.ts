/*
 * The pens, brushes and fonts the Display() code uses: port of the GDI half of NXSYS/trkgdi.cpp
 * (InitTrackGDI; CreateSPen/CreateSBrush; the Mac InitStockObjects/GetStockObject) and of the
 * font creation in StartUpNXSYS (nxsys.cpp).
 *
 * Module-level objects, (re)assigned by initGdiObjects(), which initTrackGDI() calls. Because the
 * geometry always comes from the fixed "design window" (800x640) the values never change; they
 * are still computed from the geometry arguments exactly as the C++ does (integer arithmetic).
 *
 * Mac note: NullPen is the stock NULL_PEN (trkgdi.cpp InitStockObjects: NullPen = StockObjects[NULL_PEN]).
 */
import {
  PS_SOLID,
  RGB,
  FW_BOLD,
  createFontIndirect,
  createPen,
  createSolidBrush,
  getStockObject,
  type Brush,
  type Font,
  type Pen,
  type Stock,
} from "./dc.js";

export const TrackDftCol = RGB(128, 128, 128);
export const TrackOccupiedCol = RGB(255, 0, 0);
export const TrackRoutedCol = RGB(255, 255, 255);

const unset = <T>(): T => undefined as unknown as T;

/** The globals of brushpen.h (those that Display() code touches, plus the rest for completeness). */
export const gdiObjs = {
  TrackDftBrush: unset<Brush>(),
  TrackOccupiedBrush: unset<Brush>(),
  TrackRoutedBrush: unset<Brush>(),
  GKRedBrush: unset<Brush>(),
  GKHalfRedBrush: unset<Brush>(),
  GKYellowBrush: unset<Brush>(),
  GKGreenBrush: unset<Brush>(),
  GKOffBrush: unset<Brush>(),
  GKWhiteBrush: unset<Brush>(),

  SigPen: unset<Pen>(),
  BgPen: unset<Pen>(),
  TrackPen: unset<Pen>(),
  HighlightTrackPen: unset<Pen>(),
  ExitLightPen: unset<Pen>(),
  BlackExitLightPen: unset<Pen>(),
  RedExitLightPen: unset<Pen>(),
  YellowXPen: unset<Pen>(),
  FleetGreenPen: unset<Pen>(),
  FleetBlackPen: unset<Pen>(),
  TrackDftPen: unset<Pen>(),
  TrackDftPenThrown: unset<Pen>(),
  TrackOccupiedPen: unset<Pen>(),
  TrackRoutedPen: unset<Pen>(),
  PlatformPen: unset<Pen>(),
  /** the Mac's NullPen is the stock NULL_PEN */
  NullPen: unset<Stock>(),

  /** Fnt: the layout font (nxsys.cpp StartUpNXSYS) */
  Fnt: unset<Font>(),
  /** LargeFnt (used by the full-signal windows only) */
  LargeFnt: unset<Font>(),
};

/* The dedup caches of CreateSPen/CreateSBrush are irrelevant here: objects are plain values. */
const SPen = (width: number, color: number): Pen => createPen(PS_SOLID, width, color);
const SBrush = (color: number): Brush => createSolidBrush(color);

/** The `real_dth` of StartUpNXSYS: height of the screen. >640 adds 2 to the font height; the harness uses 768. */
export const REAL_SCREEN_HEIGHT = 768;

/**
 * Port of the object-creation half of InitTrackGDI(mww, mwh) (integer arithmetic as in C) plus the
 * font creation of StartUpNXSYS. `GU2` etc. are derived here from mwh again rather than imported,
 * to keep this module free of imports from layout/.
 */
export function initGdiObjects(mww: number, mwh: number): void {
  void mww;
  const g = gdiObjs;
  g.TrackDftBrush = SBrush(TrackDftCol);
  g.TrackOccupiedBrush = SBrush(TrackOccupiedCol);
  g.TrackRoutedBrush = SBrush(TrackRoutedCol);
  g.GKRedBrush = SBrush(RGB(255, 0, 0));
  g.GKHalfRedBrush = SBrush(RGB(128, 0, 0));
  g.GKYellowBrush = SBrush(RGB(255, 192, 0));
  g.GKGreenBrush = SBrush(RGB(0, 255, 0));
  g.GKOffBrush = SBrush(RGB(128, 128, 128));
  g.GKWhiteBrush = SBrush(RGB(255, 255, 255));

  const GU1 = Math.trunc(mwh / 300);
  const Track_Normal_Halfwidth = GU1;
  const GU2 = Math.trunc(mwh / 200);

  g.SigPen = SPen(Math.trunc(mwh / 400), RGB(255, 255, 255));
  g.BgPen = SPen(Math.trunc(mwh / 400), RGB(0, 0, 0));
  g.TrackPen = SPen(2 * Track_Normal_Halfwidth, RGB(128, 128, 128));
  g.HighlightTrackPen = SPen(2 * Track_Normal_Halfwidth, RGB(0, 255, 0));
  g.ExitLightPen = SPen(3 * Track_Normal_Halfwidth, RGB(255, 255, 255));
  g.BlackExitLightPen = SPen(3 * Track_Normal_Halfwidth, RGB(0, 0, 0));
  g.RedExitLightPen = SPen(3 * Track_Normal_Halfwidth, RGB(255, 0, 0));

  const w = Math.trunc(1.2 * GU2);
  g.YellowXPen = SPen(GU2, RGB(255, 255, 0));
  g.FleetGreenPen = SPen(Math.trunc(GU2 / 3), RGB(0, 255, 0));
  g.FleetBlackPen = SPen(Math.trunc(GU2 / 3), RGB(0, 0, 0));
  g.TrackDftPen = SPen(w, TrackDftCol);
  g.TrackDftPenThrown = SPen(w, RGB(0, 0, 255));
  g.TrackOccupiedPen = SPen(w, TrackOccupiedCol);
  g.TrackRoutedPen = SPen(w, TrackRoutedCol);
  g.PlatformPen = SPen(2, TrackDftCol);
  g.NullPen = getStockObject("NULL_PEN");

  /* nxsys.cpp StartUpNXSYS: dth = design window height (== mwh) */
  let h = Math.trunc(mwh / 60);
  if (REAL_SCREEN_HEIGHT > 640) h += 2;
  g.Fnt = createFontIndirect({ height: h, weight: 0, width: 0, italic: false, face: "Helvetica" });
  g.LargeFnt = createFontIndirect({ height: Math.trunc(mwh / 35), weight: FW_BOLD, width: 0, italic: false, face: "Helvetica" });
}
