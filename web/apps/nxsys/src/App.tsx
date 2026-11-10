import { useCallback, useEffect, useRef, useState } from "react";
import { engine } from "./engine";
import { useEngine } from "./useEngine";
import { Panel, MIN_ZOOM, MAX_ZOOM, hasPaintLayout } from "./Panel";
import { Dropdown, type MenuItem } from "./Dropdown";
import { HelpPanel } from "./HelpPanel";
import { ToolLayer } from "./relays/ToolLayer";
import { TrainsMenu, TrainLayer } from "./trains/TrainLayer";
import { tools, useTools } from "./relays/tools";
import { SHOW_STOPS_ALWAYS, SHOW_STOPS_NEVER, SHOW_STOPS_RED } from "@nxsys/core/src/layout/signal";

const fmtTime = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}.${Math.floor((ms % 1000) / 100)}`;
};

function StatusLine() {
  const s = useEngine();
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT(engine.now()), 200);
    return () => clearInterval(id);
  }, []);
  return (
    <footer className="status" data-testid="status">
      <span>{s.loading ? "Loading…" : s.loaded ? s.title : "No interlocking"}</span>
      <span>sim {fmtTime(t)}</span>
      <span>{s.relayCount} relays</span>
      <span>{s.running ? `running ${s.speed}×` : "paused"}</span>
      {s.demoRunning && <span>demo running</span>}
      {!hasPaintLayout && <span className="warn">no renderer</span>}
    </footer>
  );
}

function IdMenus() {
  const s = useEngine();
  void s.rev;
  const menus = engine.dynMenus();
  if (!s.loaded || menus.length === 0) return null;
  const sorted = [...menus].sort((a, b) => Number(b.Up) - Number(a.Up));
  const up = menus.filter((m) => m.Up).length;
  return (
    <Dropdown label={`ID menus${up ? ` (${up} up)` : ""}`}>
      {sorted.map((m) => (
        <div key={m.Nomenclature} className="dm">
          <div className="dm-title">
            {m.Title} <span className="muted">#{m.Nomenclature}</span> {m.Up ? <b className="up">up</b> : null}
          </div>
          <div className="dm-entries">
            {m.Entries.map((e) => (
              <button
                key={e.ControlId}
                className={"ent" + (e.Lamp ? " lit" : "")}
                disabled={!m.Up}
                onClick={() => {
                  e.pushTheButton();
                  engine.bump();
                }}
              >
                {e.String}
              </button>
            ))}
          </div>
        </div>
      ))}
    </Dropdown>
  );
}

export function App() {
  const s = useEngine();
  const ts = useTools();
  const [zoom, setZoom] = useState(1);
  const [fitTick, setFitTick] = useState(0);
  const [help, setHelp] = useState(false);
  const [dragging, setDragging] = useState(false);
  const folderRef = useRef<HTMLInputElement>(null);
  const xdoRef = useRef<HTMLInputElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    tools.init();
    (async () => {
      await engine.init();
      const lib = engine.getSnapshot().library;
      const want = new URLSearchParams(location.search).get("i");
      const pick = (want && lib.find((e) => e.path === want || e.title === want)) || lib[0];
      if (pick && want !== "none") await engine.loadLibraryEntry(pick);
    })();
    (window as unknown as { __nxsys: unknown }).__nxsys = engine;
  }, []);

  const zoomBy = useCallback((f: number) => setZoom((z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, +(z * f).toFixed(4)))), []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void engine.openDrop(e.dataTransfer);
  };

  const c = engine.commands;
  const off = !s.loaded;
  const interlockingMenu: MenuItem[] = [
    { label: "Clear all track", onClick: c.clearAllTrack, disabled: off },
    { label: "Cancel all signals", onClick: c.cancelAllSignals, disabled: off },
    { label: "Release all approach locking", onClick: c.releaseAllApproach, disabled: off },
    { label: "Clear all aux switch keys", onClick: c.clearAllAux, disabled: off },
    { label: "Normal all switches", onClick: c.normalAllSwitches, disabled: off },
    { label: "All of the above", onClick: c.allOfTheAbove, disabled: off },
    { separator: true, label: "" },
    { label: "Bobble all signal repeaters", onClick: c.bobble, disabled: off },
    { label: "Automatic operation", onClick: () => engine.toggleAuto(), disabled: off || !s.autoAvailable, checked: s.autoOn, title: s.autoAvailable ? undefined : "This interlocking has no automatic-control relay" },
    { separator: true, label: "" },
    { label: "Show stops: when red", checked: s.stopPolicy === SHOW_STOPS_RED, onClick: () => engine.setStopPolicy(SHOW_STOPS_RED), disabled: off },
    { label: "Show stops: always", checked: s.stopPolicy === SHOW_STOPS_ALWAYS, onClick: () => engine.setStopPolicy(SHOW_STOPS_ALWAYS), disabled: off },
    { label: "Show stops: never", checked: s.stopPolicy === SHOW_STOPS_NEVER, onClick: () => engine.setStopPolicy(SHOW_STOPS_NEVER), disabled: off },
    { separator: true, label: "" },
    { label: "Reload", onClick: () => void engine.reload(), disabled: off },
  ];
  const fileMenu: MenuItem[] = [
    { label: "File info…", onClick: () => tools.showStatus(), disabled: off },
    { label: "Preferences…", onClick: () => tools.openPrefs(true) },
  ];
  const relaysMenu: MenuItem[] = [
    { label: "Query relay…", onClick: () => tools.askQuery(), disabled: off },
    { label: "Draw relay circuit…", onClick: () => tools.askDraw(), disabled: off },
    { label: "Relay list…", onClick: () => tools.openRelayList(), disabled: off },
    { separator: true, label: "" },
    { label: "Trace to console", onClick: () => tools.toggleTraceConsole(), checked: ts.consoleTraceOn, disabled: off },
    { label: "Trace to window", onClick: () => tools.toggleTraceWindow(), checked: ts.traceOn, disabled: off },
  ];
  const viewMenu: MenuItem[] = [
    { label: "Relay Draftsperson", onClick: () => tools.toggleDrafter(), checked: ts.wins.some((w) => w.kind === "drafter"), disabled: off },
    { label: "Flush Full Signal Displays", onClick: () => tools.flushFullSignals(), disabled: off },
  ];
  const demoMenu: MenuItem[] = [
    ...s.demos.map((d) => ({ label: d.replace(/^Interlockings\//, ""), onClick: () => void engine.runLibraryDemo(d), disabled: s.loading })),
    ...(s.demos.length ? [{ separator: true, label: "" }] : []),
    { label: "Run script file (.xdo)…", onClick: () => xdoRef.current?.click(), disabled: s.loading },
    { label: "Stop demo", onClick: () => engine.stopDemo(), disabled: !s.demoRunning },
  ];

  return (
    <div
      className="app"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <header className="toolbar">
        <strong className="brand">NXSYS</strong>
        <select
          className="tb"
          aria-label="Interlocking"
          value={s.library.find((e) => e.path === s.path)?.path ?? ""}
          onChange={(e) => {
            const ent = s.library.find((x) => x.path === e.target.value);
            if (ent) void engine.loadLibraryEntry(ent);
          }}
        >
          <option value="" disabled>
            {s.path && !s.library.some((e) => e.path === s.path) ? s.title || "Local interlocking" : "Interlocking…"}
          </option>
          {s.library.map((e) => (
            <option key={e.path} value={e.path}>
              {e.title}
            </option>
          ))}
        </select>
        <button className="tb" onClick={() => folderRef.current?.click()} title="Open a folder of .trk files from your computer (or drop one on the window)">
          Open folder…
        </button>
        <span className="sep" />
        <button className="tb" aria-pressed={s.running} onClick={() => engine.setRunning(!s.running)} data-testid="runpause">
          {s.running ? "Pause" : "Run"}
        </button>
        <select className="tb" aria-label="Speed" value={s.speed} onChange={(e) => engine.setSpeed(Number(e.target.value))}>
          <option value={1}>1×</option>
          <option value={2}>2×</option>
          <option value={5}>5×</option>
        </select>
        <span className="sep" />
        <button className="tb sq" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.1)}>
          −
        </button>
        <span className="zoomv" data-testid="zoom">{Math.round(zoom * 100)}%</span>
        <button className="tb sq" aria-label="Zoom in" onClick={() => zoomBy(1.1)}>
          +
        </button>
        <button className="tb" onClick={() => setZoom(1)}>
          100%
        </button>
        <button className="tb" onClick={() => setFitTick((n) => n + 1)}>
          Fit
        </button>
        <span className="sep" />
        <Dropdown label="File" items={fileMenu} />
        <Dropdown label="Interlocking" items={interlockingMenu} />
        <Dropdown label="Relays" items={relaysMenu} />
        <Dropdown label="View" items={viewMenu} />
        <Dropdown label="Demo" items={demoMenu} />
        <TrainsMenu />
        <IdMenus />
        <button className="tb" onClick={() => setHelp(!help)} aria-pressed={help}>
          Help
        </button>
      </header>

      <main className="main">
        <Panel zoom={zoom} setZoom={setZoom} fitTick={fitTick} />
        {s.loading && <div className="overlay center">Loading…</div>}
        {!s.loaded && !s.loading && s.errors.length === 0 && (
          <div className="overlay center muted">Choose an interlocking, or drop a folder of .trk files here.</div>
        )}
        {s.errors.length > 0 && (
          <div className="errors" role="alert">
            <div className="errors-head">
              <strong>{s.loaded ? "Warnings" : "Could not load interlocking"}</strong>
              <button className="tb" onClick={() => engine.dismissErrors()}>
                Dismiss
              </button>
            </div>
            <pre>{s.errors.join("\n\n")}</pre>
          </div>
        )}
        {s.choices && (
          <div className="modal">
            <div className="modal-box">
              <p>Which interlocking file?</p>
              {s.choices.map((p) => (
                <button key={p} className="tb block" onClick={() => void engine.chooseMain(p)}>
                  {p}
                </button>
              ))}
              <button className="tb block" onClick={() => engine.dismissChoices()}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {s.caption && <div className="caption">{s.caption}</div>}
        {dragging && <div className="overlay center drop">Drop interlocking folder / files</div>}
        {help && <HelpPanel onClose={() => setHelp(false)} />}
      </main>
      <StatusLine />
      <ToolLayer />
      <TrainLayer />

      <input
        ref={folderRef}
        type="file"
        hidden
        // @ts-expect-error non-standard but universal
        webkitdirectory=""
        multiple
        onChange={(e) => {
          if (e.target.files?.length) void engine.openInput(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={xdoRef}
        type="file"
        hidden
        accept=".xdo"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void engine.runDemoFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
