/*
 * Relay Draftsperson: port of NXSYS/ldgut.cpp (Mac configuration: CellW 80, CellH 32, 10 x 50 cell
 * page — the Mac app never calls DrawingSetPageSize) plus the placement glue of
 * NXSYSMac/MacRelayGraphics.cpp. Draws relay circuit diagrams (coils, front/back contacts, AND/OR
 * trees, shared LABEL sub-expressions, timers) through the DC contract; contact states are read live
 * from the relays at paint time, so repainting after relay transitions shows picked/dropped contacts.
 *
 * Checked call-for-call against the C++ recordings in tools/trace-harness/golden/tools/.
 * The compiled-code (.tko) disassembly path is dropped.
 */
import {
  DT_CALCRECT,
  DT_CENTER,
  DT_LEFT,
  DT_NOCLIP,
  DT_SINGLELINE,
  DT_TOP,
  TRANSPARENT,
  getStockObject,
  type DC,
  type Point,
  type Rect,
} from "../render/dc.js";
import { internRlysymNoCreate } from "../lisp/types.js";
import { host } from "../host.js";
import { zAppendRlysym, type LNode, type Relay } from "../relay/relay.js";

const SSNAME = "NXSYS Relay Draftsperson";

const CT_NULL = 0,
  CT_FRONT = 1,
  CT_BACK = 2,
  CT_COIL = 3,
  CT_AND = 6,
  CT_OR = 7,
  CT_CONST = 8,
  CT_COILTIMER = 9;
type CellType = number;
void CT_NULL;

/** ldraw.h */
export const LDRAW_NO_STATEREPORT = 1;

/* Mac values (ldgut.cpp #ifdef NXSYSMac) */
export const CELL_H = 32;
export const CELL_W = 80;
const N_CELL_H = 50;
const N_CELL_W = 10;
const DN_CELL_H = 2 * N_CELL_H;

/** The size the drafter page occupies, in pixels, as drawn (CellW/2 left margin; one cell of slack). */
export const DRAFT_PAGE_WIDTH = CELL_W * (N_CELL_W + 1);
export const DRAFT_PAGE_HEIGHT = CELL_H * (N_CELL_H + 2);

const mIn = Math.min;
const mAx = Math.max;
const itrunc = Math.trunc;

interface HasState {
  readonly state: boolean;
}

class Drawing {
  x = 0;
  y = 0;
  xcord = 0;
  ycord = 0;
  root!: GNode;
  miny = 0;
  maxy = 0;
  maxx = 0;
  yorg = 0;
  constructor(
    readonly relay: Relay,
    private readonly owner: RelayDrafter,
  ) {}
  /** Drawing::Mark */
  mark(xg: number, yg: number): void {
    if (yg + this.yorg < 0) throw new Error("Relay Graphics map index out of bounds.");
    this.maxy = mAx(yg, this.maxy);
    this.miny = mIn(yg, this.miny);
    this.maxx = mAx(xg, this.maxx);
    const idx = xg + (yg + this.yorg) * N_CELL_W;
    /* Simply don't mark it if out of bounds */
    if (idx >= 0 && idx < N_CELL_W * DN_CELL_H) this.owner.Darray[idx] = 1;
  }
  placeOnPage(): void {
    this.x = itrunc(CELL_W / 2) + this.xcord * CELL_W;
    this.y = this.ycord * CELL_H;
  }
}

class GNode {
  Parent: GNode | null = null;
  Child: GNode | null = null;
  LastChild: GNode | null = null;
  Next: GNode | null = null;
  Prev: GNode | null = null;
  gridx = 0;
  gridy = 0;
  width = 0;
  height = 0;
  cnx = 0;
  cny = 0;
  cnwl = 0;
  xoff = 0;
  type: CellType = 0;
  stick = 0;
  shift = 0;
  /** C++ Statep: points at an LNode's State */
  Statep: HasState | null = null;
  text = "???";

  private get st(): boolean {
    return this.Statep ? this.Statep.state : false;
  }

  /** GNode::Lastp */
  lastp(): boolean {
    if (this.Parent === null) return true;
    if (!this.Parent.lastp()) return false;
    if (this.Parent.type === CT_OR) return true;
    return this.Next === null;
  }

