/*
 * GraphicObject base class, global object registry and viewport math.
 * Port of NXSYS/nxgo.cpp + nxgo.h + NXGOLabel.cpp (non-TLEDIT build: the registry is a vector in
 * CREATION ORDER, and that order determines relay-creation order during load).
 *
 * No drawing: Display()/GDI are omitted entirely. All geometry is kept (wp_x/wp_y, wp_limits,
 * sc_limits, viewport/scale, quad map) so that a Canvas renderer can be layered on in Phase 2:
 *   - a renderer iterates allObjects() / visibleObjects() and switches on typeID();
 *   - `invalidateHook` replaces InvalidateRect (called with the object whose appearance changed);
 *   - `textMetrics` replaces DrawText(DT_CALCRECT) (label/text-string extents).
 *
 * Fidelity: MouseSensitive, HitP, FindHitGo, NXGO_Rodentate etc. are ported. Mac behaviour is
 * assumed for ComputeVisible (everything stays "Visible"; scrolling is the host's job).
 */

/* TypeId (typeid.h) */
export enum TypeId {
  TRACKSEC = 1,
  SIGNAL = 2,
  EXITLIGHT = 3,
  TURNOUT = 4,
  LABEL = 5,
  STOP = 6,
  PLATFORM = 7,
  JOINT = 8,
  TRACKSEG = 9,
  SWITCHKEY = 10,
  TEXT = 11,
  TRAFFICLEVER = 12,
  PANELLIGHT = 13,
  PANELSWITCH = 14,
  NONE = -1,
}

/* Windows messages used as "mouse commands" (the numeric values are irrelevant, only identity). */
export const WM_LBUTTONDOWN = 0x0201;
export const WM_RBUTTONDOWN = 0x0204;
export const WM_USER = 2000;
export const WM_NXGO_LBUTTONSHIFT = WM_USER + 1;
export const WM_NXGO_LBUTTONCONTROL = WM_USER + 2;
export const WM_NXGO_RBUTTONCONTROL = WM_USER + 3;

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface WPRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}
export interface WPPoint {
  x: number;
  y: number;
}

import { DT_LEFT, DT_NOCLIP, DT_SINGLELINE, DT_TOP, type DC } from "../render/dc.js";

const newRect = (): Rect => ({ left: 0, top: 0, right: 0, bottom: 0 });

/* ---- host hooks ---- */

/** Replacement for DrawText(..., DT_CALCRECT): extent of `text` in the layout font. Default = harness stub. */
export type TextMetricsFn = (text: string, font?: LogFont) => { width: number; height: number };
const defaultTextMetrics: TextMetricsFn = (text) => ({ width: text.length * 7, height: 14 });
let textMetricsFn: TextMetricsFn = defaultTextMetrics;
export function setTextMetrics(fn: TextMetricsFn | null): void {
  textMetricsFn = fn ?? defaultTextMetrics;
}
export const textMetrics: TextMetricsFn = (t, f) => textMetricsFn(t, f);

/** Replacement for InvalidateRect(G_mainwindow, &sc_limits). */
let invalidateHook: ((g: GraphicObject) => void) | null = null;
export function setInvalidateHook(fn: ((g: GraphicObject) => void) | null): void {
  invalidateHook = fn;
}

/** Subset of LOGFONT used by TEXT forms. */
export interface LogFont {
  lfHeight: number;
  lfWidth: number;
  lfWeight: number;
  lfItalic: boolean;
  lfFaceName: string;
}

/* ---- globals (nxgo.cpp) ---- */

export const nxgoState = {
  SelectedObject: null as GraphicObject | null,
  NXGOHitX: 0,
  NXGOHitY: 0,
  NXGODeleteAll: false,
  /** NXGO_Scale */
  NXGO_Scale: 1.0,
};

