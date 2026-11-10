/*
 * The application controller: owns the virtual file system, loads interlockings into the core,
 * drives the simulated clock from requestAnimationFrame, and exposes menu commands.
 * React subscribes to `engine` via useSyncExternalStore (see useEngine).
 */
import { scheduler } from "@nxsys/core/src/clock/scheduler";
import { setHost } from "@nxsys/core/src/host";
import { getLispBarfString, setLispBarfHandler } from "@nxsys/core/src/lisp/barf";
import { allRelaySyms } from "@nxsys/core/src/lisp/types";
import {
  TypeId,
  WM_LBUTTONDOWN,
  WM_NXGO_LBUTTONCONTROL,
  WM_NXGO_LBUTTONSHIFT,
  WM_NXGO_RBUTTONCONTROL,
  WM_RBUTTONDOWN,
  nxgoComputeTrueLayoutDimensions,
  nxgoMouseUp,
  nxgoRodentate,
  nxgoSetViewportDims,
  setInvalidateHook,
  setTextMetrics,
  findObjectByNomAndType,
  type GraphicObject,
} from "@nxsys/core/src/layout/nxgo";
import { dropAllSignals, implementShowStopPolicy, stopState, Signal } from "@nxsys/core/src/layout/signal";
import { clearAllTrackSecs, findDemoHitCircuit } from "@nxsys/core/src/layout/xtgtrack";
import { clearAllAuxLevers } from "@nxsys/core/src/layout/swkey";
import { findDemoHitTurnout, normalAllSwitches } from "@nxsys/core/src/layout/turnout";
import { allAbove, getLayout, nxsysState, startUpNXSYS } from "@nxsys/core/src/interlocking/nxsys";
import {
  bobbleRGPs,
  dropAllApproach,
  helpRegistry,
  loadHooks,
  loaderState,
  setFileReader,
} from "@nxsys/core/src/interlocking/rdtrkcmn";
import { layoutHooks } from "@nxsys/core/src/interlocking/xtgload";
import { dynMenuUI, dynMenusView, autoControlRelayExists, enableAutomaticOperation, enableDynMenus } from "@nxsys/core/src/interlocking/dynmenu";
import { demo, demoActive, demoUI, resetDemo } from "@nxsys/core/src/interlocking/demo";
import { getRelay2NoCreate, relayState } from "@nxsys/core/src/relay/rlyapi";
import { textMetricsFn } from "./canvasdc";
import {
  FileStore,
  baseOf,
  demosInFolder,
  allLibraryDemos,
  dirOf,
  filesFromDrop,
  filesFromInput,
  loadHelpIndex,
  loadLibrary,
  mainTrkFiles,
  normPath,
  prefetchFolder,
  storeUserFiles,
  type HelpEntry,
  type LibraryEntry,
  type UserFile,
} from "./files";

export interface Snapshot {
  library: LibraryEntry[];
  helpIndex: HelpEntry[];
  loading: boolean;
  loaded: boolean;
  path: string;
  title: string;
  relayCount: number;
  errors: string[];
  running: boolean;
  speed: number;
  autoAvailable: boolean;
  autoOn: boolean;
  stopPolicy: number;
  caption: string | null;
  yellowX: { x: number; y: number } | null;
  demoRunning: boolean;
  /** user-chosen candidate main files awaiting a choice */
  choices: string[] | null;
  demos: string[];
  /** bumps whenever dynmenu / help state changes */
  rev: number;
}

type Listener = () => void;
const MAX_FRAME_MS = 250;

class Engine {
  readonly files = new FileStore();
  private snap: Snapshot = {
    library: [],
    helpIndex: [],
    loading: false,
    loaded: false,
    path: "",
    title: "",
    relayCount: 0,
    errors: [],
    running: true,
    speed: 1,
    autoAvailable: false,
    autoOn: false,
    stopPolicy: stopState.ShowStopPolicy,
    caption: null,
    yellowX: null,
    demoRunning: false,
    choices: null,
    demos: [],
    rev: 0,
  };
  private listeners = new Set<Listener>();
  private loadErrors: string[] | null = null;

  /** set by the panel */
  paintHook: (() => void) | null = null;
  layoutSizeHook: ((w: number, h: number, origin: { x: number; y: number } | null) => void) | null = null;
  layoutW = 1024;
  layoutH = 768;
  private pendingOrigin: { x: number; y: number } | null = null;

  private last = 0;
  private acc = 0;
  private raf = 0;
  private afterLoadQueued = false;

