# trace-harness notes

Headless Linux build of the original NXSYS C++ core (`make -C tools/trace-harness` -> `build/nxtrace`).
Defines: `-DNXSYSMac=1 -DNX_HEADLESS=1 -DREALLY_NXSYS=1 -DREDUCED_RATIONALS=1` (no BLISP, no NXCMPOBJ, as in the Xcode target).
Includes: `include/` (Linux `windows.h` copy, `rlyindex.h` case shim, `nx_prelude.h` force-included), then NXSYSMac, NXSYS/v2, NXSYS.
`dynmenu.cpp` is NXSYS/v2/dynmenu.cpp (NXSYSMac/dynmenu.cpp is stale: needs objid.h). NXSYS/rlyindex.cpp is built (NXSYSMac/rlyindex.cpp is not).
Regenerate goldens: `./make-golden.sh` (also runs each twice and fails on any difference).

## Output format
```
# nxtrace 1 <basename>
@<ms> LOAD <basename>      (wrapped ReadLayout, via ld --wrap; no core change)
@<ms> PICK|DROP <relay>    (SetRelayTrace, installed before load)
@<ms> LOADED <n>           (ReadLayout/FinishUpLoad returned; n = relay syms having a relay)
@<ms> DEMO <Sexpr::PRep>   (top-level demo forms, as executed)
@<ms> END
STATE <relay> <0|1>        (sorted by Rlysym::operator<: number, then strcmp of type name)
```
Demo mode: `Demo(file)` (the real File>Demo path) is driven by stepping the sim clock until the demo
finishes, then `--settle` more ms (default 20000). `--until MS` stops at an absolute time.
Load time is sim time 0 (loading does not advance the clock).

## Stubs
- `src/SimTimers.cpp`: replaces NXTimers.mm (sim ms clock, FIFO tie-break by sequence number; Coder/FastCoder ported verbatim;
  RunTimers keeps TimeProcI semantics: kills pending timers with due <= now; HaltTimers only sets a flag, as on Mac). GetTickCount() = sim time.
- `src/HeadlessStubs.cpp`: GDI/window/dialog/Mac-app-layer no-ops, compiled-code (.tko)/disassembly entry points, MessageBox.
  MessageBox prints `MSGBOX: <title>: <text>` to stderr, returns IDNO for YES/NO(/CANCEL) boxes, IDOK otherwise.
  NxsysAppAbort (relay race / queue overflow) shows its MSGBOX then throws nxterm_exception; main() catches it, prints, exits status 3.
  Failed load exits 2. FatalAppExit exits 4.
- `src/main.cpp`: driver.

## Drawing: nxdraw recordings (`--draw-at MS[,MS...] --draw-dir DIR`)
`nxtrace --draw-at 2500,5000 --draw-dir D file` additionally repaints the whole panel at those sim times (clock is run to the
time first; times after the end of the run are skipped with a warning) and writes `D/<basename>@<ms>.nxdraw`. Stdout (the trace) is unchanged.
Format: web/packages/core/src/render/dc.ts. `src/DrawRecorder.cpp` is the GDI layer (replaces the old no-op stubs): it records only
between DrawRecorder_Begin/End, prints GDI objects by content (pens/brushes via `RetrieveGDIWrapperInfo`, fonts via a Mac-style
LOGFONT table, stock objects 1001..1005 as `STOCK <NAME>`), never records DT_CALCRECT (fake metrics 7 px/char x 14 kept), and keeps
GetTextColor/GetBkMode state. `OBJ <typeid> <nomenclature>` is printed from the per-object dispatch hook (nomenclature: signal/stop/exit light/
switch key/lever/light/panel switch XlkgNo, track circuit number for track segs, 0 otherwise; labels are typeid -1).
Paint path = MainView.mm drawRect for a dirty rect covering the whole view: fresh DC, `SetTextColor(0xFFFFFF)`, `SetBkMode(TRANSPARENT)`,
`REDISPLAYING=true`, `DisplayVisibleObjectsRect`. Viewport: WP origin (0,0) (the Mac app never moves it; VIEW-ORIGIN is only a scroll
position), scale 1.0, extent `NXGO_ComputeTrueLayoutDimensions()` (right/bottom; what MacAssertTrueLayoutDims sizes the view to);
`NXGO_SetViewportDims(w,h)` is called before each paint; paint rect = (0,0,w,h) = `VIEW 0 0 w h 1`.
Goldens: `golden/draw/*.nxdraw` + `golden/draw/MANIFEST` (`<source path>\t<times>`): load-* one paint at 20000; demos/scripts every 2500 ms plus the END time.
`make-golden.sh` checks that painting does not change the trace and that two runs are identical. `render-png.cjs` is a throwaway Canvas2D replay
(Playwright) for eyeballing; output goes to the gitignored `png/`.

