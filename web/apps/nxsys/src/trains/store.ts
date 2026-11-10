/*
 * Train UI controller (Mac: AppDelegate Trains menu + ChooseTrack + TrainDlgController): an external
 * store over the core train system. Panels are non-modal and update live from the train's dialog model.
 */
import { clampWindowTop } from "../workarea";
import { useSyncExternalStore } from "react";
import {
  CmHaltTrains,
  CmHideTrainWindows,
  CmKillTrains,
  CmShowTrainWindows,
  TRAIN_HALTCTL_GO,
  TRAIN_HALTCTL_HALTED,
  TRD_COPB,
  TRD_DEFIANT,
  TRD_HALT,
  TRD_KILL,
  TRD_OBSERVANT,
  TRD_REV,
  allTrains,
  trainDialog,
  trainEntryPoints,
  trainHooks,
  trainMiscCtl,
  windowToTopFromTrackUnit,
  type Train,
} from "@nxsys/core/src/trains/train";
import { objectUIHooks, type GraphicObject } from "@nxsys/core/src/layout/nxgo";
import { toolHooks } from "@nxsys/core/src/tools/contextmenu";
import { engine } from "../engine";

export interface PanelPos {
  x: number;
  y: number;
  z: number;
  minimized: boolean;
}
export interface TrainsSnapshot {
  rev: number;
  /** "new train" placement mode (Mac ChooseTrack window up) */
  offering: null | { halted: boolean };
  trains: Train[];
}

type Listener = () => void;

class TrainStore {
  private snap: TrainsSnapshot = { rev: 0, offering: null, trains: [] };
  private listeners = new Set<Listener>();
  private pos = new Map<number, PanelPos>();
  private zTop = 1;
  private pending = false;
  private inited = false;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = (): TrainsSnapshot => this.snap;

  private emit(): void {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.snap = { ...this.snap, rev: this.snap.rev + 1, trains: allTrains() };
      this.listeners.forEach((l) => l());
    });
  }

  init(): void {
    if (this.inited) return;
    this.inited = true;
    trainHooks.created = (t) => {
      const n = this.pos.size;
      this.pos.set(t.id, {
        x: 24 + (n % 6) * 34,
        y: clampWindowTop(110 + (n % 6) * 30),
        z: ++this.zTop,
        minimized: t.dlg.window === "minimized",
      });
      this.emit();
    };
    trainHooks.removed = (t) => {
      this.pos.delete(t.id);
      this.emit();
    };
    trainHooks.changed = () => this.emit();
    trainHooks.showWindow = (t, mode, focus) => {
      const p = this.pos.get(t.id);
      if (!p) return;
      if (mode === "minimized") p.minimized = true;
      else p.minimized = false;
      if (focus) p.z = ++this.zTop;
      this.emit();
    };
    objectUIHooks.chooseTrack = (g: GraphicObject) => {
      const off = this.snap.offering;
      if (!off) return false;
      this.snap = { ...this.snap, offering: null };
      trainDialog(g, off.halted ? TRAIN_HALTCTL_HALTED : TRAIN_HALTCTL_GO);
      engine.bump();
      this.emit();
      return true;
    };
    toolHooks.trainWindowForTrack = (seg) => void windowToTopFromTrackUnit(seg);
    this.emit();
  }

  position(id: number): PanelPos {
    return this.pos.get(id) ?? { x: 24, y: 110, z: 1, minimized: false };
  }
  move(id: number, x: number, y: number): void {
    const p = this.pos.get(id);
    if (p) {
      p.x = x;
      p.y = clampWindowTop(y);
      this.emit();
    }
  }
  focus(id: number): void {
    const p = this.pos.get(id);
    if (p && p.z !== this.zTop) {
      p.z = ++this.zTop;
      this.emit();
    }
  }
  setMinimized(id: number, m: boolean): void {
    const p = this.pos.get(id);
    if (p) {
      p.minimized = m;
      this.emit();
    }
  }

  /* ---- Trains menu ---- */
  offer(halted: boolean): void {
    this.snap = { ...this.snap, offering: { halted } };
    this.emit();
  }
  cancelOffer(): void {
    this.snap = { ...this.snap, offering: null };
    this.emit();
  }
  /** "New train" at a listed entry point */
  newAt(seg: GraphicObject, halted: boolean): void {
    trainDialog(seg, halted ? TRAIN_HALTCTL_HALTED : TRAIN_HALTCTL_GO);
    engine.bump();
  }
  entryPoints = trainEntryPoints;
  haltAll(): void {
    trainMiscCtl(CmHaltTrains);
  }
  killAll(): void {
    trainMiscCtl(CmKillTrains);
    engine.bump();
  }
  minimizeAll(): void {
    for (const t of allTrains()) this.setMinimized(t.id, true);
    trainMiscCtl(CmHideTrainWindows);
  }
  showAll(): void {
    for (const t of allTrains()) this.setMinimized(t.id, false);
    trainMiscCtl(CmShowTrainWindows);
  }
  /** TrackSeg context menu "Train...": bring the owning train's window forward */
  windowForTrack = windowToTopFromTrackUnit;

  /* ---- per-train commands (TrainDlgController actions) ---- */
  observant(t: Train): void {
    t.command(TRD_OBSERVANT);
  }
  freeWill(t: Train): void {
    t.command(TRD_DEFIANT);
  }
  halt(t: Train): void {
    t.command(TRD_HALT);
  }
  reverse(t: Train): void {
    t.command(TRD_REV);
    engine.bump();
  }
  kill(t: Train): void {
    t.command(TRD_KILL);
    engine.bump();
  }
  callOn(t: Train): void {
    t.command(TRD_COPB);
  }
  slider(t: Train, of100: number): void {
    t.setSpeedFractional(of100 / 100.0);
  }
}

export const trainStore = new TrainStore();

export function useTrains(): TrainsSnapshot {
  return useSyncExternalStore(trainStore.subscribe, trainStore.getSnapshot);
}
