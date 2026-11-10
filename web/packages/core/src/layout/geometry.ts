/*
 * Layout-global data: port of NXSYS/lyglobal.h (Glb), the geometry units from NXSYS/trkgdi.cpp
 * (InitTrackGDI computes GU1, GU2, ... from the "design window" 800x640; no pens/brushes here),
 * NXSYS/DesignWindowDims.h, NXSYS/pival.h, the TSAX/TSEX enums of v2/xtgtrack.h, and the
 * kinematics constants of traincmn.cpp / traincfg.h (the trains themselves are Phase 4).
 */

export const CONST_PI = 3.141592653589793238462643383;
export const CONST_2PI = 2.0 * CONST_PI;
export const CONST_PI_OVER_2 = CONST_PI / 2.0;
export const CONST_3PI_OVER_2 = (3.0 * CONST_PI) / 2.0;
export const CONST_PI_OVER_4 = CONST_PI / 4.0;

/** NXSYS_DESIGN_WINDOW_DIMS (DesignWindowDims.h). */
export const DESIGN_WINDOW_WIDTH = 800;
export const DESIGN_WINDOW_HEIGHT = 640;

/** NXSYS_APP_BASE_MINOR_VERSION (nxsys.cpp). */
export const NXSYS_APP_BASE_MINOR_VERSION = 3;

/** NXSYSLayoutGlobal Glb (lyglobal.h). */
export const Glb = {
  RouteIdentifier: "",
  TorontoStyle: false,
  PixelsPerSimFoot: 0,
  TrainLengthFeet: 0,
  IRTStyle: false,
  AppBaseMajor: 0,
  AppBaseMinor: 0,
  TrafficLeversTristate: false,
};

/** Screen-independent unit constants (trkgdi.cpp globals). All integers (SC_cord = int). */
export const gdi = {
  GU1: 0,
  GU2: 0,
  Track_Width_Delta: 0,
  Track_Side_Fudge: 0,
  Track_Side_Nolight: 0,
  Track_Seg_Len: 0,
  Track_Normal_Halfwidth: 0,
  Lit_Seg_HalfWidth: 0,
  SectionInterstice: 0,
  Unlit_Half_Len: 0,
  RWXO: 0,
  RWYO: 0,
  RWY_factor: 0,
  MainWindowWidth: 0,
};

const DEFAULT_SIM_FEET_PER_SCREEN = 3000.0;

/** C++ ComputeHorizontalScaling. */
export function computeHorizontalScaling(f: number): void {
  Glb.PixelsPerSimFoot = gdi.MainWindowWidth / f;
}

/** C++ SetTrackGeometryDefaults. */
export function setTrackGeometryDefaults(): void {
  computeHorizontalScaling(DEFAULT_SIM_FEET_PER_SCREEN);
}

/** The non-GDI half of C++ InitTrackGDI(mww, mwh). Integer division as in C. */
export function initTrackGDI(mww: number, mwh: number): void {
  gdi.MainWindowWidth = mww;
  gdi.GU1 = Math.trunc(mwh / 300);
  gdi.Track_Normal_Halfwidth = gdi.GU1;
  gdi.GU2 = Math.trunc(mwh / 200);
  gdi.Lit_Seg_HalfWidth = gdi.GU2;
  gdi.Track_Width_Delta = Math.trunc(gdi.GU2 * 1.5);
  gdi.Track_Side_Fudge = 0;
  gdi.Track_Side_Nolight = 0;
  gdi.Track_Seg_Len = 4 * gdi.GU2;
  gdi.Unlit_Half_Len = gdi.GU2;
  gdi.RWY_factor = Math.trunc(mww / 25);
  gdi.RWYO = Math.trunc(mww / 25);
  gdi.RWXO = Math.trunc(mwh / 24);
  setTrackGeometryDefaults();
  gdi.SectionInterstice = Math.trunc(mwh / 400);
}

/* ---- train kinematics defaults (traincmn.cpp; trains themselves are Phase 4) ---- */
const DEFAULT_SPEED = 60.0;
const DEFAULT_TRAIN_LENGTH = 610.0;
const DEFAULT_YELLOW_SPEED = 60.0;

export const trainCfg = {
  CruisingSpeed: DEFAULT_SPEED,
  YellowFeetPerSecond: DEFAULT_YELLOW_SPEED,
};

/** C++ SetTrainKinematicsDefaults. */
export function setTrainKinematicsDefaults(): void {
  trainCfg.CruisingSpeed = DEFAULT_SPEED;
  trainCfg.YellowFeetPerSecond = DEFAULT_YELLOW_SPEED;
  Glb.TrainLengthFeet = DEFAULT_TRAIN_LENGTH;
}

/* ---- v2/xtgtrack.h enums ---- */

/** Track section (branch) array index. IJR0/IJR1 alias STEM/NORMAL. */
export enum TSAX {
  STEM = 0,
  NORMAL = 1,
  REVERSE = 2,
  NOTFOUND = -1,
}
export const TSAX_IJR0 = 0;
export const TSAX_IJR1 = 1;

/** Track section end index. */
export enum TSEX {
  E0 = 0,
  E1 = 1,
  NOTFOUND = -1,
}

/** C float (single precision) rounding; used where C++ stores into `float`. */
export const f32 = Math.fround;

/** C (int) cast of a double. */
export const toInt = (x: number): number => Math.trunc(x);
