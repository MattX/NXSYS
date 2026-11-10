/*
 * Phase 5 tool controller: relay drafter page, full-signal windows, relay state/list/tracer windows,
 * relay prompt, context menu, message-box queue and preferences. A small external store (useTools).
 */
import { clampWindowTop } from "../workarea";
import { useSyncExternalStore } from "react";
import { RelayDrafter } from "@nxsys/core/src/tools/ldgut";
import { RelayTracer, lookupRelay, relaysForObject } from "@nxsys/core/src/tools/relayinfo";
import { installContextMenus, toolHooks, type ObjectMenu } from "@nxsys/core/src/tools/contextmenu";
import { fullSignalTitle } from "@nxsys/core/src/tools/fullsig";
import { interlockingStatusReport } from "@nxsys/core/src/tools/statusreport";
import { Signal, SHOW_STOPS_RED, SHOW_STOPS_ALWAYS, SHOW_STOPS_NEVER, implementShowStopPolicy, stopState } from "@nxsys/core/src/layout/signal";
import type { Relay } from "@nxsys/core/src/relay/relay";
import { engine } from "../engine";

export type WinKind = "drafter" | "fullsig" | "relaystate" | "relaylist" | "tracer" | "status" | "selector";
export interface ToolWin {
  id: number;
  kind: WinKind;
  x: number;
  y: number;
  title: string;
  signal?: Signal;
  relay?: Relay;
  text?: string;
  /** selector: relays of an object and the operation ("Draw"/"Query") */
  relays?: Relay[];
  op?: "Draw" | "Query";
  z: number;
}
export interface PopupMenu {
  x: number;
  y: number;
  title: string;
  items: { id: string; label: string; enabled: boolean }[];
  run: (id: string) => void;
}
export interface Prefs {
  /** Mac "FullSignalDisplaysAreViews": show full-signal displays as frameless overlays on the panel */
  fullSigsAreViews: boolean;
  /** Mac "SignalRightClickIsMenu" */
  signalRightIsMenu: boolean;
  /** Mac "LastShowStopsPolicy" */
  stopPolicy: number;
}
export interface Message {
  id: number;
  title: string;
  text: string;
}

const PREFS_KEY = "nxsys.preferences";
const DEFAULT_PREFS: Prefs = { fullSigsAreViews: false, signalRightIsMenu: false, stopPolicy: SHOW_STOPS_RED };

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<Prefs>;
      const stop = [SHOW_STOPS_RED, SHOW_STOPS_ALWAYS, SHOW_STOPS_NEVER].includes(p.stopPolicy as number) ? (p.stopPolicy as number) : SHOW_STOPS_RED;
      return { fullSigsAreViews: !!p.fullSigsAreViews, signalRightIsMenu: !!p.signalRightIsMenu, stopPolicy: stop };
    }
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULT_PREFS };
}

export interface ToolsSnapshot {
  rev: number;
  wins: ToolWin[];
  popup: PopupMenu | null;
  prompt: { title: string; label: string; onSubmit: (text: string) => string | null } | null;
  messages: Message[];
  prefsOpen: boolean;
  prefs: Prefs;
  /** bumps whenever something displayed in a tool window may have changed (relay transitions, repaint) */
  frame: number;
  traceOn: boolean;
  consoleTraceOn: boolean;
}

class Tools {
  readonly drafter = new RelayDrafter();
  readonly tracer = new RelayTracer();
  lastPointer = { x: 0, y: 0 };
  private nextId = 1;
  private zTop = 1;
  private nextMsg = 1;
  private listeners = new Set<() => void>();
  private frameQueued = false;
  recentRelays: string[] = [];
  private snap: ToolsSnapshot = {
    rev: 0,
    wins: [],
    popup: null,
    prompt: null,
    messages: [],
    prefsOpen: false,
    prefs: loadPrefs(),
    frame: 0,
    traceOn: false,
    consoleTraceOn: false,
  };

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = (): ToolsSnapshot => this.snap;
  private set(p: Partial<ToolsSnapshot>): void {
    this.snap = { ...this.snap, ...p, rev: this.snap.rev + 1 };
    for (const l of this.listeners) l();
  }

  /** Called when the engine invalidates the panel (relay transitions, object changes): repaint tool canvases once per frame. */
  touch = (): void => {
    if (this.frameQueued) return;
    this.frameQueued = true;
    requestAnimationFrame(() => {
      this.frameQueued = false;
      if (this.snap.wins.length) this.set({ frame: this.snap.frame + 1 });
    });
  };

