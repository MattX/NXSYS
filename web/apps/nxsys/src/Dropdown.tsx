import { useEffect, useRef, useState, type ReactNode } from "react";

export interface MenuItem {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
  title?: string;
}

export function Dropdown({ label, items, disabled, children }: { label: string; items?: MenuItem[]; disabled?: boolean; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div className="dd" ref={ref}>
      <button className="tb" disabled={disabled} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {label} <span className="caret">▾</span>
      </button>
      {open && (
        <div className="dd-menu" role="menu" onClick={(e) => {
          if ((e.target as HTMLElement).closest("button.mi")) setOpen(false);
        }}>
          {items?.map((it, i) =>
            it.separator ? (
              <hr key={i} />
            ) : (
              <button key={i} className="mi" role="menuitem" disabled={it.disabled} title={it.title} onClick={it.onClick}>
                <span className="chk">{it.checked ? "✓" : ""}</span>
                {it.label}
              </button>
            ),
          )}
          {children}
        </div>
      )}
    </div>
  );
}
