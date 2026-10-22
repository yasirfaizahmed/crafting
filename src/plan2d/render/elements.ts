/**
 * Architectural plan rendering of individual elements (model space, drawn through a Painter).
 */
import { formatArea, formatLength } from '../../core/units';
import { defaultFloorMaterial, interiorPoint, orientedBounds } from '../../core/autobuild';
import { getFurniture } from '../../core/catalog';
import { getMaterial } from '../../core/materials';
import { add, dirFromDeg, distance, normalize, perp, polygonArea, scale, sub } from '../../core/math2d';
import { computeStairLayout } from '../../core/stairs';
import type {
  Beam,
  Block,
  Column,
  Dimension,
  Door,
  Element,
  Furniture,
  Label,
  Level,
  Opening,
  Railing,
  Roof,
  Room,
  Slab,
  Stair,
  UnitSystem,
  Vec2,
  Wall,
  Window,
} from '../../core/types';
import type { WallFootprint } from '../../core/walls';
import { blockOutline, circlePolygon, dimensionLine, furnitureSize, LABEL_SCALE, offsetPolygon, openingFrame, type OpeningFrame } from '../shapes';
import { drawFurnitureSymbol } from './furniture';
import type { Painter } from './painter';
import { hexA, PAL, type Palette } from './style';

export interface DrawCtx {
  p: Painter;
  pal: Palette;
  elements: Record<string, Element>;
  footprints: Map<string, WallFootprint>;
  level: Pick<Level, 'height'>;
  units: UnitSystem;
}

const isGlass = (w: Wall) => getMaterial(w.materialId).category === 'glass';

/** Gap quad (slightly wider than the wall) that openings cut out of their host. */
function gapQuad(fr: OpeningFrame): Vec2[] {
  const r = fr.right - 1;
  const l = fr.left + 1;
  return [fr.at(fr.a, r), fr.at(fr.b, r), fr.at(fr.b, l), fr.at(fr.a, l)];
}

/**
 * Walls as poché: a 2 px outline pass then a fill pass over all walls, so joints between walls
 * show no seams (the fills cover the inner half of every outline). Openings are clipped out.
 */
export function drawWalls(dc: DrawCtx, walls: Wall[], openings: Opening[]): void {
  const { p, pal } = dc;
  const g = p.g;
  p.world();
  const gaps = new Map<string, Vec2[][]>();
  for (const op of openings) {
    const host = dc.elements[op.hostId];
    if (!host || host.type !== 'wall') continue;
    const list = gaps.get(host.id) ?? [];
    list.push(gapQuad(openingFrame(host, op)));
    gaps.set(host.id, list);
  }
  const vb = p.view.visibleBounds();
  const pad = (vb.maxX - vb.minX) * 2 + 1e5;
  const withClip = (w: Wall, draw: () => void) => {
    const qs = gaps.get(w.id);
    if (qs) {
      g.save();
      g.beginPath();
      g.rect(vb.minX - pad, vb.minY - pad, vb.maxX - vb.minX + pad * 2, vb.maxY - vb.minY + pad * 2);
      for (const q of qs) p.addPath(q);
      g.clip('evenodd');
    }
    draw();
    if (qs) g.restore();
  };
  g.lineJoin = 'miter';
  g.setLineDash([]);
  for (const w of walls) {
    const fp = dc.footprints.get(w.id);
    if (!fp) continue;
    withClip(w, () => {
      p.path(fp.polygon);
      g.strokeStyle = pal.wallStroke;
      p.lw(2);
      g.stroke();
    });
  }
  for (const w of walls) {
    const fp = dc.footprints.get(w.id);
    if (!fp) continue;
    withClip(w, () => {
      p.path(fp.polygon);
      g.fillStyle = isGlass(w) ? pal.glassWall : w.structural || w.thickness >= 180 ? pal.wallFill : pal.partitionFill;
      g.fill();
    });
    if (isGlass(w)) {
      g.strokeStyle = pal.glass;
      p.lw(0.75);
      p.line(w.start, w.end);
    }
  }
  // Jamb lines close the outline at every opening.
  g.strokeStyle = pal.wallStroke;
  p.lw(1);
  for (const qs of gaps.values()) {
    for (const q of qs) {
      p.line(q[0], q[3]);
      p.line(q[1], q[2]);
    }
  }
}

