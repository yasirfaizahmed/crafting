/**
 * Furniture plan symbols (I-FURN) per FurniturePlanSymbol, authored in the element's local frame
 * (mm): width along x, depth along y, centred on the origin, FRONT at −y, BACK (+y) to the wall.
 */
import { getFurniture, type FurniturePlanSymbol } from '../../core/catalog';
import { add, rotate } from '../../core/math2d';
import type { Furniture, Vec2 } from '../../core/types';
import { readableAngle } from '../dimension';
import { ellipsePoints } from '../geom';
import { TEXT } from '../layers';
import type { PlanContext } from './context';

type Shape = { kind: 'poly'; pts: Vec2[]; closed: boolean } | { kind: 'circle'; c: Vec2; r: number } | { kind: 'text'; at: Vec2; text: string };

class Sketch {
  shapes: Shape[] = [];
  poly(pts: Vec2[], closed = true): this {
    this.shapes.push({ kind: 'poly', pts, closed });
    return this;
  }
  rect(x0: number, y0: number, x1: number, y1: number): this {
    return this.poly([
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ]);
  }
  /** Rectangle with rounded corners (radius r) as a polyline. */
  rrect(x0: number, y0: number, x1: number, y1: number, r: number): this {
    const rr = Math.max(0, Math.min(r, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2));
    const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
    const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
    if (rr < 1) return this.rect(ax, ay, bx, by);
    const pts: Vec2[] = [];
    const corner = (cx: number, cy: number, a0: number) => {
      for (let i = 0; i <= 4; i++) {
        const a = ((a0 + i * 22.5) * Math.PI) / 180;
        pts.push({ x: cx + rr * Math.cos(a), y: cy + rr * Math.sin(a) });
      }
    };
    corner(bx - rr, ay + rr, -90);
    corner(bx - rr, by - rr, 0);
    corner(ax + rr, by - rr, 90);
    corner(ax + rr, ay + rr, 180);
    return this.poly(pts);
  }
  line(x0: number, y0: number, x1: number, y1: number): this {
    return this.poly(
      [
        { x: x0, y: y0 },
        { x: x1, y: y1 },
      ],
      false,
    );
  }
  circle(x: number, y: number, r: number): this {
    this.shapes.push({ kind: 'circle', c: { x, y }, r });
    return this;
  }
  ellipse(x: number, y: number, rx: number, ry: number): this {
    return Math.abs(rx - ry) < 1 ? this.circle(x, y, rx) : this.poly(ellipsePoints({ x, y }, rx, ry, 36));
  }
  text(x: number, y: number, text: string): this {
    this.shapes.push({ kind: 'text', at: { x, y }, text });
    return this;
  }
}

type SymbolFn = (s: Sketch, w: number, d: number) => void;

