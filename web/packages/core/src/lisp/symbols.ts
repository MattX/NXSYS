/*
 * Additional interned symbols used by the reader, macros and relay compiler.
 * Values are exactly those of the C++ reader (backquote/comma read as SI:BACKQUOTE etc.).
 */
import { intern } from "./types.js";

export const SI_BACKQUOTE = intern("SI:BACKQUOTE");
export const SI_COMMA = intern("SI:COMMA");
export const SI_COMMAATSIGN = intern("SI:COMMAATSIGN");
export const NOT = intern("NOT");
export const AND = intern("AND");
export const OR = intern("OR");
export const LABEL = intern("LABEL");
export const SWIF = intern("SWIF");
