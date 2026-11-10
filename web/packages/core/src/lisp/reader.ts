/*
 * Reader: port of read_sexp_i and friends from NXSYS/readsexp.cpp, relay dialect
 * (_RELAYS defined; BLISP, _UNICODE, ZETALISP not): ESC_CHAR '\', FRACTION_BAR '/',
 * GOOD_SYM_DELIMS "&+-_@$%*=:".
 *
 * ENCODING: the C++ reads bytes with getc(). Input text here must therefore be a "binary"
 * (latin1) string — one JS char per file byte (char codes 0..255). Decode files with
 * TextDecoder("latin1") / Buffer.toString("latin1"). Character classification is the C locale
 * (ASCII only); bytes >= 0x80 are legal only inside strings, #\x chars and comments.
 *
 * ERRORS: like the C++, errors are reported via lispBarf() (never thrown) and the same values are
 * returned (NIL, READ_ERROR_OBJ, ...). Error sentinels can end up embedded in returned structure
 * exactly as in C++ (e.g. `'` at EOF gives (QUOTE %NULL<READ_ERROR>)); a top-level sentinel
 * (EOF_OBJ / READ_ERROR_OBJ) is what a loader should test for.
 *
 * Quirks preserved from the C++ (do not "fix" without checking the oracle):
 *  - symbols are upper-cased; `:FOO` keeps its colon (":FOO"); `!x` reads as (NOT x)
 *  - a fraction `-3/4` honors the sign, but a negative float `-1.5` reads as +1.5, and `-5.` as +5
 *  - "5.<nondigit>" yields the fixnum 5 and swallows the char after the dot
 *  - number followed by letters is a relay symbol (`4732TP`); a sign before it is dropped
 *  - `\x` outside strings/#\ : the escaped char is lost and SymBuf[0] is stale (usually "")
 *  - string escapes: \n newline, \t BACKSPACE(\b), \r CR, anything else is itself
 *  - `#\A` reads exactly one char; `#\Space` is the char S followed by symbol PACE
 *  - `#| ... |#` does not nest; a file ending in such a comment gives READ_ERROR (not EOF)
 *  - at top level, the delimiter char after a symbol/number-less read is consumed (e.g. "FOO)")
 *  - fixnums are JS numbers: exact only up to 2^53 (C++ long: 2^63)
 */
import { lispBarf } from "./barf.js";
import { SI_BACKQUOTE, SI_COMMA, SI_COMMAATSIGN, NOT } from "./symbols.js";
import {
  Cons,
  EOF_OBJ,
  FUNCTION,
  intern,
  internRlysym,
  LChar,
  LFloat,
  LRational,
  LVector,
  NIL,
  NULL_OBJ,
  QUOTE,
  READ_ERROR_OBJ,
  type ReadResult,
  type Sexpr,
} from "./types.js";

export const EOF = -1;
const ESC_CHAR = 92; // '\\'
const FRACTION_BAR = 47; // '/'
const GOOD_SYM_DELIMS = "&+-_@$%*=:";

/* ---------------- C-locale ctype ---------------- */
const isdigit = (c: number): boolean => c >= 48 && c <= 57;
const isalnum = (c: number): boolean =>
  isdigit(c) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isspace = (c: number): boolean => c === 32 || (c >= 9 && c <= 13);
const ispunct = (c: number): boolean =>
  (c >= 33 && c <= 47) || (c >= 58 && c <= 64) || (c >= 91 && c <= 96) || (c >= 123 && c <= 126);

const goodSymTable: boolean[] = (() => {
  const a: boolean[] = [];
  for (let i = 0; i < 256; i++) a[i] = isalnum(i);
  for (const ch of GOOD_SYM_DELIMS) a[ch.charCodeAt(0)] = true;
  a[FRACTION_BAR] = true;
  return a;
})();
/** C++ Goodsymchar[]; out-of-range (EOF, > 255) is false instead of UB. */
export const goodSymChar = (c: number): boolean => c >= 0 && c < 256 && goodSymTable[c];

