# NXSYS Web

Browser port of NXSYS (Bernard S. Greenberg's NYC subway relay-interlocking simulator).
GPLv3, like the original. See [PLAN.md](PLAN.md) for the overall plan and phases.

## Layout

- `packages/core/` — the simulator core in TypeScript. No DOM; runs under Node for tests.
  - `src/lisp/` — relay-language data model, reader, printer, macros (port of `readsexp.cpp`, `RelayLispSubstrate.cpp`, `lspmacro.cpp`, `lispmath.cpp`)
  - `src/relay/` — relay logic engine (port of `relays.cpp`)
  - `src/clock/` — deterministic simulated-time scheduler and flashing "coders" (port of `NXSYSMac/NXTimers.mm`)
  - `src/host.ts` — services the host must provide (message boxes, display refresh)

## Develop

```bash
npm install
npm test
npm run typecheck
```

## Fidelity

The port is checked against the original C++ by **golden traces**: `tools/trace-harness/` builds the
original core headlessly on Linux, replays interlocking loads and demo scripts (`.xdo`) on a simulated
clock, and records every relay transition in order. The TS core must reproduce them byte for byte.

Two orderings are *defined* (the C++ leaves them implementation-dependent), and both sides follow them:

1. Relay symbols iterate in insertion order (C++ uses an `unordered_map`).
2. Timers due at the same simulated millisecond fire in the order they were scheduled.
