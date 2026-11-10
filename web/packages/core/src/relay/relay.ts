/*
 * Relay logic engine — faithful TS port of NXSYS/relays.cpp (interpreted path only;
 * the compiled-code / .tko machinery is dropped).
 *
 * Fidelity notes (the supplied interlockings depend on these orderings):
 *  - maybeChangeState() calls the reporter BEFORE enqueueing the relay.
 *  - Run() processes a FIFO update queue; each dequeued relay re-evaluates its
 *    dependents in the order they were added (AddDependent de-duplicates).
 *  - External inputs arriving while Run() is active are deferred to a FIFO delay queue.
 *  - Limits: update queue 750 entries, 600 transitions per Run ("relay race").
 */

import {
  Cons,
  EOF_OBJ,
  NIL,
  RlySym,
  T,
  intern,
  internRlysym,
  listLength,
  mapRelaySyms,
  Sym,
  type ReadResult,
  type Sexpr,
} from "../lisp/types.js";
import { printSexpr } from "../lisp/printer.js";
import { scheduler, getTickCount } from "../clock/scheduler.js";
import { AppAbort, host } from "../host.js";

/* ---------------- logic nodes ---------------- */

export type Reporter = (state: boolean, object: unknown) => void;

/** Constant ONE/ZERO (C++ LF_Terminal | LF_const LNodes). */
export class LConst {
  readonly kind = "const" as const;
  constructor(readonly state: boolean) {}
}
export const ONE = new LConst(true);
export const ZERO = new LConst(false);

export class LNot {
  readonly kind = "not" as const;
  constructor(readonly opd: LNode) {}
}

/** LABEL'ed shared subexpression (C++ LCommShr). */
export class LShared {
  readonly kind = "shared" as const;
  constructor(public opd: LNode) {}
}

export class LOp {
  constructor(
    readonly kind: "and" | "or",
    readonly opds: LNode[],
  ) {}
}

export class Relay {
  readonly kind = "relay" as const;
  state = false;
  /** Relays whose expressions reference this one, in order of first reference. */
  dependents: Relay[] = [];
  /** Defining expression; ZERO if never defined (C++ initial &ZERO). null after a failed TIMER compile. */
  exp: LNode | null = ZERO;
  isTimer = false;
  reporter: Reporter | null = null;
  reporterObject: unknown = null;

  constructor(readonly sym: RlySym) {
    sym.relay = this;
  }

  get name(): string {
    return this.sym.toString();
  }

  get isReporting(): boolean {
    return this.reporter !== null;
  }

  setReporter(fn: Reporter, object: unknown): void {
    this.reporter = fn;
    this.reporterObject = object;
  }

  setNewObject(object: unknown): void {
    this.reporterObject = object;
  }

  addDependent(dependent: Relay): void {
    if (!this.dependents.includes(dependent)) this.dependents.push(dependent);
  }

  computeValue(): boolean {
    return rEval(this.exp!);
  }

  maybeChangeState(newState: boolean): boolean {
    if (this.state === newState) return false;
    relayClicks++;
    this.state = newState;
    if (tracer) tracer(this.name, newState);
    if (this.reporter) this.reporter(newState, this.reporterObject);
    updateQueue.put(this);
    return true;
  }

  destroyLogic(): void {
    this.exp = null;
    this.dependents = [];
  }
}

export type LNode = LConst | LNot | LShared | LOp | Relay;

export function rEval(exp: LNode): boolean {
  switch (exp.kind) {
    case "relay":
      return exp.state;
    case "const":
      return exp.state;
    case "not":
      return !rEval(exp.opd);
    case "shared":
      return rEval(exp.opd);
    case "and":
      for (const o of exp.opds) if (!rEval(o)) return false;
      return true;
    case "or":
      for (const o of exp.opds) if (rEval(o)) return true;
      return false;
  }
}

/* ---------------- engine state ---------------- */

const RCT_MAX = 600;
const UPDATE_QUEUE_SIZE = 750;