  init(): void {
    engine.invalidateListeners.add(this.touch);
    installContextMenus((m) => this.showObjectMenu(m));
    toolHooks.drawRelaysForObject = (n, t) => this.relaysForObjectDialog(n, t, "Draw");
    toolHooks.queryRelaysForObject = (n, t) => this.relaysForObjectDialog(n, t, "Query");
    toolHooks.showFullSignal = (s) => this.openFullSignal(s);
    Signal.uiHooks.showFullsigWindow = (s, show) => (show ? this.openFullSignal(s) : this.closeFullSignal(s));
    engine.messageHook = (title, text) => this.postMessage(title, text);
    engine.layoutChangedHook = () => {
      this.layoutChanged();
      this.applyPrefs(this.snap.prefs);
    };
    this.applyPrefs(this.snap.prefs);
  }

  /** (Re)apply persisted preferences to the core (Preferences +initPreferredSettings). */
  applyPrefs(p: Prefs): void {
    Signal.SignalRIsMenu = p.signalRightIsMenu;
    if (stopState.ShowStopPolicy !== p.stopPolicy) engine.setStopPolicy(p.stopPolicy);
  }
  setPrefs(p: Prefs): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(p));
    } catch {
      /* ignore */
    }
    this.set({ prefs: p, prefsOpen: false });
    this.applyPrefs(p);
  }
  openPrefs(open: boolean): void {
    this.set({ prefsOpen: open });
  }

  /* ---- windows ---- */
  private add(w: Omit<ToolWin, "id" | "z">): ToolWin {
    const win: ToolWin = { ...w, y: clampWindowTop(w.y), id: this.nextId++, z: ++this.zTop };
    this.set({ wins: [...this.snap.wins, win] });
    return win;
  }
  private findKind(kind: WinKind): ToolWin | undefined {
    return this.snap.wins.find((w) => w.kind === kind);
  }
  focus(id: number): void {
    this.set({ wins: this.snap.wins.map((w) => (w.id === id ? { ...w, z: ++this.zTop } : w)) });
  }
  move(id: number, x: number, y: number): void {
    y = clampWindowTop(y);
    this.set({ wins: this.snap.wins.map((w) => (w.id === id ? { ...w, x, y } : w)) });
  }
  update(id: number, patch: Partial<ToolWin>): void {
    this.set({ wins: this.snap.wins.map((w) => (w.id === id ? { ...w, ...patch } : w)) });
  }
  close(id: number): void {
    const w = this.snap.wins.find((x) => x.id === id);
    if (!w) return;
    if (w.kind === "fullsig" && w.signal) w.signal.Window = null;
    if (w.kind === "tracer") {
      this.tracer.setWindow(false);
      this.set({ traceOn: false });
    }
    this.set({ wins: this.snap.wins.filter((x) => x.id !== id) });
  }
  closeKind(kind: WinKind): void {
    for (const w of this.snap.wins.filter((x) => x.kind === kind)) this.close(w.id);
  }
  /** Cleanup for a layout change (DraftsbeingCleanupForOneLayout + CloseAllFSWs). */
  layoutChanged(): void {
    this.drafter.cleanUp();
    for (const w of this.snap.wins) if (w.kind === "fullsig" && w.signal) w.signal.Window = null;
    this.set({ wins: this.snap.wins.filter((w) => w.kind === "tracer"), popup: null, prompt: null });
  }

  /* ---- full signals ---- */
  openFullSignal(s: Signal): void {
    const ex = this.snap.wins.find((w) => w.kind === "fullsig" && w.signal === s);
    if (ex) {
      this.focus(ex.id);
      return;
    }
    s.Window = true; // non-null: open (Signal.updateStop invalidates)
    const n = this.snap.wins.filter((w) => w.kind === "fullsig").length;
    // C++ puts the window just below the signal; we cascade near the pointer
    this.add({ kind: "fullsig", title: fullSignalTitle(s), signal: s, x: Math.max(8, this.lastPointer.x + 10 + 14 * (n % 5)), y: Math.max(8, this.lastPointer.y + 20) });
  }
  closeFullSignal(s: Signal): void {
    for (const w of this.snap.wins.filter((x) => x.kind === "fullsig" && x.signal === s)) this.close(w.id);
  }
  /** View > Flush Full Signal Displays */
  flushFullSignals(): void {
    this.closeKind("fullsig");
  }

  /* ---- relay drafter ---- */
  openDrafter(): void {
    const ex = this.findKind("drafter");
    if (ex) this.focus(ex.id);
    else this.add({ kind: "drafter", title: "Relay Draftsperson", x: 16, y: 60 });
  }
  toggleDrafter(): void {
    const ex = this.findKind("drafter");
    if (ex) this.close(ex.id);
    else this.openDrafter();
  }
  /** DrawRelayAPI */
  drawRelay(r: Relay): void {
    if (!this.drafter.drawRelayFromRelay(r)) return;
    this.drafter.placeDrawing();
    this.openDrafter();
    this.touch();
    this.set({ frame: this.snap.frame + 1 });
  }
  drawRelayByName(name: string): void {
    const r = lookupRelay(name);
    if (!r) {
      this.postMessage("NXSYS Relay Draftsperson", `No such relay: ${name}`);
      return;
    }
    this.drawRelay(r);
  }
  clearDrafter(): void {
    this.drafter.clear();
    this.set({ frame: this.snap.frame + 1 });
  }

  /* ---- relay prompts and dialogs ---- */
  /** AskForAndDrawRelay / AskForAndShowStateRelay */
  askRelay(title: string, then: (r: Relay) => void): void {
    this.set({
      prompt: {
        title,
        label: "Enter relay symbol (e.g., 244pbs)",
        onSubmit: (text) => {
          if (text.trim() === "") return null;
          const r = lookupRelay(text);
          if (!r) return `No such relay: ${text.trim()}`;
          this.recentRelays = [text.trim().toUpperCase(), ...this.recentRelays.filter((x) => x !== text.trim().toUpperCase())].slice(0, 20);
          this.set({ prompt: null });
          then(r);
          return null;
        },
      },
    });
  }
  closePrompt(): void {
    this.set({ prompt: null });
  }
  askDraw(): void {
    this.askRelay("Draw Relay Circuit", (r) => this.drawRelay(r));
  }
  askRelayByName(name: string): void {
    const r = lookupRelay(name);
    if (r) this.showRelayState(r);
  }
  askQuery(): void {
    this.askRelay("Query Relay State", (r) => this.showRelayState(r));
  }
  showRelayState(r: Relay): void {
    const ex = this.findKind("relaystate");
    if (ex) {
      this.update(ex.id, { relay: r, title: `Relay ${r.name}` });
      this.focus(ex.id);
    } else this.add({ kind: "relaystate", title: `Relay ${r.name}`, relay: r, x: Math.max(8, window.innerWidth - 300), y: 90 });
  }
  /** DrawRelaysForObject / ShowStateRelaysForObject */
  relaysForObjectDialog(objNo: number, typeName: string, op: "Draw" | "Query"): void {
    const relays = relaysForObject(objNo);
    if (!relays.length) {
      this.postMessage("Relay Dialog Manager", "Seemingly no relays for this object.");
      return;
    }
    this.add({ kind: "selector", title: `${op} relay`, op, relays, text: `${typeName} ${objNo}`, x: this.lastPointer.x + 10, y: Math.max(8, this.lastPointer.y - 40) });
  }
  openRelayList(): void {
    const ex = this.findKind("relaylist");
    if (ex) this.focus(ex.id);
    else this.add({ kind: "relaylist", title: "Relay List", x: Math.max(8, window.innerWidth - 640), y: 90 });
  }

  /* ---- tracer ---- */
  setTraceWindow(on: boolean): void {
    const ex = this.findKind("tracer");
    if (on) {
      if (!ex) this.add({ kind: "tracer", title: "Relay Trace", x: Math.max(8, window.innerWidth - 480), y: Math.max(60, window.innerHeight - 400) });
      else this.focus(ex.id);
      this.tracer.setWindow(true);
      this.set({ traceOn: true });
    } else {
      if (ex) this.close(ex.id);
      this.tracer.setWindow(false);
      this.set({ traceOn: false });
    }
  }
  toggleTraceWindow(): void {
    this.setTraceWindow(!this.snap.traceOn);
  }
  toggleTraceConsole(): void {
    const on = !this.snap.consoleTraceOn;
    this.tracer.setConsole(on);
    this.set({ consoleTraceOn: on });
  }

  /* ---- status report ---- */
  showStatus(): void {
    const text = interlockingStatusReport(null);
    const ex = this.findKind("status");
    if (ex) this.update(ex.id, { text });
    else this.add({ kind: "status", title: "Interlocking File Info", text, x: 200, y: 100 });
  }

  /* ---- context menus ---- */
  showObjectMenu(m: ObjectMenu): void {
    this.popup({ x: this.lastPointer.x, y: this.lastPointer.y, title: m.title, items: m.items, run: (id) => m.run(id) });
  }
  popup(p: PopupMenu | null): void {
    this.set({ popup: p });
  }

  /* ---- message boxes (host.messageBox "ok" kind is non-blocking) ---- */
  postMessage(title: string, text: string): void {
    this.set({ messages: [...this.snap.messages, { id: this.nextMsg++, title, text }] });
  }
  dismissMessage(id: number): void {
    this.set({ messages: this.snap.messages.filter((m) => m.id !== id) });
  }
}

export const tools = new Tools();

export function useTools(): ToolsSnapshot {
  return useSyncExternalStore(tools.subscribe, tools.getSnapshot);
}

(window as unknown as { __tools: unknown }).__tools = tools;
