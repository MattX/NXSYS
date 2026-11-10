import { useEffect, useRef, useState, type ReactNode } from "react";
import { CanvasDC } from "../canvasdc";
import { engine } from "../engine";
import { tools, useTools, type ToolWin } from "./tools";
import { DRAFT_PAGE_WIDTH, DRAFT_PAGE_HEIGHT } from "@nxsys/core/src/tools/ldgut";
import { paintFullSignal, fullSignalClientSize } from "@nxsys/core/src/tools/fullsig";
import { allRelays, compareRelays, relayInfo, RelayTracer } from "@nxsys/core/src/tools/relayinfo";
import { redeemName } from "./names";
import type { Relay } from "@nxsys/core/src/relay/relay";
import { SHOW_STOPS_ALWAYS, SHOW_STOPS_NEVER, SHOW_STOPS_RED } from "@nxsys/core/src/layout/signal";

/* ---------- generic floating window ---------- */
function Floating({ w, children, bare }: { w: ToolWin; children: ReactNode; bare?: boolean }) {
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const onDown = (e: React.PointerEvent) => {
    tools.focus(w.id);
    drag.current = { dx: e.clientX - w.x, dy: e.clientY - w.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (drag.current) tools.move(w.id, Math.max(0, e.clientX - drag.current.dx), Math.max(80, e.clientY - drag.current.dy));
  };
  const onUp = () => (drag.current = null);
  return (
    <div className={"fwin" + (bare ? " bare" : "")} style={{ left: w.x, top: w.y, zIndex: 40 + w.z }} data-testid={`win-${w.kind}`} onPointerDown={() => tools.focus(w.id)}>
      <div className="fwin-title" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={bare ? () => tools.close(w.id) : undefined}>
        <span className="fwin-name">{w.title}</span>
        <button className="fwin-x" aria-label="Close" onPointerDown={(e) => e.stopPropagation()} onClick={() => tools.close(w.id)}>
          ×
        </button>
      </div>
      <div className="fwin-body">{children}</div>
    </div>
  );
}

/* ---------- canvas helper ---------- */
function useCanvasPaint(w: number, h: number, bg: string, draw: (dc: CanvasDC) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(w * dpr)) c.width = Math.round(w * dpr);
    if (c.height !== Math.round(h * dpr)) c.height = Math.round(h * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    const dc = new CanvasDC(ctx);
    dc.deviceScale = dpr;
    try {
      draw(dc);
    } catch (e) {
      console.error(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

/* ---------- full signal ---------- */
function FullSignalWin({ w }: { w: ToolWin }) {
  const f = useTools().frame;
  const s = w.signal!;
  const { w: cw, h: ch } = fullSignalClientSize(s);
  const ref = useCanvasPaint(cw, ch, "#ececec", (dc) => paintFullSignal(s, dc), [f, s, cw, ch]);
  return <canvas ref={ref} width={cw} height={ch} style={{ width: cw, height: ch, display: "block" }} data-testid="fullsig-canvas" />;
}

/* ---------- drafter ---------- */
function DrafterWin({ w }: { w: ToolWin }) {
  const f = useTools().frame;
  const d = tools.drafter;
  const ref = useCanvasPaint(DRAFT_PAGE_WIDTH, DRAFT_PAGE_HEIGHT, "#fff", (dc) => d.paint(dc), [f, d.revision]);
  const box = useRef<HTMLDivElement>(null);
  const lastRev = useRef(-1);
  useEffect(() => {
    if (d.revision !== lastRev.current && box.current && d.Drawings.length) {
      box.current.scrollTop = Math.max(0, d.scrollTargetY());
    }
    lastRev.current = d.revision;
  });
  const pos = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  return (
    <>
      <div className="fwin-bar">
        <button className="tb" onClick={() => tools.askDraw()}>New relay…</button>
        <button className="tb" onClick={() => tools.clearDrafter()}>Clear</button>
        <span className="muted">Click a contact to draw its relay.</span>
      </div>
      <div className="drafter-scroll" ref={box}>
        <canvas
          ref={ref}
          width={DRAFT_PAGE_WIDTH}
          height={DRAFT_PAGE_HEIGHT}
          style={{ width: DRAFT_PAGE_WIDTH, height: DRAFT_PAGE_HEIGHT, display: "block" }}
          data-testid="drafter-canvas"
          onClick={(e) => {
            const p = pos(e);
            const n = d.relayNameFromXY(p.x, p.y);
            if (n) tools.drawRelayByName(n);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            const p = pos(e);
            const n = d.relayNameFromXY(p.x, p.y);
            tools.popup({
              x: e.clientX,
              y: e.clientY,
              title: "Drafter",
              items: [
                { id: "close", label: "Close", enabled: true },
                { id: "clear", label: "Clear", enabled: true },
                { id: "new", label: "New Relay", enabled: true },
                ...(n ? [{ id: "state", label: `Query ${n}`, enabled: true }] : []),
              ],
              run: (id) => {
                if (id === "close") tools.close(w.id);
                else if (id === "clear") tools.clearDrafter();
                else if (id === "new") tools.askDraw();
                else if (id === "state" && n) tools.askRelayByName(n);
              },
            });
          }}
        />
      </div>
    </>
  );
}

/* ---------- relay state ---------- */
function RelayStateWin({ w }: { w: ToolWin }) {
  useTools();
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, []);
  const r = w.relay!;
  const info = relayInfo(r);
  return (
    <div className="rs">
      <div className="rs-name" data-testid="rs-name">Relay {info.name}</div>
      <div data-testid="rs-state">State is {info.picked ? "PICKED" : "DROPPED"}</div>
      <div className="muted">{info.dependents.length} dependent{info.dependents.length === 1 ? "" : "s"}:</div>
      <div className="rs-list" data-testid="rs-deps">
        {info.dependents.map((d) => (
          <div key={d.name} className="rs-row" onDoubleClick={() => tools.showRelayState(d.relay)} title="Double-click to show this relay">
            <span>{d.name}</span>
            <span className={d.picked ? "pk" : "dr"}>{d.picked ? 1 : 0}</span>
          </div>
        ))}
      </div>
      <div className="rs-btns">
        <button className="tb" disabled={!info.canDraw} onClick={() => tools.drawRelay(r)}>Draw</button>
        <button className="tb" onClick={() => tools.close(w.id)}>OK</button>
      </div>
    </div>
  );
}

/* ---------- selector (relays of an object) ---------- */
function SelectorWin({ w }: { w: ToolWin }) {
  const [sel, setSel] = useState<Relay | null>(null);
  const go = (r: Relay) => {
    tools.close(w.id);
    if (w.op === "Draw") tools.drawRelay(r);
    else tools.showRelayState(r);
  };
  return (
    <div className="rs">
      <div className="muted">{w.text}</div>
      <div className="rs-list" data-testid="selector-list">
        {w.relays!.map((r) => (
          <div key={r.name} className={"rs-row sel" + (sel === r ? " on" : "")} onClick={() => setSel(r)} onDoubleClick={() => go(r)}>
            {redeemName(r)}
          </div>
        ))}
      </div>
      <div className="rs-btns">
        <button className="tb" disabled={!sel} onClick={() => sel && go(sel)}>{w.op}</button>
        <button className="tb" onClick={() => tools.close(w.id)}>Cancel</button>
      </div>
    </div>
  );
}

/* ---------- relay list (virtualised) ---------- */
const ROW = 22;
function RelayListWin() {
  useTools();
  const [filter, setFilter] = useState("");
  const [top, setTop] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 300);
    return () => clearInterval(id);
  }, []);
  const all = allRelays();
  const q = filter.trim().toUpperCase();
  const rows = q ? all.filter((r) => r.name.includes(q)) : all;
  const first = Math.floor(top / ROW);
  const vis = rows.slice(first, first + 24);
  return (
    <div className="rl">
      <input className="rl-filter" placeholder="Filter (e.g. 244 or PBS)" value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="rl-filter" />
      <div className="muted">{rows.length} of {all.length} relays</div>
      <div className="rl-scroll" onScroll={(e) => setTop((e.target as HTMLElement).scrollTop)} data-testid="rl-scroll">
        <div style={{ height: rows.length * ROW, position: "relative" }}>
          {vis.map((r, i) => (
            <div key={r.name} className="rl-row" style={{ top: (first + i) * ROW }} onClick={() => tools.showRelayState(r)} onDoubleClick={() => tools.drawRelay(r)} title="Click: state. Double-click: draw">
              <span>{r.name}</span>
              <span className={r.state ? "pk" : "dr"}>{r.state ? "PICKED" : "DROPPED"}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------- tracer ---------- */
function TracerWin() {
  useTools();
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const frozen = useRef<number>(0);
  const [, tick] = useState(0);
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(id);
  }, []);
  const t = tools.tracer;
  if (!paused) frozen.current = t.entries.length ? t.entries[t.entries.length - 1].seq : -1;
  const q = filter.trim().toUpperCase();
  const shown = t.entries.filter((e) => e.seq <= frozen.current && (!q || e.name.includes(q) || (q === "PICK" && e.picked) || (q === "DROP" && !e.picked)));
  const lines = shown.slice(-400);
  useEffect(() => {
    if (!paused && box.current) box.current.scrollTop = box.current.scrollHeight;
  });
  return (
    <div className="tr">
      <div className="fwin-bar">
        <input placeholder="Filter (name, PICK, DROP)" value={filter} onChange={(e) => setFilter(e.target.value)} data-testid="trace-filter" />
        <button className="tb" aria-pressed={paused} onClick={() => setPaused(!paused)}>{paused ? "Resume" : "Pause"}</button>
        <button className="tb" onClick={() => { t.clear(); tick((n) => n + 1); }}>Clear</button>
      </div>
      <pre className="tr-log" ref={box} data-testid="trace-log">
        {lines.map((e) => `${(e.t / 1000).toFixed(1).padStart(7)}  ${RelayTracer.format(e)}`).join("\n")}
      </pre>
    </div>
  );
}

function StatusWin({ w }: { w: ToolWin }) {
  return <pre className="status-text" data-testid="status-text">{w.text}</pre>;
}

/* ---------- popup, prompt, messages, prefs ---------- */
function Popup() {
  const p = useTools().popup;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!p) return;
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) tools.popup(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && tools.popup(null);
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", esc);
    };
  }, [p]);
  if (!p) return null;
  return (
    <div ref={ref} className="ctxmenu" role="menu" style={{ left: Math.min(p.x, window.innerWidth - 230), top: Math.min(p.y, window.innerHeight - 30 * p.items.length - 10) }} data-testid="ctxmenu">
      {p.items.map((it) => (
        <button key={it.id} className="mi" role="menuitem" disabled={!it.enabled} data-cmd={it.id} onClick={() => { tools.popup(null); p.run(it.id); engine.bump(); }}>
          {it.label}
        </button>
      ))}
    </div>
  );
}