## Patches to core sources (all `#if NX_HEADLESS`)
1. NXSYS/RelayLispSubstrate.cpp: side vector `RelaySymInsertionOrder` appended in `intern_rlysym`, cleared in `ClearRelayMaps`;
   `map_relay_syms` (iterates a snapshot copy) and `map_relay_syms_for_validate` use it instead of the unordered_map.
   Reason: canonical, implementation-independent order (affects e.g. Goose_Generale in rdtrkcmn.cpp, hence load-time PICK order).
2. NXSYS/demo.cpp: before `ProcessForm`, `NXHeadlessDemoTrace(s)` is called for top-level forms (mousecmd == WM_LBUTTONDOWN, so
   MOUSERIGHT/FLEET inner recursion is not printed twice), plus `NXHeadlessDemoActive()` (is the demo State alive).
3. NXSYS/traindcl.h: `Train::Occupied` (pointer-keyed `std::set<TrackSeg*>`) becomes an insertion-ordered vector set.
   `~Train` iterates it calling DecrementTrainOccupation (relay-visible); pointer order is address dependent.
4. NXSYS/nxgo.cpp: `NXHeadlessDrawObject(g)` (DrawRecorder.cpp) is called before each `g->Display(dc)` in DisplayVisibleObjectsRect (OBJ marker).
5. NXSYS/trkgdi.cpp: GetStockObject returns the 1001..1005 moniker itself and NullPen = NULL_PEN, so stock objects stay identifiable
   (on the Mac they map to ordinary table entries; NULL_PEN is identified by pointer compare in Polygon, so the effect is the same).
6. NXSYS/v2/joint.cpp: `JointOrganizationData jod[3]{}` in TrackJoint::PositionLabel. The C++ reads jod[2] uninitialised when two signals sit at a
   2-branch joint (affects label placement only); defined as zeros, which is what the TS port computes.
Files originally CRLF (demo.cpp, traindcl.h, nxgo.cpp, trkgdi.cpp, joint.cpp) keep CRLF.

## Nondeterminism audit (no rand/srand/time/chrono affects relays)
- rand()/srand()/random: none in core. time()/ctime/localtime only in AppBuildSignature.h and StatusReport.cpp (UI text). Real GetTickCount
  uses: relays.cpp:602 (timer relay start), traincmn.cpp:321,435, turncomn.cpp:48 -> all now sim time.
- RelayLispSubstrate.cpp:32 `unordered_map RelayHashTable` iterated by map_relay_syms: patched (1). RelayTypeHashMap/AtomMap (readsexp.cpp:186) only looked up, never iterated.
- nxgo.cpp:31-35: AllObjects/VisibleObjects are vectors in non-TLEDIT builds (ordered); `Quads` unordered_map only used for hit lookup/stats.
- traindcl.h:62 `std::set<TrackSeg*>`: patched (3).
- tcircuit.cpp:156,224 unordered_sets: counting / deletion only (circuit deletion order has no relay effect); SGM version is TLEDIT only.
- traincmn.cpp:111 `std::map<int,...> Trains` is int-keyed (ordered). SwitchConsistency map<long,int> ordered.
- joint.cpp:293 `qsort` of <=3 JointOrganizationData by double angle: not stable in general; ties only for exactly equal angles. glibc and macOS both behave stably for such tiny arrays; TS should use a stable sort.
- Valgrind: only uninitialised reads are in graphics geometry (label sizes from text metrics, scroll/viewport math) and one read in
  xtgload.cpp:268 (`CAR(s) == aNUMFLIP`, flip flag; only affects drawing). None reach relay logic. DrawText stub supplies fake fixed-pitch metrics for DT_CALCRECT.
- Timer ordering on Mac (NSTimer) for equal due times is unspecified; the harness defines it as FIFO by scheduling order.

## Goldens (golden/*.trace)
load-* for the six interlockings (Duckburg main file is db7.trk, which includes dburg.trk and stdmacs.trk; library uses db7; dburg.trk alone also captured),
demo-Myrtle (Interlockings/Myrtle/Myrtle.xdo), script-* (scripts/*.xdo: throw 2 switches, set 1-2 routes; entrance H/HV relays pick).
Demo `load` paths are relative to the .xdo file (replace_filename).
