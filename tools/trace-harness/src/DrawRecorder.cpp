// GDI stand-in for the headless harness: records the GDI call stream of a paint in the
// "nxdraw" display-list text format (web/packages/core/src/render/dc.ts documents it).
// Outside of a recording (DrawRecorder_Begin .. _End) every call is a harmless no-op, except
// that DC state (text color, bk mode) is kept so GetTextColor/GetBkMode behave.
//
// Pens/brushes are created by InitTrackGDI through CreateSPen/CreateSBrush (trkgdi.cpp), whose
// GDIEnt table hands out small-integer handles; RetrieveGDIWrapperInfo gives back their content.
// Stock objects (handles 1001..1005) are passed through unchanged by the NX_HEADLESS patch to
// GetStockObject, so they print as STOCK <NAME>. Fonts get Mac-style handles (UFONT_BASE + index).

#include "windows.h"
#include "nxgo.h"
#include "typeid.h"
#include "xtgtrack.h"
#include "swkey.h"
#include "trafficlever.h"
#include "plight.h"
#include "pswitch.h"
#include "signal.h"
#include <cstdarg>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

BOOL RetrieveGDIWrapperInfo(HGDIOBJ gh, bool& isPen, COLORREF& color, int& param1, int& param2);

struct __DC_ { int dummy; };
static __DC_ TheDummyDC;

static std::vector<LOGFONT> Fonts;
static FILE* Out = NULL;
static bool Recording = false;
static COLORREF CurTextColor = 0;
static int CurBkMode = 0;

static void put(const char* fmt, ...) __attribute__((format(printf, 1, 2)));
static void put(const char* fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    vfprintf(Out, fmt, ap);
    va_end(ap);
}

static const char* StockName(long h) {
    switch (h) {
        case 1001: return "BLACK_BRUSH";
        case 1002: return "WHITE_BRUSH";
        case 1003: return "LTGRAY_BRUSH";
        case 1004: return "BLACK_PEN";
        case 1005: return "NULL_PEN";
    }
    return NULL;
}

// Strings: double-quoted; only \\ \" and bytes < 0x20 or >= 0x7f are escaped (as \u00xx).
static std::string Quote(const char* s, size_t n) {
    std::string r = "\"";
    for (size_t i = 0; i < n; i++) {
        unsigned char c = (unsigned char)s[i];
        if (c == '"' || c == '\\') { r += '\\'; r += (char)c; }
        else if (c < 0x20 || c >= 0x7f) { char b[8]; snprintf(b, sizeof b, "\\u%04x", c); r += b; }
        else r += (char)c;
    }
    return r + "\"";
}

HDC GetDC(HWND) { return &TheDummyDC; }
HDC ReleaseDC(HWND, HDC) { return NULL; }
void DeleteObject(void*) {}

HFONT CreateFontIndirect(LOGFONT* lf) {
    Fonts.push_back(*lf);
    return (HFONT)(long)(Fonts.size() + UFONT_BASE - 1);
}

void SelectObject(HDC, void* obj) {
    if (obj == NULL || !Recording) return;
    long h = (long)obj;
    if (h > BRUSH_PEN_FIRST && h < BRUSH_PEN_END) {
        put("SELECT STOCK %s\n", StockName(h));
        return;
    }
    if (h >= UFONT_BASE && h < UFONT_END) {
        const LOGFONT& f = Fonts.at(h - UFONT_BASE);
        put("SELECT FONT %d %d %d %d %s\n", f.lfHeight, f.lfWeight, f.lfWidth, f.lfItalic ? 1 : 0,
            Quote(f.lfFaceName, strnlen(f.lfFaceName, sizeof f.lfFaceName)).c_str());
        return;
    }
    bool isPen; COLORREF c; int p1, p2;
    RetrieveGDIWrapperInfo(obj, isPen, c, p1, p2);
    if (isPen) put("SELECT PEN %d %d %06x\n", p1, p2, (unsigned)c & 0xFFFFFF);
    else put("SELECT BRUSH %06x\n", (unsigned)c & 0xFFFFFF);
}