function stoupper(s: string): string {
  let r = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    r += c >= 97 && c <= 122 ? String.fromCharCode(c - 32) : s[i];
  }
  return r;
}

/* ---------------- input sources ---------------- */

/** C++ LispInputSource. getc returns EOF (-1) at end. */
export abstract class LispInputSource {
  abstract getc(): number;
  abstract ungetc(c: number): void;
  abstract tell(): number;
  peek(): number {
    const ch = this.getc();
    if (ch !== EOF) this.ungetc(ch);
    return ch;
  }
}

/** Stands in for FILE* (LispFileInputSource): ungetc(EOF) is a no-op, as with stdio. */
export class LispFileInputSource extends LispInputSource {
  private pos = 0;
  constructor(private readonly text: string) {
    super();
  }
  getc(): number {
    return this.pos < this.text.length ? this.text.charCodeAt(this.pos++) : EOF;
  }
  ungetc(c: number): void {
    if (c !== EOF && this.pos > 0) this.pos--;
  }
  tell(): number {
    return this.pos;
  }
}

/**
 * LispNarrowStringInputSource (checkAscii=false) / LispStringInputSource (checkAscii=true).
 * ungetc ALWAYS backs up one (even after EOF), as in the C++ — which makes e.g. a bare "+" at the
 * end of a string read as "++".
 */
export class LispStringInputSource extends LispInputSource {
  private i = 0;
  constructor(
    private readonly s: string,
    private readonly checkAscii = true,
  ) {
    super();
  }
  getc(): number {
    if (this.i >= this.s.length) return EOF;
    const c = this.s.charCodeAt(this.i);
    if (this.checkAscii && c > 0x7f) {
      lispBarf("Non-ASCII character in read-from-string string.");
      return EOF;
    }
    this.i++;
    return c;
  }
  ungetc(_c: number): void {
    if (this.i > 0) this.i--;
  }
  tell(): number {
    return this.i;
  }
  getIndex(): number {
    return this.i;
  }
}

/* ---------------- hooks ---------------- */

export type LispCB1 = (s: Sexpr) => ReadResult;
let readTimeEvalHook: LispCB1 | null = null;
let loadTimeEvalHook: LispCB1 | null = null;
/** `#.expr` calls this (C++ LispReadTimeEvalHook). With none, #. barfs and yields NIL. */
export function setLispReadTimeEvalHook(h: LispCB1 | null): void {
  readTimeEvalHook = h;
}
export function setLispLoadTimeEvalHook(h: LispCB1 | null): void {
  loadTimeEvalHook = h;
}
export function getLispLoadTimeEvalHook(): LispCB1 | null {
  return loadTimeEvalHook;
}

/* ---------------- reader proper ---------------- */

let stackCount = 0;
const stack: ReadResult[] = [];
/** The C++ `static LispTChar SymBuf[256]` — static, so stale contents are observable. */
const symBuf: number[] = new Array<number>(260).fill(0);

function symBufString(): string {
  let s = "";
  for (let i = 0; symBuf[i] !== 0; i++) s += String.fromCharCode(symBuf[i]);
  return s;
}

function skipWhitespace(f: LispInputSource, ch: number): number {
  for (;;) {
    while (isspace(ch)) ch = f.getc();
    if (ch === 59 /* ; */) {
      do {
        ch = f.getc();
      } while (!(ch === EOF || ch === 10));
      continue;
    }
    return ch;
  }
}

const hex = (n: number): string => (n >>> 0).toString(16);
const chr = (n: number): string => String.fromCharCode(n & 0xff);

const enum PC {
  MORE_LF,
  COLNUM,
  COLSYM,
  FORCE_SYM_C,
  FLONUM,
  UNGNUMCH,
  AFTER,
}