function Prompt() {
  const p = useTools().prompt;
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setText(""); setErr(null); }, [p]);
  if (!p) return null;
  const submit = () => setErr(p.onSubmit(text));
  return (
    <div className="modal" style={{ position: "fixed", zIndex: 200 }}>
      <form className="modal-box small" onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="relay-prompt">
        <strong>{p.title}</strong>
        <label className="muted">{p.label}</label>
        <input autoFocus list="recent-relays" value={text} onChange={(e) => setText(e.target.value)} data-testid="relay-input" />
        <datalist id="recent-relays">{tools.recentRelays.map((r) => <option key={r} value={r} />)}</datalist>
        {err && <div className="warn">{err}</div>}
        <div className="rs-btns">
          <button className="tb" type="submit">OK</button>
          <button className="tb" type="button" onClick={() => tools.closePrompt()}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function Messages() {
  const m = useTools().messages;
  if (!m.length) return null;
  const cur = m[0];
  return (
    <div className="modal" style={{ position: "fixed", zIndex: 210 }}>
      <div className="modal-box small" role="alertdialog" data-testid="msgbox">
        <strong>{cur.title}</strong>
        <p style={{ whiteSpace: "pre-wrap" }}>{cur.text}</p>
        {m.length > 1 && <div className="muted">{m.length - 1} more message{m.length > 2 ? "s" : ""} waiting</div>}
        <div className="rs-btns">
          <button className="tb" autoFocus onClick={() => tools.dismissMessage(cur.id)}>OK</button>
        </div>
      </div>
    </div>
  );
}

function PrefsDialog() {
  const s = useTools();
  const [p, setP] = useState(s.prefs);
  useEffect(() => setP(s.prefs), [s.prefsOpen, s.prefs]);
  if (!s.prefsOpen) return null;
  const radio = (name: string, checked: boolean, on: () => void, label: string) => (
    <label className="row"><input type="radio" name={name} checked={checked} onChange={on} /> {label}</label>
  );
  return (
    <div className="modal" style={{ position: "fixed", zIndex: 200 }}>
      <div className="modal-box small" data-testid="prefs">
        <strong>Preferences</strong>
        <fieldset><legend>Full signal displays are</legend>
          {radio("fs", !p.fullSigsAreViews, () => setP({ ...p, fullSigsAreViews: false }), "Floating windows")}
          {radio("fs", p.fullSigsAreViews, () => setP({ ...p, fullSigsAreViews: true }), "Views (frameless, over the panel)")}
        </fieldset>
        <fieldset><legend>Right-click on a signal</legend>
          {radio("rc", !p.signalRightIsMenu, () => setP({ ...p, signalRightIsMenu: false }), "Shows the full signal display")}
          {radio("rc", p.signalRightIsMenu, () => setP({ ...p, signalRightIsMenu: true }), "Shows the context menu")}
        </fieldset>
        <fieldset><legend>Show stops</legend>
          {radio("st", p.stopPolicy === SHOW_STOPS_RED, () => setP({ ...p, stopPolicy: SHOW_STOPS_RED }), "When tripping (red)")}
          {radio("st", p.stopPolicy === SHOW_STOPS_ALWAYS, () => setP({ ...p, stopPolicy: SHOW_STOPS_ALWAYS }), "Always")}
          {radio("st", p.stopPolicy === SHOW_STOPS_NEVER, () => setP({ ...p, stopPolicy: SHOW_STOPS_NEVER }), "Never")}
        </fieldset>
        <div className="rs-btns">
          <button className="tb" onClick={() => tools.setPrefs(p)} data-testid="prefs-ok">OK</button>
          <button className="tb" onClick={() => tools.openPrefs(false)}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

export function ToolLayer() {
  const s = useTools();
  return (
    <>
      {s.wins.map((w) => (
        <Floating key={w.id} w={w} bare={w.kind === "fullsig" && s.prefs.fullSigsAreViews}>
          {w.kind === "fullsig" && <FullSignalWin w={w} />}
          {w.kind === "drafter" && <DrafterWin w={w} />}
          {w.kind === "relaystate" && <RelayStateWin w={w} />}
          {w.kind === "selector" && <SelectorWin w={w} />}
          {w.kind === "relaylist" && <RelayListWin />}
          {w.kind === "tracer" && <TracerWin />}
          {w.kind === "status" && <StatusWin w={w} />}
        </Floating>
      ))}
      <Popup />
      <Prompt />
      <Messages />
      <PrefsDialog />
    </>
  );
}
void compareRelays;
