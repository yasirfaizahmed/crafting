/**
 * Plan annotation: room tags (A-AREA-IDEN), labels (A-ANNO-TEXT), dimensions and automatic
 * exterior dimension chains (A-ANNO-DIMS), north arrow, scale bar and view title (A-ANNO-SYMB).
 */
import { interiorPoint } from '../../core/autobuild';
import { add, boundsOf, dot, normalize, perp, pointInPolygon, polygonArea, rotate, scale, sub, type Bounds2 } from '../../core/math2d';
import type { Dimension, Label, Opening, Room, Vec2, Wall } from '../../core/types';
import { formatArea } from '../../core/units';
import { wallDirection, wallFaceOffsets, wallNormal } from '../../core/walls';
import { DIM_STYLE, dimensionTextFits, formatDimension, outsideTextPosition, readableAngle } from '../dimension';
import { arcPoints } from '../geom';
import { PEN, TEXT } from '../layers';
import { textWidth } from '../text';
import type { DrawingBuilder } from '../builder';
import { exteriorSide, mm, openingFrame, type PlanContext } from './context';

export function drawRoomTag(ctx: PlanContext, r: Room): void {
  if (r.outline.length < 3) return;
  const { b } = ctx;
  const area = formatArea(polygonArea(r.outline), ctx.project.settings.units);
  const id = { elementId: r.id };
  const nameH = TEXT.normal * ctx.scale;
  const smallH = TEXT.small * ctx.scale;
  const gap = 1.4 * ctx.scale;
  const lines: { text: string; h: number; tag: string; bold?: boolean }[] = [];
  if (r.number) lines.push({ text: r.number, h: smallH, tag: 'room-number' });
  lines.push({ text: (r.name || 'Room').toUpperCase(), h: nameH, tag: 'room-name', bold: true });
  lines.push({ text: area, h: smallH, tag: 'room-area' });
  const total = lines.reduce((s, l) => s + l.h, 0) + gap * (lines.length - 1);
  const width = Math.max(...lines.map((l) => textWidth(l.text, l.h / ctx.scale, l.bold) * ctx.scale));
  const c = tagPosition(ctx, r.outline, width + mm(ctx, 4), total + mm(ctx, 2.5));
  let y = c.y + total / 2;
  for (const l of lines) {
    b.text('A-AREA-IDEN', { x: c.x, y: y - l.h / 2 }, l.text, l.h / ctx.scale, { ...id, tag: l.tag, bold: l.bold });
    y -= l.h + gap;
  }
}

/**
 * Tag centre inside the room, as close to its visual centre as possible while keeping the tag box
 * inside the outline and clear of furniture symbols.
 */