function readSexpI(f: LispInputSource, lf: number): ReadResult {
  let v1: ReadResult = NULL_OBJ;
  let lastCons: Cons | null = null;
  let firstCons: Cons | null = null;
  const stackBase = stackCount;
  let listing = false;
  let vectoring = false;
  let rlyf = false;
  let notf = false;
  let rmacing = false;
  let num = 0;
  let oc = 0;
  let cct = 0;
  let sign = 1;
  let ch = skipWhitespace(f, 32);
  let pc: PC = PC.MORE_LF;

  const retv1 = (v: ReadResult): ReadResult => {
    stackCount = stackBase;
    return v;
  };
  const reterr = (): ReadResult => retv1(READ_ERROR_OBJ);

  if (lf) {
    if (lf === 1) vectoring = true;
    else if (lf === 5) rmacing = true;
    else listing = true;
  } else {
    if (ch === EOF) return retv1(EOF_OBJ);
    if (ch === 91 /* [ */) {
      vectoring = true;
      ch = skipWhitespace(f, 32);
    } else if (ch === 40 /* ( */) {
      listing = true;
      ch = skipWhitespace(f, 32);
    }
  }

  for (;;) {
    switch (pc) {
      case PC.MORE_LF: {
        if (ch === 91) {
          v1 = readSexpI(f, 1);
          ch = 32;
          pc = PC.AFTER;
        } else if (ch === 40) {
          v1 = readSexpI(f, 2);
          ch = 32;
          pc = PC.AFTER;
        } else if (ch === 43 || ch === 45) {
          sign = ch === 43 ? 1 : -1;
          const ch2 = f.getc();
          if (isdigit(ch2)) {
            cct = 0;
            symBuf[cct++] = ch;
            ch = ch2;
            pc = PC.COLNUM;
          } else {
            f.ungetc(ch2);
            cct = 0;
            pc = PC.COLSYM;
          }
        } else if (isdigit(ch)) {
          sign = 1;
          cct = 0;
          pc = PC.COLNUM;
        } else if (ch === 35 /* # */) {
          ch = f.getc();
          if (ch === 46 /* . */) {
            const s = readSexpI(f, 0);
            if (readTimeEvalHook === null) {
              lispBarf("Ignoring Load Time Eval, subbing NIL - #.", s as Sexpr);
              v1 = NIL;
            } else {
              v1 = readTimeEvalHook(s as Sexpr);
              ch = 32;
              pc = PC.AFTER;
              continue;
            }
          }
          if (ch === 39 /* ' */) {
            v1 = new Cons(FUNCTION, new Cons(readSexpI(f, 5) as Sexpr, NIL));
            ch = 32;
          } else if (ch === 124 /* | */) {
            ch = 32;
            let failed = false;
            do {
              while (ch !== EOF && ch !== 124) ch = f.getc();
              if (ch === EOF) {
                failed = true;
                break;
              }
              ch = f.getc();
              if (ch === EOF) {
                failed = true;
                break;
              }
            } while (ch !== 35);
            if (failed) {
              lispBarf("End of file in middle of #| ... |#");
              return reterr();
            }
            ch = skipWhitespace(f, 32);
            continue; // goto more_lf
          } else if (ch === ESC_CHAR) {
            v1 = new LChar(chr(f.getc()));
            ch = 32;
          } else {
            lispBarf(`Non-known # escape: ${chr(ch)} (0x${hex(ch).toUpperCase()})`);
          }
          pc = PC.AFTER;
        } else if (ch === ESC_CHAR) {
          ch = f.getc();
          pc = PC.FORCE_SYM_C;
        } else if (ch === 58 /* : */) {
          for (;;) {
            const ch2 = f.getc();
            if (ch2 !== 32) {
              f.ungetc(ch2);
              break;
            }
          }
          cct = 0;
          pc = PC.COLSYM;
        } else if (goodSymChar(ch)) {
          cct = 0;
          pc = PC.COLSYM;
        } else if (ch === 34 /* " */) {
          let cb = "";
          for (ch = f.getc(); ch !== 34; ch = f.getc()) {
            if (ch === EOF) {
              lispBarf("Premature EOF in middle of string.");
              return reterr();
            }
            if (ch === ESC_CHAR) {
              ch = f.getc();
              if (ch === EOF) {
                lispBarf("Premature EOF in middle of string.");
                return reterr();
              }
              if (ch === 110) ch = 10;
              else if (ch === 116) ch = 8; // \t is BACKSPACE in this dialect
              else if (ch === 114) ch = 13;
            }
            cb += String.fromCharCode(ch);
          }
          v1 = cb;
          ch = 32;
          pc = PC.AFTER;
        } else if (ch === 41 /* ) */) {
          if (listing) {
            if (oc > 0) lastCons!.cdr = NIL;
            else return NIL;
            return firstCons!;
          }
          lispBarf("Unexpected list ')'");
          return reterr();
        } else if (ch === 93 /* ] */) {
          if (vectoring) {
            v1 = new LVector(stack.slice(stackBase, stackCount) as Sexpr[]);
            return retv1(v1);
          }
          lispBarf("Unexpected vector ']'");
          return reterr();
        } else if (ch === 33 /* ! */) {
          notf = !notf;
          ch = f.getc();
          // goto more_lf
        } else if (ch === 46 /* . */) {
          if (!isdigit(f.peek())) {
            if (!listing || oc === 0) {
              lispBarf("Reader dot context error.");
              return reterr();
            }
            lastCons!.cdr = readSexpI(f, 5) as Sexpr;
            ch = skipWhitespace(f, 32);
            if (ch !== 41) {
              lispBarf("Dot CDR not followed by close paren.");
              return reterr();
            }
            return firstCons!;
          }
          num = 0;
          pc = PC.FLONUM;
        } else if (ch === 39 /* ' */) {
          v1 = new Cons(QUOTE, new Cons(readSexpI(f, 5) as Sexpr, NIL));
          ch = 32;
          pc = PC.AFTER;
        } else if (ch === 96 /* ` */) {
          v1 = new Cons(SI_BACKQUOTE, new Cons(readSexpI(f, 0) as Sexpr, NIL));
          ch = 32;
          pc = PC.AFTER;
        } else if (ch === 44 /* , */) {
          if (f.peek() === 64 /* @ */) {
            f.getc();
            v1 = new Cons(SI_COMMAATSIGN, new Cons(readSexpI(f, 5) as Sexpr, NIL));
          } else v1 = new Cons(SI_COMMA, new Cons(readSexpI(f, 5) as Sexpr, NIL));
          ch = 32;
          pc = PC.AFTER;
        } else {
          if (ch === EOF) lispBarf("Premature EOF/missing )");
          else
            lispBarf(
              `Incomprehensible data in Lisp;\nFile position = ${f.tell()}\nHex char = (#x${hex(ch)})`,
            );
          return reterr();
        }
        break;
      }

      case PC.COLNUM: {
        for (num = 0; isdigit(ch); ch = f.getc()) {
          if (cct < 255) symBuf[cct++] = ch;
          const newdig = ch - 48;
          if (num > 1844674407379955) {
            lispBarf("Number in Lisp source too big.");
            return NIL;
          }
          num = num * 10 + newdig;
        }
        if (ch === FRACTION_BAR) {
          const numerator = num | 0;
          ch = f.getc();
          for (num = 0; isdigit(ch); ch = f.getc()) num = num * 10 + ch - 48;
          if (num === 0) {
            lispBarf("Zero denominator in rational fraction.");
            return NIL;
          }
          v1 = new LRational((sign * numerator) | 0, num | 0);
          pc = PC.UNGNUMCH;
        } else if (ch === 46 /* . */) {
          pc = PC.FLONUM;
        } else {
          if (!(isspace(ch) || ispunct(ch) || ch === EOF || ch === 59)) {
            if (goodSymChar(ch)) {
              rlyf = true;
              pc = PC.MORE_LF;
              break;
            }
            lispBarf("Junk after number in SEXP: " + chr(ch));
          }
          v1 = num * sign || 0;
          pc = PC.UNGNUMCH;
        }
        break;
      }

      case PC.FLONUM: {
        ch = f.getc();
        if (!isdigit(ch)) {
          v1 = num; // sign is NOT applied (C++ quirk)
          pc = PC.AFTER;
        } else {
          let fl = num;
          let divi = 1;
          for (num = 0; isdigit(ch); ch = f.getc()) {
            fl = fl * 10.0 + (ch - 48);
            divi *= 10.0;
          }
          v1 = new LFloat(fl / divi);
          pc = PC.UNGNUMCH;
        }
        break;
      }

      case PC.UNGNUMCH:
        if (ch !== EOF) f.ungetc(ch);
        ch = 32;
        pc = PC.AFTER;
        break;

      case PC.FORCE_SYM_C:
        cct = 0;
        cct++; // C++ stores ch into the unrelated static `buf`; SymBuf[0] is left stale
        ch = f.getc();
        pc = PC.COLSYM;
        break;

      case PC.COLSYM: {
        for (; goodSymChar(ch); ch = f.getc()) {
          if (cct > 255) {
            lispBarf("Symbol buffer overflow (256 chars max)");
            return NIL;
          }
          symBuf[cct++] = ch;
        }
        symBuf[cct] = 0;
        if (rmacing) f.ungetc(ch);
        if (rlyf) {
          rlyf = false;
          v1 = internRlysym(num, symBufString());
        } else v1 = intern(stoupper(symBufString()));
        pc = PC.AFTER;
        break;
      }

      case PC.AFTER: {
        if (notf) {
          notf = false;
          v1 = new Cons(NOT, new Cons(v1 as Sexpr, NIL));
        }
        if (!listing && !vectoring) return retv1(v1);
        if (vectoring) stack[stackCount++] = v1;
        else {
          const nc = new Cons(v1 as Sexpr, NIL);
          if (oc++ === 0) firstCons = nc;
          else lastCons!.cdr = nc;
          lastCons = nc;
        }
        if (isspace(ch) || ch === 59) ch = skipWhitespace(f, ch);
        pc = PC.MORE_LF;
        break;
      }
    }
  }
}