export let relayClicks = 0;
let halted = false;
let running = false;

class RelayUpdateQueue {
  private q: Relay[] = [];
  private head = 0;
  get empty(): boolean {
    return this.head >= this.q.length;
  }
  reset(): void {
    this.q = [];
    this.head = 0;
  }
  put(r: Relay): void {
    if (this.q.length - this.head >= UPDATE_QUEUE_SIZE) throw new AppAbort("Relay Update Queue Overflow");
    this.q.push(r);
  }
  take(): Relay {
    const r = this.q[this.head++];
    if (this.head > 1024 && this.head * 2 > this.q.length) {
      this.q = this.q.slice(this.head);
      this.head = 0;
    }
    return r;
  }
}

const updateQueue = new RelayUpdateQueue();
const delayQueue: { relay: Relay; state: boolean }[] = [];

export type RelayTracer = (name: string, state: boolean) => void;
let tracer: RelayTracer | null = null;

/** C++ SetRelayTrace (null disables). */
export function setRelayTrace(fn: RelayTracer | null): void {
  tracer = fn;
}

export const isHalted = (): boolean => halted;

function run(topLevel: Relay, forceNewState: boolean): void {
  if (running) throw new Error("assertion failed: !Running");
  running = true;
  try {
    topLevel.maybeChangeState(forceNewState);
    let count = 0;
    while (!updateQueue.empty && !halted) {
      const r = updateQueue.take();
      for (const dep of r.dependents) {
        if (dep.maybeChangeState(dep.computeValue()))
          if (++count > RCT_MAX) throw new AppAbort("RELAY RACE! Apparent relay logic instability.");
      }
    }
  } finally {
    running = false;
  }
}

function runDelayQueue(): void {
  if (!running)
    while (delayQueue.length > 0) {
      const e = delayQueue[0];
      run(e.relay, e.state);
      delayQueue.shift();
    }
  host().relayDisplayChanged();
}

function extRun(r: Relay, state: boolean): void {
  if (running) delayQueue.push({ relay: r, state });
  else run(r, state);
}

/* ---------------- external API (C++ names) ---------------- */

export function gooseRelay(r: Relay): void {
  const state = rEval(r.exp!);
  if (r.state !== state) run(r, state);
  runDelayQueue();
}

export function reportToRelay(r: Relay | null, state: boolean): void {
  if (r === null) return;
  if (state === r.state) return;
  extRun(r, state);
  runDelayQueue();
}

export function toggleToRelay(r: Relay | null): void {
  if (r === null) return;
  extRun(r, !r.state);
  runDelayQueue();
}

export function pulseToRelay(r: Relay | null): void {
  if (r === null) return;
  extRun(r, true);
  extRun(r, false);
  runDelayQueue();
}

/* ---------------- creation ---------------- */

/** C++ CreateRelay / CreateReportingRelay (all relays can report). */
export function createRelay(sym: RlySym): Relay {
  return sym.relay ?? new Relay(sym);
}

export const createReportingRelay = createRelay;

export function createQuislingRelay(n: number, nomenclature: string): Relay {
  return createRelay(internRlysym(n, nomenclature));
}

export function createAndSetReporter(n: number, nomenclature: string, fn: Reporter, object: unknown): Relay {
  const r = createRelay(internRlysym(n, nomenclature));
  r.setReporter(fn, object);
  return r;
}

/* ---------------- compiler (S-expression -> logic tree) ---------------- */

export class RelayCompileError extends Error {}

/** Macro expansion hook: returns the expansion, or EOF_OBJ if `s` is not a macro form. */
export type MacroExpander = (s: Sexpr) => ReadResult;
let expandMacro: MacroExpander = () => EOF_OBJ;
export function setMacroExpander(fn: MacroExpander): void {
  expandMacro = fn;
}

export let ignoreDuplicateRelayLabels = false;
export function setIgnoreDuplicateRelayLabels(v: boolean): void {
  ignoreDuplicateRelayLabels = v;
}

