/**
 * Slabs (A-FLOR), roofs (A-ROOF), columns (S-COLS), beams (S-BEAM), structural grid (S-GRID) and
 * free-form blocks (A-GENM) in plan.
 */
import { add, distance, dot, normalize, perp, rotate, scale, sub } from '../../core/math2d';
import { getMaterial } from '../../core/materials';
import type { Beam, Block, Column, Roof, Slab, Vec2 } from '../../core/types';
import { ellipsePoints, offsetPolygon } from '../geom';
import { PEN, TEXT } from '../layers';
import { mm, type PlanContext } from './context';

export function drawSlab(ctx: PlanContext, s: Slab): void {
  const { b } = ctx;
  if (s.outline.length < 3 || s.kind === 'ceiling') return;
  const auto = s.props?.autogen === true;
  const id = { elementId: s.id };
  if (!auto) {
    const extra = s.kind === 'foundation' ? { linetype: 'hidden' as const, lineweight: PEN.fine, tag: 'foundation' } : { tag: s.kind };
    b.polyline('A-FLOR', s.outline, true, { ...id, ...extra });
  }
  for (const h of s.holes ?? []) {
    if (h.length < 3) continue;
    b.polyline('A-FLOR', h, true, { ...id, tag: 'slab-opening', lineweight: PEN.thin });
    // "Open to below" cross.
    if (h.length >= 4) {
      b.line('A-FLOR', h[0], h[2], { ...id, tag: 'void-cross', lineweight: PEN.extraFine });
      b.line('A-FLOR', h[1], h[3], { ...id, tag: 'void-cross', lineweight: PEN.extraFine });
    }
  }
}

/** Roof above the cut plane: eave outline with overhang, plus ridge / hip lines. */
export function drawRoof(ctx: PlanContext, r: Roof): void {
  const { b } = ctx;
  if (r.outline.length < 3) return;
  const id = { elementId: r.id };
  const eave = r.overhang > 0 ? offsetPolygon(r.outline, r.overhang) : r.outline;
  b.polyline('A-ROOF', eave, true, { ...id, tag: 'eave' });
  if (r.shape === 'flat') return;
  // Pitched shapes use the bounding rectangle aligned with the ridge direction.
  const u = { x: Math.cos((r.ridgeAngle * Math.PI) / 180), y: Math.sin((r.ridgeAngle * Math.PI) / 180) };
  const v = perp(u);
  let u0 = Infinity;
  let u1 = -Infinity;
  let v0 = Infinity;
  let v1 = -Infinity;
  for (const p of r.outline) {
    u0 = Math.min(u0, dot(p, u));
    u1 = Math.max(u1, dot(p, u));
    v0 = Math.min(v0, dot(p, v));
    v1 = Math.max(v1, dot(p, v));
  }
  const o = r.overhang;
  u0 -= o;
  u1 += o;
  v0 -= o;
  v1 += o;
  const P = (a: number, c: number): Vec2 => add(scale(u, a), scale(v, c));
  const vm = (v0 + v1) / 2;
  const um = (u0 + u1) / 2;
  const line = (p: Vec2, q: Vec2, tag: string) => b.line('A-ROOF', p, q, { ...id, tag, linetype: 'center', lineweight: PEN.fine });
  if (r.shape === 'gable') line(P(u0, vm), P(u1, vm), 'ridge');
  else if (r.shape === 'hip') {
    const h = (v1 - v0) / 2;
    const ra = Math.min(u0 + h, um);
    const rb = Math.max(u1 - h, um);
    line(P(ra, vm), P(rb, vm), 'ridge');
    line(P(u0, v0), P(ra, vm), 'hip');
    line(P(u0, v1), P(ra, vm), 'hip');
    line(P(u1, v0), P(rb, vm), 'hip');
    line(P(u1, v1), P(rb, vm), 'hip');
  } else if (r.shape === 'pyramid') {
    for (const c of [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)]) line(c, P(um, vm), 'hip');
  }
}

export function columnOutline(c: Column): Vec2[] {
  if (c.shape === 'round') return ellipsePoints(c.position, c.width / 2, c.depth / 2, 40);
  const hw = c.width / 2;
  const hd = c.depth / 2;
  return [
    { x: -hw, y: -hd },
    { x: hw, y: -hd },
    { x: hw, y: hd },
    { x: -hw, y: hd },
  ].map((p) => add(rotate(p, c.rotation), c.position));
}

