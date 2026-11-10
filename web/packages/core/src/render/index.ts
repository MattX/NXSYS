/*
 * Rendering entry points of the core. All drawing goes through the DC interface (dc.ts).
 *
 *   paintLayout(dc, rect?)     repaint all visible objects (those intersecting rect) for the current
 *                              viewport: the Mac app's MainView drawRect path.
 *   setupPanelViewport()       the viewport the harness-equivalent paint uses (see below)
 *   RecordingDC / parseNxdraw / replayNxdraw   the nxdraw display-list format
 */
import { TRANSPARENT, type DC, type Rect } from "./dc.js";
import { RecordingDC } from "./recording.js";
import {
  displayVisibleObjectsRect,
  nxgoComputeTrueLayoutDimensions,
  nxgoGetDisplayScale,
  nxgoSetViewportDims,
} from "../layout/nxgo.js";

export * from "./dc.js";
export { RecordingDC, quoteNxdraw, FAKE_CHAR_WIDTH, FAKE_TEXT_HEIGHT } from "./recording.js";
export { parseNxdraw, replayNxdraw, nxdrawView, type NxdrawOp } from "./nxdraw.js";
export { gdiObjs, initGdiObjects, TrackDftCol } from "./gdiobjects.js";

/**
 * The viewport of the reference paint (what MacAssertTrueLayoutDims + the unscrolled MainView
 * give the Mac app): world-panel origin (0,0), scale 1.0 (the default), extent
 * NXGO_ComputeTrueLayoutDimensions(). Recomputes the visible set; returns the whole-panel rect in
 * screen coordinates (left = top = 0). Call once after a layout loads.
 */
export function setupPanelViewport(): Rect {
  const lims = nxgoComputeTrueLayoutDimensions();
  const w = lims.right - lims.left;
  const h = lims.bottom - lims.top;
  nxgoSetViewportDims(w, h);
  return { left: 0, top: 0, right: w, bottom: h };
}

/**
 * Repaint every visible object that intersects `rect` (screen coordinates; default: the whole
 * panel, NXGO_ComputeTrueLayoutDimensions()), exactly as MainView.mm drawRect does: a fresh DC
 * with text color white and transparent background, then DisplayVisibleObjectsRect.
 * Drawing state (selected pen/brush/font) starts out empty; a DC used across calls must be reset by the caller.
 */
export function paintLayout(dc: DC, rect?: Rect): void {
  let r = rect;
  if (!r) {
    const d = nxgoComputeTrueLayoutDimensions();
    r = { left: 0, top: 0, right: d.right - d.left, bottom: d.bottom - d.top };
  }
  dc.setTextColor(0xffffff);
  dc.setBkMode(TRANSPARENT);
  displayVisibleObjectsRect(dc, r);
}

/** Record a whole-panel paint as nxdraw text, i.e. what `nxtrace --draw-at` writes (`rect` from setupPanelViewport()). */
export function recordPaint(basename: string, ms: number, rect: Rect): string {
  const rec = new RecordingDC();
  rec.header(basename, ms);
  rec.view(rect.left, rect.top, rect.right, rect.bottom, nxgoGetDisplayScale());
  paintLayout(rec, rect);
  rec.end();
  return rec.toString();
}
