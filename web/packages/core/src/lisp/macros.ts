/*
 * Port of NXSYS/lspmacro.cpp: DEFRMACRO / MaybeExpandMacro / MacroCleanup.
 * Preserved C++ quirks: lcopy/macexp drop the dotted tail of improper lists; calling a macro with
 * exactly 10 args barfs "Macro arg overflow"; the first definition of a name wins.
 */
import { lispBarf } from "./barf.js";
import { ARG, Cons, DEFRMACRO, EOF_OBJ, NIL, RlySym, Sym, clearRelaySymbols, internRlysym } from "./types.js";
import type { ReadResult, Sexpr } from "./types.js";

interface Macro {
  sym: Sym;
  exp: Sexpr;
  argct: number;
}

const Macros: Macro[] = [];
const MaxNMacargs = 10;
const Macargs: Sexpr[] = new Array<Sexpr>(MaxNMacargs).fill(NIL);
let NMacargs = 0;
let MacName: ReadResult = EOF_OBJ;

function lcopy(x: Sexpr): Sexpr {
  let copy: Sexpr = NIL;
  let last: Cons | null = null;
  while (x instanceof Cons) {
    const lcons = new Cons(lcopy(x.car), NIL);
    if (last === null) copy = lcons;
    else last.cdr = lcons;
    last = lcons;
    x = x.cdr;
  }
  return last === null ? x : copy;
}

/** @returns 1 defined, -1 duplicate (ignored), 0 error/not a defrmacro form */
export function defrmacro(arg: Sexpr): number {
  return defrmacroMaybeDup(arg, true);
}

export function defrmacroMaybeDup(arg: Sexpr, ignoreDup: boolean): number {
  if (!(arg instanceof Cons && arg.car === DEFRMACRO)) return 0;
  const bs = (): number => {
    lispBarf("Bad Syntax in DEFRMACRO");
    return 0;
  };
  let rest: Sexpr = arg.cdr;
  if (!(rest instanceof Cons)) return bs();
  if (!(rest.car instanceof Sym)) return bs();
  const sym = rest.car;
  rest = rest.cdr;
  if (!(rest instanceof Cons)) return bs();
  if (typeof rest.car !== "number") return bs();
  const argct = rest.car;
  rest = rest.cdr;
  if (!(rest instanceof Cons)) return bs();
  if (argct < 1 || argct > 10) return bs();
  for (const m of Macros) {
    if (m.sym === sym) {
      if (ignoreDup) return -1;
      lispBarf("Duplicate Macro", sym);
      return 0;
    }
  }
  Macros.push({ sym, argct, exp: lcopy(rest.car) });
  return 1;
}

function getMacargN(n: number): ReadResult {
  if (n < 1 || n > NMacargs) {
    lispBarf("Macro arg designator out of range", MacName, n);
    return EOF_OBJ;
  }
  return lcopy(Macargs[n - 1]);
}

function getMacarg(ns: Sexpr): ReadResult {
  if (typeof ns !== "number") {
    lispBarf("Invalid macro arg designator.", ns);
    return EOF_OBJ;
  }
  return getMacargN(ns);
}

function macsubst(x: Sexpr): ReadResult {
  if (!(x instanceof RlySym)) return x;
  const n = x.n;
  if (n === 0) return x; // Allow 0 as global
  const actual = getMacargN(n);
  if (typeof actual === "number") return internRlysym(actual, x.type);
  if (actual instanceof RlySym) return internRlysym(actual.n, x.type);
  lispBarf("Invalid actual parameter for relay sym substitution", MacName, actual);
  return x;
}

function macexp(x: Sexpr): ReadResult {
  if (x instanceof Cons && x.car === ARG) {
    const d = x.cdr;
    if (!(d instanceof Cons)) {
      // C++ would dereference CAR(NIL) here (undefined behavior)
      lispBarf("Invalid macro arg designator.", x);
      return EOF_OBJ;
    }
    return getMacarg(d.car);
  }
  let copy: Sexpr = NIL;
  let last: Cons | null = null;
  while (x instanceof Cons) {
    const lcons = new Cons(macexp(x.car) as Sexpr, NIL);
    if (last === null) copy = lcons;
    else last.cdr = lcons;
    last = lcons;
    x = x.cdr;
  }
  return last === null ? macsubst(x) : copy;
}

/** MaybeExpandMacro: the expansion, or EOF_OBJ if `s` is not a (successfully expanded) macro call. */
export function maybeExpandMacro(s: Sexpr): ReadResult {
  const ss = s;
  if (!(s instanceof Cons)) return EOF_OBJ;
  if (!(s.car instanceof Sym)) return EOF_OBJ;
  const head = s.car;
  const mp = Macros.find((m) => m.sym === head);
  if (!mp) return EOF_OBJ;
  MacName = head;
  let rest: Sexpr = s.cdr;
  for (NMacargs = 0; NMacargs < MaxNMacargs; NMacargs++) {
    if (!(rest instanceof Cons)) break;
    Macargs[NMacargs] = rest.car;
    rest = rest.cdr;
  }
  if (NMacargs >= MaxNMacargs) {
    lispBarf("Macro arg overflow", MacName);
    return EOF_OBJ;
  }
  let reslt: ReadResult = EOF_OBJ;
  if (NMacargs !== mp.argct) lispBarf("Wrong number of macro args", ss);
  else reslt = macexp(mp.exp);
  NMacargs = 0;
  MacName = EOF_OBJ;
  return reslt;
}

export function macroCleanup(): void {
  Macros.length = 0;
}

/** C++ dealloc_lisp_sys / LispCleanOutRelays (non-TLEDIT): drop macros and relay symbols.
 *  The atom table is permanent in the TS port (interned Syms stay valid). */
export function lispCleanOutRelays(): void {
  macroCleanup();
  clearRelaySymbols();
}
export const deallocLispSys = lispCleanOutRelays;
