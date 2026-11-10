/*
 * nxdraw display lists: parse (text -> ops) and replay (ops -> any DC). Used to look at the C++
 * golden recordings with a Canvas backend, and by the tests.
 */
import {
  createFontIndirect,
  createPen,
  createSolidBrush,
  getStockObject,
  type Brush,
  type DC,
  type Point,
  type StockName,
} from "./dc.js";

export type NxdrawOp =
  | { op: "HEADER"; version: number; basename: string; ms: number }
  | { op: "VIEW"; left: number; top: number; right: number; bottom: number; scale: number }
  | { op: "OBJ"; typeId: number; nomenclature: number }
  | { op: "SELECT_PEN"; style: number; width: number; color: number }
  | { op: "SELECT_BRUSH"; color: number }
  | { op: "SELECT_FONT"; height: number; weight: number; width: number; italic: boolean; face: string }
  | { op: "SELECT_STOCK"; name: StockName }
  | { op: "MOVETO"; x: number; y: number }
  | { op: "LINETO"; x: number; y: number }
  | { op: "POLYGON"; points: Point[] }
  | { op: "ELLIPSE"; left: number; top: number; right: number; bottom: number }
  | { op: "RECTANGLE"; left: number; top: number; right: number; bottom: number }
  | { op: "FILLRECT"; left: number; top: number; right: number; bottom: number; brush: number | StockName }
  | { op: "DRAWTEXT"; left: number; top: number; right: number; bottom: number; flags: number; text: string }
  | { op: "TEXTCOLOR"; color: number }
  | { op: "BKCOLOR"; color: number }
  | { op: "BKMODE"; mode: number }
  | { op: "END" };

const STOCKS = new Set(["BLACK_BRUSH", "WHITE_BRUSH", "LTGRAY_BRUSH", "BLACK_PEN", "NULL_PEN"]);

/** Parse a double-quoted nxdraw string starting at s[i] === '"'; returns [value, indexAfterQuote]. */
function unquote(s: string, i: number): [string, number] {
  if (s[i] !== '"') throw new Error(`nxdraw: expected string at "${s.slice(i)}"`);
  let out = "";
  i++;
  for (; i < s.length; i++) {
    const c = s[i];
    if (c === '"') return [out, i + 1];
    if (c === "\\") {
      const n = s[++i];
      if (n === "u") {
        out += String.fromCharCode(parseInt(s.slice(i + 1, i + 5), 16));
        i += 4;
      } else out += n;
    } else out += c;
  }
  throw new Error("nxdraw: unterminated string");
}

const int = (t: string): number => {
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`nxdraw: bad number "${t}"`);
  return n;
};
const color = (t: string): number => parseInt(t, 16);

