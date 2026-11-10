/*
 * "Coded" (flashing) current sources — verbatim port of the Coder half of
 * NXSYSMac/NXTimers.mm. All flashing lights flash in unison, as if fed from one
 * coded source. Slot reuse and the odd KillOne bookkeeping are preserved on purpose,
 * because they determine callback order.
 */

import { scheduler } from "./scheduler.js";

export type CoderFn = (object: unknown, phase: boolean) => void;

const CodeBlipMS = 300;
const FastCodeBlipMS = 120;

class Coder {
  object: unknown = null;
  fn: CoderFn | null = null;
  valid = false;
  set(object: unknown, fn: CoderFn): void {
    this.object = object;
    this.fn = fn;
    this.valid = true;
  }
  callIfValid(phase: boolean): void {
    if (this.valid) this.fn!(this.object, phase);
  }
}

class CodersCtl {
  timerRunning = false;
  codePhase = 0;
  nActive = 0;
  coders: Coder[] = [];

  constructor(readonly blipMS: number) {}

  reset(): void {
    this.coders = [];
    this.timerRunning = false;
    this.codePhase = 0;
    this.nActive = 0;
  }

  timerFn(): void {
    this.codePhase ^= 1;
    const p = (this.codePhase & 1) === 1;
    this.timerRunning = false;
    // C++ indexes by size() each iteration; a callback that kills a coder can shrink it.
    for (let i = 0; i < this.coders.length; i++) this.coders[i].callIfValid(p);
    if (this.nActive > 0) this.maybeStartTimer();
  }

  register(object: unknown, fn: CoderFn): void {
    let c = this.coders.find((x) => !x.valid);
    if (!c) {
      c = new Coder();
      this.coders.push(c);
    }
    c.set(object, fn);
    if (this.nActive++ === 0) {
      this.codePhase = 0;
      this.maybeStartTimer();
    }
    c.callIfValid((this.codePhase & 1) === 1);
  }

  maybeStartTimer(): void {
    if (!this.timerRunning) {
      scheduler.nxTimer(this, (ctl) => (ctl as CodersCtl).timerFn(), this.blipMS);
      this.timerRunning = true;
    }
  }

  killOne(object: unknown): void {
    for (let i = this.coders.length - 1; i >= 0; i--) {
      const c = this.coders[i];
      if (c.valid && c.object === object) {
        c.valid = false;
        if (i === this.coders.length - 1) this.coders.length = this.coders.length - 1;
        this.nActive--;
      }
    }
    if (this.nActive <= 0) {
      this.nActive = 0; /* "I don't know how this happens (goes negative) but it does" */
      this.timerRunning = false;
      scheduler.killOneTimer(this);
    }
  }
}

const stdCoders = new CodersCtl(CodeBlipMS);
const fastCoders = new CodersCtl(FastCodeBlipMS);

export const nxCoder = (object: unknown, fn: CoderFn): void => stdCoders.register(object, fn);
export const nxFastCoder = (object: unknown, fn: CoderFn): void => fastCoders.register(object, fn);
export const killOneCoder = (object: unknown): void => stdCoders.killOne(object);
export const killOneFastCoder = (object: unknown): void => fastCoders.killOne(object);

/** C++ KillNXTimers(): kill all timers and reset coders. */
export function killNXTimers(): void {
  scheduler.killAll();
  stdCoders.reset();
  fastCoders.reset();
}