  thread(parent: GNode): void {
    this.Parent = parent;
    if (parent.Child === null) parent.Child = this;
    this.Prev = parent.LastChild;
    if (parent.LastChild !== null) parent.LastChild.Next = this;
    parent.LastChild = this;
  }

  flatten(): void {
    let next: GNode | null = null;
    for (let sn = this.Child; sn !== null; sn = next) {
      next = sn.Next;
      if (sn.type === this.type) {
        for (let ssn = sn.Child; ssn !== null; ssn = ssn.Next) ssn.Parent = this;
        const snChild = sn.Child!;
        snChild.Prev = sn.Prev;
        sn.LastChild!.Next = sn.Next;
        if (sn === this.LastChild) this.LastChild = sn.LastChild;
        if (sn === this.Child) this.Child = sn.Child;
        if (sn.Prev !== null) sn.Prev.Next = sn.Child;
        if (sn.Next !== null) sn.Next.Prev = sn.LastChild;
        sn.Child = null; /* don't subdelete */
      }
    }
    /* Assume it's going to fit once squozen. */
    this.width = mIn(this.width, N_CELL_W);
  }

  layout(xc: number, yc: number, D: Drawing): void {
    this.gridx = xc;
    this.gridy = yc;
    this.cnx = this.cny = 0;
    switch (this.type) {
      case CT_AND: {
        for (let sg = this.Child; sg !== null; sg = sg.Next) {
          if (xc + sg.width > N_CELL_W) {
            let wdl = 0;
            let wdh = 0;
            for (let gg: GNode | null = sg; gg !== null; gg = gg.Next) {
              wdl += gg.width;
              wdh = mAx(wdh, gg.height);
            }
            let nxc = N_CELL_W - wdl;
            nxc = mAx(nxc, 0);
            const nwl = D.maxy + 1;
            const nyc = nwl + wdh; /* hahah */
            sg.shift = 1;
            sg.layout(nxc, nyc, D);
            for (let j = nxc; j < xc; j++) D.mark(j, nwl);
            sg.cnx = xc;
            sg.cny = yc;
            sg.cnwl = nwl;
            xc = nxc;
            yc = nyc;
            for (let j = nwl; j <= nyc; j++) D.mark(xc, j);
          } else sg.layout(xc, yc, D);
          xc += sg.width;
        }
        break;
      }
      case CT_OR: {
        for (let sg = this.Child; sg !== null; sg = sg.Next) {
          sg.layout(xc, yc, D);
          yc -= sg.height;
        }
        for (let i = 0; i < this.width; i++) for (let j = 0; j < this.height; j++) D.mark(xc + i, yc + j);
        break;
      }
      case CT_COIL:
      case CT_COILTIMER:
        D.mark(xc, yc);
        this.height = 1;
        if (!(this.owner.ldrawFlags & LDRAW_NO_STATEREPORT)) {
          D.mark(xc, yc - 1);
          this.height++;
        }
        break;
      default: {
        let nostick = !this.stick;
        if (this.stick) {
          if (D.maxy > 0 || this.shift) nostick = true;
          else if (this.Parent!.type === CT_OR && this.gridy !== 0) nostick = true;
          else if (this.Parent!.type === CT_AND && this.Parent!.Parent !== null) nostick = true;
          else {
            for (let j = 0; j <= this.Parent!.gridx + this.Parent!.width - 1; j++) D.mark(j, +1);
            this.height = 0;
          }
        }
        if (nostick) {
          this.stick = 0;
          if (this.type === CT_CONST && !this.st) break;
          D.mark(xc, yc);
          if (this.lastp()) {
            /* last in its chain: nothing more to mark */
          } else if (this.Parent!.type === CT_OR && this.Parent!.width > 1) {
            const lx = this.Parent!.gridx + this.Parent!.width;
            for (let i = this.Parent!.gridx; i < lx; i++) D.mark(i, this.gridy);
          }
        }
        break;
      }
    }
  }

  constructor(private readonly owner: RelayDrafter) {}

  /* ---------------- drawing ---------------- */

