# NXSYS Web — Port Plan

Goal: a browser version of NXSYS (simulator, later TLEdit) as a static web app.
The native Mac/Windows code goes away; the interlockings, docs and help come along unchanged.

## Approach

Rewrite in **TypeScript**, not an Emscripten port. Emscripten would need a third Win32
emulation (HWND/HDC/dialogs) on top of Canvas — the same "huge" path the README describes
for the Mac. The real shared core is ~15–20k lines (Lisp reader, relay engine, layout loader,
signals/switches, trains, scenario scripting), well documented in `DocSource/RelayLanguage.md`.

**Risk control:** relay behavior is order-sensitive (see `Futures.md`). Before removing the C++,
build its core as a headless Linux CLI (stub `windows.h`, no-op GDI) that replays scripted
inputs and dumps ordered relay transitions. The TS core must produce identical traces for all
six interlockings. Native code stays in the tree until parity, then is deleted.

## Architecture

```
web/
  packages/core/     pure TS, no DOM, runs in Node for tests
    sexpr/           reader (#\A chars, :keywords, strings, include)
    relay/           logic tree, dependents, run queue, delay queue, timer relays
    clock/           simulated-time event scheduler (replaces SetTimer/NSTimer)
    layout/          segments, joints, track circuits, signals, switches, exit lights, ...
    interlocking/    loading .trk forms into a model, IJID handling
    trains/          kinematics, stop/trip logic
    scenario/        demo scripts, status report
  packages/render/   Canvas2D: thin DC interface; per-object Display() ported ~1:1
  apps/nxsys/        Vite + React: panel view, menus, dialogs, help
  apps/tledit/       layout editor (phase 6)
tools/trace-harness/ headless C++ build of the original core, emits golden traces
```

Key decisions:

1. **Simulated clock** — all timers go through one deterministic scheduler: reproducible
   tests, pause/fast-forward for free.
2. **Rendering** — keep the GraphicObject model with `Display`/hit-testing, ported onto Canvas
   with world-coordinate pan/zoom; redraw on rAF when state is dirty.
3. **UI chrome** — web components for train dialog, relay state/tracer/drafter (SVG),
   stop policy, full-signal views, preferences, help (from `Help.xml`).
4. **Files** — bundled interlockings served statically, picker from `InterlockingLibrary.xml`;
   user files via directory picker / drag-drop into a virtual FS (needed for `include`).
   Preferences in localStorage.
5. **Deploy** — static site (GitHub Pages via Actions). Core stays DOM-free so it can move
   to a Worker later.

## Dropped

Mac/Windows UI layers, Xcode/VS projects, installers, registry, printing, the Relay Compiler /
`.tko` / JIT / x86 emulator (no functional value; impossible in a browser — compiling relays
to JS functions is a trivial optional substitute), Version 1 layout format.

Kept: `Interlockings/`, `Documentation/`, `DocSource/`, `Help.xml`, `LICENSE`.
The fork stays **GPLv3** and keeps Bernard Greenberg's name and credit.

## Phases

| # | Milestone | Exit criterion | Status |
|---|---|---|---|
| 0 | Web workspace scaffold; C++ headless trace harness | Golden traces for all 6 interlockings | done |
| 1 | Core: reader, macros, relay engine, clock, interlocking loader | All 6 load; relay counts and traces match | done |
| 2 | Read-only panel rendering | Panels visually match native | done |
| 3 | Interaction: NX buttons, switch keys, signals, stops, traffic levers | Routes set/clear correctly | done (trains, relay tools, full-signal windows pending) |
| 4 | Trains | Run through routes, trip stops, release locking | done |
| 5 | Relay state/tracer/drafter, status report, demo scripts | Simulator feature parity | done except trains (Phase 4); Relay Index tool not ported |
| 6 | TLEdit on the web | Round-trips the bundled layouts |  |
| 7 | Mobile/touch, shareable URLs, Worker | — |  |

Behavior changes from `Futures.md` (richer IJIDs, three-state relays) come **after** parity,
so golden traces stay meaningful.