function tagPosition(ctx: PlanContext, outline: Vec2[], w: number, h: number): Vec2 {
  const c0 = interiorPoint(outline);
  const boxes = new Map<string, Bounds2>();
  for (const e of ctx.b.only(['I-FURN', 'A-FLOR-STRS', 'S-COLS', 'A-GENM', 'A-DOOR'])) {
    if (!e.elementId) continue;
    const bb = boxes.get(e.elementId) ?? { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const pts = e.kind === 'polyline' ? e.points : e.kind === 'arc' ? arcPoints(e.center, e.radius, e.startAngle, e.endAngle, 10) : e.kind === 'circle' ? [add(e.center, { x: -e.radius, y: -e.radius }), add(e.center, { x: e.radius, y: e.radius })] : [];
    for (const p of pts) {
      bb.minX = Math.min(bb.minX, p.x);
      bb.minY = Math.min(bb.minY, p.y);
      bb.maxX = Math.max(bb.maxX, p.x);
      bb.maxY = Math.max(bb.maxY, p.y);
    }
    boxes.set(e.elementId, bb);
  }
  /** Overlap area with furniture (Infinity when the box leaves the room). */
  const cost = (c: Vec2) => {
    const x0 = c.x - w / 2;
    const x1 = c.x + w / 2;
    const y0 = c.y - h / 2;
    const y1 = c.y + h / 2;
    const corners = [c, { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
    if (!corners.every((p) => pointInPolygon(p, outline))) return Infinity;
    let a = 0;
    for (const bb of boxes.values()) a += Math.max(0, Math.min(x1, bb.maxX) - Math.max(x0, bb.minX)) * Math.max(0, Math.min(y1, bb.maxY) - Math.max(y0, bb.minY));
    return a;
  };
  if (cost(c0) === 0) return c0;
  const bb = boundsOf(outline);
  for (const [k, box] of boxes) if (box.minX > bb.maxX || box.maxX < bb.minX || box.minY > bb.maxY || box.maxY < bb.minY) boxes.delete(k);
  const step = Math.max(25, mm(ctx, 0.5), Math.max(bb.maxX - bb.minX, bb.maxY - bb.minY) / 120);
  const nx = Math.min(200, Math.ceil((bb.maxX - bb.minX) / step));
  const ny = Math.min(200, Math.ceil((bb.maxY - bb.minY) / step));
  let best = c0;
  let bestScore = cost(c0) === Infinity ? Infinity : cost(c0) * 4 / (w * h) * 1e6;
  for (let i = -nx; i <= nx; i++) {
    for (let j = -ny; j <= ny; j++) {
      const p = { x: c0.x + i * step, y: c0.y + j * step };
      const dist = Math.hypot(i * step, j * step * 1.5);
      if (dist >= bestScore) continue;
      const a = cost(p);
      if (a === Infinity) continue;
      // Overlap is far worse than distance: 1% of the box overlapped ≈ 40 mm*… of travel.
      const score = dist + (a / (w * h)) * 4e6;
      if (score < bestScore) {
        best = p;
        bestScore = score;
      }
    }
  }
  return best;
}

/** Door (circle) and window (hexagon) tags carrying the schedule marks. */
export function drawOpeningTags(ctx: PlanContext, marks: Map<string, string>): void {
  const { b } = ctx;
  for (const op of ctx.elements) {
    if (op.type !== 'door' && op.type !== 'window') continue;
    const mark = marks.get(op.id);
    const host = ctx.project.elements[op.hostId];
    if (!mark || !host || host.type !== 'wall') continue;
    const fr = openingFrame(host, op);
    const ext = exteriorSide(ctx, fr);
    const s = (fr.a + fr.b) / 2;
    let side: number;
    if (op.type === 'window') side = ext === 0 ? 1 : ext;
    else if (op.style === 'single' || op.style === 'double') side = op.flip ? 1 : -1; // opposite the swing
    else side = ext === 0 ? 1 : -ext;
    const face = side > 0 ? fr.left : fr.right;
    const r = mm(ctx, 2.9);
    const c = fr.at(s, face + side * (r + mm(ctx, 1.2)));
    const id = { elementId: op.id };
    if (op.type === 'door') b.circle('A-DOOR-IDEN', c, r, { ...id, tag: 'door-tag' });
    else {
      const w = mm(ctx, 3.8);
      const h = mm(ctx, 2.2);
      const k = mm(ctx, 1.2);
      b.polyline('A-GLAZ-IDEN', [{ x: c.x - w, y: c.y }, { x: c.x - w + k, y: c.y - h }, { x: c.x + w - k, y: c.y - h }, { x: c.x + w, y: c.y }, { x: c.x + w - k, y: c.y + h }, { x: c.x - w + k, y: c.y + h }], true, { ...id, tag: 'window-tag' });
    }
    b.text(op.type === 'door' ? 'A-DOOR-IDEN' : 'A-GLAZ-IDEN', c, mark, TEXT.tiny, { ...id, tag: 'mark', bold: true });
  }
}

export function drawLabel(ctx: PlanContext, l: Label): void {
  ctx.b.text('A-ANNO-TEXT', l.position, l.text, l.size, { elementId: l.id, rotation: l.rotation, tag: 'label' });
}

export function drawDimensionElement(ctx: PlanContext, d: Dimension): void {
  const extra: { elementId: string; tag: string; textPosition?: Vec2 } = { elementId: d.id, tag: 'dimension' };
  if (!dimensionTextFits(d, ctx.scale, ctx.b.units)) extra.textPosition = outsideTextPosition(d, 'b', ctx.scale, ctx.b.units);
  ctx.b.dimension('A-ANNO-DIMS', d.a, d.b, d.offset, extra);
}

type Side = 'south' | 'north' | 'west' | 'east';

const SIDES: { side: Side; normal: Vec2; axis: Vec2 }[] = [
  { side: 'south', normal: { x: 0, y: -1 }, axis: { x: 1, y: 0 } },
  { side: 'north', normal: { x: 0, y: 1 }, axis: { x: 1, y: 0 } },
  { side: 'west', normal: { x: -1, y: 0 }, axis: { x: 0, y: 1 } },
  { side: 'east', normal: { x: 1, y: 0 }, axis: { x: 0, y: 1 } },
];

/** First chain distance from the building extent and spacing between chains, paper mm. */
export const CHAIN_FIRST = 9;
export const CHAIN_STEP = 7;

export interface DimensionChain {
  side: Side;
  kind: 'openings' | 'walls' | 'overall';
  /** Sorted positions along the side's axis, mm. */
  positions: number[];
}

/**
 * Automatic exterior dimension chains on each side of the building: openings (jambs), wall
 * structure (corners and interior wall junctions) and overall length, innermost first.
 */
export function exteriorChains(ctx: PlanContext): DimensionChain[] {
  const polys = ctx.outer;
  if (!polys.length) return [];
  const walls = ctx.elements.filter((e): e is Wall => e.type === 'wall');
  const openings = ctx.elements.filter((e): e is Opening => e.type === 'door' || e.type === 'window');
  const pts = polys.flat();
  const chains: DimensionChain[] = [];
  for (const { side, normal, axis } of SIDES) {
    const coord = (p: Vec2) => dot(p, axis);
    const lo = Math.min(...pts.map(coord));
    const hi = Math.max(...pts.map(coord));
    if (hi - lo < 1) continue;
    // Boundary edges facing this side.
    const facing: [Vec2, Vec2][] = [];
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        const d = normalize(sub(q, p));
        const out = { x: d.y, y: -d.x }; // outward normal of a CCW outline
        if (dot(out, normal) > 0.7) facing.push([p, q]);
      }
    }
    const corners = new Set<number>([lo, hi]);
    for (const [p, q] of facing) {
      corners.add(coord(p));
      corners.add(coord(q));
    }
    const nearFacing = (p: Vec2, tol: number) =>
      facing.some(([a, c]) => {
        const d = sub(c, a);
        const l2 = dot(d, d);
        const t = Math.max(0, Math.min(1, dot(sub(p, a), d) / l2));
        const proj = add(a, scale(d, t));
        return Math.hypot(p.x - proj.x, p.y - proj.y) <= tol;
      });
    // Exterior walls along this side: their outer face lies on a facing edge.
    const sideWalls = walls.filter((w) => {
      const dir = wallDirection(w);
      if (Math.abs(dot(dir, axis)) < 0.95) return false;
      const n = wallNormal(w);
      const f = wallFaceOffsets(w);
      const mid = scale(add(w.start, w.end), 0.5);
      const faceLat = dot(n, normal) > 0 ? f.left : f.right;
      return nearFacing(add(mid, scale(n, faceLat)), 5);
    });
    // Interior walls meeting those exterior walls (T junctions).
    const structure = new Set(corners);
    for (const w of walls) {
      if (sideWalls.includes(w)) continue;
      const dir = wallDirection(w);
      if (Math.abs(dot(dir, axis)) > 0.3) continue;
      const hits = [w.start, w.end].some((p) => sideWalls.some((sw) => nearWall(sw, p, w.thickness)));
      if (!hits) continue;
      const f = wallFaceOffsets(w);
      const n = wallNormal(w);
      const c = coord(w.start);
      structure.add(c + dot(n, axis) * f.left);
      structure.add(c + dot(n, axis) * f.right);
    }
    const jambs = new Set(corners);
    let hasOpening = false;
    for (const op of openings) {
      const host = sideWalls.find((w) => w.id === op.hostId);
      if (!host) continue;
      const fr = openingFrame(host, op);
      const ext = exteriorSide(ctx, fr);
      const lat = ext > 0 ? fr.left : fr.right;
      jambs.add(coord(fr.at(fr.a, lat)));
      jambs.add(coord(fr.at(fr.b, lat)));
      hasOpening = true;
    }
    const norm = (s: Set<number>) => {
      const v = [...s].filter((x) => x >= lo - 0.5 && x <= hi + 0.5).sort((a, b) => a - b);
      const out: number[] = [];
      for (const x of v) if (!out.length || x - out[out.length - 1] > 1) out.push(x);
      return out;
    };
    const overall = [lo, hi];
    const struct = norm(structure);
    const open = norm(jambs);
    const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= 1);
    if (hasOpening && open.length > 2) chains.push({ side, kind: 'openings', positions: open });
    if (struct.length > 2 && !same(struct, open)) chains.push({ side, kind: 'walls', positions: struct });
    chains.push({ side, kind: 'overall', positions: overall });
  }
  return chains;
}