  private cTriangle(dc: DC, x: number, y: number): void {
    const trx = x;
    const trb = itrunc(0.1 * CELL_W);
    const trh = itrunc(0.866 * trb);
    const p0x = trx - itrunc(trb / 2);
    const p1x = trx;
    const p2x = p0x + trb;
    let y0 = y;
    dc.selectObject(getStockObject("BLACK_PEN"));
    if (this.type === CT_FRONT) {
      dc.selectObject(getStockObject(this.st ? "BLACK_BRUSH" : "WHITE_BRUSH"));
      y0 -= itrunc(CELL_W * 0.025);
      dc.polygon([
        { x: p0x, y: y0 - trh },
        { x: p1x, y: y0 },
        { x: p2x, y: y0 - trh },
      ]);
    } else if (this.type === CT_BACK) {
      dc.selectObject(getStockObject(this.st ? "WHITE_BRUSH" : "BLACK_BRUSH"));
      y0 += itrunc(CELL_W * 0.025);
      dc.polygon([
        { x: p0x, y: y0 + trh },
        { x: p1x, y: y0 },
        { x: p2x, y: y0 + trh },
      ]);
    }
  }

  private cDot(dc: DC, x: number, y: number): void {
    dc.selectObject(getStockObject("BLACK_BRUSH"));
    const rad = itrunc(CELL_W * 0.04);
    dc.ellipse(x - rad, y - rad, x + rad, y + rad);
  }

  private drawCoil(dc: DC, scx: number, scy: number, timerP: boolean): void {
    const txr: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
    const statereport = !(this.owner.ldrawFlags & LDRAW_NO_STATEREPORT);
    if (statereport) {
      const s = this.st ? "PICKED" : "DROPPED";
      txr.left = txr.right = txr.top = txr.bottom = 0;
      dc.drawText("DROPPED", txr, DT_TOP | DT_LEFT | DT_SINGLELINE | DT_NOCLIP | DT_CALCRECT);
      txr.left = scx;
      txr.right = scx + CELL_W;
      txr.top = itrunc(scy - CELL_H * 0.95);
      txr.bottom += txr.top;
      dc.fillRect(txr, getStockObject("WHITE_BRUSH"));
      dc.drawText(s, txr, DT_TOP | DT_CENTER | DT_SINGLELINE | DT_NOCLIP);
    }
    txr.left = txr.right = txr.top = txr.bottom = 0;
    dc.drawText(this.text, txr, DT_TOP | DT_LEFT | DT_SINGLELINE | DT_NOCLIP | DT_CALCRECT);
    txr.left = scx;
    txr.right = scx + CELL_W;
    if (statereport) {
      txr.bottom = itrunc(txr.bottom * 1.2);
      txr.top = itrunc(scy - CELL_H * 0.95 - txr.bottom);
      txr.bottom += txr.top;
    } else {
      txr.top = itrunc(scy - CELL_H * 0.95);
      txr.bottom += txr.top;
    }
    dc.drawText(this.text, txr, DT_TOP | DT_CENTER | DT_SINGLELINE | DT_NOCLIP);

    const box: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
    box.top = scy - itrunc(CELL_H / 2);
    box.bottom = scy;
    box.left = itrunc(scx + 0.35 * CELL_W);
    box.right = itrunc(scx + 0.65 * CELL_W);

    dc.moveTo(box.left, box.bottom);
    dc.lineTo(box.left, box.top);
    dc.lineTo(box.right, box.top);
    dc.lineTo(box.right, box.bottom);
    dc.selectObject(getStockObject("BLACK_BRUSH"));
    if (timerP) {
      box.bottom = scy - itrunc(CELL_H / 4);
      dc.fillRect(box, getStockObject("BLACK_BRUSH"));
    }

    /* Draw "CX" arrow */
    const pts: Point[] = [
      { x: scx + itrunc(CELL_W / 8), y: scy - itrunc(CELL_H / 10) },
      { x: scx, y: scy },
      { x: scx + itrunc(CELL_W / 8), y: scy + itrunc(CELL_H / 10) },
    ];
    dc.polygon(pts);
  }

