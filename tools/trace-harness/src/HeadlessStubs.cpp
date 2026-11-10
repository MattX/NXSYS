// Stub implementations of everything the NXSYSMac Objective-C++ layer
// (Winapi.mm, DeviceContext.mm, MessageBox.mm, MiscApi.mm, MainView.mm,
// AppDelegate.mm, dialogs, BigYellowX, ...) provides to the portable core,
// plus the compiled-code (.tko) support entry points the headless build omits.
// Window/dialog calls are no-ops (GDI lives in DrawRecorder.cpp).

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

static int TheDummyWindow;

// ---- GDI: see DrawRecorder.cpp (records the nxdraw display list) --------
void DebugBreak() { abort(); }
void FatalAppExit(int, const char* text) {
    fprintf(stderr, "FATALAPPEXIT: %s\n", text);
    exit(4);
}
void DeleteMenu(HMENU, int, int) {}
void EnableMenuItem(HMENU, int, int) {}
void DestroyWindow(HWND) {}
void CheckRadioButton(HWND, int, int, int) {}
int HeadlessClientW = 1024, HeadlessClientH = 768;   // main.cpp sets these while recording a full-signal window
void GetClientRect(HWND, RECT* r) { r->left = r->top = 0; r->right = HeadlessClientW; r->bottom = HeadlessClientH; }
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
