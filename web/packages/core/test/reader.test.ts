import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import {
  Cons,
  EOF_OBJ,
  LChar,
  LFloat,
  LRational,
  LVector,
  NIL,
  READ_ERROR_OBJ,
  RlySym,
  Sym,
  LispFileInputSource,
  clearRelaySymbols,
  intern,
  internRlysym,
  listToArray,
  printSexpr,
  readAllSexps,
  readSexp,
  readSexpFromCharString,
  readSexpFromString,
  setLispBarfHandler,
  setLispReadTimeEvalHook,
  skipLispFileWhitespace,
  takeBarfs,
  formatFloat,
} from "../src/lisp/index.js";
import type { ReadResult } from "../src/lisp/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n: string): string => readFileSync(join(here, "fixtures/sexpr-dump", n)).toString("latin1");

const esc = (s: string): string => s.replace(/\n/g, "\\n");

/* This must run first in the file: SymBuf is static (stale across reads) exactly as in C++, and the
   oracle ran these cases in this order in a fresh process. */
describe("reader parity with C++ read_sexp_from_char_string (edge-cases)", () => {
  it("matches the oracle output for every case", () => {
    const out: string[] = [];
    for (const line of fx("edge-cases.txt").split("\n")) {
      if (!line) continue;
      out.push(`CASE ${line}`);
      const { value, left } = readSexpFromCharString(line.replace(/@N/g, "\n"));
      for (const e of takeBarfs()) out.push(`BARF ${esc(e.message)}`);
      out.push(`VALUE ${esc(printSexpr(value))}`, `LEFT ${left}`);
    }
    expect(out.join("\n") + "\n").toBe(fx("edge.txt"));
  });
});

const rd = (s: string): ReadResult => {
  const v = readSexpFromCharString(s).value;
  return v;
};

beforeEach(() => {
  clearRelaySymbols();
  takeBarfs();
});

describe("numbers", () => {
  it("fixnums and signs", () => {
    expect(rd("123")).toBe(123);
    expect(rd("-45")).toBe(-45);
    expect(rd("+7")).toBe(7);
    expect(Object.is(rd("-0"), 0)).toBe(true);
  });
  it("rationals keep sign and are not reduced", () => {
    expect(rd("-6/8")).toEqual(new LRational(-6, 8));
    expect(printSexpr(rd("3/4"))).toBe("3/4");
    expect(rd("1/0")).toBe(NIL);
    expect(takeBarfs()[0].message).toBe("Zero denominator in rational fraction.");
  });
  it("floats; sign is dropped as in C++; 5. is a fixnum", () => {
    expect(rd("1.5")).toEqual(new LFloat(1.5));
    expect(rd("-1.5")).toEqual(new LFloat(1.5));
    expect(rd(".25")).toEqual(new LFloat(0.25));
    expect(rd("5.")).toBe(5);
  });
  it("too-big numbers barf and yield NIL", () => {
    expect(rd("99999999999999999999")).toBe(NIL);
    expect(takeBarfs()).toHaveLength(1);
  });
});

describe("symbols", () => {
  it("upper-cases and keeps keyword colons", () => {
    expect(rd("foo-Bar_1")).toBe(intern("FOO-BAR_1"));
    expect(rd(":foo")).toBe(intern(":FOO"));
    expect(rd("nil")).toBe(NIL);
  });
  it("relay symbols: number then symbol chars, including n=0", () => {
    const r = rd("4732tp") as RlySym;
    expect(r).toBeInstanceOf(RlySym);
    expect([r.n, r.type]).toEqual([4732, "TP"]);
    expect(rd("4732TP")).toBe(r); // interned
    const z = rd("0nw") as RlySym;
    expect([z.n, z.type]).toEqual([0, "NW"]);
    expect(printSexpr(rd("12ab-c"))).toBe("12AB-C");
    expect(rd("-12ab")).toBe(internRlysym(12, "AB")); // sign dropped
  });
  it("!x reads as (NOT x)", () => {
    expect(printSexpr(rd("!4732TP"))).toBe("(NOT 4732TP)");
    expect(printSexpr(rd("(and !1a !(or 2b 3c))"))).toBe("(AND (NOT 1A) (NOT (OR 2B 3C)))");
  });
  it("clearRelaySymbols gives fresh rlysyms", () => {
    const a = rd("5X");
    clearRelaySymbols();
    expect(rd("5X")).not.toBe(a);
  });
});

