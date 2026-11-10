/*
 * Lisp data model for the NXSYS relay language — TypeScript port of NXSYS/lisp.h
 * and NXSYS/RelayLispSubstrate.cpp.
 *
 * Representation (C++ `enum class Lisp` -> TS):
 *   ATOM     -> Sym (interned; identity comparison is valid)
 *   NUM      -> number (always an integer; "fixnum")
 *   FLOAT    -> LFloat
 *   RATIONAL -> LRational
 *   STRING   -> string (JS primitive)
 *   CHAR     -> LChar
 *   VECTOR   -> LVector
 *   CONS     -> Cons
 *   RLYSYM   -> RlySym (interned per (n, type); identity comparison is valid)
 *   tNULL    -> EOF_OBJ / READ_ERROR_OBJ sentinels (never appear inside structure)
 *
 * The empty list reads as NIL, exactly as in the C++ reader.
 */

import type { Relay } from "../relay/relay.js";

export class Sym {
  /** Use intern(); never construct directly. */
  constructor(readonly name: string) {}
  toString(): string {
    return this.name;
  }
}

export class Cons {
  constructor(
    public car: Sexpr,
    public cdr: Sexpr,
  ) {}
}

export class LChar {
  constructor(readonly ch: string) {}
}

export class LFloat {
  constructor(readonly value: number) {}
}

export class LRational {
  constructor(
    readonly num: number,
    readonly den: number,
  ) {}
}

export class LVector {
  constructor(readonly items: Sexpr[]) {}
}

/** Relay symbol: "4732TP" -> n = 4732, type = "TP". Type is stored upper-cased. */
export class RlySym {
  relay: Relay | null = null;
  constructor(
    readonly n: number,
    readonly type: string,
  ) {}
  /** Printed representation, identical to C++ Rlysym::PRep(). */
  toString(): string {
    return `${this.n}${this.type}`;
  }
}

/** Sentinel returned by readers at end of input / on read error (C++ tNULL objects). */
export class LispSentinel {
  constructor(readonly what: "EOF" | "READ_ERROR" | "NULL") {}
}
export const EOF_OBJ = new LispSentinel("EOF");
export const READ_ERROR_OBJ = new LispSentinel("READ_ERROR");
/** C++ default-constructed Sexpr (tNULL with null pointer); prints "%NULL<0>". Added by the reader port. */
export const NULL_OBJ = new LispSentinel("NULL");

export type Sexpr = Sym | Cons | number | string | LChar | LFloat | LRational | LVector | RlySym;
export type ReadResult = Sexpr | LispSentinel;

/* ---------------- atom symbol table (permanent) ---------------- */

const symbolTable = new Map<string, Sym>();

/** Intern exactly the given name. The reader upper-cases before calling this. */
export function intern(name: string): Sym {
  let s = symbolTable.get(name);
  if (!s) {
    s = new Sym(name);
    symbolTable.set(name, s);
  }
  return s;
}

export const NIL = intern("NIL");
export const T = intern("T");
export const QUOTE = intern("QUOTE");
export const FUNCTION = intern("FUNCTION");
export const DEFRMACRO = intern("DEFRMACRO");
export const FORMS = intern("FORMS");
export const ARG = intern("ARG");

/* ---------------- relay symbol table (reset per interlocking) ---------------- */

/*
 * C++ keeps an unordered_map, whose iteration order is implementation-defined (and
 * differs between libc++ and libstdc++). We define the canonical order as
 * INSERTION order — the headless C++ trace harness is patched to match.
 */
const relaySymbolTable = new Map<string, RlySym>();

function rlyKey(n: number, type: string): string {
  return `${n}\u0000${type}`;
}

export function internRlysym(n: number, type: string): RlySym {
  const t = type.toUpperCase();
  const k = rlyKey(n, t);
  let r = relaySymbolTable.get(k);
  if (!r) {
    r = new RlySym(n, t);
    relaySymbolTable.set(k, r);
  }
  return r;
}

export function internRlysymNoCreate(n: number, type: string): RlySym | null {
  return relaySymbolTable.get(rlyKey(n, type.toUpperCase())) ?? null;
}

/** "  4732TP" -> RlySym or null (C++ RlysymFromStringNocreate). */
export function rlysymFromStringNoCreate(s: string): RlySym | null {
  const m = /^\s*(\d*)(.*)$/s.exec(s)!;
  return internRlysymNoCreate(m[1] ? parseInt(m[1], 10) : 0, m[2]);
}

export function getRelayNoCreate(n: number, type: string): Relay | null {
  return internRlysymNoCreate(n, type)?.relay ?? null;
}

/** Iterate all relay symbols in canonical (insertion) order. */
export function mapRelaySyms(fn: (r: RlySym) => void): void {
  for (const r of [...relaySymbolTable.values()]) fn(r);
}

export function allRelaySyms(): RlySym[] {
  return [...relaySymbolTable.values()];
}

export function clearRelaySymbols(): void {
  relaySymbolTable.clear();
}

/** C++ Rlysym::operator< — by number, then by type name. For UI sorting. */
export function compareRlysyms(a: RlySym, b: RlySym): number {
  if (a.n !== b.n) return a.n - b.n;
  return a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
}

/* ---------------- list helpers ---------------- */

export const isCons = (x: unknown): x is Cons => x instanceof Cons;
export const isNil = (x: unknown): boolean => x === NIL;
export const isSym = (x: unknown): x is Sym => x instanceof Sym;
export const isRlysym = (x: unknown): x is RlySym => x instanceof RlySym;
export const isFixnum = (x: unknown): x is number => typeof x === "number";
export const isNumber = (x: unknown): boolean =>
  typeof x === "number" || x instanceof LFloat || x instanceof LRational;

export function cons(a: Sexpr, b: Sexpr): Cons {
  return new Cons(a, b);
}

export function list(...items: Sexpr[]): Sexpr {
  let r: Sexpr = NIL;
  for (let i = items.length - 1; i >= 0; i--) r = new Cons(items[i], r);
  return r;
}

/** Elements of a proper (or dotted — tail ignored) list. */
export function listToArray(s: Sexpr): Sexpr[] {
  const out: Sexpr[] = [];
  while (s instanceof Cons) {
    out.push(s.car);
    s = s.cdr;
  }
  return out;
}

/** C++ ListLen: number of conses in the spine. */
export function listLength(s: Sexpr): number {
  let n = 0;
  while (s instanceof Cons) {
    n++;
    s = s.cdr;
  }
  return n;
}

export const car = (s: Sexpr): Sexpr => (s as Cons).car;
export const cdr = (s: Sexpr): Sexpr => (s as Cons).cdr;
export const cadr = (s: Sexpr): Sexpr => car(cdr(s));
export const cddr = (s: Sexpr): Sexpr => cdr(cdr(s));
export const caddr = (s: Sexpr): Sexpr => car(cddr(s));

/** Lisp error (C++ LispBarf). Callers decide whether to surface or swallow. */
export class LispError extends Error {
  constructor(
    message: string,
    readonly objects: readonly (Sexpr | ReadResult)[] = [],
  ) {
    super(message);
    this.name = "LispError";
  }
}