/* ---------------- public entry points (C++ names in comments) ---------------- */

/** read_sexp_LIS / read_sexp(FILE*): read one object from a source. */
export function readSexp(src: LispInputSource): ReadResult {
  stackCount = 0;
  return readSexpI(src, 0);
}

/** read_sexp_from_string: returns the object and the index just past what was consumed. */
export function readSexpFromString(s: string): { value: ReadResult; left: number } {
  stackCount = 0;
  const f = new LispStringInputSource(s, true);
  const value = readSexpI(f, 0);
  return { value, left: f.getIndex() };
}

/** read_sexp_from_char_string (no ASCII check). */
export function readSexpFromCharString(s: string): { value: ReadResult; left: number } {
  stackCount = 0;
  const f = new LispStringInputSource(s, false);
  const value = readSexpI(f, 0);
  return { value, left: f.getIndex() };
}

/** skip_lisp_file_whitespace: skips whitespace/comments, leaves the next char unread, returns it. */
export function skipLispFileWhitespace(f: LispInputSource): number {
  const ch = skipWhitespace(f, 32);
  f.ungetc(ch);
  return ch;
}

/** Read every object of a text until EOF; stops (inclusive) at a READ_ERROR. Convenience for tests/loaders. */
export function readAllSexps(text: string): ReadResult[] {
  const f = new LispFileInputSource(text);
  const out: ReadResult[] = [];
  for (;;) {
    const v = readSexp(f);
    if (v === EOF_OBJ) break;
    out.push(v);
    if (v === READ_ERROR_OBJ) break;
  }
  return out;
}
