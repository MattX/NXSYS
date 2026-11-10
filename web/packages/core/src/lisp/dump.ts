/*
 * "sexpr-dump" walker: mirrors tools/sexpr-dump/main.cpp, which mirrors NXSYS/rdtrkcmn.cpp
 * (LoadExprcodeFile / InterpretTopLevelForm) plus the macro-expansion decisions of
 * relays.cpp CompileExpr. Output must be byte-identical to the C++ tool's. The structure here
 * (loadExprcodeFile / interpretTopLevelForm / walkExpr) is also the skeleton of the real loader.
 *
 * Output lines (binary/latin1 text, '\n' separated, trailing '\n'):
 *   <PRep>                every processed top-level form (macro calls, their expansions, subforms)
 *   DEFRMACRO <name>      after a (defrmacro ...) form  (DEFRMACRO-DUP / DEFRMACRO-FAILED variants)
 *   EXPANDED <PRep>       for RELAY and TIMER: (AND exp...) after macro expansion à la CompileExpr
 *   BARF <msg>            Lisp barfs, newlines escaped as \n
 *   ERROR <msg>           load errors
 */
import { setLispBarfHandler } from "./barf.js";
import { lispCleanOutRelays, defrmacro, maybeExpandMacro } from "./macros.js";
import { printSexpr } from "./printer.js";
import { LispFileInputSource, readSexp } from "./reader.js";
import { AND, LABEL, NOT, OR } from "./symbols.js";
import { Cons, DEFRMACRO, EOF_OBJ, FORMS, NIL, Sym } from "./types.js";
import { LispSentinel } from "./types.js";
import type { ReadResult, Sexpr } from "./types.js";

/** std::filesystem::path(base).replace_filename(name).string() for POSIX paths. */
export function replaceFilename(basepath: string, filename: string): string {
  if (filename.startsWith("/")) return filename;
  const dir = basepath.slice(0, basepath.lastIndexOf("/") + 1);
  return dir + filename;
}

/** Macro-expand where relays.cpp CompileExpr would (AND/OR/NOT/LABEL walked; others expanded). */
export function walkExpr(s: Sexpr): Sexpr {
  if (!(s instanceof Cons)) return s;
  const fn = s.car;
  if (fn === AND || fn === OR) {
    const items: Sexpr[] = [];
    for (let r = s.cdr; r instanceof Cons; r = r.cdr) items.push(walkExpr(r.car));
    return listWithHead(fn, items);
  } else if (fn === NOT) {
    if (!(s.cdr instanceof Cons)) return s;
    return new Cons(fn, new Cons(walkExpr(s.cdr.car), NIL));
  } else if (fn === LABEL) {
    const r = s.cdr;
    if (!(r instanceof Cons) || !(r.cdr instanceof Cons)) return s;
    const items: Sexpr[] = [];
    for (let b: Sexpr = r.cdr; b instanceof Cons; b = b.cdr) items.push(walkExpr(b.car));
    return new Cons(fn, new Cons(r.car, listWithHead(null, items)));
  }
  const m = maybeExpandMacro(s);
  if (m !== EOF_OBJ) return walkExpr(m as Sexpr);
  return s;
}

function listWithHead(head: Sexpr | null, items: Sexpr[]): Sexpr {
  let r: Sexpr = NIL;
  for (let i = items.length - 1; i >= 0; i--) r = new Cons(items[i], r);
  return head === null ? r : new Cons(head, r);
}

const symcmp = (s: Sexpr, str: string): boolean => s instanceof Sym && s.name === str;

/**
 * Dump a main .trk file. `readFile(path)` returns the file as a latin1 "binary" string (one char
 * per byte), or null if it cannot be opened.
 */
export function dumpTrk(mainPath: string, readFile: (path: string) => string | null): string {
  const lines: string[] = [];
  const out = (s: string): void => {
    lines.push(s);
  };
  lispCleanOutRelays();
  const prev = setLispBarfHandler((e) => out("BARF " + e.message.replace(/\n/g, "\\n")));

  const loadError = (msg: string, s: Sexpr | ReadResult): number => {
    out("ERROR " + msg + (s !== EOF_OBJ ? ": " + printSexpr(s) : ""));
    return 0;
  };

  const loadExprcodeFile = (fname: string): boolean => {
    const text = readFile(fname);
    if (text === null) {
      out("ERROR cannot open " + fname);
      return false;
    }
    const f = new LispFileInputSource(text);
    let gotIt = false;
    let success = true;
    while (success && !gotIt) {
      const s = readSexp(f);
      if (s === EOF_OBJ) gotIt = true;
      else if (s instanceof LispSentinel) {
        out("ERROR read error in " + fname);
        success = false;
      } else success = interpretTopLevelForm(fname, s as Sexpr) !== 0;
    }
    return gotIt;
  };

  const interpretForms = (fname: string, s: Sexpr): number => {
    while (s instanceof Cons) {
      const item = s.car;
      s = s.cdr;
      if (!interpretTopLevelForm(fname, item)) return 0;
    }
    return 1;
  };

  const interpretTopLevelForm = (fname: string, s: Sexpr): number => {
    out(printSexpr(s));
    if (!(s instanceof Cons)) return loadError("Item definition not a list", s);
    const fn = s.car;
    if (!(fn instanceof Sym)) return loadError("Top-level item doesn't start with atom", s);
    const f2 = maybeExpandMacro(s);
    if (f2 !== EOF_OBJ) return interpretTopLevelForm(fname, f2 as Sexpr);
    if (fn === DEFRMACRO) {
      const nm: Sexpr = s.cdr instanceof Cons ? s.cdr.car : NIL;
      const r = defrmacro(s);
      out((r === 1 ? "DEFRMACRO " : r === -1 ? "DEFRMACRO-DUP " : "DEFRMACRO-FAILED ") + printSexpr(nm));
      return 1;
    }
    if (fn === FORMS) return interpretForms(fname, s.cdr);
    const rest = s.cdr;
    if (symcmp(fn, "QUIT")) return 1;
    if (symcmp(fn, "INCLUDE")) {
      if (!(rest instanceof Cons && typeof rest.car === "string")) return loadError("Bad INCLUDE", s);
      return loadExprcodeFile(replaceFilename(fname, rest.car)) ? 1 : 0;
    }
    if (symcmp(fn, "RELAY")) {
      if (rest instanceof Cons) out("EXPANDED " + printSexpr(walkExpr(new Cons(AND, rest.cdr))));
      return 1;
    }
    if (symcmp(fn, "TIMER")) {
      if (rest instanceof Cons && rest.cdr instanceof Cons)
        out("EXPANDED " + printSexpr(walkExpr(new Cons(AND, rest.cdr.cdr))));
      return 1;
    }
    if (symcmp(fn, "ROUTE") || symcmp(fn, "MENU") || symcmp(fn, "COMMENT") || symcmp(fn, "LAYOUT")) return 1;
    if (symcmp(fn, "EVAL-WHEN")) {
      const r2 = s.cdr;
      if (r2 instanceof Cons && r2.car instanceof Cons) {
        for (let sc: Sexpr = r2.car; sc instanceof Cons; sc = sc.cdr)
          if (symcmp(sc.car, "EVAL")) return interpretForms(fname, r2.cdr);
      }
      return 1;
    }
    return loadError("Unknown top level form", fn);
  };

  try {
    loadExprcodeFile(mainPath);
  } finally {
    setLispBarfHandler(prev);
  }
  return lines.map((l) => l + "\n").join("");
}