  private drawStickContact(dc: DC, scx: number, _scy: number, D: Drawing): void {
    const rscx = 0 * CELL_W + D.x;
    const rscy = itrunc(0.5 * CELL_H + D.y);
    dc.moveTo(rscx, rscy);
    dc.lineTo(scx, rscy);
    dc.lineTo(scx, D.y);
    dc.moveTo(rscx, rscy);
    dc.lineTo(rscx, 1 * CELL_H + D.y);
    if (this.Parent !== null && this.Parent.type === CT_OR) this.cDot(dc, scx, D.y);
    if (this.lastp()) this.bxHookCell(dc, rscx, 1 * CELL_H + D.y);
    else {
      let fgp = this.gridx + 1;
      if (this.Parent !== null && this.Parent.type === CT_OR) {
        fgp = this.Parent.gridx + this.Parent.width;
        this.cDot(dc, fgp * CELL_W + D.x, D.y);
      }
      const x3 = fgp * CELL_W + D.x;
      dc.lineTo(x3, 1 * CELL_H + D.y);
      dc.lineTo(x3, 0 + D.y);
    }
    this.cDot(dc, itrunc(rscx + 0.35 * CELL_W), rscy);
    this.cTriangle(dc, itrunc(rscx + 0.65 * CELL_W), rscy);
  }

  private bxHookCell(dc: DC, scx: number, scy: number): void {
    const sex = itrunc(scx + CELL_W * 0.8);
    dc.lineTo(sex, scy);
    const yh = itrunc(CELL_W * 0.1);
    dc.moveTo(sex + yh, scy - yh);
    dc.lineTo(sex, scy);
    dc.moveTo(sex + yh, scy + yh); /* asymmetry in drawing */
    dc.lineTo(sex, scy);
  }

  private drawBaseLine(dc: DC, scx: number, scy: number, D: Drawing): void {
    dc.moveTo(scx, scy);
    const sex = scx + CELL_W;
    if (this.lastp()) this.bxHookCell(dc, scx, scy);
    else {
      dc.lineTo(sex, scy);
      /* SHOULD BE one guy on line  -- maybe spread 'em out? */
      const P = this.Parent!;
      if (P.type === CT_OR && P.width > 1) {
        const wasScx = scx;
        scx = P.gridx * CELL_W + itrunc((P.width * CELL_W) / 2) - itrunc(CELL_W / 2) + D.x;
        this.xoff = scx - wasScx;
        dc.moveTo(P.gridx * CELL_W + D.x, scy);
        dc.lineTo((P.gridx + P.width) * CELL_W + D.x, scy);
      } else if (P.type === CT_OR && this.gridx + this.width < P.gridx + P.width) {
        /* more than one but not enough cells on line */
        dc.moveTo(scx + CELL_W, scy);
        dc.lineTo(scx + CELL_W * (P.gridx + P.width + 1 - (this.gridx + this.width) + D.x), scy);
      }
    }
  }

  private drawContactLabel(dc: DC, scx: number, scy: number): void {
    let flgs = DT_TOP | DT_SINGLELINE | DT_NOCLIP;
    const txr: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
    txr.top = itrunc(scy - CELL_H * 0.55);
    txr.bottom = scy;
    if (this.type === CT_FRONT) {
      txr.left = itrunc(scx + CELL_W * 0.3);
      txr.right = scx + CELL_W;
      flgs |= DT_LEFT;
    } else {
      txr.left = scx;
      txr.right = itrunc(scx + CELL_W * (0.65 + 0.2));
      flgs |= DT_CENTER;
    }
    dc.drawText(this.text, txr, flgs);
  }