const QUAD = 50;
let allObjects: GraphicObject[] = [];
let visibleObjects: GraphicObject[] = [];
const quads = new Map<number, GraphicObject[]>();
let viewport: WPRect = { top: 0, bottom: 0, left: 0, right: 0 };
let lRect: WPRect = { top: 0, bottom: 0, left: 0, right: 0 };
let scaleNum = 100;
let scaleDen = 100;
let VPSCWidth = 0;
let VPSCHeight = 0;
let mouseUpObject: GraphicObject | null = null;
let selectHook: ((g: GraphicObject | null) => void) | null = null;

/** Read-only views for renderers. */
export const allObjectsView = (): readonly GraphicObject[] => allObjects;
export const visibleObjectsView = (): readonly GraphicObject[] => visibleObjects;
export const getViewport = (): Readonly<WPRect> => viewport;
export const getLayoutRect = (): Readonly<WPRect> => lRect;
export const graphicObjectCount = (): number => allObjects.length;

const quadKey = (i: number, j: number): number => (((i << 16) | j) >>> 0) as number;

/* ---- coordinate conversion ---- */
export function SCXtoWP(x: number): number {
  return Math.trunc((x * scaleDen) / scaleNum) + viewport.left;
}
export function SCYtoWP(y: number): number {
  return Math.trunc((y * scaleDen) / scaleNum) + viewport.top;
}
export function WPXtoSC(x: number): number {
  return Math.trunc(((x - viewport.left) * scaleNum) / scaleDen);
}
export function WPYtoSC(y: number): number {
  return Math.trunc(((y - viewport.top) * scaleNum) / scaleDen);
}

export abstract class GraphicObject {
  rw_x = 0;
  rw_y = 0;
  wp_x = 0;
  wp_y = 0;
  /** relative to wp_x, wp_y */
  wp_limits: Rect = newRect();
  sc_limits: Rect = newRect();
  sc_x = 0;
  sc_y = 0;
  Valid = 0;
  Selected = false;
  Visible = false;

  constructor() {
    allObjects.push(this);
  }

  /* virtuals */
  typeID(): TypeId {
    return TypeId.NONE;
  }
  isNomenclature(_n: number): boolean {
    return false;
  }
  mouseSensitive(): boolean {
    return true;
  }
  /** Hit(mh): mh is a WM_ mouse command. */
  hit(_mh: number): void {}
  unHit(): void {}
  computeWP(): void {}
  computeWPRect(): void {}
  wpPoint(): WPPoint {
    return { x: this.wp_x, y: this.wp_y };
  }

  hitP(x: number, y: number): boolean {
    return x >= this.sc_limits.left && x < this.sc_limits.right && y >= this.sc_limits.top && y < this.sc_limits.bottom;
  }

  hitXY(x: number, y: number, message: number): void {
    nxgoState.NXGOHitX = x;
    nxgoState.NXGOHitY = y;
    this.hit(message);
  }

  /** C++ virtual Display(HDC): draw through the DC interface only. */
  display(_dc: DC): void {}

  /** "Nomenclature" printed in the OBJ marker of a recorded paint (0 for objects without one). */
  drawNomenclature(): number {
    return 0;
  }

  /** NXSYSMac semantics: always visible (the scroll view does the clipping); sc coords recomputed. */
  computeVisible(_view: WPRect): boolean {
    this.sc_limits.left = WPXtoSC(this.wp_x + this.wp_limits.left);
    this.sc_limits.right = WPXtoSC(this.wp_x + this.wp_limits.right);
    this.sc_limits.top = WPYtoSC(this.wp_y + this.wp_limits.top);
    this.sc_limits.bottom = WPYtoSC(this.wp_y + this.wp_limits.bottom);
    this.sc_x = WPXtoSC(this.wp_x);
    this.sc_y = WPYtoSC(this.wp_y);
    return (this.Visible = true);
  }

  invalidate(): void {
    invalidateHook?.(this);
  }

  unHide(): void {
    visibleObjects.push(this);
    this.Visible = true;
    this.invalidate();
  }

  /** REALLY_NXSYS: assert(!"GraphicObject::Hide called in real NXSYS"). */
  hide(): void {
    throw new Error("assertion failed: GraphicObject::Hide called in real NXSYS");
  }