function nearWall(w: Wall, p: Vec2, extra: number): boolean {
  const d = sub(w.end, w.start);
  const l2 = dot(d, d);
  if (l2 < 1) return false;
  const t = dot(sub(p, w.start), d) / l2;
  if (t < -0.01 || t > 1.01) return false;
  const lat = dot(sub(p, w.start), perp(normalize(d)));
  const f = wallFaceOffsets(w);
  return lat >= f.right - extra && lat <= f.left + extra;
}

/** Emit the chains as dimension entities placed outside `extent`. */
export function drawExteriorChains(ctx: PlanContext, extent: Bounds2): DimensionChain[] {
  const chains = exteriorChains(ctx);
  const polys = ctx.outer;
  const pts = polys.flat();
  const rank = new Map<Side, number>();
  for (const ch of chains) {
    const s = SIDES.find((x) => x.side === ch.side)!;
    const k = rank.get(ch.side) ?? 0;
    rank.set(ch.side, k + 1);
    // Base line: the building's extreme face on this side; dimension line outside the extent.
    const faceCoord = Math.max(...pts.map((p) => dot(p, s.normal)));
    const extentCoord = Math.max(
      dot({ x: extent.minX, y: extent.minY }, s.normal),
      dot({ x: extent.maxX, y: extent.maxY }, s.normal),
      dot({ x: extent.minX, y: extent.maxY }, s.normal),
      dot({ x: extent.maxX, y: extent.minY }, s.normal),
    );
    const lineCoord = Math.max(faceCoord, extentCoord) + mm(ctx, CHAIN_FIRST + k * CHAIN_STEP);
    const base = (t: number): Vec2 => add(scale(s.axis, t), scale(s.normal, faceCoord));
    const u = s.axis;
    // Offset is measured along perp(a→b) (left of the dimension direction).
    const offset = (lineCoord - faceCoord) * dot(s.normal, perp(u));
    const tag = `chain-${ch.side}-${ch.kind}`;
    const extensionLength = k === 0 ? CHAIN_FIRST - 2 : CHAIN_STEP - 1;
    const segs = ch.positions.slice(0, -1).map((t0, i) => {
      const t1 = ch.positions[i + 1];
      const text = formatDimension(t1 - t0, ctx.b.units);
      return { t0, t1, text, w: textWidth(text, DIM_STYLE.textHeight) * ctx.scale, fits: dimensionTextFits({ a: base(t0), b: base(t1) }, ctx.scale, ctx.b.units) };
    });
    // Text placement along the chain: fitting texts first, the others outside the segment where
    // there is room (after, before), else on a second row above.
    const pad = mm(ctx, 0.8);
    const rows: [number, number][][] = [[], []];
    const free = (row: number, lo: number, hi: number) => rows[row].every(([a, b]) => hi + pad <= a || lo - pad >= b);
    const pos: (null | { t: number; row: number })[] = segs.map(() => null);
    segs.forEach((g) => {
      if (!g.fits) return;
      const m = (g.t0 + g.t1) / 2;
      rows[0].push([m - g.w / 2, m + g.w / 2]);
    });
    segs.forEach((g, i) => {
      if (g.fits) return;
      const gap = mm(ctx, 1.6);
      const after = { t: g.t1 + gap + g.w / 2, row: 0 };
      const before = { t: g.t0 - gap - g.w / 2, row: 0 };
      // The first segment's text goes outside the chain's start, the others after their end.
      const cands = [...(i === 0 ? [before, after] : [after, before]), { t: (g.t0 + g.t1) / 2, row: 1 }];
      const pick = cands.find((c) => free(c.row, c.t - g.w / 2, c.t + g.w / 2)) ?? cands[2];
      rows[pick.row].push([pick.t - g.w / 2, pick.t + g.w / 2]);
      pos[i] = pick;
    });
    const angle = readableAngle((Math.atan2(u.y, u.x) * 180) / Math.PI);
    const up = { x: Math.cos(((angle + 90) * Math.PI) / 180), y: Math.sin(((angle + 90) * Math.PI) / 180) };
    segs.forEach((g, i) => {
      const extra: { tag: string; textPosition?: Vec2; extensionLength: number } = { tag, extensionLength };
      const p = pos[i];
      if (p) {
        const lift = (DIM_STYLE.textGap + DIM_STYLE.textHeight / 2 + p.row * (DIM_STYLE.textHeight + 0.8)) * ctx.scale;
        extra.textPosition = add(add(base(p.t), scale(s.normal, lineCoord - faceCoord)), scale(up, lift));
      }
      ctx.b.dimension('A-ANNO-DIMS', base(g.t0), base(g.t1), offset, extra);
    });
  }
  return chains;
}