const AND = intern("AND");
const OR = intern("OR");
const NOT = intern("NOT");
const LABEL = intern("LABEL");

let labelTable: { sym: Sexpr; v: LShared }[] = [];

function cmplrErr(errRelay: Relay | null, s: Sexpr | undefined, message: string): never {
  let text =
    errRelay === null
      ? "Relay language error in unknown top-level form:\n"
      : "Relay language error in definition of relay %s:\n" + errRelay.name;
  text += message;
  if (s !== undefined) text += ": " + printSexpr(s);
  host().messageBox(text, "Interpretive Relay Logic Loader", "ok");
  throw new RelayCompileError(text);
}

function addLabel(s: Sexpr, v: LShared): void {
  for (const l of labelTable)
    if (l.sym === s) {
      if (ignoreDuplicateRelayLabels) return;
      cmplrErr(null, s, "Duplicate label");
    }
  labelTable.push({ sym: s, v });
}

function propagateDescendent(ln: LNode, r: Relay): void {
  for (;;) {
    switch (ln.kind) {
      case "const":
        return;
      case "relay":
        ln.addDependent(r);
        return;
      case "not":
      case "shared":
        ln = ln.opd;
        continue;
      default:
        for (const o of ln.opds) propagateDescendent(o, r);
        return;
    }
  }
}

function compileAsAnd(s: Sexpr, r: Relay): LNode {
  return compileExpr(new Cons(AND, s), r);
}

function compileExpr(s: Sexpr, r: Relay): LNode {
  if (s instanceof RlySym) {
    const rly = s.relay ?? createRelay(s);
    rly.addDependent(r);
    return rly;
  }
  if (s instanceof Cons) {
    const n = listLength(s.cdr);
    const fn = s.car;
    if (fn === AND || fn === OR) {
      if (n === 0) return fn === AND ? ONE : ZERO;
      let rest = s.cdr as Cons;
      if (n === 1) return compileExpr(rest.car, r);
      const opds: LNode[] = [];
      for (let x: Sexpr = rest; x instanceof Cons; x = x.cdr) opds.push(compileExpr(x.car, r));
      return new LOp(fn === AND ? "and" : "or", opds);
    }
    if (fn === NOT) return new LNot(compileExpr((s.cdr as Cons).car, r));
    if (fn === LABEL) {
      const rest = s.cdr;
      if (!(rest instanceof Cons)) cmplrErr(r, undefined, "Bad Format LABEL clause.");
      if (!(rest.cdr instanceof Cons)) cmplrErr(r, undefined, "Bad Format LABEL clause.");
      const v = new LShared(compileAsAnd(rest.cdr, r));
      addLabel(rest.car, v);
      return v;
    }
    const mexp = expandMacro(s);
    if (mexp !== EOF_OBJ) return compileExpr(mexp as Sexpr, r);
    cmplrErr(r, s, "Unknown form");
  }
  if (s instanceof Sym) {
    if (s === NIL) return ZERO;
    if (s === T) return ONE;
    for (const l of labelTable)
      if (l.sym === s) {
        propagateDescendent(l.v, r);
        return l.v;
      }
    cmplrErr(r, s, "Logic label not found");
  }
  if (typeof s === "number") {
    if (s === 1) return ONE;
    if (s === 0) return ZERO;
    cmplrErr(r, s, "Number found as expression");
  }
  cmplrErr(r, s, "Random object found as expression");
}

function compileAsAndTopLevel(s: Sexpr, r: Relay): LNode | null {
  try {
    return compileAsAnd(s, r);
  } catch (e) {
    if (e instanceof RelayCompileError) return null;
    throw e;
  }
}

/** (RELAY name . expression) — C++ DefineRelayFromLisp2. */
export function defineRelayFromLisp2(name: Sexpr, exp: Sexpr): Relay | null {
  try {
    if (!(name instanceof RlySym)) cmplrErr(null, name, "Relay name should be a relay symbol, but is not");
    const us = createRelay(name);
    const ln = compileAsAndTopLevel(exp, us);
    if (ln) {
      us.exp = ln;
      return us;
    }
    return null;
  } catch (e) {
    if (e instanceof RelayCompileError) return null;
    throw e;
  }
}

