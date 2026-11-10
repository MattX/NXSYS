// Visual self-test for CanvasDC (open the app with ?dctest while no interlocking is loaded).
import { engine } from "./engine";
import {
  DT_CALCRECT, DT_CENTER, DT_VCENTER, FW_BOLD, FW_NORMAL, OPAQUE, PS_NULL, PS_SOLID, RGB, TRANSPARENT,
  createFontIndirect, createPen, createSolidBrush, getStockObject, type DC,
} from "@nxsys/core/src/render/dc";

export function drawDcTest(dc: DC): void {
  dc.selectObject(createPen(PS_SOLID, 1, RGB(128, 128, 128)));
  for (let i = 0; i < 6; i++) { dc.moveTo(20, 20 + i * 8); dc.lineTo(220, 20 + i * 8); }
  dc.selectObject(createPen(PS_SOLID, 2, RGB(0, 255, 0)));
  dc.moveTo(20, 80); dc.lineTo(220, 80); dc.moveTo(240, 20); dc.lineTo(240, 90);
  dc.selectObject(createPen(PS_SOLID, 3, RGB(255, 255, 255)));
  dc.moveTo(20, 95); dc.lineTo(220, 100);
  dc.selectObject(createSolidBrush(RGB(255, 0, 0)));
  dc.ellipse(260, 20, 300, 60);
  dc.selectObject(createSolidBrush(RGB(0, 255, 0)));
  dc.rectangle(310, 20, 350, 60);
  dc.selectObject(createSolidBrush(RGB(255, 192, 0)));
  dc.selectObject(createPen(PS_SOLID, 3, RGB(0, 0, 255)));
  dc.polygon([{ x: 360, y: 60 }, { x: 400, y: 60 }, { x: 380, y: 20 }]);
  dc.selectObject(getStockObject("NULL_PEN"));
  dc.polygon([{ x: 410, y: 60 }, { x: 450, y: 60 }, { x: 430, y: 20 }]);
  dc.selectObject(createPen(PS_NULL, 1, 0));
  dc.fillRect({ left: 460, top: 20, right: 500, bottom: 60 }, getStockObject("LTGRAY_BRUSH"));
  dc.setBkMode(TRANSPARENT);
  dc.setTextColor(RGB(255, 255, 255));
  const f = (h: number, w: number, face = "") => createFontIndirect({ height: h, weight: w, width: 0, italic: false, face });
  dc.selectObject(f(12, FW_NORMAL));
  const r = { left: 20, top: 120, right: 200, bottom: 150 };
  dc.drawText("Default Helvetica 12 (9.6->10)", r, 0);
  dc.selectObject(f(18, FW_BOLD));
  dc.drawText("Bold 18 (14.4)", { left: 20, top: 150, right: 200, bottom: 180 }, 0);
  const box = { left: 260, top: 110, right: 460, bottom: 150 };
  dc.selectObject(createPen(PS_SOLID, 1, RGB(90, 90, 90)));
  dc.moveTo(box.left, box.top); dc.lineTo(box.right, box.top); dc.lineTo(box.right, box.bottom); dc.lineTo(box.left, box.bottom); dc.lineTo(box.left, box.top);
  dc.selectObject(f(15, FW_NORMAL));
  dc.drawText("CENTER+VCENTER", box, DT_CENTER | DT_VCENTER);
  const cr = { left: 0, top: 0, right: 0, bottom: 0 };
  dc.drawText("measure me", cr, DT_CALCRECT);
  dc.setBkMode(OPAQUE);
  dc.setBkColor(RGB(0, 0, 160));
  dc.setTextColor(RGB(255, 255, 0));
  dc.drawText(`opaque bk, extent ${cr.right}x${cr.bottom}`, { left: 260, top: 160, right: 460, bottom: 180 }, 0);
}

/**
 * `?dctest&replay=<url>`: fetch an nxdraw display list (e.g. a golden C++ recording) and replay it
 * through the CanvasDC, to compare the backend against the original drawing.
 */
let replayOps: unknown[] | null = null;
let replayRequested = false;
export function replayDump(dc: DC): void {
  const url = new URLSearchParams(location.search).get("replay");
  if (!url) return;
  if (replayOps) {
    void import("@nxsys/core/src/render/nxdraw").then((m) => m.replayNxdraw(replayOps as never, dc));
    return;
  }
  if (replayRequested) return;
  replayRequested = true;
  void Promise.all([fetch(url).then((r) => r.text()), import("@nxsys/core/src/render/nxdraw")]).then(([text, m]) => {
    replayOps = m.parseNxdraw(text);
    engine.invalidate();
  });
}