export function drawOpening(dc: DrawCtx, op: Opening, ghost = false): void {
  const host = dc.elements[op.hostId];
  if (!host || host.type !== 'wall') return;
  const { p, pal } = dc;
  const g = p.g;
  p.world();
  g.setLineDash([]);
  const fr = openingFrame(host, op);
  if (ghost) {
    p.path(gapQuad(fr));
    g.fillStyle = PAL.paper;
    g.fill();
    g.fillStyle = pal.paper;
    g.fill();
    g.strokeStyle = pal.line;
    p.lw(1);
    g.stroke();
  }
  if (op.type === 'door') drawDoor(dc, op, fr);
  else drawWindow(dc, op, fr);
}

function arcBetween(p: Painter, c: Vec2, r: number, from: Vec2, to: Vec2): void {
  const a0 = Math.atan2(from.y - c.y, from.x - c.x);
  const a1 = Math.atan2(to.y - c.y, to.x - c.x);
  let d = a1 - a0;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  p.g.beginPath();
  p.g.arc(c.x, c.y, r, a0, a1, d < 0);
  p.g.stroke();
}

/** Leaf rectangle from hinge h, along `dir` for `len`, `t` thick towards `toward`. */
function leaf(p: Painter, pal: Palette, h: Vec2, dir: Vec2, len: number, toward: Vec2, t = 40): void {
  const tip = add(h, scale(dir, len));
  const off = scale(toward, t);
  p.path([h, tip, add(tip, off), add(h, off)]);
  p.g.fillStyle = pal === PAL ? '#ffffff' : pal.paper;
  p.g.fill();
  p.g.strokeStyle = pal.line;
  p.lw(1.1);
  p.g.stroke();
}