  contributeToLayoutRect(): void {
    const x0 = this.wp_x + this.wp_limits.left;
    const x1 = this.wp_x + this.wp_limits.right;
    const y0 = this.wp_y + this.wp_limits.top;
    const y1 = this.wp_y + this.wp_limits.bottom;
    lRect.left = Math.min(lRect.left, x0);
    lRect.right = Math.max(lRect.right, x1);
    lRect.top = Math.min(lRect.top, y0);
    lRect.bottom = Math.max(lRect.bottom, y1);
    if (this.mouseSensitive())
      for (let i = Math.trunc(x0 / QUAD); i <= Math.trunc((x1 + 1) / QUAD); i++)
        for (let j = Math.trunc(y0 / QUAD); j <= Math.trunc((y1 + 1) / QUAD); j++) {
          const k = quadKey(i, j);
          let q = quads.get(k);
          if (!q) quads.set(k, (q = []));
          q.push(this);
        }
  }

  computeVisibleLast(): void {
    this.computeVisible(viewport);
  }

  makeSelfVisible(): void {
    this.computeVisibleLast();
    this.unHide();
  }

  moveWP(x: number, y: number): void {
    if (x === this.wp_x && y === this.wp_y) return;
    const wasv = this.Visible;
    if (wasv) this.hide();
    this.wp_x = x;
    this.wp_y = y;
    this.computeWPRect();
    this.computeVisible(viewport);
    if (wasv) this.unHide();
  }

  moveSC(scx: number, scy: number): void {
    this.moveWP(SCXtoWP(scx), SCYtoWP(scy));
  }

  wantMouseUp(): void {
    mouseUpObject = this;
  }

  select(): void {
    if (nxgoState.SelectedObject) nxgoState.SelectedObject.deselect();
    this.Selected = true;
    nxgoState.SelectedObject = this;
    this.invalidate();
    selectHook?.(this);
  }

  deselect(): void {
    this.Selected = false;
    this.invalidate();
    deselect0();
  }

  /**
   * Called by the demo system (C++ FindHitGo): "click" the center of the object. Returns the
   * screen point clicked, or null if the object is not mouse sensitive.
   */
  findHitGo(buttons: number): { x: number; y: number } | null {
    const x = Math.trunc((this.sc_limits.left + this.sc_limits.right) / 2);
    const y = Math.trunc((this.sc_limits.top + this.sc_limits.bottom) / 2);
    if (this.mouseSensitive()) {
      this.hitXY(x, y, buttons);
      nxgoMouseUp(); /* oops */
      return { x, y };
    }
    return null;
  }
}

function deselect0(): void {
  nxgoState.SelectedObject = null;
  selectHook?.(null);
}

export function setSelectHook(h: ((g: GraphicObject | null) => void) | null): void {
  selectHook = h;
}

/* ---- NXGOLabel (NXGOLabel.cpp) ---- */
export class NXGOLabel extends GraphicObject {
  s = "";
  Parent: GraphicObject | null;
  constructor(parg: GraphicObject | null, x: number, y: number, lab: string) {
    super();
    this.wp_x = x;
    this.wp_y = y;
    this.Parent = parg;
    this.setText(lab);
  }
  setText(lab: string): void {
    this.s = lab;
    const m = textMetrics(lab);
    this.wp_limits.left = 0;
    this.wp_limits.right = m.width;
    this.wp_limits.top = 0;
    this.wp_limits.bottom = m.height;
  }
  override typeID(): TypeId {
    return TypeId.NONE; /* NXGOLabel does not override TypeID */
  }
  override display(dc: DC): void {
    /* at < .8 resolution, don't draw */
    if (nxgoGetDisplayScale() >= 0.8) dc.drawText(this.s, this.sc_limits, DT_TOP | DT_LEFT | DT_SINGLELINE | DT_NOCLIP);
  }
  override select(): void {} /* disallow selection */
  override mouseSensitive(): boolean {
    return false;
  }
  diddle(x: number, y: number): void {
    this.wp_x += x;
    this.wp_y += y;
  }
  positionCenter(x: number, y: number): void {
    this.wp_x = x - Math.trunc(this.wp_limits.right / 2);
    this.wp_y = y - Math.trunc(this.wp_limits.bottom / 2);
  }
  /** returns float */
  radius(): number {
    return Math.fround(
      Math.sqrt(this.wp_limits.right * this.wp_limits.right + this.wp_limits.bottom * this.wp_limits.bottom) / 2.0,
    );
  }
}

