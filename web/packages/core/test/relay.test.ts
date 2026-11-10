import { beforeEach, describe, expect, it } from "vitest";
import { clearRelaySymbols, intern, internRlysym, list, type Sexpr } from "../src/lisp/types.js";
import {
  cleanUpRelaySys,
  defineRelayFromLisp2,
  defineTimerRelayFromLisp,
  gooseRelay,
  initRelaySys,
  pulseToRelay,
  reportToRelay,
  setRelayTrace,
  createRelay,
} from "../src/relay/relay.js";
import { scheduler } from "../src/clock/scheduler.js";
import { nxCoder, killOneCoder, killNXTimers } from "../src/clock/coders.js";
import { AppAbort } from "../src/host.js";

const R = (s: string) => {
  const m = /^(\d+)(.*)$/.exec(s)!;
  return internRlysym(parseInt(m[1], 10), m[2]);
};
const AND = intern("AND");
const OR = intern("OR");
const NOT = intern("NOT");
const LABEL = intern("LABEL");

let trace: string[];

beforeEach(() => {
  cleanUpRelaySys();
  clearRelaySymbols();
  killNXTimers();
  scheduler.reset();
  trace = [];
  setRelayTrace((n, s) => trace.push(`@${scheduler.now} ${s ? "PICK" : "DROP"} ${n}`));
  initRelaySys();
});

const def = (name: string, ...body: Sexpr[]) => defineRelayFromLisp2(R(name), list(...body));

describe("relay engine", () => {
  it("propagates through AND/OR/NOT in FIFO order", () => {
    def("1B", R("1A"));
    def("1C", list(NOT, R("1A")));
    def("1D", list(OR, R("1B"), R("1E")));
    def("1F", R("1B"), R("1D"));
    reportToRelay(R("1A").relay, true);
    expect(trace).toEqual(["@0 PICK 1A", "@0 PICK 1B", "@0 PICK 1D", "@0 PICK 1F"]);
  });

  it("goose computes initial state of a normally-picked relay", () => {
    def("2C", list(NOT, R("2A")));
    gooseRelay(R("2C").relay!);
    expect(trace).toEqual(["@0 PICK 2C"]);
  });

  it("stick relays hold via their own front contact", () => {
    // 3S picks on 3P and sticks while 3K is down
    def("3S", list(OR, R("3P"), R("3S")), list(NOT, R("3K")));
    pulseToRelay(createRelay(R("3P")));
    expect(R("3S").relay!.state).toBe(true);
    reportToRelay(createRelay(R("3K")), true);
    expect(R("3S").relay!.state).toBe(false);
  });

  it("reporters fire before dependents; reentrant inputs go to delay queue", () => {
    const order: string[] = [];
    def("4B", R("4A"));
    def("4D", R("4C"));
    R("4A").relay!.setReporter((st) => {
      order.push(`rep4A ${st}`);
      reportToRelay(createRelay(R("4C")), st); // deferred: engine is running
      order.push(`4C now ${R("4C").relay!.state}`);
    }, null);
    reportToRelay(R("4A").relay, true);
    expect(order).toEqual(["rep4A true", "4C now false"]);
    expect(trace).toEqual(["@0 PICK 4A", "@0 PICK 4B", "@0 PICK 4C", "@0 PICK 4D"]);
  });

  it("labels share subexpressions and propagate dependents", () => {
    def("5X", list(LABEL, intern("FOO"), R("5A"), R("5B")));
    def("5Y", intern("FOO"));
    reportToRelay(createRelay(R("5A")), true);
    reportToRelay(createRelay(R("5B")), true);
    expect(R("5Y").relay!.state).toBe(true);
    expect(R("5A").relay!.dependents.map((d) => d.name)).toEqual(["5X", "5Y"]);
  });

  it("detects relay races", () => {
    def("6B", list(NOT, R("6B")), R("6A")); // buzzer
    expect(() => reportToRelay(createRelay(R("6A")), true)).toThrow(AppAbort);
  });

  it("timer relays pick after the interval and drop immediately", () => {
    defineTimerRelayFromLisp(list(R("7T"), 3, R("7A")));
    reportToRelay(createRelay(R("7A")), true);
    expect(R("7T").relay!.state).toBe(false);
    scheduler.advance(2999);
    expect(R("7T").relay!.state).toBe(false);
    scheduler.advance(1);
    expect(R("7T").relay!.state).toBe(true);
    reportToRelay(R("7A").relay, false);
    expect(trace).toEqual([
      "@0 PICK 7A",
      "@0 PICK 7TZ",
      "@3000 PICK 7T",
      "@3000 DROP 7A",
      "@3000 DROP 7TZ",
      "@3000 DROP 7T",
    ]);
  });
});

describe("scheduler and coders", () => {
  it("orders ties FIFO and allows multiple timers per object", () => {
    const seen: string[] = [];
    const o = {};
    scheduler.nxTimer(o, () => seen.push("a"), 10);
    scheduler.nxTimer(o, () => seen.push("b"), 5);
    scheduler.nxTimer(o, () => seen.push("c"), 10);
    scheduler.advance(10);
    expect(seen).toEqual(["b", "a", "c"]);
    scheduler.nxTimer(o, () => seen.push("d"), 1);
    scheduler.killOneTimer(o);
    scheduler.advance(10);
    expect(seen).toEqual(["b", "a", "c"]);
  });

  it("coders flash in unison at 300 ms", () => {
    const log: string[] = [];
    const a = {}, b = {};
    nxCoder(a, (_o, p) => log.push(`a${+p}@${scheduler.now}`));
    scheduler.advance(150);
    nxCoder(b, (_o, p) => log.push(`b${+p}@${scheduler.now}`));
    scheduler.advance(450);
    killOneCoder(a);
    killOneCoder(b);
    scheduler.advance(1000);
    expect(log).toEqual(["a0@0", "b0@150", "a1@300", "b1@300", "a0@600", "b0@600"]);
  });
});