function drawDoor(dc: DrawCtx, d: Door, fr: OpeningFrame): void {
  const { p, pal } = dc;
  const g = p.g;
  const side = d.flip ? -1 : 1;
  const face = side > 0 ? fr.left : fr.right;
  const swing = scale(fr.normal, side);
  const hingeAtB = d.hinge === 'left';
  const W = d.width;
  g.strokeStyle = pal.line;
  switch (d.style) {
    case 'double': {
      const ha = fr.at(fr.a, face);
      const hb = fr.at(fr.b, face);
      const mid = fr.at((fr.a + fr.b) / 2, face);
      leaf(p, pal, ha, swing, W / 2, fr.dir);
      leaf(p, pal, hb, swing, W / 2, scale(fr.dir, -1));
      g.strokeStyle = pal.thin;
      p.lw(0.75);
      arcBetween(p, ha, W / 2, add(ha, scale(swing, W / 2)), mid);
      arcBetween(p, hb, W / 2, add(hb, scale(swing, W / 2)), mid);
      break;
    }
    case 'sliding': {
      const m = (fr.left + fr.right) / 2;
      const t = fr.left - fr.right;
      const o = (fr.a + fr.b) / 2;
      const panel = (s0: number, s1: number, lat: number) => {
        p.path([fr.at(s0, lat - 15), fr.at(s1, lat - 15), fr.at(s1, lat + 15), fr.at(s0, lat + 15)]);
        g.fillStyle = pal === PAL ? '#ffffff' : pal.paper;
        g.fill();
        g.strokeStyle = pal.line;
        p.lw(1);
        g.stroke();
      };
      panel(fr.a, o + 60, m + t * 0.2);
      panel(o - 60, fr.b, m - t * 0.2);
      g.strokeStyle = pal.glass;
      p.lw(0.75);
      p.line(fr.at(fr.a + 40, m + t * 0.2), fr.at(o + 20, m + t * 0.2));
      p.line(fr.at(o - 20, m - t * 0.2), fr.at(fr.b - 40, m - t * 0.2));
      break;
    }
    case 'pocket': {
      const m = (fr.left + fr.right) / 2;
      const into = hingeAtB ? 1 : -1;
      const s0 = hingeAtB ? fr.b : fr.a;
      // Pocket cavity inside the wall.
      p.dash([4, 3]);
      g.strokeStyle = pal.thin;
      p.lw(0.75);
      p.path([fr.at(s0, m - 22), fr.at(s0 + into * W, m - 22), fr.at(s0 + into * W, m + 22), fr.at(s0, m + 22)]);
      g.stroke();
      p.dash(null);
      // Leaf drawn a third open.
      const open = W * 0.35 * into;
      p.path([fr.at(fr.a + open, m - 18), fr.at(fr.b + open, m - 18), fr.at(fr.b + open, m + 18), fr.at(fr.a + open, m + 18)]);
      g.fillStyle = pal === PAL ? '#ffffff' : pal.paper;
      g.fill();
      g.strokeStyle = pal.line;
      p.lw(1.1);
      g.stroke();
      break;
    }
    case 'garage': {
      const depth = Math.min(d.height, 2600);
      p.path([fr.at(fr.a, face), fr.at(fr.b, face), fr.at(fr.b, face + side * 45), fr.at(fr.a, face + side * 45)]);
      g.fillStyle = pal === PAL ? '#ffffff' : pal.paper;
      g.fill();
      g.strokeStyle = pal.line;
      p.lw(1);
      g.stroke();
      p.dash([7, 4]);
      g.strokeStyle = pal.thin;
      p.lw(0.75);
      p.path([fr.at(fr.a, face), fr.at(fr.a, face + side * depth), fr.at(fr.b, face + side * depth), fr.at(fr.b, face)], false);
      g.stroke();
      p.dash(null);
      break;
    }
    case 'opening': {
      p.dash([6, 4]);
      g.strokeStyle = pal.thin;
      p.lw(0.75);
      p.line(fr.at(fr.a, fr.left), fr.at(fr.b, fr.left));
      p.line(fr.at(fr.a, fr.right), fr.at(fr.b, fr.right));
      p.dash(null);
      break;
    }
    default: {
      const h = fr.at(hingeAtB ? fr.b : fr.a, face);
      const free = fr.at(hingeAtB ? fr.a : fr.b, face);
      const toward = scale(fr.dir, hingeAtB ? -1 : 1);
      leaf(p, pal, h, swing, W, toward);
      g.strokeStyle = pal.thin;
      p.lw(0.75);
      arcBetween(p, h, W, add(h, scale(swing, W)), free);
    }
  }
}

function drawWindow(dc: DrawCtx, w: Window, fr: OpeningFrame): void {
  const { p, pal } = dc;
  const g = p.g;
  const m = (fr.left + fr.right) / 2;
  const t = fr.left - fr.right;
  // Frame lines at both faces.
  g.strokeStyle = pal.line;
  p.lw(0.9);
  p.line(fr.at(fr.a, fr.left), fr.at(fr.b, fr.left));
  p.line(fr.at(fr.a, fr.right), fr.at(fr.b, fr.right));
  // Glazing.
  g.strokeStyle = pal.glass;
  p.lw(1);
  const o = (fr.a + fr.b) / 2;
  if (w.style === 'sliding') {
    p.line(fr.at(fr.a, m + t * 0.12), fr.at(o + 60, m + t * 0.12));
    p.line(fr.at(o - 60, m - t * 0.12), fr.at(fr.b, m - t * 0.12));
  } else if (w.style === 'fixed') {
    p.line(fr.at(fr.a, m), fr.at(fr.b, m));
  } else {
    p.line(fr.at(fr.a, m + Math.min(15, t * 0.1)), fr.at(fr.b, m + Math.min(15, t * 0.1)));
    p.line(fr.at(fr.a, m - Math.min(15, t * 0.1)), fr.at(fr.b, m - Math.min(15, t * 0.1)));
    if (w.style === 'casement' && w.width >= 900) {
      // Mullion between two casements.
      g.strokeStyle = pal.line;
      p.line(fr.at(o, m - t * 0.25), fr.at(o, m + t * 0.25));
    }
  }
  // Sill projecting on the exterior (right) side.
  g.strokeStyle = pal.line;
  p.lw(0.8);
  const so = 40;
  p.path([fr.at(fr.a - 50, fr.right), fr.at(fr.a - 50, fr.right - so), fr.at(fr.b + 50, fr.right - so), fr.at(fr.b + 50, fr.right)], false);
  g.stroke();
}