void MoveTo(HDC, int x, int y) { if (Recording) put("MOVETO %d %d\n", x, y); }
void MoveToEx(HDC, int x, int y, void*) { if (Recording) put("MOVETO %d %d\n", x, y); }
void LineTo(HDC, int x, int y) { if (Recording) put("LINETO %d %d\n", x, y); }
void Ellipse(HDC, int l, int t, int r, int b) { if (Recording) put("ELLIPSE %d %d %d %d\n", l, t, r, b); }
void Rectangle(HDC, int l, int t, int r, int b) { if (Recording) put("RECTANGLE %d %d %d %d\n", l, t, r, b); }
void NXM_Polygon(HDC, POINT* p, int n) {
    if (!Recording) return;
    put("POLYGON %d", n);
    for (int i = 0; i < n; i++) put(" %d %d", p[i].x, p[i].y);
    put("\n");
}
void FillRect(HDC, RECT* r, HBRUSH b) {
    if (!Recording) return;
    long h = (long)b;
    put("FILLRECT %d %d %d %d ", r->left, r->top, r->right, r->bottom);
    if (h > BRUSH_PEN_FIRST && h < BRUSH_PEN_END) { put("STOCK %s\n", StockName(h)); return; }
    bool isPen; COLORREF c; int p1, p2;
    RetrieveGDIWrapperInfo(b, isPen, c, p1, p2);
    put("BRUSH %06x\n", (unsigned)c & 0xFFFFFF);
}

void SetTextColor(HDC, COLORREF c) { CurTextColor = c; if (Recording) put("TEXTCOLOR %06x\n", (unsigned)c & 0xFFFFFF); }
COLORREF GetTextColor(HDC) { return CurTextColor; }
void SetBkColor(HDC, COLORREF c) { if (Recording) put("BKCOLOR %06x\n", (unsigned)c & 0xFFFFFF); }
void SetBkMode(HDC, int m) { CurBkMode = m; if (Recording) put("BKMODE %d\n", m); }
int GetBkMode(HDC) { return CurBkMode; }

// Fake fixed-pitch text metrics (7 px/char, height 14): graphics geometry only.
// DT_CALCRECT is never recorded.
int DrawText(HDC, const char* s, unsigned long len, RECT* r, int flags) {
    if (flags & DT_CALCRECT) {
        if (r) {
            r->right = r->left + (int)(len ? len : strlen(s)) * 7;
            r->bottom = r->top + 14;
        }
        return 14;
    }
    if (Recording) {
        size_t n = strlen(s);
        if (len < n) n = len;
        put("DRAWTEXT %d %d %d %d %d %s\n", r->left, r->top, r->right, r->bottom, flags, Quote(s, n).c_str());
    }
    return 14;
}

// ---- driver interface --------------------------------------------------------------------
void DrawRecorder_Begin(FILE* f) {
    Out = f;
    Recording = true;
    CurTextColor = 0;
    CurBkMode = 0;
}
void DrawRecorder_End() {
    Recording = false;
    Out = NULL;
}
void DrawRecorder_Put(const char* line) { if (Recording) put("%s\n", line); }

// Called from DisplayVisibleObjectsRect (NX_HEADLESS patch in nxgo.cpp) before each object's Display().
void NXHeadlessDrawObject(GraphicObject* g) {
    if (!Recording) return;
    TypeId t = g->TypeID();
    long nom = 0;
    switch (t) {
        case TypeId::SIGNAL: { PanelSignal* p = static_cast<PanelSignal*>(g); nom = p->Sig ? p->Sig->XlkgNo : 0; break; }
        case TypeId::STOP: { Stop* p = static_cast<Stop*>(g); nom = p->Sig ? p->Sig->XlkgNo : 0; break; }
        case TypeId::EXITLIGHT: nom = static_cast<ExitLight*>(g)->XlkgNo; break;
        case TypeId::TRACKSEG: nom = static_cast<TrackSeg*>(g)->TCNO(); break;
        case TypeId::SWITCHKEY: nom = static_cast<SwitchKey*>(g)->XlkgNo; break;
        case TypeId::TRAFFICLEVER: nom = static_cast<TrafficLever*>(g)->XlkgNo; break;
        case TypeId::PANELLIGHT: nom = static_cast<PanelLight*>(g)->XlkgNo; break;
        case TypeId::PANELSWITCH: nom = static_cast<PanelSwitch*>(g)->XlkgNo; break;
        default: break;
    }
    put("OBJ %d %ld\n", (int)t, nom);
}
