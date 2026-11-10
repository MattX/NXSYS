import { useState } from "react";
import { engine } from "./engine";
import { useEngine } from "./useEngine";

interface Tab {
  key: string;
  group: string;
  title: string;
  text?: string;
  href?: string;
  external?: boolean;
}

export function HelpPanel({ onClose }: { onClose: () => void }) {
  const s = useEngine();
  const tabs: Tab[] = [];
  if (s.loaded) {
    engine.helpTexts().forEach((h, i) => tabs.push({ key: "t" + i, group: s.title, title: h.title, text: h.text }));
    engine.helpUrls().forEach((h, i) => {
      if (!h.url) return;
      const r = engine.resolveHelpUrl(h.url);
      tabs.push({ key: "u" + i, group: s.title, title: h.title, href: r.href, external: r.external });
    });
  }
  s.helpIndex.forEach((h, i) => {
    if (h.include) return; // platform-specific (Mac) entry
    tabs.push({ key: "h" + i, group: "NXSYS", title: h.title, href: h.url, external: h.external });
  });
  const [sel, setSel] = useState<string | null>(null);
  const cur = tabs.find((t) => t.key === sel) ?? tabs[0];
  return (
    <aside className="help" aria-label="Help">
      <div className="help-head">
        <strong>Help</strong>
        <button className="tb" onClick={onClose} aria-label="Close help">
          ✕
        </button>
      </div>
      <div className="help-body">
        <nav className="help-nav">
          {tabs.map((t, i) => (
            <div key={t.key}>
              {(i === 0 || tabs[i - 1].group !== t.group) && <div className="help-group">{t.group}</div>}
              <button className={"help-tab" + (cur?.key === t.key ? " on" : "")} onClick={() => setSel(t.key)}>
                {t.title}
              </button>
            </div>
          ))}
        </nav>
        <div className="help-content">
          {!cur && <p className="muted">No help available.</p>}
          {cur?.text !== undefined && <pre className="help-text">{cur.text}</pre>}
          {cur?.href && cur.external && (
            <p>
              <a href={cur.href} target="_blank" rel="noreferrer">
                Open {cur.href}
              </a>
            </p>
          )}
          {cur?.href && !cur.external && <iframe title={cur.title} src={cur.href} className="help-frame" />}
        </div>
      </div>
    </aside>
  );
}