export function slabLooksAuto(s: Slab): boolean {
  return s.props?.autogen === true && (s.kind === 'floor' || s.kind === 'ceiling');
}

export function drawSlab(dc: DrawCtx, s: Slab): void {
  if (s.outline.length < 3 || slabLooksAuto(s)) return;
  const { p, pal } = dc;
  const g = p.g;
  p.world();
  p.path(s.outline);
  if (s.kind === 'floor' || s.kind === 'terrace') {
    g.fillStyle = s.kind === 'terrace' ? hexA(getMaterial(s.materialId).color, 0.12) : 'rgba(150,160,175,0.05)';
    g.fill();
  }
  g.strokeStyle = pal.slab;
  p.lw(0.9);
  p.dash(s.kind === 'foundation' ? [10, 5] : s.kind === 'ceiling' ? [10, 3, 2, 3] : [6, 4]);
  g.stroke();
  p.dash(null);
  for (const h of s.holes ?? []) {
    if (h.length < 3) continue;
    p.path(h);
    g.fillStyle = PAL.paper;
    g.fill();
    g.strokeStyle = pal.line;
    p.lw(1);
    g.stroke();
    // Opening-in-slab cross.
    g.strokeStyle = pal.thin;
    p.lw(0.6);
    if (h.length >= 4) {
      p.line(h[0], h[2]);
      p.line(h[1], h[3]);
    }
  }
}

export function roomFillColor(r: Room): string {
  return getMaterial(r.floorMaterialId ?? defaultFloorMaterial(r.name ?? '')).color;
}

export function drawRoomFill(dc: DrawCtx, r: Room): void {
  if (r.outline.length < 3) return;
  const { p } = dc;
  p.world();
  p.path(r.outline);
  p.g.fillStyle = dc.pal === PAL ? hexA(roomFillColor(r), 0.17) : dc.pal.paper;
  p.g.fill();
}

const labelPointCache = new WeakMap<Vec2[], Vec2>();

export function roomLabelPoint(r: Room): Vec2 {
  let c = labelPointCache.get(r.outline);
  if (!c) {
    c = interiorPoint(r.outline);
    labelPointCache.set(r.outline, c);
  }
  return c;
}

export function drawRoomTag(dc: DrawCtx, r: Room): void {
  if (r.outline.length < 3) return;
  const { p, pal } = dc;
  const xs = r.outline.map((q) => q.x);
  const ys = r.outline.map((q) => q.y);
  const sw = (Math.max(...xs) - Math.min(...xs)) * p.view.scale;
  const sh = (Math.max(...ys) - Math.min(...ys)) * p.view.scale;
  if (sw < 46 || sh < 26) return;
  const c = roomLabelPoint(r);
  const area = formatArea(polygonArea(r.outline), dc.units);
  const name = r.name || 'Room';
  const big = sw > 110 && sh > 44;
  const nameSize = big ? 13 : 11.5;
  p.text(c, name, { size: nameSize, weight: 650, color: pal.text, dy: big ? -8 : -6, halo: 'rgba(255,255,255,0.85)' });
  const sub = r.number && big ? `${r.number}  ·  ${area}` : area;
  p.text(c, sub, { size: big ? 11 : 10, weight: 500, color: pal.muted, dy: big ? 9 : 7, halo: 'rgba(255,255,255,0.85)' });
}

/** Plan cut plane height for stairs (treads above it are drawn hidden), mm. */
export const STAIR_CUT_HEIGHT = 1200;