/** `s` is the cdr of the (RELAY ...) form. */
export function defineRelayFromLisp(s: Sexpr): Relay | null {
  return defineRelayFromLisp2((s as Cons).car, (s as Cons).cdr);
}

/* ---------------- timer relays ---------------- */

class TimerCtl {
  startedTiming = 0;
  timing = false;
  constructor(
    readonly outter: Relay,
    readonly ctrler: Relay,
    readonly interval: number,
  ) {
    timers.push(this);
  }
}

let timers: TimerCtl[] = [];

function timerTimeFcn(v: unknown): void {
  const tc = v as TimerCtl;
  tc.timing = false;
  reportToRelay(tc.outter, tc.ctrler.state);
}

function timerRelayFcn(state: boolean, v: unknown): void {
  const tc = v as TimerCtl;
  tc.timing = state;
  if (state) {
    tc.startedTiming = getTickCount();
    scheduler.nxTimer(tc, timerTimeFcn, tc.interval);
  } else reportToRelay(tc.outter, false);
}

/** "4732TS" -> "4732TSZ" (C++ ZAppendRlysym). */
export function zAppendRlysym(base: RlySym): RlySym {
  return internRlysym(base.n, base.type + "Z");
}

/** `s` is the cdr of (TIMER name seconds . expression). Returns the outputting relay. */
export function defineTimerRelayFromLisp(s: Sexpr): Relay | null {
  try {
    if (!(s instanceof Cons)) cmplrErr(null, undefined, "No timer relay name present in TIMER form.");
    const nam = s.car;
    if (!(nam instanceof RlySym)) cmplrErr(null, nam, "TIMER relay name not a relay symbol");
    const outter = createRelay(nam);
    const rest = s.cdr;
    if (!(rest instanceof Cons)) cmplrErr(outter, undefined, "TIMER time and expression absent");
    const timeNum = rest.car;
    if (typeof timeNum !== "number") cmplrErr(outter, timeNum, "TIMER time (in seconds) not an integer");
    const ctrler = createReportingRelay(zAppendRlysym(nam));
    const tc = new TimerCtl(outter, ctrler, timeNum * 1000);
    outter.isTimer = true;
    ctrler.setReporter(timerRelayFcn, tc);
    ctrler.exp = compileAsAndTopLevel(rest.cdr, ctrler);
    return ctrler.exp ? outter : null;
  } catch (e) {
    if (e instanceof RelayCompileError) return null;
    throw e;
  }
}

/* ---------------- init / cleanup ---------------- */

function logicHalter(state: boolean): void {
  if (state) {
    const ans = host().messageBox(
      'LOGIC HALT RELAY PICKED!\n"Yes" to take breakpoint, "No" to continue.',
      "NXSYS Relay Simulation",
      "yesno",
    );
    if (ans === "yes") {
      scheduler.haltTimers();
      halted = true;
    }
  }
}

export function initRelaySys(): void {
  halted = false;
  scheduler.runTimers();
  updateQueue.reset();
  createReportingRelay(internRlysym(0, "LOGICHALT")).setReporter(logicHalter, null);
}

/** C++ CleanUpRelaySys: drop all logic, labels, timer controls; relays are detached from symbols. */
export function cleanUpRelaySys(): void {
  updateQueue.reset();
  running = false;
  timers = [];
  delayQueue.length = 0;
  mapRelaySyms((rs) => rs.relay?.destroyLogic());
  labelTable = [];
  mapRelaySyms((rs) => (rs.relay = null));
  halted = false;
}

export function relayUseDefined(r: Relay | null): boolean {
  return r !== null && r.dependents.length > 0;
}

export function relayHasExp(r: Relay | null): boolean {
  return r !== null && r.exp !== null;
}
