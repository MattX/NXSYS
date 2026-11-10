/*
 * Object context menus: the menu definitions of NXSYSMac/ContextMenu.mm and the per-object EditContextMenu /
 * command dispatch of signal.cpp, swkey.cpp, v2/trackseg.cpp and v2/xturnout.cpp, UI-free.
 *
 * Gesture (MainView.mm rodaCommon): CONTROL + right mouse button (WM_NXGO_RBUTTONCONTROL) opens the menu; a plain
 * right click throws a switch / shows the full-signal display (or this menu if the SignalRIsMenu preference is on).
 *
 * ContextMenu.mm's cleanupGratuitousSeparators, as written, removes every separator (its `next != nil` test is always
 * true for a non-last item); the Mac menus therefore have no separators and neither do these.
 */
import { GraphicObject, TypeId, objectUIHooks } from "../layout/nxgo.js";
import { SIGF_CO, Signal, type PanelSignal } from "../layout/signal.js";
import { SwitchKey } from "../layout/swkey.js";
import type { TrackSeg } from "../layout/xtgtrack.js";
import { getRelay2NoCreate, relayState } from "../relay/rlyapi.js";
import { relayUseDefined } from "../relay/relay.js";

export interface MenuEntry {
  id: string;
  label: string;
  enabled: boolean;
}
export interface ObjectMenu {
  title: string;
  items: MenuEntry[];
  /** perform a command (the id of one of `items`) */
  run(id: string): void;
}

/** Services supplied by the UI. */
export const toolHooks: {
  drawRelaysForObject?: (objNo: number, typeName: string) => void;
  queryRelaysForObject?: (objNo: number, typeName: string) => void;
  showFullSignal?: (s: Signal) => void;
  trainWindowForTrack?: (seg: TrackSeg) => void;
} = {};

type Def = [id: string, label: string][];
const SIGNAL: Def = [
  ["FULL", "Show Full Signal"],
  ["DRAW", "Draw relay"],
  ["FLEET", "Toggle fleeting"],
  ["INITIATE", "Press (Initiate) PB"],
  ["CANCEL", "Cancel"],
  ["CALLON", "Call on (initiate)"],
  ["VPB", "CO Stop Release (VPB)"],
  ["QUERY", "Query Relay"],
  ["RESETAPP", "Reset Approach locking"],
];
const SWITCH: Def = [
  ["DRAW", "Draw relay..."],
  ["REVERSE", "Call Reverse"],
  ["NORMAL", "Call Normal"],
  ["QUERY", "Query relay..."],
];
const TRACK: Def = [
  ["DRAW", "Draw relay..."],
  ["OCCUPY", "Occupy"],
  ["VACATE", "Vacate"],
  ["TRAIN", "Train..."],
  ["QUERY", "Query relay..."],
];
const SWKEY: Def = [
  ["REVERSE", "Call Reverse"],
  ["NORMAL", "Call Normal"],
  ["REVERSE_HOLD", "Call Reverse, HOLD"],
  ["NORMAL_HOLD", "Call Normal, HOLD"],
  ["UNHOLD", "Unlatch hold"],
  ["DRAW", "Draw relay..."],
  ["QUERY", "Query relay..."],
];

function make(title: string, def: Def, edit: (state: Map<string, boolean | null>) => void, run: (id: string) => void): ObjectMenu {
  const state = new Map<string, boolean | null>(def.map(([id]) => [id, true])); // null = deleted
  edit(state);
  return {
    title,
    items: def.filter(([id]) => state.get(id) !== null).map(([id, label]) => ({ id, label, enabled: state.get(id) === true })),
    run,
  };
}

function signalMenu(s: Signal): ObjectMenu {
  const id = s.XlkgNo ? s.XlkgNo : s.StationNo;
  return make(
    "Signal",
    SIGNAL,
    (m) => {
      if (!s.XlkgNo) {
        for (const k of ["DRAW", "INITIATE", "CANCEL", "VPB", "CALLON", "RESETAPP", "FLEET"]) m.set(k, null);
      } else {
        if (s.initiated()) m.set("INITIATE", false);
        else {
          m.set("CANCEL", false);
          m.set("CALLON", false);
        }
        const hasco = relayUseDefined(s.COPB);
        if (!hasco) {
          m.set("CALLON", null);
          m.set("VPB", null);
        }
        const as = getRelay2NoCreate(s.XlkgNo, "AS");
        if (!as) m.set("RESETAPP", null);
        else if (relayState(as)) m.set("RESETAPP", false);
        if (!(s.FL && getRelay2NoCreate(s.XlkgNo, "FL") && relayUseDefined(s.FL))) m.set("FLEET", null);
        if (hasco && !(s.MiscG & SIGF_CO && s.TStop)) m.set("VPB", false);
        if (hasco && s.MiscG & SIGF_CO && m.get("CALLON") !== null) m.set("CALLON", true);
      }
    },
    (cmd) => {
      switch (cmd) {
        case "DRAW":
          toolHooks.drawRelaysForObject?.(id, "Signal");
          break;
        case "QUERY":
          toolHooks.queryRelaysForObject?.(id, "Signal");
          break;
        case "FULL":
          if (toolHooks.showFullSignal) toolHooks.showFullSignal(s);
          else Signal.uiHooks.showFullsigWindow?.(s, true);
          break;
        case "INITIATE":
          s.initiate();
          break;
        case "CALLON":
          s.callOn();
          break;
        case "FLEET":
          s.fleet(!s.Fleeted);
          break;
        case "CANCEL":
          s.cancel();
          break;
        case "VPB":
          s.TStop?.pressStopPB();
          break;
        case "RESETAPP":
          s.resetApproach();
          break;
      }
    },
  );
}