export function drawStair(dc: DrawCtx, s: Stair, withText = true): void {
  const { p, pal } = dc;
  const g = p.g;
  p.world();
  const l = computeStairLayout(s, dc.level.height);
  g.setLineDash([]);
  for (const f of l.footprint) {
    p.path(f);
    g.fillStyle = pal === PAL ? 'rgba(255,255,255,0.75)' : pal.paper;
    g.fill();
  }
  g.strokeStyle = pal.stair;
  p.lw(0.7);
  // Treads above the plan cut plane are hidden (dashed), with a break line at the cut.
  const cutAt = l.treads.findIndex((t) => t.top > STAIR_CUT_HEIGHT);
  [...l.treads, ...l.landings].forEach((t, i) => {
    const above = cutAt >= 0 && i >= cutAt && i < l.treads.length;
    p.dash(above ? [4, 3] : null);
    p.path(t.polygon);
    g.stroke();
  });
  p.dash(null);
  if (s.shape === 'straight' && cutAt > 0 && cutAt + 1 < l.treads.length) {
    const a = l.treads[cutAt].polygon;
    const b = l.treads[cutAt + 1].polygon;
    p.lw(1.1);
    g.strokeStyle = pal.line;
    // Diagonal break across two treads, from one stringer to the other.
    const ca = scale(add(a[0], a[3]), 0.5);
    const cb = scale(add(b[1], b[2]), 0.5);
    const side = perp(normalize(sub(cb, ca)));
    p.line(add(ca, scale(side, s.width / 2)), sub(cb, scale(side, s.width / 2)));
  }
  p.lw(1.2);
  for (const f of l.footprint) {
    p.path(f);
    g.stroke();
  }
  // Walk line with arrow.
  const wl = l.walkline;
  if (wl.length >= 2) {
    g.strokeStyle = pal.line;
    p.lw(1);
    p.path(wl, false);
    g.stroke();
    p.circle(wl[0], p.px(3));
    g.fillStyle = pal.line;
    g.fill();
    const end = wl[wl.length - 1];
    const prev = wl[wl.length - 2];
    const dir = normalize(sub(end, prev));
    const n = perp(dir);
    const ah = p.px(9);
    p.path([end, add(sub(end, scale(dir, ah)), scale(n, ah * 0.45)), add(sub(end, scale(dir, ah)), scale(n, -ah * 0.45))]);
    g.fill();
    if (withText && p.view.scale * s.width > 28) {
      const back = scale(normalize(sub(wl[1], wl[0])), -1);
      const at = add(wl[0], scale(back, p.px(12)));
      p.text(at, 'UP', { size: 10, weight: 700, color: pal.line });
    }
  }
}

export function drawColumn(dc: DrawCtx, c: Column): void {
  const { p, pal } = dc;
  const g = p.g;
  p.world();
  if (c.shape === 'round') p.circle(c.position, c.width / 2);
  else p.path(orientedRectPts(c.position, c.width, c.depth, c.rotation));
  g.fillStyle = pal.column;
  g.fill();
  g.strokeStyle = pal.wallStroke;
  p.lw(1);
  g.stroke();
}

function orientedRectPts(c: Vec2, w: number, d: number, deg: number): Vec2[] {
  const ux = dirFromDeg(deg);
  const uy = perp(ux);
  const hx = scale(ux, w / 2);
  const hy = scale(uy, d / 2);
  return [sub(sub(c, hx), hy), sub(add(c, hx), hy), add(add(c, hx), hy), add(sub(c, hx), hy)];
}

export function drawBeam(dc: DrawCtx, b: Beam): void {
  const { p, pal } = dc;
  const g = p.g;
  if (distance(b.start, b.end) < 1) return;
  p.world();
  const n = scale(perp(normalize(sub(b.end, b.start))), b.width / 2);
  g.strokeStyle = pal.beam;
  p.lw(0.9);
  p.dash([9, 5]);
  p.line(add(b.start, n), add(b.end, n));
  p.line(sub(b.start, n), sub(b.end, n));
  p.dash(null);
  p.line(add(b.start, n), sub(b.start, n));
  p.line(add(b.end, n), sub(b.end, n));
  p.dash([14, 3, 2, 3]);
  p.lw(0.6);
  p.line(b.start, b.end);
  p.dash(null);
}