export function drawColumn(ctx: PlanContext, c: Column): void {
  const { b } = ctx;
  const id = { elementId: c.id };
  const h = c.height ?? ctx.level.height;
  const isCut = c.baseOffset <= ctx.cut && c.baseOffset + h > ctx.cut;
  if (c.shape === 'round' && Math.abs(c.width - c.depth) < 1) {
    b.circle('S-COLS', c.position, c.width / 2, { ...id, ...(isCut ? { fill: '#000000' } : { lineweight: PEN.thin, linetype: 'hidden' }), tag: 'column' });
    return;
  }
  const outline = columnOutline(c);
  if (isCut) {
    const mat = getMaterial(c.materialId ?? 'concrete');
    b.fill('S-COLS', outline, '#000000', { ...id, stroke: true, tag: 'column', ...(mat.category === 'wood' ? { fill: '#ffffff', hatch: 'wood' as const } : {}) });
  } else b.polyline('S-COLS', outline, true, { ...id, lineweight: PEN.thin, linetype: 'hidden', tag: 'column' });
}

export function drawBeam(ctx: PlanContext, bm: Beam): void {
  if (distance(bm.start, bm.end) < 1) return;
  const n = scale(perp(normalize(sub(bm.end, bm.start))), bm.width / 2);
  ctx.b.polyline('S-BEAM', [add(bm.start, n), add(bm.end, n), sub(bm.end, n), sub(bm.start, n)], true, { elementId: bm.id, tag: 'beam' });
}

export function blockOutline(k: Block): Vec2[] {
  const o = { x: k.position.x, y: k.position.y };
  if (k.shape === 'cylinder' || k.shape === 'sphere') {
    const c = add(o, rotate({ x: k.size.x / 2, y: k.size.y / 2 }, k.rotation));
    return ellipsePoints(c, k.size.x / 2, k.size.y / 2, 40).map((p) => add(rotate(sub(p, c), k.rotation), c));
  }
  return [
    { x: 0, y: 0 },
    { x: k.size.x, y: 0 },
    { x: k.size.x, y: k.size.y },
    { x: 0, y: k.size.y },
  ].map((p) => add(rotate(p, k.rotation), o));
}

export function drawBlock(ctx: PlanContext, k: Block): void {
  const isCut = k.position.z <= ctx.cut && k.position.z + k.size.z > ctx.cut;
  const above = k.position.z > ctx.cut;
  const outline = blockOutline(k);
  const mat = getMaterial(k.materialId ?? 'brick-red');
  const id = { elementId: k.id, tag: 'block' };
  if (isCut) {
    const hatch = mat.hatch === 'none' ? undefined : mat.hatch;
    ctx.b.fill('A-GENM', outline, hatch ? '#ffffff' : '#c8c8c8', { ...id, stroke: true, lineweight: PEN.thick, ...(hatch ? { hatch } : {}) });
  } else ctx.b.polyline('A-GENM', outline, true, { ...id, ...(above ? { linetype: 'hidden' as const, lineweight: PEN.fine } : {}) });
}

/** Structural grid through distinct column centres, with lettered / numbered bubbles. */
export function drawGrid(ctx: PlanContext, columns: Column[], extent: { minX: number; minY: number; maxX: number; maxY: number }): void {
  const { b } = ctx;
  const cluster = (vals: number[]) => {
    const out: number[] = [];
    for (const v of [...vals].sort((x, y) => x - y)) if (!out.length || v - out[out.length - 1] > 50) out.push(v);
    return out;
  };
  const xs = cluster(columns.map((c) => c.position.x));
  const ys = cluster(columns.map((c) => c.position.y));
  const over = mm(ctx, 8);
  const r = mm(ctx, 3.5);
  const bubble = (p: Vec2, label: string) => {
    b.circle('S-GRID', p, r, { linetype: 'continuous', tag: 'grid-bubble' });
    b.text('S-GRID', p, label, TEXT.normal, { tag: 'grid-label' });
  };
  xs.forEach((x, i) => {
    const y0 = extent.minY - over;
    const y1 = extent.maxY + over;
    b.line('S-GRID', { x, y: y0 }, { x, y: y1 }, { tag: 'grid-line' });
    bubble({ x, y: y1 + r }, `${i + 1}`);
    bubble({ x, y: y0 - r }, `${i + 1}`);
  });
  ys.forEach((y, i) => {
    const x0 = extent.minX - over;
    const x1 = extent.maxX + over;
    b.line('S-GRID', { x: x0, y }, { x: x1, y }, { tag: 'grid-line' });
    const label = String.fromCharCode(65 + (i % 26)) + (i >= 26 ? `${Math.floor(i / 26)}` : '');
    bubble({ x: x0 - r, y }, label);
    bubble({ x: x1 + r, y }, label);
  });
}