  draw(dc: DC, D: Drawing): void {
    let scx = CELL_W * this.gridx + D.x;
    const scy = CELL_H * this.gridy + D.y;
    const lastp = this.lastp();
    if (this.shift) {
      dc.moveTo(this.cnx * CELL_W + D.x, this.cny * CELL_H + D.y);
      dc.lineTo(this.cnx * CELL_W + D.x, this.cnwl * CELL_H + D.y);
      dc.lineTo(scx, this.cnwl * CELL_H + D.y);
      dc.lineTo(scx, scy);
    }

    switch (this.type) {
      case CT_CONST:
        if (this.st) this.drawBaseLine(dc, scx, scy, D);
        break;

      case CT_FRONT:
      case CT_BACK:
        if (this.stick) {
          this.drawStickContact(dc, scx, scy, D);
          break;
        }
        this.drawBaseLine(dc, scx, scy, D);
        scx += this.xoff;
        this.drawContactLabel(dc, scx, scy);
        this.cTriangle(dc, itrunc(scx + 0.2 * CELL_W), scy);
        this.cDot(dc, itrunc(scx + 0.65 * CELL_W), scy);
        break;

      case CT_COIL:
      case CT_COILTIMER:
        this.drawCoil(dc, scx, scy, this.type === CT_COILTIMER);
        this.drawBaseLine(dc, scx, scy, D);
        break;

      case CT_AND: {
        for (let sg = this.Child; sg !== null; sg = sg.Next) {
          sg.draw(dc, D);
          if (this.Parent && sg.Next === null && this.Parent.type === CT_OR && this.Parent.width > 1 && !sg.lastp()) {
            const parend = CELL_W * (this.Parent.gridx + this.Parent.width) + D.x;
            const lastend = CELL_W * sg.gridx + D.x;
            if (lastend < parend) {
              dc.moveTo(lastend, scy);
              dc.lineTo(parend, scy);
            }
          }
        }
        break;
      }
      case CT_OR: {
        let miny = this.gridy;
        for (let sg = this.Child; sg !== null; sg = sg.Next) {
          sg.draw(dc, D);
          const gy = sg.gridy;
          if (!sg.stick) {
            miny = mIn(gy, miny);
            const y = D.y + CELL_H * gy;
            if (this.shift) {
              if (sg.Prev !== null) this.cDot(dc, scx, y);
              if (!lastp) if (sg.Next !== null) this.cDot(dc, scx + this.width * CELL_W, y);
            } else if (sg.Next !== null && !sg.Next.stick) {
              this.cDot(dc, scx, y);
              if (!lastp) this.cDot(dc, scx + this.width * CELL_W, y);
            }
          }
        }
        for (let j = this.gridy - 1; j >= miny; j--) {
          const y = j * CELL_H + D.y;
          let left = 0;
          let right = 0;
          if (j > miny) {
            if (this.dotoc(this.gridx, j)) left = 1;
            if (this.dotoc(this.gridx + this.width, j)) right = 1;
          }
          if (this.Prev !== null && this.Prev.dotoc(this.gridx, j)) left = 1;
          if (this.Next !== null && this.Next.dotoc(this.gridx + this.width, j)) right = 1;
          if (left) this.cDot(dc, scx, y);
          if (right) this.cDot(dc, scx + this.width * CELL_W, y);
        }

        dc.moveTo(scx, scy);
        dc.lineTo(scx, CELL_H * miny + D.y);
        if (!lastp && miny < this.gridy) {
          const x0 = scx + CELL_W * this.width;
          dc.moveTo(x0, scy);
          dc.lineTo(x0, CELL_H * miny + D.y);
          this.cDot(dc, x0, scy);
          break;
        }
      }
    }
  }

  dotoc(gx: number, gy: number): number {
    if (this.type === CT_CONST && !this.st) return 0;
    switch (this.type) {
      case CT_CONST:
      case CT_FRONT:
      case CT_BACK:
      case CT_COIL:
      case CT_COILTIMER:
        if (this.shift || this.stick) return 0;
        if (gy !== this.gridy) return 0;
        if (gx === this.gridx) return 1;
        if (this.lastp()) return 0;
        if (this.Parent!.type === CT_OR && this.Parent!.width > 1) {
          if (this.Parent!.gridx + this.Parent!.width === gx) return 1;
        } else if (this.gridx + this.width === gx) return 1;
        return 0;
      case CT_AND:
      case CT_OR:
        for (let gn = this.Child; gn !== null; gn = gn.Next) if (gn.dotoc(gx, gy)) return 1;
        return 0;
      default:
        return 0;
    }
  }

  isThisMeXY(x: number, y: number, d: Drawing): boolean {
    const scx = CELL_W * this.gridx + d.x + this.xoff;
    const scy = CELL_H * this.gridy + d.y;
    return y > scy - itrunc(CELL_H / 2) && y < scy + itrunc(CELL_H / 2) && x >= scx && x <= scx + CELL_W;
  }

