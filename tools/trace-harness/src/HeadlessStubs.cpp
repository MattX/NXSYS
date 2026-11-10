// Stub implementations of everything the NXSYSMac Objective-C++ layer
// (Winapi.mm, DeviceContext.mm, MessageBox.mm, MiscApi.mm, MainView.mm,
// AppDelegate.mm, dialogs, BigYellowX, ...) provides to the portable core,
// plus the compiled-code (.tko) support entry points the headless build omits.
// All GDI/window calls are no-ops.

#include "windows.h"
#include "MessageBox.h"
#include "MacRlyDlg.h"
#include "AppDelegateGlobals.h"
#include "GetResourceDirectoryPathname.h"
#include "CompiledReportInfo.h"
#include "ldgDisassemble.hpp"
#include <filesystem>
#include <stdio.h>
#include <string>

struct __DC_ { int dummy; };
static __DC_ TheDummyDC;
static int TheDummyWindow;

// ---- GDI / window no-ops -------------------------------------------------
HDC GetDC(HWND) { return &TheDummyDC; }
HDC ReleaseDC(HWND, HDC) { return NULL; }
HFONT CreateFontIndirect(LOGFONT*) { return NULL; }
void DeleteObject(void*) {}
void DebugBreak() { abort(); }
void FatalAppExit(int, const char* text) {
    fprintf(stderr, "FATALAPPEXIT: %s\n", text);
    exit(4);
}
void DeleteMenu(HMENU, int, int) {}
void EnableMenuItem(HMENU, int, int) {}
void DestroyWindow(HWND) {}
void CheckRadioButton(HWND, int, int, int) {}
// Fake fixed-pitch text metrics (graphics only; keeps label geometry defined).
int DrawText(HDC, const char* s, unsigned long len, RECT* r, int flags) {
    if (r && (flags & DT_CALCRECT)) {
        r->right = r->left + (int)(len ? len : strlen(s)) * 7;
        r->bottom = r->top + 14;
    }
    return 14;
}
void Ellipse(HDC, int, int, int, int) {}
void FillRect(HDC, RECT*, HBRUSH) {}
void LineTo(HDC, int, int) {}
void MoveTo(HDC, int, int) {}
void MoveToEx(HDC, int, int, void*) {}
void Rectangle(HDC, int, int, int, int) {}
void NXM_Polygon(HDC, POINT*, int) {}
void SelectObject(HDC, void*) {}
void SetBkColor(HDC, COLORREF) {}
void SetBkMode(HDC, int) {}
void SetTextColor(HDC, COLORREF) {}
COLORREF GetTextColor(HDC) { return 0; }
int GetBkMode(HDC) { return 0; }
void GetClientRect(HWND, RECT* r) { r->left = r->top = 0; r->right = 1024; r->bottom = 768; }
void GetWindowRect(HWND, RECT* r) { GetClientRect(NULL, r); }
HWND GetDesktopWindow() { return (HWND)&TheDummyWindow; }
HWND GetDlgItem(HWND, int) { return NULL; }
int GetDlgItemInt(HWND, int, BOOL*, BOOL) { return 0; }
UINT GetDlgItemText(HWND, int, char* buf, int) { if (buf) buf[0] = 0; return 0; }
void SetDlgItemText(HWND, int, const char*) {}
void SetWindowText(HWND, const char*) {}
void InvalidateRect(HWND, RECT*, int) {}
void ShowWindow(HWND, int) {}
void setFrameTopLeft(HWND, int, int) {}
void setSliderValue(HWND, int, int) {}

// ---- Mac app layer -------------------------------------------------------
bool REDISPLAYING = false;
void ScenarioHelpTitler(const char*) {}
void Mac_SetDisplayWPOrg(long, long) {}
void MacDemoSay(const char*) {}
void MacDemoHide() {}
void MacBeforeLayoutLoad() {}
void MacOnSuccessfulLayoutLoad(const char*) {}
void MacAssertTrueLayoutDims(int, int) {}
HWND MacCreateDynmenu(void*) { return NULL; }
int MacKludgeParam2(HWND, int, int) { return 0; }
HWND MacCreateTrainDialog(void*, int, bool) { return (HWND)&TheDummyWindow; }
void MacFillPlateSexily(HWND, int, int, int, int) {}
HWND MacMakeFSW(int, int, int, int, void*) { return (HWND)&TheDummyWindow; }
int MacWindowsContextMenu(HWND, int, void*) { return 0; }
void ShowBigYellowX(int, int) {}
void UnShowBigYellowX() {}
void DrafterMakeScrollVisible(void*, int, int, int) {}
HWND getRelayDrafterHWND(bool) { return NULL; }
void ShowStateRelay(Relay*) {}
Relay* RelayListDialog(int, const char*, const RelayVec&, const char*) { return NULL; }
void HelpSystemDisplay(const char*) {}
void HelpSystemDisplayURL(const char*) {}
void OfferChooseTrack() {}
void LoseChooseTrack() {}
bool SimpleGetDialog(const char*, const char*, char*, int) { return false; }

std::filesystem::path GetResourceDirectoryPathname() { return std::filesystem::path("."); }

// ---- Modal message boxes -------------------------------------------------
// Never blocks. Prints "MSGBOX: <title>: <text>" to stderr and returns the
// default answer: IDNO for YES/NO(/CANCEL) boxes, IDOK otherwise.
int MessageBox(void*, const char* message, const char* title, int flags) {
    fprintf(stderr, "MSGBOX: %s: %s\n", title ? title : "", message ? message : "");
    int ftype = flags & MB_LOWMASK;
    if (ftype == MB_YESNO || ftype == MB_YESNOCANCEL)
        return IDNO;
    return IDOK;
}
int MessageBoxWithImage(void* h, const char* text, const char* hdr, const char*, int flags) {
    return MessageBox(h, text, hdr, flags);
}

// ---- Compiled-code (.tko) support: not built ------------------------------
bool haveDisassembly = false;
void InitLdgDisassembly() { haveDisassembly = false; }
void ldgDisassemble(Relay*) {}
void ldgDisassembleDraw(HDC) {}
int GetRelayFunctionLength(Relay*) { return 0; }
const CompiledReportInfo* GetCompiledReportInfo() { return NULL; }
