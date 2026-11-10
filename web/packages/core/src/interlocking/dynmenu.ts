/*
 * Relay-operated menus (MENU form: "Train ID" button boxes) — port of the model half of
 * NXSYS/v2/dynmenu.cpp. No dialogs: `dynMenuUI` hooks let a host show/hide a box and update lamps.
 *
 * Model: DynMenu { Title, Nomenclature, Entries[], Up, TiedObject (signal), MNZ }, each
 * DynMenuEntry { String, ControlId, PushButtonRelay, ReporterRelay (lamp) }.
 * Actions: DynMenu.pushValidButton(controlId) / DynMenuEntry.pushTheButton() pulse the button relay.
 */
import { lispBarf } from "../lisp/barf.js";
import { Cons, NIL, RlySym, listLength, type Sexpr } from "../lisp/types.js";
import { TypeId, findObjectByNomAndType, type GraphicObject } from "../layout/nxgo.js";
import {
  createReportingRelay,
  defineRelayFromLisp2,
  pulseToRelay,
  reportToRelay,
  createRelay,
  type Relay,
} from "../relay/relay.js";
import { getRelay2NoCreate } from "../relay/rlyapi.js";

export const CONTROL_ID_BASE = 1000;

let dynMenusEnabled = true;

export const dynMenuUI = {
  /** Show/hide the ID box (DynMenu::ShowIDBox, after the tied object's position is known). */
  showIDBox: ((_menu: DynMenu, _state: boolean): void => {}) as (menu: DynMenu, state: boolean) => void,
  /** A lamp changed (DynMenuEntry::LampReport). */
  lampReport: ((_entry: DynMenuEntry, _state: boolean): void => {}) as (entry: DynMenuEntry, state: boolean) => void,
};

class DynMenuCreateException extends Error {}

export class DynMenuEntry {
  String: string;
  PushButtonRelay: Relay;
  ReporterRelay: Relay | null = null;
  /** lamp state as last reported (DynMenuEntry::BeforeShow reads ReporterRelay->State & 1) */
  Lamp = false;

  constructor(
    buttonDef: Sexpr,
    public Menu: DynMenu,
    public ControlId: number,
  ) {
    const lab = buttonDef instanceof Cons ? buttonDef.car : NIL;
    if (typeof lab !== "string") throw new DynMenuCreateException("Item destination label not a string");
    this.String = lab;
    const rest = (buttonDef as Cons).cdr;
    const rs = rest instanceof Cons ? rest.car : NIL;
    if (!(rs instanceof RlySym)) throw new DynMenuCreateException("Pushbutton relay symbol not a relay symbol");
    this.PushButtonRelay = createRelay(rs); // not a reporter
    // Defer back-pointing relay connection until all DynMenuEntries are in place...
  }

  finishUpInPlace(itemDef: Sexpr): void {
    const cddr = itemDef instanceof Cons && itemDef.cdr instanceof Cons ? itemDef.cdr.cdr : NIL;
    if (cddr instanceof Cons) {
      // Some don't have lamps (e.g., "Cancel").
      const rlysym = cddr.car as RlySym;
      this.ReporterRelay = createReportingRelay(rlysym);
      this.ReporterRelay.setReporter((state, v) => (v as DynMenuEntry).lampReport(state), this);
    }
  }

  pushTheButton(): void {
    pulseToRelay(this.PushButtonRelay);
  }

  beforeShow(): boolean {
    this.Lamp = !!this.ReporterRelay!.state;
    return this.Lamp;
  }

  lampReport(state: boolean): void {
    this.Lamp = state;
    dynMenuUI.lampReport(this, state);
  }
}

const menus: DynMenu[] = [];

export class DynMenu {
  Entries: DynMenuEntry[] = [];
  Title: string;
  Up = false;
  Nomenclature: number;
  MNZ: Relay | null;
  TiedObject: GraphicObject | null;