export function parseNxdraw(text: string): NxdrawOp[] {
  const ops: NxdrawOp[] = [];
  const lines = text.split("\n");
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    if (line === "") continue;
    try {
      if (line.startsWith("# nxdraw ")) {
        const m = /^# nxdraw (\d+) (.*) @(-?\d+)$/.exec(line);
        if (!m) throw new Error("bad header");
        ops.push({ op: "HEADER", version: int(m[1]), basename: m[2], ms: int(m[3]) });
        continue;
      }
      if (line[0] === "#") continue;
      const sp = line.indexOf(" ");
      const cmd = sp < 0 ? line : line.slice(0, sp);
      const rest = sp < 0 ? "" : line.slice(sp + 1);
      const t = rest === "" ? [] : rest.split(" ");
      switch (cmd) {
        case "VIEW":
          ops.push({ op: "VIEW", left: int(t[0]), top: int(t[1]), right: int(t[2]), bottom: int(t[3]), scale: int(t[4]) });
          break;
        case "OBJ":
          ops.push({ op: "OBJ", typeId: int(t[0]), nomenclature: int(t[1]) });
          break;
        case "SELECT":
          if (t[0] === "PEN") ops.push({ op: "SELECT_PEN", style: int(t[1]), width: int(t[2]), color: color(t[3]) });
          else if (t[0] === "BRUSH") ops.push({ op: "SELECT_BRUSH", color: color(t[1]) });
          else if (t[0] === "STOCK") {
            if (!STOCKS.has(t[1])) throw new Error("bad stock object");
            ops.push({ op: "SELECT_STOCK", name: t[1] as StockName });
          } else if (t[0] === "FONT") {
            const [face] = unquote(rest, rest.indexOf('"'));
            ops.push({ op: "SELECT_FONT", height: int(t[1]), weight: int(t[2]), width: int(t[3]), italic: t[4] === "1", face });
          } else throw new Error("bad SELECT");
          break;
        case "MOVETO":
          ops.push({ op: "MOVETO", x: int(t[0]), y: int(t[1]) });
          break;
        case "LINETO":
          ops.push({ op: "LINETO", x: int(t[0]), y: int(t[1]) });
          break;
        case "POLYGON": {
          const n = int(t[0]);
          const points: Point[] = [];
          for (let k = 0; k < n; k++) points.push({ x: int(t[1 + 2 * k]), y: int(t[2 + 2 * k]) });
          ops.push({ op: "POLYGON", points });
          break;
        }
        case "ELLIPSE":
        case "RECTANGLE":
          ops.push({ op: cmd, left: int(t[0]), top: int(t[1]), right: int(t[2]), bottom: int(t[3]) });
          break;
        case "FILLRECT":
          ops.push({
            op: "FILLRECT",
            left: int(t[0]),
            top: int(t[1]),
            right: int(t[2]),
            bottom: int(t[3]),
            brush: t[4] === "STOCK" ? (t[5] as StockName) : color(t[5]),
          });
          break;
        case "DRAWTEXT": {
          const [str] = unquote(rest, rest.indexOf('"'));
          ops.push({ op: "DRAWTEXT", left: int(t[0]), top: int(t[1]), right: int(t[2]), bottom: int(t[3]), flags: int(t[4]), text: str });
          break;
        }
        case "TEXTCOLOR":
          ops.push({ op: "TEXTCOLOR", color: color(t[0]) });
          break;
        case "BKCOLOR":
          ops.push({ op: "BKCOLOR", color: color(t[0]) });
          break;
        case "BKMODE":
          ops.push({ op: "BKMODE", mode: int(t[0]) });
          break;
        case "END":
          ops.push({ op: "END" });
          break;
        default:
          throw new Error("unknown record");
      }
    } catch (e) {
      throw new Error(`nxdraw line ${ln + 1}: ${(e as Error).message}: ${line}`);
    }
  }
  return ops;
}

/** The VIEW record of a parsed list, if any. */
export function nxdrawView(ops: readonly NxdrawOp[]): Extract<NxdrawOp, { op: "VIEW" }> | null {
  for (const o of ops) if (o.op === "VIEW") return o;
  return null;
}

/**
 * Replay a display list into a DC. HEADER, VIEW and END are not DC calls and are skipped
 * (the caller sets up the canvas from nxdrawView()). Pens/brushes/fonts are rebuilt from content.
 */
export function replayNxdraw(ops: readonly NxdrawOp[], dc: DC): void {
  for (const o of ops) {
    switch (o.op) {
      case "OBJ":
        dc.beginObject?.(o.typeId, o.nomenclature);
        break;
      case "SELECT_PEN":
        dc.selectObject(createPen(o.style, o.width, o.color));
        break;
      case "SELECT_BRUSH":
        dc.selectObject(createSolidBrush(o.color));
        break;
      case "SELECT_FONT":
        dc.selectObject(createFontIndirect({ height: o.height, weight: o.weight, width: o.width, italic: o.italic, face: o.face }));
        break;
      case "SELECT_STOCK":
        dc.selectObject(getStockObject(o.name));
        break;
      case "MOVETO":
        dc.moveTo(o.x, o.y);
        break;
      case "LINETO":
        dc.lineTo(o.x, o.y);
        break;
      case "POLYGON":
        dc.polygon(o.points);
        break;
      case "ELLIPSE":
        dc.ellipse(o.left, o.top, o.right, o.bottom);
        break;
      case "RECTANGLE":
        dc.rectangle(o.left, o.top, o.right, o.bottom);
        break;
      case "FILLRECT": {
        const b: Brush | ReturnType<typeof getStockObject> =
          typeof o.brush === "number" ? createSolidBrush(o.brush) : getStockObject(o.brush);
        dc.fillRect({ left: o.left, top: o.top, right: o.right, bottom: o.bottom }, b);
        break;
      }
      case "DRAWTEXT":
        dc.drawText(o.text, { left: o.left, top: o.top, right: o.right, bottom: o.bottom }, o.flags);
        break;
      case "TEXTCOLOR":
        dc.setTextColor(o.color);
        break;
      case "BKCOLOR":
        dc.setBkColor(o.color);
        break;
      case "BKMODE":
        dc.setBkMode(o.mode);
        break;
      default:
        break; // HEADER, VIEW, END
    }
  }
}
