// nxtrace -- headless driver for the original NXSYS core.
//
//   nxtrace [--settle MS] [--until MS] [--draw-at MS[,MS...]] [--tool-at MS,.. [--draft-relays NAME,..]... [--fullsig NO,..]]
//           [--status-at MS,..] [--draw-dir DIR] <file.trk | file.xdo>
//
// Emits a deterministic relay trace on stdout (see NOTES.md for the format).
// With --draw-at/--draw-dir it also repaints the whole panel at the given sim times and writes
// the GDI call stream (nxdraw format) to <DIR>/<basename>@<ms>.nxdraw. Painting does not
// change the trace output.

#include "windows.h"
#include "AppAbortRestart.h"
#include "lisp.h"
#include "relays.h"
#include "rlyapi.h"
#include "rlytrapi.h"
#include "nxsysapp.h"
#include "demoapi.h"
#include "timers.h"
#include "nxgo.h"
#include "typeid.h"
#include "xtgtrack.h"
#include "swkey.h"
#include "trafficlever.h"
#include "plight.h"
#include "pswitch.h"
#include "signal.h"
#include "StatusReport.h"
#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <filesystem>
#include <string>
#include <vector>

// sim clock (SimTimers.cpp)
long SimNow();
bool SimStep(long limit_ms);
void SimRunUntil(long until_ms);
// nxsys.cpp
extern HWND G_mainwindow;
int StartUpNXSYS(HINSTANCE, HWND, const char*, const char*, int);
void CleanUpNXSYS();
// demo.cpp (NX_HEADLESS hook)
bool NXHeadlessDemoActive();

static std::string Base;

// DrawRecorder.cpp
void DrawRecorder_Begin(FILE* f);
void DrawRecorder_End();
extern bool REDISPLAYING;

// ---- Phase 5 tool recordings (see NOTES.md) ----
static std::vector<std::vector<std::string>> DraftPages;   // --draft-relays (repeatable): one page each
static std::vector<long> ToolTimes;                       // --tool-at
static std::vector<long> StatusTimes;                     // --status-at
static std::vector<long> FullsigNos;                      // --fullsig
static size_t NextTool = 0, NextStatus = 0;

extern int HeadlessClientW, HeadlessClientH;
HWND MakeSigWin(Signal* s, int x, int y);                 // fullsig.cpp
void CallFSWinDisp(void* s, HDC dc, int lo);              // fullsig.cpp (NXSYSMac)
int DrawRelayFromName(const char*);                       // ldgut.cpp
int PlaceRelayDrawing();
void RenderRelayPage(HDC);
void ClearRelayGraphics();

static std::vector<long> DrawTimes;
static std::string DrawDir;
static size_t NextDraw = 0;

// Repaint everything the way MainView.mm drawRect does for a dirty rect covering the whole view.
// Viewport: origin (0,0) (the Mac app never moves the WP origin; VIEW-ORIGIN is only a scroll
// position), scale 1.0, extent = NXGO_ComputeTrueLayoutDimensions() (what MacAssertTrueLayoutDims
// sizes the view to).
static void PaintPanel(long ms) {
    RECT lims = NXGO_ComputeTrueLayoutDimensions();
    int w = lims.right - lims.left, h = lims.bottom - lims.top;
    NXGO_SetViewportDims(w, h);   // recomputes visible set, as the Mac app does once per layout load
    std::string path = DrawDir + "/" + Base + "@" + std::to_string(ms) + ".nxdraw";
    FILE* f = fopen(path.c_str(), "wb");
    if (!f) {
        fprintf(stderr, "nxtrace: cannot write %s\n", path.c_str());
        return;
    }
    fprintf(f, "# nxdraw 1 %s @%ld\n", Base.c_str(), ms);
    fprintf(f, "VIEW %d %d %d %d %g\n", 0, 0, w, h, NXGO_GetDisplayScale());
    DrawRecorder_Begin(f);
    REDISPLAYING = true;
    HDC dc = GetDC(G_mainwindow);
    SetTextColor(dc, 0xFFFFFF);
    SetBkMode(dc, TRANSPARENT);
    RECT r;
    r.left = 0; r.top = 0; r.right = w; r.bottom = h;
    DisplayVisibleObjectsRect(dc, r);
    ReleaseDC(G_mainwindow, dc);
    REDISPLAYING = false;
    DrawRecorder_End();
    fprintf(f, "END\n");
    fclose(f);
}