const SYMBOLS: Record<FurniturePlanSymbol, SymbolFn> = {
  rect: (s, w, d) => s.rect(-w / 2, -d / 2, w / 2, d / 2),
  round: (s, w, d) => s.ellipse(0, 0, w / 2, d / 2),
  counter: (s, w, d) => {
    s.rect(-w / 2, -d / 2, w / 2, d / 2);
    s.line(-w / 2, -d / 2 + Math.min(40, d * 0.1), w / 2, -d / 2 + Math.min(40, d * 0.1));
  },
  table: (s, w, d) => {
    s.rect(-w / 2, -d / 2, w / 2, d / 2);
  },
  bed: (s, w, d) => {
    const hx = w / 2;
    const hy = d / 2;
    s.rect(-hx, -hy, hx, hy);
    s.rect(-hx, hy - 60, hx, hy); // headboard
    const n = w > 1200 ? 2 : 1;
    const gap = 70;
    const pw = (w - gap * (n + 1)) / n;
    const py1 = hy - 60 - 50;
    const py0 = py1 - Math.min(380, d * 0.17);
    for (let i = 0; i < n; i++) {
      const x0 = -hx + gap + i * (pw + gap);
      s.rrect(x0, py0, x0 + pw, py1, 60);
    }
    const fold = py0 - 80;
    s.line(-hx, fold, hx, fold);
    // Turned-down corner of the duvet.
    s.poly(
      [
        { x: hx, y: fold - d * 0.2 },
        { x: hx - w * 0.28, y: fold },
      ],
      false,
    );
  },
  sofa: (s, w, d) => {
    const hx = w / 2;
    const hy = d / 2;
    const back = Math.min(220, d * 0.25);
    const arm = Math.min(200, w * 0.12);
    s.rrect(-hx, -hy, hx, hy, 60);
    s.line(-hx + arm, hy - back, hx - arm, hy - back);
    s.line(-hx + arm, -hy, -hx + arm, hy - back);
    s.line(hx - arm, -hy, hx - arm, hy - back);
    const n = w > 1800 ? 3 : 2;
    const seat = (w - 2 * arm) / n;
    for (let i = 1; i < n; i++) s.line(-hx + arm + i * seat, -hy + 40, -hx + arm + i * seat, hy - back);
  },
  chair: (s, w, d) => {
    const hx = w / 2;
    const hy = d / 2;
    s.rrect(-hx, -hy, hx, hy, Math.min(60, w * 0.1));
    s.line(-hx, hy - d * 0.18, hx, hy - d * 0.18);
    if (w >= 700) {
      s.line(-hx + w * 0.15, -hy, -hx + w * 0.15, hy - d * 0.18);
      s.line(hx - w * 0.15, -hy, hx - w * 0.15, hy - d * 0.18);
    }
  },
  toilet: (s, w, d) => {
    const hx = w / 2;
    const hy = d / 2;
    const tank = Math.min(200, d * 0.28);
    s.rrect(-hx, hy - tank, hx, hy, 30);
    const ry = (d - tank) * 0.48;
    const cy = hy - tank - ry;
    s.ellipse(0, cy, hx * 0.95, ry);
    s.ellipse(0, cy - ry * 0.08, hx * 0.62, ry * 0.68);
  },
  sink: (s, w, d) => {
    const hx = w / 2;
    const hy = d / 2;
    s.rect(-hx, -hy, hx, hy);
    const bw = Math.min(w * 0.62, 520);
    const bd = Math.min(d * 0.62, 400);
    const cy = -hy + d * 0.45;
    if (w >= 800 && d >= 550) s.rrect(-bw / 2, cy - bd / 2, bw / 2, cy + bd / 2, 50);
    else s.ellipse(0, cy, bw / 2, bd / 2);
    s.circle(0, cy, 22);
    s.circle(0, hy - Math.min(70, d * 0.15), 18); // tap
  },
  bathtub: (s, w, d) => {
    const hx = w / 2;
    const hy = d / 2;
    s.rect(-hx, -hy, hx, hy);
    s.rrect(-hx + 90, -hy + 60, hx - 60, hy - 60, Math.min(200, d * 0.3));
    s.circle(-hx + 170, 0, 25);
  },
  shower: (s, w, d) => {
    const hx = w / 2;
    const hy = d / 2;
    s.rect(-hx, -hy, hx, hy);
    s.rect(-hx + 40, -hy + 40, hx - 40, hy - 40);
    s.line(-hx + 40, -hy + 40, hx - 40, hy - 40);
    s.line(-hx + 40, hy - 40, hx - 40, -hy + 40);
    s.circle(0, 0, 35);
  },
  stove: (s, w, d) => {
    const hx = w / 2;
    const hy = d / 2;
    s.rect(-hx, -hy, hx, hy);
    const r1 = Math.min(w, d) * 0.15;
    const r2 = Math.min(w, d) * 0.11;
    s.circle(-w / 4, -d / 4, r1).circle(w / 4, -d / 4, r2).circle(-w / 4, d / 4, r2).circle(w / 4, d / 4, r1);
  },
  fridge: (s, w, d) => {
    const hx = w / 2;
    const hy = d / 2;
    s.rect(-hx, -hy, hx, hy);
    s.line(-hx, -hy + 60, hx, -hy + 60);
    s.text(0, 30, 'REF');
  },
  tree: (s, w, d) => {
    const r = Math.min(w, d) / 2;
    const pts: Vec2[] = [];
    const n = 120;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const k = 1 - 0.07 * Math.abs(Math.sin(a * 7));
      pts.push({ x: r * k * Math.cos(a), y: r * k * Math.sin(a) });
    }
    s.poly(pts);
    s.circle(0, 0, Math.max(60, r * 0.06));
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      s.line(r * 0.12 * Math.cos(a), r * 0.12 * Math.sin(a), r * 0.55 * Math.cos(a), r * 0.55 * Math.sin(a));
    }
  },
  plant: (s, w, d) => {
    const r = Math.min(w, d) / 2;
    s.circle(0, 0, r);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      s.line(0, 0, r * 0.85 * Math.cos(a), r * 0.85 * Math.sin(a));
    }
  },
  car: (s, w, d) => {
    const hx = w / 2;
    const hy = d / 2;
    s.rrect(-hx, -hy, hx, hy, Math.min(w * 0.22, 380));
    const ws = -hy + d * 0.3;
    const rs = hy - d * 0.2;
    s.rrect(-hx + w * 0.12, ws, hx - w * 0.12, rs, 120);
    s.line(-hx + w * 0.08, ws - d * 0.08, hx - w * 0.08, ws - d * 0.08);
    // Wing mirrors.
    s.rect(-hx - 90, ws - 40, -hx, ws + 40).rect(hx, ws - 40, hx + 90, ws + 40);
  },
  lamp: (s, w, d) => {
    const r = Math.min(w, d) / 2;
    const k = r * Math.SQRT1_2;
    s.circle(0, 0, r).line(-k, -k, k, k).line(-k, k, k, -k);
  },
  wardrobe: (s, w, d) => {
    const hx = w / 2;
    const hy = d / 2;
    s.rect(-hx, -hy, hx, hy);
    s.line(-hx + 30, 0, hx - 30, 0);
    const n = Math.max(3, Math.round(w / 200));
    for (let i = 1; i < n; i++) {
      const x = -hx + (i * w) / n;
      s.line(x - 60, -d * 0.32, x + 60, d * 0.32);
    }
  },
  rug: (s, w, d) => {
    s.rect(-w / 2, -d / 2, w / 2, d / 2);
    s.rect(-w / 2 + 80, -d / 2 + 80, w / 2 - 80, d / 2 - 80);
  },
};