export function drawRailing(dc: DrawCtx, r: Railing): void {
  if (r.path.length < 2) return;
  const { p, pal } = dc;
  const g = p.g;
  p.world();
  g.strokeStyle = pal.line;
  g.lineJoin = 'round';
  p.lw(1.6);
  p.path(r.path, false);
  g.stroke();
  // Second, thin line for the handrail edge.
  p.lw(0.6);
  for (let i = 0; i + 1 < r.path.length; i++) {
    const a = r.path[i];
    const b = r.path[i + 1];
    if (distance(a, b) < 1) continue;
    const n = scale(perp(normalize(sub(b, a))), 35);
    p.line(add(a, n), add(b, n));
    p.line(sub(a, n), sub(b, n));
  }
  g.fillStyle = pal.line;
  for (const q of r.path) {
    p.path(orientedRectPts(q, 60, 60, 0));
    g.fill();
  }
}

export function drawFurniture(dc: DrawCtx, f: Furniture): void {
  const { p, pal } = dc;
  const def = getFurniture(f.catalogId);
  const { w, d } = furnitureSize(f);
  const g = p.g;
  p.world();
  g.save();
  g.translate(f.position.x, f.position.y);
  g.rotate((f.rotation * Math.PI) / 180);
  if (f.mirrored) g.scale(-1, 1);
  g.setLineDash([]);
  g.lineJoin = 'round';
  p.lw(0.9);
  drawFurnitureSymbol(p, def?.plan ?? 'rect', w, d, pal);
  g.restore();
}

export function drawBlock(dc: DrawCtx, b: Block): void {
  const { p, pal } = dc;
  const g = p.g;
  p.world();
  const color = getMaterial(b.materialId ?? 'brick-red').color;
  const round = b.shape === 'cylinder' || b.shape === 'sphere';
  const pts = blockOutline(b);
  if (round) {
    p.path(circlePolygon(scale(add(pts[0], pts[2]), 0.5), Math.min(b.size.x, b.size.y) / 2, 32));
  } else p.path(pts);
  g.fillStyle = pal === PAL ? hexA(color, 0.55) : pal.furnitureFill;
  g.fill();
  g.strokeStyle = pal === PAL ? shade(color) : pal.line;
  p.lw(1);
  g.stroke();
  if (b.shape === 'wedge') {
    p.line(pts[0], pts[2]);
  } else if (b.shape === 'box' && pal === PAL) {
    // Minecraft-ish bevel.
    p.lw(0.5);
    const inset = Math.min(b.size.x, b.size.y) * 0.12;
    const c = scale(add(pts[0], pts[2]), 0.5);
    p.path(pts.map((q) => add(q, scale(normalize(sub(c, q)), inset * 1.41))));
    g.stroke();
  }
}

function shade(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const k = 0.62;
  return `rgb(${Math.round(parseInt(m[1], 16) * k)},${Math.round(parseInt(m[2], 16) * k)},${Math.round(parseInt(m[3], 16) * k)})`;
}

export function drawDimension(dc: DrawCtx, d: Dimension): void {
  const { p, pal } = dc;
  const g = p.g;
  const len = distance(d.a, d.b);
  if (len < 1) return;
  const { a, b, n } = dimensionLine(d);
  p.world();
  g.setLineDash([]);
  g.strokeStyle = pal.dim;
  p.lw(0.8);
  p.line(a, b);
  // Extension lines: gap at the object, overshoot past the dimension line.
  const sgn = d.offset >= 0 ? 1 : -1;
  const gap = p.px(4);
  const over = p.px(5);
  for (const [o, q] of [
    [d.a, a],
    [d.b, b],
  ] as const) {
    if (Math.abs(d.offset) > gap) p.line(add(o, scale(n, sgn * gap)), add(q, scale(n, sgn * over)));
  }
  // Architectural ticks.
  const dir = normalize(sub(d.b, d.a));
  const tk = scale(normalize(add(dir, n)), p.px(5));
  p.lw(1.6);
  for (const q of [a, b]) p.line(sub(q, tk), add(q, tk));
  // Upright text above the line.
  const mid = scale(add(a, b), 0.5);
  let ang = -Math.atan2(dir.y, dir.x);
  let up = n;
  if (ang > Math.PI / 2 + 1e-6 || ang < -Math.PI / 2 - 1e-6) {
    ang += Math.PI;
  }
  // Put text on the side of the line facing screen-up.
  if (p.view.toScreen(add(mid, n)).y > p.view.toScreen(mid).y) up = scale(n, -1);
  const text = formatLength(len, dc.units);
  if (len * p.view.scale < p.measure(text, 11) * 0.8) return;
  p.text(add(mid, scale(up, p.px(8))), text, { size: 11, weight: 600, color: pal.dim, angle: ang, halo: 'rgba(255,255,255,0.9)' });
}

