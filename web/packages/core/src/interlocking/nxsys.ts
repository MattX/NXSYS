/*
 * Application-level layout lifecycle — the non-UI parts of NXSYS/nxsys.cpp:
 * StartUpNXSYS (relay system, GDI units, form table, viewport), DeInstallLayout, GetLayout,
 * AllAbove. UI (windows, menus, title bars) is omitted.
 */
import { initRelaySys, cleanUpRelaySys } from "../relay/relay.js";
import { setLispBarfString } from "../lisp/barf.js";
import { scheduler } from "../clock/scheduler.js";
import { killNXTimers } from "../clock/coders.js";
import { lispCleanOutRelays } from "../lisp/macros.js";
import {
  Glb,
  DESIGN_WINDOW_HEIGHT,
  DESIGN_WINDOW_WIDTH,
  NXSYS_APP_BASE_MINOR_VERSION,
  initTrackGDI,
} from "../layout/geometry.js";
import {
  computeVisibleObjectsLast,
  freeGraphicObjects,
  nxgoGetDisplayWPOrg,
  nxgoSetDisplayWPOrg,
  nxgoSetViewportDims,
  nxgoValidateWpVp,
  resetNxgoForTests,
} from "../layout/nxgo.js";
import { clearAllTrackSecs, trackCircuitSystemReInit } from "../layout/xtgtrack.js";
import { clearAllAuxLevers } from "../layout/swkey.js";
import { dropAllSignals, SHOW_STOPS_RED, stopState } from "../layout/signal.js";
import { normalAllSwitches, resetTurnouts } from "../layout/turnout.js";
import { destroyDynMenus } from "./dynmenu.js";
import { xtgLoadInit } from "./xtgload.js";
import { clearHelpMenu, dropAllApproach, loaderState, readLayout, resetLoaderGlobals } from "./rdtrkcmn.js";

/** The "window" the layout is shown in (GetClientRect of the main window in the harness). */
export const mainWindow = { width: 1024, height: 768 };

/** Host hooks for state outside this port's scope (trains are Phase 4). */
export const nxsysHooks = {
  /** C++ TrainMiscCtl(CmKillTrains), called from DeInstallLayout and Demo(). */
  killTrains: (() => {}) as () => void,
  /** forget all trains without side effects (fresh-process reset for tests) */
  discardTrains: (() => {}) as () => void,
};

export const nxsysState = { GotLayout: false, LayoutFileName: "", GlobalFilePathname: "" };

const NORMAL_ALL_WAIT_TIME_MS = 1500;

/**
 * StartUpNXSYS, for a fresh "process": also resets every piece of module-level state in the
 * core (clock, layout, Lisp, relay engine) so successive runs in one JS process are independent.
 */
export function startUpNXSYS(): void {
  scheduler.reset();
  nxsysHooks.discardTrains();
  killNXTimers();
  deInstallLayout();
  resetNxgoForTests();
  stopState.ShowStopPolicy = SHOW_STOPS_RED;
  stopState.StopsChanging = 0;
  loaderState.InterpretedP = false;
  loaderState.InterlockingName = "";
  nxsysState.LayoutFileName = nxsysState.GlobalFilePathname = "";

  setLispBarfString("NXSYS/Mac Lisp Substrate"); /* InitRelaySys, first call */
  initRelaySys();
  initTrackGDI(DESIGN_WINDOW_WIDTH, DESIGN_WINDOW_HEIGHT);
  xtgLoadInit();

  Glb.TorontoStyle = false;
  Glb.AppBaseMajor = 2;
  Glb.AppBaseMinor = NXSYS_APP_BASE_MINOR_VERSION;

  setViewportDimsFromWindow();
}

export function setViewportDimsFromWindow(): void {
  nxgoSetViewportDims(mainWindow.width, mainWindow.height);
}

function installLayoutFile(): void {
  computeVisibleObjectsLast();
  nxgoValidateWpVp();
}

/** C++ DeInstallLayout */
export function deInstallLayout(): void {
  /* loose trains are nasty. destroy them first. */
  nxsysHooks.killTrains();

  clearHelpMenu();
  killNXTimers();
  destroyDynMenus();
  trackCircuitSystemReInit();
  freeGraphicObjects();
  resetTurnouts();
  cleanUpRelaySys();
  lispCleanOutRelays();
  resetLoaderGlobals();
  nxsysState.GotLayout = false;
}

/** C++ GetLayout(name, review): load an interlocking, replacing the current one. */
export function getLayout(name: string, review: boolean): boolean {
  deInstallLayout();
  if (review) setViewportDimsFromWindow();
  const org = nxgoGetDisplayWPOrg();
  const s = readLayout(name);
  nxsysState.GotLayout = s !== null;

  if (nxsysState.GotLayout) {
    if (!review) nxgoSetDisplayWPOrg(org.x, org.y);
    installLayoutFile();
    nxsysState.GlobalFilePathname = name;
  }
  if (!nxsysState.GotLayout) deInstallLayout();
  return nxsysState.GotLayout;
}

/** C++ AllAbove (the "reset everything" command). */
export function allAbove(): void {
  if (!loaderState.InterlockingLoaded) return;
  dropAllSignals();
  dropAllApproach();
  clearAllTrackSecs();
  clearAllAuxLevers();
  /* Have to wait for all stops to come up */
  scheduler.nxTimer(null, () => normalAllSwitches(), NORMAL_ALL_WAIT_TIME_MS);
}