/** North arrow centred at `c` (model), pointing to geographic north. */
export function drawNorthArrow(ctx: PlanContext, c: Vec2): void {
  const { b } = ctx;
  const r = mm(ctx, 7);
  const north = ctx.project.settings.northAngle ?? 0;
  const R = (p: Vec2) => add(rotate(p, north), c);
  b.circle('A-ANNO-SYMB', c, r, { tag: 'north-arrow', lineweight: PEN.thin });
  const tip = R({ x: 0, y: r * 0.95 });
  const tail = R({ x: 0, y: -r * 0.95 });
  const left = R({ x: -r * 0.38, y: -r * 0.62 });
  const right = R({ x: r * 0.38, y: -r * 0.62 });
  const notch = R({ x: 0, y: -r * 0.35 });
  b.fill('A-ANNO-SYMB', [tip, notch, right], '#000000', { tag: 'north-arrow', stroke: true });
  b.polyline('A-ANNO-SYMB', [tip, left, notch], true, { tag: 'north-arrow' });
  b.line('A-ANNO-SYMB', notch, tail, { tag: 'north-arrow', lineweight: PEN.fine });
  b.text('A-ANNO-SYMB', R({ x: 0, y: r + mm(ctx, 3.2) }), 'N', TEXT.large, { tag: 'north-arrow', bold: true, rotation: 0 });
}

