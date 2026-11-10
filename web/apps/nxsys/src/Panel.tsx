import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { engine } from "./engine";
import { CanvasDC } from "./canvasdc";
import type { Rect } from "@nxsys/core/src/render/dc";
import { drawDcTest, replayDump } from "./dctest";

/*
 * The panel view: a scroll container holding a "sizer" (layout size x zoom, giving native
 * scrollbars/wheel/touch panning) and a canvas that is sticky to the container's top-left and
 * always viewport-sized. Zoom is a canvas transform (like the Mac's scroll-view magnification),
 * so the core stays at scale 1 and its screen coordinates equal world coordinates.
 */

type PaintFn = (dc: CanvasDC, rect: Rect) => void;
// paintLayout lives in core's render/index.ts, written by another workstream. Bind it only if present.
const renderModules = import.meta.glob("../../../packages/core/src/render/index.ts", { eager: true }) as Record<
  string,
  { paintLayout?: (dc: CanvasDC, rect?: Rect) => void }
>;
const paintLayout: PaintFn | null = Object.values(renderModules)[0]?.paintLayout ?? null;
export const hasPaintLayout = paintLayout !== null;

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 6;

interface Props {
  zoom: number;
  setZoom: (z: number) => void;
  /** increments to request fit-to-window */
  fitTick: number;
}

interface Anchor {
  wx: number;
  wy: number;
  cx: number;
  cy: number;
}

