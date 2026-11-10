import type { Relay } from "@nxsys/core/src/relay/relay";
/** RelayListView nomenclatureOnly: the type part of the relay name ("PBS" of 244PBS). */
export const redeemName = (r: Relay): string => r.sym.type;