/* ---- registry-wide functions ---- */

export function computeVisibleObjects(view: WPRect): void {
  viewport = view;
  visibleObjects = [];
  lRect.top = lRect.left = lRect.bottom = lRect.right = 0;
  for (const go of allObjects) {
    go.contributeToLayoutRect();
    if (go.computeVisible(view)) go.unHide();
    else go.Visible = false;
  }
}

export function computeVisibleObjectsLast(): void {
  computeVisibleObjects(viewport);
}

/** C++ DisplayVisibleObjects */
export function displayVisibleObjects(dc: DC): void {
  for (const o of visibleObjects) o.display(dc);
}

/**
 * C++ DisplayVisibleObjectsRect (the Mac paint path). `dc.beginObject` (optional) is called before
 * each object, standing in for the OBJ hook of the C++ trace harness.
 */
export function displayVisibleObjectsRect(dc: DC, ur: Rect): void {
  for (const g of visibleObjects) {
    if (ur.left > g.sc_limits.right) continue;
    if (ur.right < g.sc_limits.left) continue;
    if (ur.top > g.sc_limits.bottom) continue;
    if (ur.bottom < g.sc_limits.top) continue;
    dc.beginObject?.(g.typeID(), g.drawNomenclature());
    g.display(dc);
  }
}

export function computeWindowPos(): void {
  for (const o of allObjects) o.computeWP();
}

export function mapAllGraphicObjects(fn: (g: GraphicObject) => boolean | number): GraphicObject | null {
  for (const g of allObjects) if (fn(g)) return g;
  return null;
}

export function mapAllVisibleGraphicObjects(fn: (g: GraphicObject) => boolean | number): GraphicObject | null {
  for (const g of visibleObjects) if (fn(g)) return g;
  return null;
}

/** C++ MapGraphicObjectsOfType: returns 1 if the mapper stopped early. */
export function mapGraphicObjectsOfType(type: TypeId, fn: (g: GraphicObject) => boolean | number): number {
  for (const g of allObjects) if (g.typeID() === type) if (fn(g)) return 1;
  return 0;
}

export function mapFindGraphicObjectsOfType(
  type: TypeId,
  fn: (g: GraphicObject) => boolean | number,
): GraphicObject | null {
  for (const g of allObjects) if (g.typeID() === type) if (fn(g)) return g;
  return null;
}

export function findObjectByNomAndType(nomenclature: number, type: TypeId): GraphicObject | null {
  for (const g of allObjects) if (g.typeID() === type) if (g.isNomenclature(nomenclature)) return g;
  return null;
}

export function findObjectByTypeAndWPpos(type: TypeId, wpx: number, wpy: number): GraphicObject | null {
  for (const g of allObjects) {
    if (g.typeID() === type) {
      const p = g.wpPoint();
      if (p.x === wpx && p.y === wpy) return g;
    }
  }
  return null;
}

export function findHitObjectOfType(type: TypeId, x: number, y: number): GraphicObject | null {
  for (const g of visibleObjects) if (g.typeID() === type) if (g.hitP(x, y)) return g;
  return null;
}

export function findHitObjectOfTypes(types: TypeId[], x: number, y: number): GraphicObject | null {
  for (const g of visibleObjects) {
    const t = g.typeID();
    for (const k of types) if (k === t) if (g.hitP(x, y)) return g;
  }
  return null;
}

export function getMouseHitObject(x: number, y: number): GraphicObject | null {
  if (quads.size) {
    const key = quadKey(Math.trunc(SCXtoWP(x) / QUAD), Math.trunc(SCYtoWP(y) / QUAD));
    const q = quads.get(key);
    if (q) for (const g of q) if (g.hitP(x, y)) return g;
    return null;
  }
  for (const o of visibleObjects) if (o.mouseSensitive() && o.hitP(x, y)) return o;
  return null;
}