  /* ---- store ---- */
  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = (): Snapshot => this.snap;
  private set(patch: Partial<Snapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of this.listeners) l();
  }
  bump(): void {
    this.set({ rev: this.snap.rev + 1 });
  }

  /** simulated time, ms */
  now(): number {
    return scheduler.now;
  }

  /* ---- init ---- */
  async init(): Promise<void> {
    setTextMetrics(textMetricsFn);
    // As the Mac app does at launch, so a demo script's (load ...) works before any interlocking is open.
    startUpNXSYS();
    this.installHooks();
    setFileReader((p) => this.files.read(p));
    try {
      const [library, helpIndex] = await Promise.all([loadLibrary(), loadHelpIndex()]);
      this.set({ library, helpIndex, demos: allLibraryDemos() });
    } catch (e) {
      this.set({ errors: [`Cannot read the interlocking library: ${(e as Error).message}`] });
    }
    this.startClock();
  }

  private installHooks(): void {
    setInvalidateHook(() => this.invalidate());
    setHost({
      messageBox: (text, title, kind) => {
        if (this.loadErrors) {
          this.loadErrors.push(`${title}: ${text}`);
          return kind === "yesno" ? "no" : "ok";
        }
        // NOTE: synchronous, as the core requires; blocks the page (and the sim clock) while shown.
        if (kind === "yesno") return window.confirm(`${title}\n\n${text}`) ? "yes" : "no";
        window.alert(`${title}\n\n${text}`);
        return "ok";
      },
      relayDisplayChanged: () => this.invalidate(),
    });
    setLispBarfHandler((e) => {
      const msg = `${getLispBarfString()}: ${e.message}`;
      if (this.loadErrors) this.loadErrors.push(msg);
      else window.alert(msg);
    });
    layoutHooks.setDisplayWPOrg = (x, y) => {
      this.pendingOrigin = { x, y };
    };
    loadHooks.afterReadLayout = (ok) => {
      if (ok && !this.afterLoadQueued) {
        this.afterLoadQueued = true;
        queueMicrotask(() => {
          this.afterLoadQueued = false;
          this.afterLayoutLoaded();
        });
      }
    };
    dynMenuUI.showIDBox = () => this.bump();
    dynMenuUI.lampReport = () => this.bump();
    Signal.uiHooks.showFullsigWindow = undefined; // TODO: full-signal windows
    demoUI.say = (m) => this.set({ caption: m });
    demoUI.hide = () => this.set({ caption: null, yellowX: null });
    demoUI.showBigYellowX = (x, y) => this.set({ yellowX: { x, y } });
    demoUI.unShowBigYellowX = () => this.set({ yellowX: null });
  }

  invalidate(): void {
    this.paintHook?.();
  }

  /* ---- loading ---- */
  private countRelays(): number {
    return allRelaySyms().filter((r) => r.relay !== null).length;
  }

  /** Common post-load work (also after a demo script's own (load ...)). */
  private afterLayoutLoaded(): void {
    const d = nxgoComputeTrueLayoutDimensions();
    this.layoutW = d.right;
    this.layoutH = d.bottom;
    nxgoSetViewportDims(d.right, d.bottom); // whole layout is the viewport; the page scrolls/zooms it
    enableDynMenus(true);
    const origin = this.pendingOrigin;
    this.pendingOrigin = null;
    this.layoutSizeHook?.(d.right, d.bottom, origin);
    this.set({
      loaded: true,
      // Also right when a demo script's (load ...) brought this interlocking in.
      path: nxsysState.GlobalFilePathname ? normPath(nxsysState.GlobalFilePathname) : this.snap.path,
      title: loaderState.InterlockingName || "NX Interlocking",
      relayCount: this.countRelays(),
      autoAvailable: autoControlRelayExists(),
      autoOn: false,
      stopPolicy: stopState.ShowStopPolicy,
      rev: this.snap.rev + 1,
    });
    this.invalidate();
  }

  async loadPath(path: string, opts: { fromLibrary?: boolean; runDemo?: string } = {}): Promise<boolean> {
    path = normPath(path);
    this.set({ loading: true, errors: [], choices: null });
    this.loadErrors = [];
    try {
      if (opts.fromLibrary) await prefetchFolder(this.files, path);
      resetDemo();
      this.set({ caption: null, yellowX: null, demoRunning: false });
      startUpNXSYS();
      this.installHooks();
      this.acc = 0;
      this.pendingOrigin = null;
      const ok = getLayout(path, true);
      if (!ok) {
        const errs = this.loadErrors.length ? this.loadErrors : [`Could not load ${path}`];
        this.set({ loading: false, loaded: false, title: "", relayCount: 0, errors: errs, rev: this.snap.rev + 1 });
        this.invalidate();
        return false;
      }
      this.afterLayoutLoaded();
      this.set({
        loading: false,
        path,
        errors: this.loadErrors.slice(),
        // All bundled demos, plus any local scripts beside the loaded file. A demo (load ...)s its own interlocking.
        demos: [
          ...allLibraryDemos(),
          ...this.files.paths().filter((p) => /\.xdo$/i.test(p) && dirOf(p) === dirOf(path) && !allLibraryDemos().includes(p)),
        ],
      });
      if (opts.runDemo) this.runDemo(opts.runDemo);
      return true;
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      this.set({ loading: false, loaded: false, errors: [...(this.loadErrors ?? []), msg] });
      return false;
    } finally {
      this.loadErrors = null;
    }
  }

  loadLibraryEntry(e: LibraryEntry): Promise<boolean> {
    return this.loadPath(e.path, { fromLibrary: true });
  }

  reload(): Promise<boolean> {
    return this.snap.path ? this.loadPath(this.snap.path) : Promise.resolve(false);
  }

  /** User-supplied files (folder picker / drop). */
  async openUserFiles(uf: UserFile[]): Promise<void> {
    this.set({ loading: true, errors: [] });
    const stored = await storeUserFiles(this.files, uf);
    const xdos = stored.filter((p) => /\.xdo$/i.test(p));
    const mains = mainTrkFiles(this.files, stored);
    if (mains.length === 0 && xdos.length && this.snap.loaded) {
      this.set({ loading: false });
      for (const x of xdos) {
        // a lone script: put it next to the current interlocking, so its (load ...) resolves
        const target = normPath(dirOf(this.snap.path) + "/" + baseOf(x));
        this.files.set(target, this.files.read(x)!);
        this.runDemo(target);
        break;
      }
      return;
    }
    if (mains.length === 0) {
      this.set({ loading: false, errors: ["No .trk interlocking files found in the selection."] });
      return;
    }
    if (mains.length > 1) {
      this.set({ loading: false, choices: mains });
      return;
    }
    await this.loadPath(mains[0]);
  }
  async openInput(list: FileList): Promise<void> {
    await this.openUserFiles(filesFromInput(list));
  }
  async openDrop(dt: DataTransfer): Promise<void> {
    await this.openUserFiles(await filesFromDrop(dt));
  }
  chooseMain(path: string): Promise<boolean> {
    return this.loadPath(path);
  }
  dismissChoices(): void {
    this.set({ choices: null });
  }
  dismissErrors(): void {
    this.set({ errors: [] });
  }

  /* ---- demo scripts ---- */
  runDemo(path: string): void {
    if (!this.snap.loaded && !this.files.has(path)) return;
    nxgoMouseUp();
    this.set({ demoRunning: true });
    this.loadErrors = null;
    try {
      demo(path);
    } catch (e) {
      this.set({ errors: [`Demo failed: ${(e as Error).message}`] });
    }
  }
  async runLibraryDemo(path: string): Promise<void> {
    await prefetchFolder(this.files, path);
    this.runDemo(path);
  }
  async runDemoFile(file: File): Promise<void> {
    const text = new TextDecoder("latin1").decode(await file.arrayBuffer());
    const target = normPath((this.snap.path ? dirOf(this.snap.path) + "/" : "") + file.name);
    this.files.set(target, text);
    this.runDemo(target);
  }

  /* ---- clock ---- */
  private startClock(): void {
    const frame = (t: number): void => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(MAX_FRAME_MS, Math.max(0, t - this.last));
      this.last = t;
      if (!this.snap.running || this.snap.loading) return;
      this.acc += dt * this.snap.speed;
      const whole = Math.floor(this.acc);
      if (whole > 0) {
        this.acc -= whole;
        this.advance(whole);
      }
      if (this.snap.demoRunning && !demoActive()) this.set({ demoRunning: false, caption: null, yellowX: null });
    };
    this.last = performance.now();
    this.raf = requestAnimationFrame(frame);
  }

  /** Advance the simulated clock (also used by tests). */
  advance(ms: number): void {
    try {
      scheduler.advance(ms);
    } catch (e) {
      this.set({ running: false, errors: [`Simulation stopped: ${(e as Error).message}`] });
    }
  }
  setRunning(r: boolean): void {
    this.set({ running: r });
  }
  setSpeed(s: number): void {
    this.set({ speed: s });
  }

  /* ---- mouse (MainView rodaCommon / mouseUp) ---- */
  mouse(x: number, y: number, kind: "left" | "right", mods: { shift: boolean; ctrl: boolean }): void {
    let msg = kind === "left" ? WM_LBUTTONDOWN : WM_RBUTTONDOWN;
    if (kind === "left") {
      if (mods.shift) msg = WM_NXGO_LBUTTONSHIFT;
      if (mods.ctrl) msg = WM_NXGO_LBUTTONCONTROL;
    } else if (mods.ctrl) msg = WM_NXGO_RBUTTONCONTROL;
    nxgoRodentate(Math.trunc(x), Math.trunc(y), msg);
  }
  mouseUp(): void {
    nxgoMouseUp();
  }

  /* ---- menu commands (AppDelegate.mm) ---- */
  readonly commands = {
    clearAllTrack: () => clearAllTrackSecs(),
    cancelAllSignals: () => dropAllSignals(),
    releaseAllApproach: () => dropAllApproach(),
    clearAllAux: () => clearAllAuxLevers(),
    normalAllSwitches: () => normalAllSwitches(),
    allOfTheAbove: () => allAbove(),
    bobble: () => bobbleRGPs(),
  };
  toggleAuto(): void {
    const on = !this.snap.autoOn;
    enableAutomaticOperation(on);
    this.set({ autoOn: on });
  }
  setStopPolicy(p: number): void {
    implementShowStopPolicy(p);
    this.set({ stopPolicy: stopState.ShowStopPolicy });
  }
  stopDemo(): void {
    resetDemo();
    this.set({ demoRunning: false, caption: null, yellowX: null });
  }

  /* ---- help / menus ---- */
  helpTexts(): { title: string; text: string }[] {
    return helpRegistry.texts
      .filter((h) => !isFileUrl(h.text))
      .map((h) => ({ title: menuTitle(h.title), text: h.text.replace(/\r/g, "") }));
  }
  helpUrls(): { title: string; url: string | null }[] {
    // :HELP-TEXT entries with an "@page.html" third element register a file:// URL as their text.
    const pages = helpRegistry.texts.filter((h) => isFileUrl(h.text)).map((h) => ({ title: menuTitle(h.title), url: h.text.trim() }));
    return [...pages, ...helpRegistry.urls.map((u) => ({ ...u, title: menuTitle(u.title) }))];
  }
  dynMenus() {
    return dynMenusView();
  }

  /** Resolve a help URL registered by an interlocking to something an iframe/link can open. */
  resolveHelpUrl(url: string): { href: string; external: boolean } {
    if (/^https?:/i.test(url)) return { href: url, external: true };
    if (/^file:\/\//i.test(url)) {
      // From :HELP-TEXT ("title" "..." "@page.html"): the loader already resolved it
      // relative to the interlocking file, as the C++ does.
      const p = normPath(url.slice(7));
      if (/^(interlockings|documentation)\//i.test(p)) return { href: "data/" + p, external: false };
      const t = this.files.read(p);
      if (t !== null) return { href: URL.createObjectURL(new Blob([t], { type: "text/html" })), external: false };
      return { href: "data/" + p, external: false };
    }
    const p = normPath(url.replace(/^file:\/\//, ""));
    if (/^documentation\//i.test(p)) return { href: "data/" + p, external: false };
    const local = normPath(dirOf(this.snap.path) + "/" + p);
    if (this.snap.path.startsWith("Interlockings/")) return { href: "data/" + local, external: false };
    const t = this.files.read(local);
    if (t !== null) return { href: URL.createObjectURL(new Blob([t], { type: "text/html" })), external: false };
    return { href: "data/" + p, external: false };
  }

  /* ---- debugging / test access ---- */
  debug = {
    relay: (name: string): boolean | null => {
      const m = /^(\d+)(.+)$/.exec(name);
      if (!m) return null;
      const r = getRelay2NoCreate(Number(m[1]), m[2].toUpperCase());
      return r ? relayState(r) : null;
    },
    /** Find a clickable object like the demo system does (a switch is its owning track segment). */
    find: (type: keyof typeof TypeId, nom: number): GraphicObject | null =>
      type === "TURNOUT" ? findDemoHitTurnout(nom) : type === "TRACKSEC" ? findDemoHitCircuit(nom) : findObjectByNomAndType(nom, TypeId[type]),
    center: (type: keyof typeof TypeId, nom: number): { x: number; y: number } | null => {
      const g = engine.debug.find(type, nom);
      return g ? { x: (g.sc_limits.left + g.sc_limits.right) / 2, y: (g.sc_limits.top + g.sc_limits.bottom) / 2 } : null;
    },
    advance: (ms: number) => this.advance(ms),
  };
}

export const engine = new Engine();

function isFileUrl(text: string): boolean {
  return /^file:\/\//i.test(text.trim());
}

/** Strip Windows menu mnemonics ("&Interlocking" -> "Interlocking"; "&&" -> "&"). */
function menuTitle(t: string): string {
  return t.replace(/&(&?)/g, "$1");
}