export function Panel({ zoom, setZoom, fitTick }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const anchor = useRef<Anchor | null>(null);
  const paintQueued = useRef(false);
  const viewSize = useRef({ w: 0, h: 0 });

  /* ---- painting ---- */
  const paint = useCallback(() => {
    paintQueued.current = false;
    const canvas = canvasRef.current;
    const sc = scrollRef.current;
    if (!canvas || !sc) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const z = zoomRef.current;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const k = dpr * z;
    ctx.setTransform(k, 0, 0, k, -sc.scrollLeft * dpr, -sc.scrollTop * dpr);
    const rect: Rect = {
      left: Math.floor(sc.scrollLeft / z),
      top: Math.floor(sc.scrollTop / z),
      right: Math.ceil((sc.scrollLeft + W) / z),
      bottom: Math.ceil((sc.scrollTop + H) / z),
    };
    const dc = new CanvasDC(ctx);
    dc.deviceScale = k;
    if (!engine.getSnapshot().loaded && location.search.includes("dctest")) { drawDcTest(dc); replayDump(dc); }
    if (engine.getSnapshot().loaded) {
      if (paintLayout) {
        try {
          paintLayout(dc, rect);
        } catch (e) {
          console.error("paintLayout failed", e);
        }
      } else {
        ctx.fillStyle = "#789";
        ctx.font = "16px sans-serif";
        ctx.fillText("paintLayout (core render) is not available in this build.", rect.left + 20, rect.top + 40);
      }
      const yx = engine.getSnapshot().yellowX;
      if (yx) {
        ctx.strokeStyle = "rgba(255,255,0,0.85)";
        ctx.lineWidth = 8;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(yx.x - 28, yx.y - 28);
        ctx.lineTo(yx.x + 28, yx.y + 28);
        ctx.moveTo(yx.x + 28, yx.y - 28);
        ctx.lineTo(yx.x - 28, yx.y + 28);
        ctx.stroke();
      }
    }
  }, []);

  const requestPaint = useCallback(() => {
    if (paintQueued.current) return;
    paintQueued.current = true;
    requestAnimationFrame(paint);
  }, [paint]);

  /* ---- sizing ---- */
  const applySizes = useCallback(() => {
    const sc = scrollRef.current;
    const canvas = canvasRef.current;
    const sizer = sizerRef.current;
    if (!sc || !canvas || !sizer) return;
    const dpr = window.devicePixelRatio || 1;
    const w = sc.clientWidth;
    const h = sc.clientHeight;
    viewSize.current = { w, h };
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    const bw = Math.max(1, Math.round(w * dpr));
    const bh = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const z = zoomRef.current;
    sizer.style.width = Math.max(w, Math.ceil(engine.layoutW * z)) + "px";
    sizer.style.height = Math.max(h, Math.ceil(engine.layoutH * z)) + "px";
  }, []);

  useEffect(() => {
    const sc = scrollRef.current!;
    engine.paintHook = requestPaint;
    engine.layoutSizeHook = (_w, _h, origin) => {
      applySizes();
      if (origin) {
        sc.scrollLeft = origin.x * zoomRef.current;
        sc.scrollTop = origin.y * zoomRef.current;
      } else {
        sc.scrollLeft = 0;
        sc.scrollTop = 0;
      }
      requestPaint();
    };
    const ro = new ResizeObserver(() => {
      applySizes();
      requestPaint();
    });
    ro.observe(sc);
    const onScroll = () => requestPaint();
    sc.addEventListener("scroll", onScroll, { passive: true });
    const unsub = engine.subscribe(requestPaint);
    applySizes();
    requestPaint();
    return () => {
      engine.paintHook = null;
      engine.layoutSizeHook = null;
      ro.disconnect();
      sc.removeEventListener("scroll", onScroll);
      unsub();
    };
  }, [applySizes, requestPaint]);

  /* ---- zoom changes keep the anchor point fixed (default anchor: view center) ---- */
  const prevZoom = useRef(zoom);
  useLayoutEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    applySizes();
    const { w, h } = viewSize.current;
    const a = anchor.current ?? {
      wx: (sc.scrollLeft + w / 2) / prevZoom.current,
      wy: (sc.scrollTop + h / 2) / prevZoom.current,
      cx: w / 2,
      cy: h / 2,
    };
    sc.scrollLeft = a.wx * zoom - a.cx;
    sc.scrollTop = a.wy * zoom - a.cy;
    anchor.current = null;
    prevZoom.current = zoom;
    requestPaint();
  }, [zoom, applySizes, requestPaint]);

  const zoomAbout = useCallback(
    (newZoom: number, cx: number, cy: number) => {
      const sc = scrollRef.current!;
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, newZoom));
      if (z === zoomRef.current) return;
      anchor.current = {
        wx: (sc.scrollLeft + cx) / zoomRef.current,
        wy: (sc.scrollTop + cy) / zoomRef.current,
        cx,
        cy,
      };
      setZoom(z);
    },
    [setZoom],
  );

  // zoom buttons/keys (App changes `zoom` prop): anchor on the view center when no anchor is set.
  useLayoutEffect(() => {
    // fit-to-window
    if (fitTick === 0) return;
    const { w, h } = viewSize.current;
    if (w && h && engine.layoutW && engine.layoutH) {
      const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(w / engine.layoutW, h / engine.layoutH)));
      anchor.current = { wx: 0, wy: 0, cx: 0, cy: 0 };
      setZoom(z);
    }
  }, [fitTick, setZoom]);

  /* ---- wheel (ctrl/cmd = zoom) ---- */
  useEffect(() => {
    const sc = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = sc.getBoundingClientRect();
      zoomAbout(zoomRef.current * Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025)), e.clientX - r.left, e.clientY - r.top);
    };
    sc.addEventListener("wheel", onWheel, { passive: false });
    return () => sc.removeEventListener("wheel", onWheel);
  }, [zoomAbout]);

  /* ---- pointer handling ---- */
  const space = useRef(false);
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
    const kd = (e: KeyboardEvent) => {
      if (e.code === "Space" && !typing(e.target) && !(e.target instanceof HTMLButtonElement)) {
        space.current = true;
        e.preventDefault();
        scrollRef.current?.classList.add("grab");
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        space.current = false;
        scrollRef.current?.classList.remove("grab");
      }
    };
    const up = () => engine.mouseUp();
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  const drag = useRef<{ x: number; y: number; sl: number; st: number } | null>(null);
  const touch = useRef<{ x: number; y: number; t: number; moved: boolean; timer: number } | null>(null);

  const toWorld = (e: { clientX: number; clientY: number }) => {
    const sc = scrollRef.current!;
    const r = sc.getBoundingClientRect();
    return {
      x: (e.clientX - r.left + sc.scrollLeft) / zoomRef.current,
      y: (e.clientY - r.top + sc.scrollTop) / zoomRef.current,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const sc = scrollRef.current!;
    if (e.pointerType === "touch") {
      const t = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false, timer: 0 };
      t.timer = window.setTimeout(() => {
        if (touch.current === t && !t.moved) {
          // long press = right click
          const w = toWorld(e);
          engine.mouse(w.x, w.y, "right", { shift: false, ctrl: false });
          engine.mouseUp();
          touch.current = null;
        }
      }, 550);
      touch.current = t;
      return;
    }
    if (e.button === 1 || (e.button === 0 && space.current)) {
      e.preventDefault();
      drag.current = { x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      sc.classList.add("grabbing");
      return;
    }
    if (e.button === 0 || e.button === 2) {
      const w = toWorld(e);
      const ctrl = e.ctrlKey; // Mac: control-click is its own command (WM_NXGO_*CONTROL), not a right click
      engine.mouse(w.x, w.y, e.button === 0 ? "left" : "right", { shift: e.shiftKey, ctrl });
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const sc = scrollRef.current!;
    if (drag.current) {
      sc.scrollLeft = drag.current.sl - (e.clientX - drag.current.x);
      sc.scrollTop = drag.current.st - (e.clientY - drag.current.y);
    }
    const t = touch.current;
    if (t && Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8) t.moved = true;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const sc = scrollRef.current!;
    if (drag.current) {
      drag.current = null;
      sc.classList.remove("grabbing");
    }
    const t = touch.current;
    if (t && e.pointerType === "touch") {
      clearTimeout(t.timer);
      touch.current = null;
      if (!t.moved && performance.now() - t.t < 550) {
        const w = toWorld(e);
        engine.mouse(w.x, w.y, "left", { shift: false, ctrl: false });
        engine.mouseUp();
      }
    }
  };

  return (
    <div
      ref={scrollRef}
      className="panel-scroll"
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      data-testid="panel"
    >
      <div ref={sizerRef} className="panel-sizer">
        <canvas ref={canvasRef} className="panel-canvas" data-testid="canvas" />
      </div>
    </div>
  );
}