/** C++ NXGO_Rodentate: dispatch a mouse event at screen point (x, y). */
export function nxgoRodentate(x: number, y: number, message: number): void {
  const g = getMouseHitObject(x, y);
  if (g && g.mouseSensitive()) g.hitXY(x, y, message);
}

export function nxgoMouseUp(): void {
  if (mouseUpObject) {
    const g = mouseUpObject;
    mouseUpObject = null;
    g.unHit();
  }
}

export function nxgoMouseMove(x: number, y: number): void {
  if (mouseUpObject && !mouseUpObject.hitP(x, y)) nxgoMouseUp();
}

/** C++ FreeGraphicObjects (destructors have no relay-visible effect in the TS port). */
export function freeGraphicObjects(): void {
  quads.clear();
  nxgoState.SelectedObject = null;
  mouseUpObject = null;
  allObjects = [];
  visibleObjects = [];
}

/* ---- viewport (scroll/zoom model; hosts drive these) ---- */

export function nxgoSetViewportDims(width: number, height: number): void {
  VPSCWidth = width;
  VPSCHeight = height;
  viewport.right = viewport.left + Math.trunc(width / nxgoState.NXGO_Scale);
  viewport.bottom = viewport.top + Math.trunc(height / nxgoState.NXGO_Scale);
  computeVisibleObjectsLast();
}

export function nxgoSetDisplayScale(s: number): void {
  nxgoState.NXGO_Scale = s;
  scaleNum = Math.trunc(s * 100.0);
  scaleDen = 100;
  viewport.right = viewport.left + Math.trunc(VPSCWidth / s);
  viewport.bottom = viewport.top + Math.trunc(VPSCHeight / s);
  computeVisibleObjectsLast();
}

export function nxgoGetDisplayScale(): number {
  return scaleNum / scaleDen;
}

export function nxgoSetDisplayWPOrg(x: number, y: number): void {
  const width = viewport.right - viewport.left;
  const height = viewport.bottom - viewport.top;
  viewport.left = x;
  viewport.right = x + width;
  viewport.top = y;
  viewport.bottom = y + height;
  computeVisibleObjectsLast();
}

export function nxgoGetDisplayWPOrg(): { x: number; y: number } {
  return { x: viewport.left, y: viewport.top };
}

/** C++ NXGO_ValidateWpVp (scroll clamp, minus the window invalidation). */
export function nxgoValidateWpVp(): void {
  const width = viewport.right - viewport.left;
  const xslop = lRect.right - lRect.left - width;
  if (viewport.left < lRect.left) {
    viewport.left = lRect.left;
    viewport.right = viewport.left + width;
    computeVisibleObjects(viewport);
  } else if (viewport.right > lRect.right) {
    if (xslop > 0) {
      viewport.right = lRect.right;
      viewport.left = viewport.right - width;
      computeVisibleObjects(viewport);
    }
  }
}

/** C++ NXGO_ComputeTrueLayoutDimensions (right/bottom extents; left/top are 0). */
export function nxgoComputeTrueLayoutDimensions(): Rect {
  let highestY = 128;
  let highestX = 128;
  for (const g of allObjects) {
    const right = g.wp_x + g.wp_limits.right;
    const bottom = g.wp_y + g.wp_limits.bottom;
    if (bottom > highestY) highestY = bottom;
    if (right > highestX) highestX = right;
  }
  return { left: 0, right: Math.trunc(highestX), top: 0, bottom: Math.trunc(highestY) };
}

/** Reset the module (new process). Not part of the C++ API. */
export function resetNxgoForTests(): void {
  freeGraphicObjects();
  viewport = { top: 0, bottom: 0, left: 0, right: 0 };
  lRect = { top: 0, bottom: 0, left: 0, right: 0 };
  scaleNum = scaleDen = 100;
  nxgoState.NXGO_Scale = 1.0;
  VPSCWidth = VPSCHeight = 0;
}