/** Graphic scale bar with its left end at `at` (model, baseline of the bar). Returns its width. */
export function drawScaleBar(b: DrawingBuilder, scale: number, at: Vec2, layer = 'A-ANNO-SYMB'): number {
  const units = [100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];
  const unit = units.find((u) => (5 * u) / scale >= 35) ?? units[units.length - 1];
  const h = 1.4 * scale;
  for (let i = 0; i < 5; i++) {
    const x0 = at.x + i * unit;
    const box = [
      { x: x0, y: at.y },
      { x: x0 + unit, y: at.y },
      { x: x0 + unit, y: at.y + h },
      { x: x0, y: at.y + h },
    ];
    b.fill(layer, box, i % 2 === 0 ? '#000000' : '#ffffff', { tag: 'scale-bar', stroke: true, lineweight: PEN.fine });
  }
  const fmt = (v: number) => (unit >= 1000 ? `${+(v / 1000).toFixed(2)}` : `${v}`);
  for (let i = 0; i <= 5; i++) {
    b.text(layer, { x: at.x + i * unit, y: at.y + h + scale }, i === 5 ? `${fmt(i * unit)} ${unit >= 1000 ? 'm' : 'mm'}` : fmt(i * unit), TEXT.tiny, {
      tag: 'scale-bar',
      valign: 'bottom',
      align: i === 5 ? 'left' : 'center',
    });
  }
  return 5 * unit;
}

/** View title under a drawing: "GROUND FLOOR PLAN" + "SCALE 1:100" and a scale bar. */
export function drawViewTitle(b: DrawingBuilder, scale: number, title: string, at: Vec2, withScaleBar: boolean, layer = 'A-ANNO-SYMB'): void {
  const h = TEXT.large;
  b.text(layer, at, title, h, { tag: 'view-title', bold: true, align: 'left', valign: 'baseline' });
  const w = textWidth(title, h, true) * scale;
  const under = at.y - 1.6 * scale;
  b.line(layer, { x: at.x, y: under }, { x: at.x + w, y: under }, { tag: 'view-title', lineweight: PEN.thick });
  b.text(layer, { x: at.x, y: under - 1.6 * scale }, `SCALE 1:${scale}`, TEXT.small, { tag: 'view-scale', align: 'left', valign: 'top' });
  if (withScaleBar) drawScaleBar(b, scale, { x: at.x + Math.max(w, 30 * scale) + 12 * scale, y: under - 4 * scale }, layer);
}
