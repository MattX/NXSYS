/*
 * LispBarf (readsexp.cpp): non-fatal Lisp error reporting. In C++ it pops a message box and the
 * caller carries on, returning NIL / READ_ERROR_OBJ / EOFOBJ. Here the barf builds a LispError and
 * hands it to a handler (default: append to a log drained with takeBarfs()). It NEVER throws, so the
 * callers' C++ result values are preserved. Install a throwing handler if you want exceptions.
 */
import { printSexpr } from "./printer.js";
import { LispError, type ReadResult, type Sexpr } from "./types.js";

export type LispBarfHandler = (err: LispError) => void;

let barfString = "Lisp Substrate";
const barfLog: LispError[] = [];
const defaultHandler: LispBarfHandler = (e) => {
  barfLog.push(e);
};
let handler: LispBarfHandler = defaultHandler;

export function setLispBarfString(s: string): void {
  barfString = s;
}
export function getLispBarfString(): string {
  return barfString;
}
/** Pass null to restore the default (logging) handler. Returns the previous handler. */
export function setLispBarfHandler(h: LispBarfHandler | null): LispBarfHandler {
  const prev = handler;
  handler = h ?? defaultHandler;
  return prev;
}
/** Return and clear the errors logged by the default handler. */
export function takeBarfs(): LispError[] {
  return barfLog.splice(0, barfLog.length);
}

/** C++ LispBarfVariadic message format: "msg:\n obj1 obj2". */
export function lispBarf(msg: string, ...objs: (Sexpr | ReadResult)[]): void {
  let m = msg;
  if (objs.length) m += ":\n";
  for (const s of objs) {
    if (m.length) m += " ";
    m += printSexpr(s);
  }
  handler(new LispError(m, objs));
}