export function drawLabel(dc: DrawCtx, l: Label): void {
  const { p, pal } = dc;
  const px = l.size * LABEL_SCALE * p.view.scale;
  if (px < 3.5) return;
  p.text(l.position, l.text, { size: Math.min(px, 400), weight: 650, color: pal.text, angle: (-l.rotation * Math.PI) / 180 });
}

export function drawRoof(dc: DrawCtx, r: Roof): void {
  if (r.outline.length < 3) return;
  const { p, pal } = dc;
  const g = p.g;
  p.world();
  g.strokeStyle = pal.roof;
  p.lw(0.9);
  p.dash([10, 6]);
  p.path(r.outline);
  g.stroke();
  if (r.overhang > 0) {
    p.lw(0.7);
    p.dash([4, 4]);
    p.path(offsetPolygon(r.outline, r.overhang));
    g.stroke();
  }
  // Ridge / hips from the oriented bounds.
  if (r.shape !== 'flat') {
    const ob = orientedBounds(r.outline);
    const u = dirFromDeg(r.ridgeAngle);
    const v = perp(u);
    // Extents along the ridge direction.
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const q of r.outline) {
      const rel = sub(q, ob.center);
      const a = rel.x * u.x + rel.y * u.y;
      const b = rel.x * v.x + rel.y * v.y;
      minU = Math.min(minU, a);
      maxU = Math.max(maxU, a);
      minV = Math.min(minV, b);
      maxV = Math.max(maxV, b);
    }
    const at = (a: number, b: number) => add(ob.center, add(scale(u, a), scale(v, b)));
    const cv = (minV + maxV) / 2;
    const half = (maxV - minV) / 2;
    p.dash([16, 4, 3, 4]);
    p.lw(0.8);
    if (r.shape === 'gable') p.line(at(minU, cv), at(maxU, cv));
    else if (r.shape === 'hip' || r.shape === 'pyramid') {
      const inset = r.shape === 'pyramid' ? (maxU - minU) / 2 : Math.min(half, (maxU - minU) / 2);
      const r0 = at(minU + inset, cv);
      const r1 = at(maxU - inset, cv);
      if (distance(r0, r1) > 1) p.line(r0, r1);
      p.line(r0, at(minU, minV));
      p.line(r0, at(minU, maxV));
      p.line(r1, at(maxU, minV));
      p.line(r1, at(maxU, maxV));
    } else if (r.shape === 'shed') {
      p.line(at(minU, maxV), at(maxU, maxV));
    }
    p.dash(null);
  }
  p.dash(null);
}

/** Render a non-wall element (walls are batched by drawWalls). */
export function drawElement(dc: DrawCtx, el: Element): void {
  switch (el.type) {
    case 'door':
    case 'window':
      drawOpening(dc, el);
      break;
    case 'slab':
      drawSlab(dc, el);
      break;
    case 'room':
      drawRoomFill(dc, el);
      break;
    case 'stair':
      drawStair(dc, el);
      break;
    case 'column':
      drawColumn(dc, el);
      break;
    case 'beam':
      drawBeam(dc, el);
      break;
    case 'railing':
      drawRailing(dc, el);
      break;
    case 'furniture':
      drawFurniture(dc, el);
      break;
    case 'block':
      drawBlock(dc, el);
      break;
    case 'dimension':
      drawDimension(dc, el);
      break;
    case 'label':
      drawLabel(dc, el);
      break;
    case 'roof':
      drawRoof(dc, el);
      break;
    default:
      break;
  }
}