static std::string ToolPath(long ms, const std::string& tag, const char* ext) {
    return DrawDir + "/" + Base + "@" + std::to_string(ms) + "." + tag + "." + ext;
}

// RelayDrafterView.mm drawRect: SelectObject(BLACK_PEN), SetTextColor(0), SetBkMode(TRANSPARENT), RenderRelayPage.
// Each page is re-placed from scratch (ClearRelayGraphics, then the Mac's DrawRelayAPI sequence: DrawRelayFromName +
// PlaceRelayDrawing); placement depends only on circuit structure, never on relay state.
// The page occupies NCellW x NCellH cells of 80x32 (the Mac never calls DrawingSetPageSize): view 880x1664 is arbitrary.
static const int DraftW = 880, DraftH = 1664;
static void PaintDraft(long ms, size_t page) {
    ClearRelayGraphics();
    for (auto& name : DraftPages[page]) {
        if (!DrawRelayFromName(name.c_str())) continue;
        if (!PlaceRelayDrawing())
            fprintf(stderr, "nxtrace: relay circuit %s too big for the page\n", name.c_str());
    }
    std::string path = ToolPath(ms, "draft" + std::to_string(page), "nxdraw");
    FILE* f = fopen(path.c_str(), "wb");
    if (!f) { fprintf(stderr, "nxtrace: cannot write %s\n", path.c_str()); return; }
    fprintf(f, "# nxdraw 1 %s @%ld\n", Base.c_str(), ms);
    fprintf(f, "VIEW 0 0 %d %d 1\n", DraftW, DraftH);
    DrawRecorder_Begin(f);
    HDC dc = GetDC(G_mainwindow);
    SelectObject(dc, GetStockObject(BLACK_PEN));
    SetTextColor(dc, 0x000000);
    SetBkMode(dc, TRANSPARENT);
    RenderRelayPage(dc);
    ReleaseDC(G_mainwindow, dc);
    DrawRecorder_End();
    fprintf(f, "END\n");
    fclose(f);
    ClearRelayGraphics();
}

static Signal* FoundSignal;
static long WantedSignal;
static int SignalFinder(GraphicObject* g) {
    Signal* s = static_cast<PanelSignal*>(g)->Sig;
    if (s && (s->XlkgNo ? s->XlkgNo : s->StationNo) == WantedSignal) { FoundSignal = s; return 1; }
    return 0;
}

// FullSignalView.mm drawRect (non-floating window): BLACK_PEN, text color 0, TRANSPARENT, Signal::WinDisp.
// Window client area = SigWinWidth(60) x (10 + UnitHeight + 20) (MakeSigWin on the Mac).
static void PaintFullsig(long ms, long no) {
    WantedSignal = no; FoundSignal = NULL;
    MapGraphicObjectsOfType(TypeId::SIGNAL, SignalFinder);
    if (!FoundSignal) { fprintf(stderr, "nxtrace: no signal %ld\n", no); return; }
    Signal* s = FoundSignal;
    if (s->Window == NULL) s->Window = MakeSigWin(s, 0, 0);
    HeadlessClientW = 60;
    HeadlessClientH = 10 + s->UnitHeight() + 20;
    std::string path = ToolPath(ms, "fullsig" + std::to_string(no), "nxdraw");
    FILE* f = fopen(path.c_str(), "wb");
    if (!f) { fprintf(stderr, "nxtrace: cannot write %s\n", path.c_str()); return; }
    fprintf(f, "# nxdraw 1 %s @%ld\n", Base.c_str(), ms);
    fprintf(f, "VIEW 0 0 %d %d 1\n", HeadlessClientW, HeadlessClientH);
    DrawRecorder_Begin(f);
    HDC dc = GetDC(G_mainwindow);
    SelectObject(dc, GetStockObject(BLACK_PEN));
    SetTextColor(dc, 0x000000);
    SetBkMode(dc, TRANSPARENT);
    CallFSWinDisp(s, dc, 0);
    ReleaseDC(G_mainwindow, dc);
    DrawRecorder_End();
    fprintf(f, "END\n");
    fclose(f);
}

static void ToolsAt(long ms) {   // all tool recordings due at `ms`
    for (size_t i = 0; i < DraftPages.size(); i++) PaintDraft(ms, i);
    for (long n : FullsigNos) PaintFullsig(ms, n);
}

