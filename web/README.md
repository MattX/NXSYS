# NXSYS Web

Browser port of NXSYS (Bernard S. Greenberg's NYC subway relay-interlocking simulator).
GPLv3, like the original. See [PLAN.md](PLAN.md) for the overall plan and phases.

## Layout

- `packages/core/` — the simulator core in TypeScript. No DOM; runs under Node for tests.
  - `src/lisp/` — relay-language data model, reader, printer, macros (port of `readsexp.cpp`, `RelayLispSubstrate.cpp`, `lspmacro.cpp`, `lispmath.cpp`)
  - `src/relay/` — relay logic engine (port of `relays.cpp`)
  - `src/clock/` — deterministic simulated-time scheduler and flashing "coders" (port of `NXSYSMac/NXTimers.mm`)
  - `src/host.ts` — services the host must provide (message boxes, display refresh)
  - `src/layout/` — graphic-object registry (`nxgo.ts`), track topology (`xtgtrack.ts`: joints, segments, track circuits), signals/stops, turnouts, exit lights, switch keys, traffic levers, panel lights/switches, text (ports of `nxgo.cpp`, `v2/*.cpp`, `signal.cpp`, ...). No drawing; geometry is kept for the Phase 2 renderer.
  - `src/interlocking/` — `.trk` loader (`rdtrkcmn.ts`, `xtgload.ts`), MENU model, app lifecycle (`nxsys.ts`: `startUpNXSYS`, `getLayout`, `deInstallLayout`) and the demo-script runner (`demo.ts`)
  - `src/render/` — the drawing contract (`dc.ts`), `paintLayout(dc, rect?)`, `RecordingDC`, nxdraw parse/replay, pens/brushes/fonts (`gdiobjects.ts`); every object's `display(dc)` lives with its class in `src/layout/`. Checked call-for-call against the C++ GDI streams in `tools/trace-harness/golden/draw/`.
  - `src/trains/train.ts` — the train system (port of `traincmn.cpp`, `v2/xtrains.cpp`, `trainaut.h`, the demo TRAIN forms) with a UI-free dialog model (`Train.dlg`) and hooks (`trainHooks`)
  - `src/tools/` — Phase 5: relay drafter (`ldgut.ts`), full-signal windows (`fullsig.ts`), status report, relay query/list/trace helpers, object context menus; goldens in `tools/trace-harness/golden/tools/`
  - `src/trace/nxtrace.ts` — the golden-trace runner (same output as `tools/trace-harness`)

- `apps/nxsys/` — the browser app (Vite + React). `npm run dev` / `npm run build` at this level delegate to it;
  `npm run e2e` runs headless-Chromium smoke tests against the built site. `scripts/copy-assets.mjs` copies
  `Interlockings/`, `Documentation/`, `InterlockingLibrary.xml`, `Help.xml` into the (gitignored)
  `apps/nxsys/public/data/` and writes a manifest, so nothing is duplicated in git. Output is a static site
  with a relative base (GitHub Pages friendly).

## Develop

```bash
npm install
npm test
npm run typecheck
npx tsx packages/core/scripts/nxtrace.ts ../Interlockings/Myrtle/myrtle.trk   # print a trace (also .xdo demos)
```

## Fidelity

The port is checked against the original C++ by **golden traces**: `tools/trace-harness/` builds the
original core headlessly on Linux, replays interlocking loads and demo scripts (`.xdo`) on a simulated
clock, and records every relay transition in order. The TS core must reproduce them byte for byte.

Two orderings are *defined* (the C++ leaves them implementation-dependent), and both sides follow them:

1. Relay symbols iterate in insertion order (C++ uses an `unordered_map`).
2. Timers due at the same simulated millisecond fire in the order they were scheduled.
