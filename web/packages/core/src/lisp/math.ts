/*
 * Port of NXSYS/lispmath.cpp: fixnum / rational / float arithmetic on Lisp numbers.
 * Fixnums are JS numbers, rationals LRational (int32 num/den), floats LFloat.
 * C `long` overflow is not emulated beyond 2^53; rational components wrap to int32 like (int).
 */
import { LFloat, LispError, LRational } from "./types.js";
import type { Sexpr } from "./types.js";

export type LNumber = number | LFloat | LRational;

const isFloat = (x: unknown): x is LFloat => x instanceof LFloat;

export function lpZerop(x: Sexpr): boolean {
  if (x instanceof LFloat) return x.value === 0;
  if (typeof x === "number") return x === 0;
  if (x instanceof LRational) return x.num === 0;
  return false;
}

function coerceToFloatVal(x: Sexpr): number {
  if (x instanceof LFloat) return x.value;
  if (typeof x === "number") return x;
  if (x instanceof LRational) return x.num / x.den;
  return 0.0;
}

export function lCoerceToFloat(x: Sexpr): Sexpr {
  if (x instanceof LFloat) return x;
  if (typeof x === "number" || x instanceof LRational) return new LFloat(coerceToFloatVal(x));
  return x;
}

export function lCoerceToFix(x: Sexpr): Sexpr {
  if (x instanceof LFloat) return Math.trunc(x.value) || 0;
  if (typeof x === "number") return x;
  if (x instanceof LRational) {
    if (x.den === 0) throw new LispError("Integer division by zero in LCoerceToFix", [x]);
    return Math.trunc(x.num / x.den) || 0;
  }
  return x;
}

export function gcd(x: number, y: number): number {
  x = Math.abs(x);
  y = Math.abs(y);
  if (y > x) [x, y] = [y, x];
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

/** CreateReducedRational: reduced rational, or a fixnum when it divides evenly. */
export function createReducedRational(num: number, den: number): number | LRational {
  if (num === 0) return 0;
  let sign = 1;
  if (num < 0) {
    sign = -1;
    num = -num;
  }
  const g = gcd(num, den);
  if (g === den) return Math.trunc((sign * num) / den) || 0;
  return new LRational(Math.trunc((sign * num) / g) | 0, Math.trunc(den / g) | 0);
}

function ratArgs(x: Sexpr, y: Sexpr): [number, number, number, number] {
  const part = (v: Sexpr): [number, number] => {
    if (typeof v === "number") return [v, 1];
    if (v instanceof LRational) return [v.num, v.den];
    throw new LispError("Non-numeric argument to Lisp math", [v]);
  };
  const [xn, xd] = part(x);
  const [yn, yd] = part(y);
  return [xn, xd, yn, yd];
}

export function lMultiply(x: Sexpr, y: Sexpr): Sexpr {
  if (isFloat(x) || isFloat(y)) return new LFloat(coerceToFloatVal(x) * coerceToFloatVal(y));
  const [xn, xd, yn, yd] = ratArgs(x, y);
  return createReducedRational(xn * yn, xd * yd);
}
export function lDivide(x: Sexpr, y: Sexpr): Sexpr {
  if (isFloat(x) || isFloat(y)) return new LFloat(coerceToFloatVal(x) / coerceToFloatVal(y));
  const [xn, xd, yn, yd] = ratArgs(x, y);
  return createReducedRational(xn * yd, xd * yn);
}
export function lAdd(x: Sexpr, y: Sexpr): Sexpr {
  if (isFloat(x) || isFloat(y)) return new LFloat(coerceToFloatVal(x) + coerceToFloatVal(y));
  const [xn, xd, yn, yd] = ratArgs(x, y);
  return createReducedRational(xn * yd + xd * yn, xd * yd);
}
export function lSubtract(x: Sexpr, y: Sexpr): Sexpr {
  if (isFloat(x) || isFloat(y)) return new LFloat(coerceToFloatVal(x) - coerceToFloatVal(y));
  const [xn, xd, yn, yd] = ratArgs(x, y);
  return createReducedRational(xn * yd - xd * yn, xd * yd);
}

/** LCompare: 1, 0 or -1. */
export function lCompare(x: Sexpr, y: Sexpr): number {
  if (isFloat(x) || isFloat(y)) {
    const xv = coerceToFloatVal(x);
    const yv = coerceToFloatVal(y);
    return xv > yv ? 1 : xv < yv ? -1 : 0;
  }
  const [xn, xd, yn, yd] = ratArgs(x, y);
  const d = xn * yd - xd * yn;
  return d === 0 ? 0 : d > 0 ? 1 : -1;
}
