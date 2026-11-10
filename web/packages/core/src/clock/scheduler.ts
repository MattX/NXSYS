/*
 * Simulated-time scheduler: TS port of the timer half of NXSYSMac/NXTimers.mm,
 * driven by a deterministic integer-millisecond clock instead of NSTimer.
 *
 * Semantics preserved from NXTimers.mm:
 *  - nxTimer(object, fn, ms) is one-shot and does NOT cancel other timers on the same
 *    object; several may coexist.
 *  - killOneTimer(object) kills every pending timer for that object.
 *  - runTimers() (called from InitRelaySys) kills pending timers already due
 *    (C++ TimeProcI), unless halted. haltTimers() only disables that; timers still fire,
 *    exactly as on the Mac.
 *
 * Determinism (defined here, mirrored by the C++ trace harness): earliest due time first,
 * ties broken FIFO by scheduling order.
 */

export type TimerFn = (object: unknown) => void;

interface Entry {
  due: number;
  seq: number;
  object: unknown;
  fn: TimerFn;
  alive: boolean;
}

class MinHeap {
  private a: Entry[] = [];
  get size(): number {
    return this.a.length;
  }
  private less(x: Entry, y: Entry): boolean {
    return x.due < y.due || (x.due === y.due && x.seq < y.seq);
  }
  push(e: Entry): void {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  peek(): Entry | undefined {
    return this.a[0];
  }
  pop(): Entry | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
  entries(): readonly Entry[] {
    return this.a;
  }
  clear(): void {
    this.a = [];
  }
}

export class Scheduler {
  private _now = 0;
  private seq = 0;
  private heap = new MinHeap();
  private byObject = new Map<unknown, Set<Entry>>();
  private halted = false;

  /** C++ GetTickCount(): simulated milliseconds. */
  get now(): number {
    return this._now;
  }

  nxTimer(object: unknown, fn: TimerFn, ms: number): void {
    const e: Entry = { due: this._now + Math.trunc(ms), seq: this.seq++, object, fn, alive: true };
    this.heap.push(e);
    let s = this.byObject.get(object);
    if (!s) this.byObject.set(object, (s = new Set()));
    s.add(e);
  }

  killOneTimer(object: unknown): void {
    const s = this.byObject.get(object);
    if (!s) return;
    for (const e of s) e.alive = false;
    this.byObject.delete(object);
  }

  /** C++ KillNXTimers (the coder reset part lives in coders.ts). */
  killAll(): void {
    for (const e of this.heap.entries()) e.alive = false;
    this.heap.clear();
    this.byObject.clear();
  }

  runTimers(): void {
    this.halted = false;
    for (const e of this.heap.entries()) if (e.alive && e.due <= this._now) this.retire(e);
  }

  haltTimers(): void {
    this.halted = true;
  }

  get isHalted(): boolean {
    return this.halted;
  }

  /** Due time of the next live timer, or undefined. */
  nextDue(): number | undefined {
    this.dropDead();
    return this.heap.peek()?.due;
  }

  /** Fire the single next live timer if it is due at or before `limit`. */
  step(limit = Infinity): boolean {
    this.dropDead();
    const e = this.heap.peek();
    if (!e || e.due > limit) return false;
    this.heap.pop();
    this.retire(e);
    if (e.due > this._now) this._now = e.due;
    e.fn(e.object);
    return true;
  }

  /** Fire everything due up to and including `t`, then set the clock to `t`. */
  runUntil(t: number): void {
    while (this.step(t)) {
      /* keep going */
    }
    if (t > this._now) this._now = t;
  }

  advance(ms: number): void {
    this.runUntil(this._now + ms);
  }

  /** Reset to time zero with no timers (between interlockings / tests). */
  reset(): void {
    this.killAll();
    this._now = 0;
    this.seq = 0;
    this.halted = false;
  }

  private retire(e: Entry): void {
    e.alive = false;
    const s = this.byObject.get(e.object);
    if (s) {
      s.delete(e);
      if (s.size === 0) this.byObject.delete(e.object);
    }
  }

  private dropDead(): void {
    while (this.heap.size > 0 && !this.heap.peek()!.alive) this.heap.pop();
  }
}

/** The simulator's single clock (C++ has one global timer system). */
export const scheduler = new Scheduler();

export const nxTimer = (object: unknown, fn: TimerFn, ms: number): void =>
  scheduler.nxTimer(object, fn, ms);
export const killOneTimer = (object: unknown): void => scheduler.killOneTimer(object);
export const getTickCount = (): number => scheduler.now;