  locateRelayRecurse(x: number, y: number, drawing: Drawing): GNode | null {
    if (this.Child === null && this.isThisMeXY(x, y, drawing)) return this; // compound nodes have extent
    for (let sn = this.Child; sn !== null; sn = sn.Next) {
      const g = sn.locateRelayRecurse(x, y, drawing);
      if (g) return g;
    }
    return null;
  }
}

/** The drafter's page: the C++ file-level globals (Drawings, Darray, Parray, DD, G). */
export class RelayDrafter {
  Drawings: Drawing[] = [];
  Darray = new Uint8Array(DN_CELL_H * N_CELL_W);
  private Parray = new Uint8Array(N_CELL_H * N_CELL_W);
  private DD: Drawing | null = null;
  ldrawFlags = 0;
  lastDrawingX = 0;
  lastDrawingY = 0;
  lastDrawingRise = 0;
  /** bumps when the drawn content changes (a UI repaint trigger) */
  revision = 0;

  /** GNode * CreateGNode */
  private createGNode(ln: LNode, parent: GNode, d: Drawing): GNode {
    if (ln.kind === "shared") return this.createGNode(ln.opd, parent, d);

    if (ln.kind === "not") {
      const n = this.createGNode(ln.opd, parent, d);
      n.width = n.height = 1;
      n.type = CT_BACK;
      return n;
    }

    if (ln.kind === "const") {
      const n = new GNode(this);
      n.Statep = ln;
      n.type = CT_CONST;
      n.text = ln.state ? "TRUE" : "FALSE";
      n.thread(parent);
      n.width = n.height = 1;
      return n;
    }

    if (ln.kind === "relay") {
      const n = new GNode(this);
      n.type = CT_FRONT;
      n.Statep = ln;
      n.text = ln.sym.toString();
      n.thread(parent);
      n.width = n.height = 1;
      n.stick = ln === d.relay ? 1 : 0;
      return n;
    }

    const n = new GNode(this);
    n.thread(parent);
    n.type = ln.kind === "and" ? CT_AND : CT_OR;
    for (const o of ln.opds) {
      const sub = this.createGNode(o, n, d);
      if (ln.kind === "and") {
        n.width += sub.width;
        n.height = mAx(sub.height, n.height);
      } else {
        n.height += sub.height;
        n.width = mAx(sub.width, n.width);
      }
    }
    n.flatten();
    return n;
  }

  /** DrawCircuit */
  private drawCircuit(r: Relay, exp: LNode, tmr: boolean): void {
    const root = new GNode(this);
    root.type = CT_AND;
    const relay = new GNode(this);
    relay.text = r.sym.toString();
    relay.type = tmr ? CT_COILTIMER : CT_COIL;
    relay.width = relay.height = 1;
    relay.thread(root);
    relay.Statep = r;
    const D = new Drawing(r, this);
    D.yorg = DN_CELL_H / 2;
    const gn = this.createGNode(exp, root, D);
    root.width = 1 + gn.width;
    root.height = gn.height;
    root.flatten();

    D.root = root;
    D.miny = 0;
    D.maxx = 0;
    D.maxy = 0;
    this.Darray.fill(0);
    root.layout(0, 0, D);
    this.DD = D;
  }

  /** DrawRelayFromName: false (after a message box) if no such relay / no autonomous code. */
  drawRelayFromName(rnm: string): boolean {
    const m = /^(\d+)(.*)$/.exec(rnm.trim());
    const sym = m ? internRlysymNoCreate(Number(m[1]), m[2].toUpperCase()) : null;
    if (!sym || !sym.relay) {
      host().messageBox(`No such relay: ${rnm}`, SSNAME, "ok");
      return false;
    }
    const r = sym.relay;
    if (r.exp === null) {
      host().messageBox("Simulator-provided relay, no autonomous code.", SSNAME, "ok");
      return false;
    }
    return this.drawRelayFromRelay(r);
  }

  /** DrawRelayFromRelay (timer relays are drawn as their Z-suffix control relay, with the timer coil). */
  drawRelayFromRelay(r: Relay): boolean {
    let tmr = false;
    if (r.isTimer) {
      const control = zAppendRlysym(r.sym).relay;
      if (!control || control.exp === null) {
        host().messageBox("Simulator-provided relay, no autonomous code.", SSNAME, "ok");
        return false;
      }
      r = control;
      tmr = true;
    }
    this.drawCircuit(r, r.exp!, tmr);
    return true;
  }

