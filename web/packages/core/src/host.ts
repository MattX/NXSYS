/*
 * Host services the core needs from its environment (browser UI, test harness, CLI).
 * The C++ calls MessageBox / NxsysAppAbort directly; the TS core calls through here.
 *
 * Defaults mirror the headless C++ trace harness: message boxes are logged and answer
 * with their default (OK / No), so golden traces line up.
 */

export type MessageBoxKind = "ok" | "yesno";
export type MessageBoxAnswer = "ok" | "yes" | "no";

export interface Host {
  messageBox(text: string, title: string, kind: MessageBoxKind): MessageBoxAnswer;
  /** C++ CheckRelayDisplay(): called after the delay queue drains (UI refresh hook). */
  relayDisplayChanged(): void;
}

const defaultHost: Host = {
  messageBox(text, title, kind) {
    console.error(`MSGBOX: ${title}: ${text}`);
    return kind === "yesno" ? "no" : "ok";
  },
  relayDisplayChanged() {},
};

let current: Host = defaultHost;

export function setHost(h: Partial<Host>): void {
  current = { ...defaultHost, ...h };
}

export function host(): Host {
  return current;
}

/** C++ NxsysAppAbort: unrecoverable simulator state (relay race, queue overflow). */
export class AppAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppAbort";
  }
}
