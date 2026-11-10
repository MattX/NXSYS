/*
 * Small relay API helpers used by the object layer: port of the glue in NXSYS/rdtrkcmn.cpp
 * (ReportingRelayNoCreate, SetReporterIfExists, ...) and NXSYS/rlyapi.h (RelayState, GetRelay2NoCreate).
 */
import { getRelayNoCreate } from "../lisp/types.js";
import { createAndSetReporter, createQuislingRelay, relayUseDefined, type Relay, type Reporter } from "./relay.js";

export { createAndSetReporter, createQuislingRelay, relayUseDefined };

/** C++ GetRelay2NoCreate. */
export const getRelay2NoCreate = (n: number, type: string): Relay | null => getRelayNoCreate(n, type);

/** C++ RelayState (undefined for NULL in C++; here a null relay reads as 0). */
export const relayState = (r: Relay | null): boolean => (r ? r.state : false);

/** C++ ReportingRelayNoCreate. */
export const reportingRelayNoCreate = (n: number, type: string): Relay | null => getRelayNoCreate(n, type);

/** C++ SetReporterIfExists: null or the relay. */
export function setReporterIfExists(n: number, type: string, fn: Reporter, obj: unknown): Relay | null {
  const r = reportingRelayNoCreate(n, type);
  if (r) r.setReporter(fn, obj);
  return r;
}
