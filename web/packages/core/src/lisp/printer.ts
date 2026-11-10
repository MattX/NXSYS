/*
 * Printer: port of Sexpr::PRep() (readsexp.cpp). Output is byte-identical to the C++.
 * Strings are "binary" JS strings (one char per byte, see reader.ts).
 */
import {
  Cons,
  LChar,
  LFloat,
  LispSentinel,
  LRational,
  LVector,
  NIL,
  RlySym,
  Sym,
  type ReadResult,
  type Sexpr,
} from "./types.js";

const ESC_CHAR = "\\";

/** printf("%f", x) — exactly 6 decimals, exact round-half-even like glibc. */
export function formatFloat(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (x === Infinity) return "inf";
  if (x === -Infinity) return "-inf";
  const neg = x < 0 || Object.is(x, -0);
  const dv = new DataView(new ArrayBuffer(8));
  dv.setFloat64(0, Math.abs(x));
  const bits = dv.getBigUint64(0);
  const expBits = Number((bits >> 52n) & 0x7ffn);
  const frac = bits & ((1n << 52n) - 1n);
  const m = expBits === 0 ? frac : frac | (1n << 52n);
  const e = (expBits === 0 ? 1 : expBits) - 1075; // value = m * 2^e
  const N = m * 1000000n;
  let q: bigint;
  if (e >= 0) q = N << BigInt(e);
  else {
    const sh = BigInt(-e);
    q = N >> sh;
    const rem = N & ((1n << sh) - 1n);
    const half = 1n << (sh - 1n);
    if (rem > half || (rem === half && (q & 1n) === 1n)) q += 1n;
  }
  const s = q.toString().padStart(7, "0");
  return (neg ? "-" : "") + s.slice(0, -6) + "." + s.slice(-6);
}

function printString(str: string): string {
  let b = '"';
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (c === "\0") break; // C string semantics
    if (c === '"' || c === ESC_CHAR) b += ESC_CHAR;
    b += c;
  }
  return b + '"';
}

/** C++ Sexpr::PRep(). */
export function printSexpr(s: Sexpr | ReadResult): string {
  if (s instanceof Sym) return s.name;
  if (typeof s === "number") return String(s);
  if (s instanceof Cons) {
    let b = "(";
    let c: Sexpr | ReadResult = s;
    for (;;) {
      b += printSexpr((c as Cons).car);
      const d: Sexpr = (c as Cons).cdr;
      if (d === NIL) break;
      if (!(d instanceof Cons)) {
        b += " . " + printSexpr(d);
        break;
      }
      c = d;
      b += " ";
    }
    return b + ")";
  }
  if (typeof s === "string") return printString(s);
  if (s instanceof RlySym) return s.toString();
  if (s instanceof LFloat) return formatFloat(s.value);
  if (s instanceof LRational) return `${s.num}/${s.den}`;
  if (s instanceof LChar) return "#" + ESC_CHAR + s.ch;
  if (s instanceof LVector) return "[" + s.items.map(printSexpr).join(" ") + "]";
  if (s instanceof LispSentinel) return s.what === "NULL" ? "%NULL<0>" : `%NULL<${s.what}>`;
  return "<UNKNOWN-TYPE>";
}

let showHandler: ((text: string) => void) | null = null;

/** Install the sink for show_sexp (C++ pops a "Lisp Exp" message box). Default: no-op. */
export function setShowSexpHandler(h: ((text: string) => void) | null): void {
  showHandler = h;
}

/** C++ show_sexp. */
export function showSexp(s: Sexpr | ReadResult): void {
  showHandler?.(printSexpr(s));
}