  /** PlaceRelayDrawing: find room on the page for the drawing in hand. */
  placeRelayDrawing(): boolean {
    const d = this.DD;
    if (d === null) throw new Error("DD Null in PlaceRelayDrawing");
    const P = this.Parray;
    const ye = -(d.miny - 1) + d.maxy;
    const xe = d.maxx + 1;
    let found = false;
    let x = 0;
    let y = 0;
    search: for (y = 0; y + ye < N_CELL_H; y++) {
      for (x = 0; x + xe <= N_CELL_W; x++) {
        let ok = true;
        for (let y2 = y; y2 < y + ye && ok; y2++) {
          const vx = y2 * N_CELL_W;
          if (x > 0 && P[x - 1 + vx]) ok = false;
          else if (x + xe < N_CELL_W && P[x + xe + vx]) ok = false;
          else for (let x2 = x; x2 < x + xe; x2++) if (P[x2 + vx]) ok = false;
        }
        if (ok) {
          found = true;
          break search;
        }
      }
    }
    if (!found) return false;

    for (let yy = 0; yy < ye; yy++) {
      const vx = (yy + d.yorg + d.miny) * N_CELL_W;
      const vx2 = N_CELL_W * (y + yy);
      for (let xx = 0; xx < xe; xx++) P[x + xx + vx2] |= this.Darray[xx + vx] ?? 0;
    }
    d.xcord = x;
    d.ycord = y - (d.miny - 1);
    d.placeOnPage();
    this.Drawings.push(d);
    this.DD = null;
    this.lastDrawingX = d.x;
    this.lastDrawingY = d.y;
    this.lastDrawingRise = d.miny * CELL_H;
    this.revision++;
    return true;
  }

  /** MacRelayGraphics.cpp TryToPlaceRelayDrawing (message if it will not fit). */
  tryToPlaceRelayDrawing(): boolean {
    if (!this.placeRelayDrawing()) {
      host().messageBox(
        "Requested relay circuit too big for current size of relay graphics window.  Make it longer and maybe NARROWER.",
        "NXSYS Relay Graphics",
        "ok",
      );
      return false;
    }
    return true;
  }

  /** MacRelayGraphics.cpp PlaceDrawing: place, or clear the page and try again. */
  placeDrawing(): boolean {
    if (!this.placeRelayDrawing()) {
      this.clear();
      return this.tryToPlaceRelayDrawing();
    }
    return true;
  }

  /** ClearRelayGraphics */
  clear(): void {
    this.Drawings = [];
    this.Parray.fill(0);
    this.revision++;
  }

  /** CleanUpDrawing (layout change) */
  cleanUp(): void {
    this.clear();
    this.DD = null;
    this.Darray.fill(0);
  }

  /** RenderRelayPage (the Mac view has already selected BLACK_PEN, text color black, transparent bk). */
  renderRelayPage(dc: DC): void {
    for (const d of this.Drawings) d.root.draw(dc, d);
  }

  /** What RelayDrafterView.mm drawRect does around RenderRelayPage. */
  paint(dc: DC): void {
    dc.selectObject(getStockObject("BLACK_PEN"));
    dc.setTextColor(0x000000);
    dc.setBkMode(TRANSPARENT);
    this.renderRelayPage(dc);
  }

  /** RelayGraphicsNameFromXY: the relay named by the contact under (x,y), if any. */
  relayNameFromXY(x: number, y: number): string | null {
    for (const d of this.Drawings) {
      const g = d.root.locateRelayRecurse(x, y, d);
      if (g) return g.text;
    }
    return null;
  }

  /** Where the last drawing lies (for scrolling it into view): MacRelayGraphics.cpp ScrollToLastDrawing. */
  scrollTargetY(): number {
    const YSLOP = 200;
    let targy = this.lastDrawingY + this.lastDrawingRise;
    if (targy > YSLOP) targy -= YSLOP;
    return targy - 15; // lettering on top
  }

  get pageHeight(): number {
    return DRAFT_PAGE_HEIGHT;
  }
}