static void StatusAt(long ms) {  // InterlockingFileStatus::Report(), as the File Info menu command shows it
    InterlockingFileStatus ifs;
    std::string path = DrawDir + "/" + Base + "@" + std::to_string(ms) + ".status";
    FILE* f = fopen(path.c_str(), "wb");
    if (!f) { fprintf(stderr, "nxtrace: cannot write %s\n", path.c_str()); return; }
    std::string r = ifs.Report();
    fwrite(r.data(), 1, r.size(), f);
    fclose(f);
}

// A requested time may carry any of: panel repaint (--draw-at), tool pages (--tool-at), status report (--status-at).
static std::vector<long> PanelTimes;
static void Paint(long ms) {
    if (std::find(PanelTimes.begin(), PanelTimes.end(), ms) != PanelTimes.end()) PaintPanel(ms);
    if (std::find(ToolTimes.begin(), ToolTimes.end(), ms) != ToolTimes.end()) ToolsAt(ms);
    if (std::find(StatusTimes.begin(), StatusTimes.end(), ms) != StatusTimes.end()) StatusAt(ms);
}

static void ParseTimes(const std::string& l, std::vector<long>& out) {
    size_t pos = 0;
    while (pos <= l.size()) {
        size_t c = l.find(',', pos);
        if (c == std::string::npos) c = l.size();
        if (c > pos) out.push_back(atol(l.substr(pos, c - pos).c_str()));
        pos = c + 1;
    }
}

// Run the sim clock to `t`, painting at each requested draw time <= t on the way.
static void RunWithDraws(long t) {
    while (NextDraw < DrawTimes.size() && DrawTimes[NextDraw] <= t) {
        long d = DrawTimes[NextDraw++];
        SimRunUntil(d);
        Paint(d);
    }
    SimRunUntil(t);
}

static void Tracer(const char* name, int state) {
    printf("@%ld %s %s\n", GetTickCount(), state ? "PICK" : "DROP", name);
}

static int CountRelays() {
    int n = 0;
    auto counter = [&](Rlysym* rsp, void*) { if (rsp->rly) n++; };
    map_relay_syms([](Rlysym* r, void* c) {
        (*static_cast<decltype(counter)*>(c))(r, nullptr);
    }, &counter);
    return n;
}

// Linker-wrapped (-Wl,--wrap=ReadLayout): GetLayout() in nxsys.cpp calls ReadLayout().
const char* real_ReadLayout(const char* fname) asm("__real__Z10ReadLayoutPKc");
const char* wrap_ReadLayout(const char* fname) asm("__wrap__Z10ReadLayoutPKc");
const char* wrap_ReadLayout(const char* fname) {
    printf("@%ld LOAD %s\n", GetTickCount(),
           std::filesystem::path(fname).filename().string().c_str());
    const char* r = real_ReadLayout(fname);
    if (r != NULL)
        printf("@%ld LOADED %d\n", GetTickCount(), CountRelays());
    else
        fprintf(stderr, "nxtrace: layout load failed: %s\n", fname);
    return r;
}

// called by the NX_HEADLESS hook in demo.cpp:ProcessForm
void NXHeadlessDemoTrace(Sexpr s) {
    printf("@%ld DEMO %s\n", GetTickCount(), s.PRep().c_str());
}

static void Finish(int rc) {
    fflush(stdout);
    fflush(stderr);
    _Exit(rc);
}

