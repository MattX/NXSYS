import { beforeEach, describe, expect, it } from "vitest";
import {
  EOF_OBJ,
  LFloat,
  LRational,
  NIL,
  createReducedRational,
  defrmacro,
  gcd,
  lAdd,
  lCoerceToFix,
  lCoerceToFloat,
  lCompare,
  lDivide,
  lMultiply,
  lSubtract,
  lpZerop,
  lispCleanOutRelays,
  maybeExpandMacro,
  printSexpr,
  readSexpFromCharString,
  takeBarfs,
  type Sexpr,
} from "../src/lisp/index.js";

const rd = (s: string): Sexpr => readSexpFromCharString(s).value as Sexpr;
const exp = (s: string): string => printSexpr(maybeExpandMacro(rd(s)));

beforeEach(() => {
  lispCleanOutRelays();
  takeBarfs();
});

describe("defrmacro / maybeExpandMacro", () => {
  it("defines and expands, substituting (ARG n) and relay-symbol numbers", () => {
    expect(defrmacro(rd("(defrmacro swif 3 (or (and 1rwc (arg 2)) (and 1nwc (arg 3))))"))).toBe(1);
    expect(exp("(swif 5 a b)")).toBe("(OR (AND 5RWC A) (AND 5NWC B))");
  });
  it("0-numbered relay syms are global; rlysym actuals substitute their number", () => {
    defrmacro(rd("(defrmacro m 1 (and 0x 1y (arg 1)))"));
    expect(exp("(m 77)")).toBe("(AND 0X 77Y 77)");
    expect(exp("(m 12ab)")).toBe("(AND 0X 12Y 12AB)");
  });
  it("non-macros give EOF_OBJ; duplicate defs ignored (-1); bad syntax barfs", () => {
    expect(maybeExpandMacro(rd("(nothing 1)"))).toBe(EOF_OBJ);
    expect(maybeExpandMacro(5)).toBe(EOF_OBJ);
    expect(defrmacro(rd("(defrmacro m 1 x)"))).toBe(1);
    expect(defrmacro(rd("(defrmacro m 1 y)"))).toBe(-1);
    expect(exp("(m 1)")).toBe("X");
    expect(defrmacro(rd("(defrmacro q 11 x)"))).toBe(0);
    expect(takeBarfs().map((e) => e.message)).toEqual(["Bad Syntax in DEFRMACRO"]);
    expect(defrmacro(rd("(foo)"))).toBe(0);
  });
  it("wrong arg count and arg-out-of-range barf", () => {
    defrmacro(rd("(defrmacro m2 2 (list (arg 1) (arg 2)))"));
    expect(maybeExpandMacro(rd("(m2 1)"))).toBe(EOF_OBJ);
    expect(takeBarfs()[0].message).toMatch(/^Wrong number of macro args/);
    defrmacro(rd("(defrmacro m3 1 (arg 2))"));
    expect(maybeExpandMacro(rd("(m3 1)"))).toBe(EOF_OBJ);
    expect(takeBarfs()[0].message).toMatch(/^Macro arg designator out of range/);
  });
  it("exactly 10 args hits the C++ 'overflow' check", () => {
    defrmacro(rd("(defrmacro m10 10 (arg 1))"));
    expect(maybeExpandMacro(rd("(m10 1 2 3 4 5 6 7 8 9 10)"))).toBe(EOF_OBJ);
    expect(takeBarfs()[0].message).toMatch(/^Macro arg overflow/);
  });
  it("expansion copies (no sharing with args) and macroCleanup resets", () => {
    defrmacro(rd("(defrmacro d 1 ((arg 1) (arg 1)))"));
    const e = maybeExpandMacro(rd("(d (x))")) as unknown as { car: unknown; cdr: { car: unknown } };
    expect(e.car).not.toBe(e.cdr.car);
    lispCleanOutRelays();
    expect(maybeExpandMacro(rd("(d (x))"))).toBe(EOF_OBJ);
  });
});

describe("lispmath", () => {
  it("rational arithmetic reduces; integers collapse", () => {
    expect(lAdd(new LRational(1, 2), new LRational(1, 3))).toEqual(new LRational(5, 6));
    expect(lAdd(new LRational(1, 2), new LRational(1, 2))).toBe(1);
    expect(lSubtract(1, new LRational(1, 4))).toEqual(new LRational(3, 4));
    expect(lMultiply(new LRational(2, 3), 3)).toBe(2);
    expect(lDivide(3, 6)).toEqual(new LRational(1, 2));
    expect(lDivide(-3, 6)).toEqual(new LRational(-1, 2));
    expect(createReducedRational(0, 5)).toBe(0);
    expect(gcd(-12, 18)).toBe(6);
  });
  it("floats are contagious", () => {
    expect(lMultiply(new LFloat(1.5), 2)).toEqual(new LFloat(3));
    expect(lAdd(new LRational(1, 2), new LFloat(0.25))).toEqual(new LFloat(0.75));
    expect(lDivide(1, new LFloat(4))).toEqual(new LFloat(0.25));
  });
  it("coercions, zerop, compare", () => {
    expect(lCoerceToFloat(new LRational(1, 4))).toEqual(new LFloat(0.25));
    expect(lCoerceToFix(new LFloat(-2.7))).toBe(-2);
    expect(lCoerceToFix(new LRational(7, 2))).toBe(3);
    expect(lpZerop(0)).toBe(true);
    expect(lpZerop(new LFloat(0))).toBe(true);
    expect(lpZerop(new LRational(1, 2))).toBe(false);
    expect(lpZerop(NIL)).toBe(false);
    expect(lCompare(new LRational(1, 2), new LRational(2, 3))).toBe(-1);
    expect(lCompare(3, new LFloat(3))).toBe(0);
    expect(lCompare(new LFloat(4), 3)).toBe(1);
  });
});