  constructor(rlysym: RlySym, title: string, items: Sexpr) {
    this.Nomenclature = rlysym.n;
    this.Title = title;
    /* point to NXSYS object not interested in their referrers */
    this.TiedObject = findObjectByNomAndType(this.Nomenclature, TypeId.SIGNAL);
    this.MNZ = getRelay2NoCreate(this.Nomenclature, "MNZ");

    let saveItems = items;
    for (let controlId = CONTROL_ID_BASE; items instanceof Cons; controlId++) {
      this.Entries.push(new DynMenuEntry(items.car, this, controlId));
      items = items.cdr;
    }
    /* Now, once they're all in place, do a second pass, setting up the callbacks. */
    for (const entry of this.Entries) {
      const item = (saveItems as Cons).car;
      saveItems = (saveItems as Cons).cdr;
      entry.finishUpInPlace(item);
    }

    /* Create the reporting relay (if it doesn't exist) */
    const rr = createReportingRelay(rlysym);
    rr.setReporter((state, v) => {
      if (dynMenusEnabled || !state) (v as DynMenu).showIDBox(state);
    }, this);
  }

  showIDBox(state: boolean): void {
    if (state) this.setLights();
    this.Up = state;
    dynMenuUI.showIDBox(this, state);
  }

  setLights(): void {
    for (const e of this.Entries) if (e.ReporterRelay) e.beforeShow(); // Cancel buttons don't have lights!
  }

  pushValidButton(controlId: number): boolean {
    const idx = controlId - CONTROL_ID_BASE;
    if (idx >= 0 && idx < this.Entries.length) {
      this.Entries[idx].pushTheButton();
      return true;
    }
    return false;
  }
}

/** C++ DefineMenuFromLisp; `s` is the cdr of the (MENU ...) form. */
export function defineMenuFromLisp(s: Sexpr): number {
  if (listLength(s) < 5) {
    lispBarf("Fewer than five arguments in MENU form", s);
    return 0;
  }
  const pop = (): Sexpr => {
    const c = s as Cons;
    s = c.cdr;
    return c.car;
  };
  const rlysym = pop(); // Needed for catch clause, too.
  try {
    if (!(rlysym instanceof RlySym)) throw new DynMenuCreateException("Required relay symbol in MENU not a relay symbol");

    const expr: Sexpr = new Cons(pop(), NIL); // Make it look like a train cdr.
    if (!defineRelayFromLisp2(rlysym, expr)) throw new DynMenuCreateException("Creation of menu relay failed");

    if (!(s instanceof Cons) || typeof s.car !== "string")
      throw new DynMenuCreateException("Title string in MENU not a Lisp string");
    const title = pop() as string;

    pop(); // options: ignorem for now.

    const buttonItems = pop();
    if (!(buttonItems instanceof Cons)) throw new DynMenuCreateException("Button list in MENU not a list");

    menus.push(new DynMenu(rlysym, title, buttonItems));
  } catch (e) {
    if (e instanceof DynMenuCreateException) {
      lispBarf("Error in dynamic MENU definition:\n" + e.message + "\n for MENU", rlysym);
      return 0;
    }
    throw e;
  }
  return 1;
}

export const dynMenusView = (): readonly DynMenu[] => menus;

/** Called at interlocking Deinstall and app shutdown */
export function destroyDynMenus(): void {
  menus.length = 0;
}

export function enableDynMenus(onoff: boolean): void {
  dynMenusEnabled = onoff;
}

let AZ: Relay | null = null; /* "Automatic control" relay. */

export function autoControlRelayExists(): boolean {
  AZ = getRelay2NoCreate(0, "AZ");
  return AZ !== null;
}

export function enableAutomaticOperation(onoff: boolean): void {
  if (AZ) reportToRelay(AZ, onoff);
}

/** Called by the Train system when a train reverses, to see if its new front end has an ID Box. */
export function trySignalIDBox(nomenclature: number): void {
  for (const m of menus) {
    if (m.Nomenclature === nomenclature) {
      if (m.MNZ) pulseToRelay(m.MNZ);
      break;
    }
  }
}