static int run(int argc, char** argv) {
    long settle = 20000, until = -1;
    const char* file = NULL;
    for (int i = 1; i < argc; i++) {
        std::string a = argv[i];
        if (a == "--settle" && i + 1 < argc) settle = atol(argv[++i]);
        else if (a == "--until" && i + 1 < argc) until = atol(argv[++i]);
        else if (a == "--draw-at" && i + 1 < argc) ParseTimes(argv[++i], PanelTimes);
        else if (a == "--tool-at" && i + 1 < argc) ParseTimes(argv[++i], ToolTimes);
        else if (a == "--status-at" && i + 1 < argc) ParseTimes(argv[++i], StatusTimes);
        else if (a == "--fullsig" && i + 1 < argc) ParseTimes(argv[++i], FullsigNos);
        else if (a == "--draft-relays" && i + 1 < argc) {
            std::string l = argv[++i];
            std::vector<std::string> page;
            size_t pos = 0;
            while (pos <= l.size()) {
                size_t c = l.find(',', pos);
                if (c == std::string::npos) c = l.size();
                if (c > pos) page.push_back(l.substr(pos, c - pos));
                pos = c + 1;
            }
            DraftPages.push_back(page);
        }
        else if (a == "--draw-dir" && i + 1 < argc) DrawDir = argv[++i];
        else if (a[0] == '-' && a.size() > 1) {
            fprintf(stderr, "usage: nxtrace [--settle MS] [--until MS] [--draw-at MS,..] [--tool-at MS,.. --draft-relays N,.. ... --fullsig NO,..] [--status-at MS,..] --draw-dir DIR <file.trk|file.xdo>\n");
            return 64;
        } else file = argv[i];
    }
    if (!file) {
        fprintf(stderr, "usage: nxtrace [--settle MS] [--until MS] [--draw-at MS,..] [--tool-at MS,.. --draft-relays N,.. ... --fullsig NO,..] [--status-at MS,..] --draw-dir DIR <file.trk|file.xdo>\n");
        return 64;
    }
    for (auto* v : {&PanelTimes, &ToolTimes, &StatusTimes}) DrawTimes.insert(DrawTimes.end(), v->begin(), v->end());
    std::sort(DrawTimes.begin(), DrawTimes.end());
    DrawTimes.erase(std::unique(DrawTimes.begin(), DrawTimes.end()), DrawTimes.end());
    if (!DrawTimes.empty() && DrawDir.empty()) {
        fprintf(stderr, "nxtrace: --draw-at/--tool-at/--status-at need --draw-dir\n");
        return 64;
    }
    std::filesystem::path p(file);
    Base = p.filename().string();
    std::string ext = p.extension().string();
    for (auto& c : ext) c = tolower(c);
    bool is_demo = (ext == ".xdo");

    setvbuf(stdout, NULL, _IOLBF, 0);
    printf("# nxtrace 1 %s\n", Base.c_str());

    SetRelayTrace(Tracer);                 // before anything loads
    StartUpNXSYS(NULL, G_mainwindow, NULL, NULL, 0);
    SetRelayTrace(Tracer);                 // (belt and braces; nothing resets it)

    long stop;
    if (!is_demo) {
        if (!GetLayout(file, TRUE)) {
            fprintf(stderr, "nxtrace: could not load %s\n", file);
            Finish(2);
        }
        stop = (until >= 0) ? until : SimNow() + settle;
    } else {
        Demo(file);
        long limit = (until >= 0) ? until : 0x7fffffffL;
        while (NXHeadlessDemoActive()) {
            long nd = (NextDraw < DrawTimes.size()) ? DrawTimes[NextDraw] : 0x7fffffffL;
            if (SimStep(std::min(limit, nd))) continue;
            if (NextDraw < DrawTimes.size() && nd <= limit) {   // idle until the draw time
                SimRunUntil(nd);
                Paint(nd);
                NextDraw++;
                continue;
            }
            break;
        }
        stop = (until >= 0) ? until : SimNow() + settle;
    }
    RunWithDraws(stop);
    for (; NextDraw < DrawTimes.size(); NextDraw++)
        fprintf(stderr, "nxtrace: draw time %ld is after the end of the run (%ld); skipped\n", DrawTimes[NextDraw], stop);
    printf("@%ld END\n", GetTickCount());

    std::vector<Rlysym*> syms;
    map_relay_syms([](Rlysym* r, void* v) {
        if (r->rly) static_cast<std::vector<Rlysym*>*>(v)->push_back(r);
    }, &syms);
    std::stable_sort(syms.begin(), syms.end(),
                     [](Rlysym* a, Rlysym* b) { return *a < *b; });
    for (Rlysym* r : syms)
        printf("STATE %s %d\n", r->PRep().c_str(), RelayState(r->rly) ? 1 : 0);
    return 0;
}

int main(int argc, char** argv) {
    int rc;
    try {
        rc = run(argc, argv);
    } catch (nxterm_exception& e) {
        fprintf(stderr, "nxtrace: FATAL: NxsysAppAbort (fatal relay logic error, e.g. relay race); exiting\n");
        Finish(3);
    } catch (std::exception& e) {
        fprintf(stderr, "nxtrace: exception: %s\n", e.what());
        Finish(5);
    }
    Finish(rc);
}