export function furnitureSymbol(symbol: FurniturePlanSymbol, w: number, d: number): Shape[] {
  const s = new Sketch();
  (SYMBOLS[symbol] ?? SYMBOLS.rect)(s, w, d);
  return s.shapes;
}

export function drawFurniture(ctx: PlanContext, f: Furniture): void {
  const def = getFurniture(f.catalogId);
  const w = f.width ?? def?.width ?? 1000;
  const d = f.depth ?? def?.depth ?? 1000;
  const symbol = def?.plan ?? 'rect';
  const over = f.elevation >= ctx.cut;
  const extra = { elementId: f.id, tag: symbol, ...(over ? { linetype: 'hidden' as const } : {}) };
  const tf = (p: Vec2): Vec2 => add(rotate({ x: f.mirrored ? -p.x : p.x, y: p.y }, f.rotation), f.position);
  for (const sh of furnitureSymbol(symbol, w, d)) {
    if (sh.kind === 'poly') ctx.b.polyline('I-FURN', sh.pts.map(tf), sh.closed, extra);
    else if (sh.kind === 'circle') ctx.b.circle('I-FURN', tf(sh.c), sh.r, extra);
    else ctx.b.text('I-FURN', tf(sh.at), sh.text, TEXT.tiny, { ...extra, rotation: readableAngle(f.rotation) });
  }
}