function switchMenu(seg: TrackSeg): ObjectMenu {
  const t = seg.OwningTurnout!;
  return make(
    "Switch",
    SWITCH,
    (m) => {
      if (!t.MovingPhase && !t.Thrown) m.set("NORMAL", false);
      if (!t.MovingPhase && t.Thrown) m.set("REVERSE", false);
    },
    (cmd) => {
      if (cmd === "NORMAL") t.throwSwitch(false);
      else if (cmd === "REVERSE") t.throwSwitch(true);
      else if (cmd === "DRAW") toolHooks.drawRelaysForObject?.(t.XlkgNo, "Switch");
      else if (cmd === "QUERY") toolHooks.queryRelaysForObject?.(t.XlkgNo, "Switch");
    },
  );
}

function trackMenu(seg: TrackSeg): ObjectMenu {
  const c = seg.Circuit!;
  return make(
    "Track Section",
    TRACK,
    (m) => {
      m.set(c.Occupied ? "OCCUPY" : "VACATE", null);
      if (!seg.TrainCount) m.set("TRAIN", false);
    },
    (cmd) => {
      if (cmd === "TRAIN") {
        if (seg.TrainCount) toolHooks.trainWindowForTrack?.(seg);
      } else if (cmd === "OCCUPY") c.setOccupied(true);
      else if (cmd === "VACATE") c.setOccupied(false);
      else if (cmd === "DRAW") toolHooks.drawRelaysForObject?.(c.StationNo, "Track Section");
      else if (cmd === "QUERY") toolHooks.queryRelaysForObject?.(c.StationNo, "Track Section");
    },
  );
}

function swkeyMenu(k: SwitchKey): ObjectMenu {
  const n = k.Turn!.XlkgNo;
  return make(
    "Switch key",
    SWKEY,
    (m) => {
      const nhold = relayState(k.Turn!.NL);
      const rhold = relayState(k.Turn!.RL);
      if (!k.Turn!.Thrown || k.Normal || nhold) m.set("NORMAL", false);
      if (k.Turn!.Thrown || k.Reverse || rhold) m.set("REVERSE", false);
      if (nhold) m.set("NORMAL_HOLD", false);
      if (rhold) m.set("REVERSE_HOLD", false);
      if (!(rhold || nhold)) m.set("UNHOLD", false);
    },
    (cmd) => {
      if (cmd === "NORMAL") k.press(false, false);
      else if (cmd === "REVERSE") k.press(true, false);
      else if (cmd === "NORMAL_HOLD") k.press(false, true);
      else if (cmd === "REVERSE_HOLD") k.press(true, true);
      else if (cmd === "UNHOLD") k.clearAux();
      else if (cmd === "DRAW") toolHooks.drawRelaysForObject?.(n, "Switch");
      else if (cmd === "QUERY") toolHooks.queryRelaysForObject?.(n, "Switch");
    },
  );
}

/** The menu for a hit object (signal panel object / signal, track segment, switch key), or null. */
export function buildObjectMenu(g: GraphicObject | Signal): ObjectMenu | null {
  if (g instanceof Signal) return signalMenu(g);
  if (g instanceof SwitchKey) return swkeyMenu(g);
  if (g.typeID() === TypeId.SIGNAL) return signalMenu((g as PanelSignal).Sig);
  if (g.typeID() === TypeId.TRACKSEG) {
    const seg = g as TrackSeg;
    if (seg.OwningTurnout) return switchMenu(seg);
    if (seg.Circuit) return trackMenu(seg);
  }
  return null;
}

/** Install the core hooks: `show` receives the menu to display (e.g. at the last hit position). */
export function installContextMenus(show: (m: ObjectMenu) => void): void {
  const f = (g: GraphicObject | Signal): void => {
    const m = buildObjectMenu(g);
    if (m) show(m);
  };
  objectUIHooks.contextMenu = f;
  Signal.uiHooks.contextMenu = (s) => f(s);
}