describe("chars, strings", () => {
  it("#\\x reads exactly one char, uncased", () => {
    expect(rd("#\\A")).toEqual(new LChar("A"));
    expect(printSexpr(rd("(#\\a #\\Space)"))).toBe("(#\\a #\\S PACE)");
    expect(printSexpr(rd("#\\("))).toBe("#\\(");
  });
  it("string escapes (\\t is backspace)", () => {
    expect(rd('"a\\"b\\\\c\\nd\\te\\rf\\qg"')).toBe('a"b\\c\nd\be\rfqg');
    expect(printSexpr('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(rd('"multi\nline"')).toBe("multi\nline");
  });
  it("unterminated string", () => {
    expect(rd('"abc')).toBe(READ_ERROR_OBJ);
    expect(rd('"abc\\')).toBe(READ_ERROR_OBJ);
  });
  it("high bytes survive in strings (latin1)", () => {
    const v = rd('"M\xA9 2001"');
    expect(v).toBe("M\xA9 2001");
    expect(printSexpr(v as string)).toBe('"M\xA9 2001"');
  });
});

describe("lists, vectors, quoting, comments, EOF", () => {
  it("lists and dotted pairs", () => {
    expect(rd("()")).toBe(NIL);
    expect(printSexpr(rd("(a (b c) . d)"))).toBe("(A (B C) . D)");
    expect(rd("(a . b c)")).toBe(READ_ERROR_OBJ);
  });
  it("vectors", () => {
    const v = rd("[1 [2] (3) x]") as LVector;
    expect(v).toBeInstanceOf(LVector);
    expect(printSexpr(v)).toBe("[1 [2] (3) X]");
  });
  it("quote, function, backquote, comma", () => {
    expect(printSexpr(rd("'x"))).toBe("(QUOTE X)");
    expect(printSexpr(rd("#'x"))).toBe("(FUNCTION X)");
    expect(printSexpr(rd("`(a ,b ,@c)"))).toBe("(SI:BACKQUOTE (A (SI:COMMA B) (SI:COMMAATSIGN C)))");
  });
  it("comments", () => {
    expect(rd("; hi\n 42")).toBe(42);
    expect(printSexpr(rd("(a ; x\n b #| c |# d)"))).toBe("(A B D)");
  });
  it("EOF, errors, and a stream of forms", () => {
    expect(rd("")).toBe(EOF_OBJ);
    expect(rd("   ; only comment")).toBe(EOF_OBJ);
    expect(rd("(a b")).toBe(READ_ERROR_OBJ);
    expect(rd(")")).toBe(READ_ERROR_OBJ);
    expect(rd("]")).toBe(READ_ERROR_OBJ);
    expect(rd("#| never closed")).toBe(READ_ERROR_OBJ);
    expect(rd("#| c |#")).toBe(READ_ERROR_OBJ); // trailing block comment => error, not EOF
    const all = readAllSexps("(a)\n42 foo\n");
    expect(all.map((x) => printSexpr(x))).toEqual(["(A)", "42", "FOO"]);
    expect(takeBarfs().length).toBeGreaterThan(0);
  });
  it("file source: readSexp consumes sequentially; skipLispFileWhitespace peeks", () => {
    const f = new LispFileInputSource("  ; c\n (x) (y)");
    expect(skipLispFileWhitespace(f)).toBe("(".charCodeAt(0));
    expect(printSexpr(readSexp(f))).toBe("(X)");
    expect(printSexpr(readSexp(f))).toBe("(Y)");
    expect(readSexp(f)).toBe(EOF_OBJ);
  });
  it("read-string source returns consumed length; rejects non-ASCII", () => {
    expect(readSexpFromString("(a) rest").left).toBe(3);
    expect(readSexpFromString("\xE9").value).toBe(EOF_OBJ);
    expect(takeBarfs()[0].message).toMatch(/Non-ASCII/);
  });
  it("#. uses the read-time eval hook", () => {
    setLispReadTimeEvalHook((s) => (s instanceof Cons ? listToArray(s).length : NIL));
    try {
      expect(rd("#.(a b c)")).toBe(3);
    } finally {
      setLispReadTimeEvalHook(null);
    }
  });
  it("barf handler can be replaced", () => {
    const seen: string[] = [];
    const prev = setLispBarfHandler((e) => seen.push(e.message));
    rd("]");
    setLispBarfHandler(prev);
    expect(seen).toEqual(["Unexpected vector ']'"]);
  });
});

describe("printer", () => {
  it("floats print like printf %f", () => {
    const cases: [number, string][] = [
      [0.0078125, "0.007812"],
      [1e21, "1000000000000000000000.000000"],
      [1e-7, "0.000000"],
      [-1e-9, "-0.000000"],
      [123456789.123456789, "123456789.123457"],
      [0.5, "0.500000"],
      [2.5e-7, "0.000000"],
      [1 / 3, "0.333333"],
      [-2, "-2.000000"],
      [5e-324, "0.000000"],
      [0.0000015, "0.000002"],
      [Infinity, "inf"],
    ];
    for (const [x, s] of cases) expect(formatFloat(x)).toBe(s);
    expect(printSexpr(new LFloat(1234567.8))).toBe("1234567.800000");
  });
  it("atoms", () => {
    expect(printSexpr(new LRational(-3, 4))).toBe("-3/4");
    expect(printSexpr(42)).toBe("42");
    expect(printSexpr(internRlysym(7, "tp"))).toBe("7TP");
    expect(printSexpr(EOF_OBJ)).toBe("%NULL<EOF>");
    expect(printSexpr(READ_ERROR_OBJ)).toBe("%NULL<READ_ERROR>");
    expect(printSexpr(new Cons(1, new Cons(2, 3)))).toBe("(1 2 . 3)");
    expect(printSexpr(new Cons(new Cons(NIL, NIL), NIL))).toBe("((NIL))");
    expect(printSexpr(intern("X") as Sym)).toBe("X");
  });
});
