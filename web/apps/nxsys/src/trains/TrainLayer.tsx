import { useEffect, useRef } from "react";
import type { Train } from "@nxsys/core/src/trains/train";
import { Dropdown } from "../Dropdown";
import { useEngine } from "../useEngine";
import { trainStore, useTrains } from "./store";
import "./trains.css";

/** The Trains menu (Mac: New / New (stopped) / Halt all / Kill all) plus entry-point shortcuts. */
export function TrainsMenu() {
  const s = useEngine();
  const ts = useTrains();
  const off = !s.loaded;
  useEffect(() => trainStore.init(), []);
  const entries = off ? [] : trainStore.entryPoints();
  const n = ts.trains.length;
  return (
    <Dropdown label={`Trains${n ? ` (${n})` : ""}`} disabled={off}>
      <button className="mi" role="menuitem" data-testid="train-new" onClick={() => trainStore.offer(false)}>
        <span className="chk" />New — click a track end
      </button>
      <button className="mi" role="menuitem" data-testid="train-new-stopped" onClick={() => trainStore.offer(true)}>
        <span className="chk" />New (stopped) — click a track end
      </button>
      <hr />
      <button className="mi" role="menuitem" disabled={!n} onClick={() => trainStore.haltAll()}>
        <span className="chk" />Halt all
      </button>
      <button className="mi" role="menuitem" disabled={!n} onClick={() => trainStore.killAll()} data-testid="train-kill-all">
        <span className="chk" />Kill all
      </button>
      <button className="mi" role="menuitem" disabled={!n} onClick={() => trainStore.minimizeAll()}>
        <span className="chk" />Minimize train windows
      </button>
      <button className="mi" role="menuitem" disabled={!n} onClick={() => trainStore.showAll()}>
        <span className="chk" />Show train windows
      </button>
      {entries.length > 0 && (
        <>
          <hr />
          <div className="tr-entries-title muted">New train at entry point (IJ #):</div>
          <div className="tr-entries">
            {entries.map((e) => (
              <button key={`${e.ij}-${e.tc}`} className="ent mi tr-ent" title={`track circuit ${e.tc}`} data-testid={`train-entry-${e.ij}`} onClick={() => trainStore.newAt(e.seg, false)}>
                {e.ij}
              </button>
            ))}
          </div>
        </>
      )}
    </Dropdown>
  );
}

function Field({ label, value, testid }: { label: string; value: string; testid?: string }) {
  return (
    <div className="tr-row">
      <span className="tr-lab">{label}</span>
      <span className="tr-val" data-testid={testid}>
        {value || " "}
      </span>
    </div>
  );
}

function TrainPanel({ t }: { t: Train }) {
  void t.version;
  const d = t.dlg;
  const pos = trainStore.position(t.id);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  if (d.window === "hidden") return null;
  const onDown = (e: React.PointerEvent) => {
    trainStore.focus(t.id);
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (drag.current) trainStore.move(t.id, Math.max(0, e.clientX - drag.current.dx), Math.max(40, e.clientY - drag.current.dy));
  };
  return (
    <div className={"tr-win" + (pos.minimized ? " min" : "")} style={{ left: pos.x, top: pos.y, zIndex: 60 + pos.z }} data-testid={`train-${t.id}`} onPointerDown={() => trainStore.focus(t.id)}>
      <div className="tr-title" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
        <span>Train #{t.id}</span>
        {pos.minimized && <span className="tr-mini" data-testid={`train-${t.id}-mini`}>{d.speed} {d.location}</span>}
        <button className="tr-x" aria-label={pos.minimized ? "Restore" : "Minimize"} onPointerDown={(e) => e.stopPropagation()} onClick={() => trainStore.setMinimized(t.id, !pos.minimized)}>
          {pos.minimized ? "▢" : "–"}
        </button>
      </div>
      {!pos.minimized && (
        <div className="tr-body">
          <Field label="Train" value={String(t.id)} />
          <Field label="Length" value={d.length + " ft"} />
          <Field label="Location" value={d.location} testid={`train-${t.id}-loc`} />
          <Field label="Speed" value={d.speed} testid={`train-${t.id}-speed`} />
          <input
            type="range"
            min={0}
            max={100}
            value={d.sliderOf100}
            aria-label="Speed control"
            data-testid={`train-${t.id}-slider`}
            onChange={(e) => trainStore.slider(t, Number(e.target.value))}
          />
          <Field label="Next signal" value={d.nextSigName} testid={`train-${t.id}-next`} />
          <Field label="Aspect" value={d.nextSigState} testid={`train-${t.id}-aspect`} />
          <Field label="Last signal" value={d.lastSigName} />
          <Field label="Aspect" value={d.lastSigState} />
          <div className="tr-row tr-radio">
            <label>
              <input type="radio" name={`obs${t.id}`} checked={d.observant} onChange={() => trainStore.observant(t)} data-testid={`train-${t.id}-observant`} /> Observant
            </label>
            <label>
              <input type="radio" name={`obs${t.id}`} checked={!d.observant} onChange={() => trainStore.freeWill(t)} data-testid={`train-${t.id}-freewill`} /> Free will
            </label>
          </div>
          <div className="tr-row tr-btns">
            <button className="tb" onClick={() => trainStore.halt(t)} data-testid={`train-${t.id}-halt`}>Halt</button>
            <button className="tb" onClick={() => trainStore.reverse(t)} data-testid={`train-${t.id}-reverse`}>Reverse</button>
            {d.callOnShown && (
              <button className="tb" onClick={() => trainStore.callOn(t)} data-testid={`train-${t.id}-callon`}>Call on</button>
            )}
            <button className="tb danger" onClick={() => trainStore.kill(t)} data-testid={`train-${t.id}-kill`}>Kill</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Floating, non-modal train control panels, plus the "click a track end" prompt. */
export function TrainLayer() {
  const ts = useTrains();
  useEffect(() => trainStore.init(), []);
  return (
    <>
      {ts.offering && (
        <div className="tr-offer" role="status" data-testid="train-offer">
          Click an end-of-track section to place the new train{ts.offering.halted ? " (stopped)" : ""}.
          <button className="tb" onClick={() => trainStore.cancelOffer()}>Cancel</button>
        </div>
      )}
      {ts.trains.map((t) => (
        <TrainPanel key={t.id} t={t} />
      ))}
    </>
  );
}
