/**
 * Stair plan symbols (A-FLOR-STRS): treads from computeStairLayout, a 30° break line at the plan
 * cut plane with the treads above it dashed, the walk line with an arrow and an UP / DN label.
 */
import { add, centroid, distance, dot, normalize, perp, rotate, scale, sub } from '../../core/math2d';
import { computeStairLayout, type StairStep } from '../../core/stairs';
import type { Stair, Vec2 } from '../../core/types';
import { chainSegments, type Segment } from '../geom';
import { PEN, TEXT } from '../layers';
import { mm, type PlanContext } from './context';

const LAYER = 'A-FLOR-STRS';

interface Cut {
  /** A point on the break line. */
  at: Vec2;
  /** Break line direction. */
  dir: Vec2;
  /** Normal pointing to the part of the flight above the cut plane. */
  beyond: Vec2;
  halfLength: number;
}

/** Split consecutive treads into flights (a landing or turn separates them). */
export function stairFlights(treads: StairStep[], going: number): number[][] {
  const flights: number[][] = [];
  let cur: number[] = [];
  let prev: Vec2 | null = null;
  treads.forEach((t, i) => {
    const c = centroid(t.polygon);
    if (prev && distance(prev, c) > going * 1.5) {
      flights.push(cur);
      cur = [];
    }
    cur.push(i);
    prev = c;
  });
  if (cur.length) flights.push(cur);
  return flights;
}

function polygonEdges(poly: Vec2[]): Segment[] {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]] as Segment);
}

/** Split segments by a half-plane into [before, beyond]. */
function splitByCut(segs: Segment[], cut: Cut): [Segment[], Segment[]] {
  const before: Segment[] = [];
  const beyond: Segment[] = [];
  for (const [p, q] of segs) {
    const sp = dot(sub(p, cut.at), cut.beyond);
    const sq = dot(sub(q, cut.at), cut.beyond);
    if (sp <= 0 && sq <= 0) before.push([p, q]);
    else if (sp >= 0 && sq >= 0) beyond.push([p, q]);
    else {
      const m = add(p, scale(sub(q, p), sp / (sp - sq)));
      if (sp < 0) {
        before.push([p, m]);
        beyond.push([m, q]);
      } else {
        beyond.push([p, m]);
        before.push([m, q]);
      }
    }
  }
  return [before, beyond];
}

/**
 * Draw a stair. `mode` 'up' = the stair starts on this level (cut at the plan cut plane);
 * 'down' = the stair arrives from the level below (seen from above, fully visible, labelled DN).
 */
export function drawStair(ctx: PlanContext, s: Stair, mode: 'up' | 'down', levelHeight: number): void {
  const { b } = ctx;
  const layout = computeStairLayout(s, levelHeight);
  const treads = layout.treads;
  const id = { elementId: s.id };
  if (!treads.length) return;
  const cutIdx = mode === 'up' ? treads.findIndex((t) => t.top > ctx.cut) : -1;
  let cut: Cut | null = null;
  let cutFlight: number[] = [];
  if (cutIdx >= 0) {
    const flights = s.shape === 'spiral' ? [treads.map((_, i) => i)] : stairFlights(treads, s.tread);
    cutFlight = flights.find((f) => f.includes(cutIdx)) ?? [];
    cut = breakLine(s, treads, cutIdx, cutFlight);
  }
  const hidden = { linetype: 'hidden' as const, lineweight: PEN.fine };
  treads.forEach((t, i) => {
    const tag = `tread-${i}`;
    if (!cut || (s.shape !== 'spiral' && !cutFlight.includes(i)) || s.shape === 'spiral') {
      const above = cut ? i >= cutIdx : false;
      b.polyline(LAYER, t.polygon, true, { ...id, tag, ...(above ? hidden : {}) });
      return;
    }
    const [before, beyond] = splitByCut(polygonEdges(t.polygon), cut);
    for (const c of chainSegments(before, 0.01)) b.polyline(LAYER, c.points, c.closed, { ...id, tag });
    for (const c of chainSegments(beyond, 0.01)) b.polyline(LAYER, c.points, c.closed, { ...id, tag, ...hidden });
  });
  for (const l of layout.landings) {
    const above = cut ? l.top > ctx.cut : false;
    b.polyline(LAYER, l.polygon, true, { ...id, tag: 'landing', ...(above ? hidden : {}) });
  }
  if (cut) drawBreak(ctx, cut, s.id);
  drawWalkline(ctx, s, layout.walkline, mode);
}

function breakLine(s: Stair, treads: StairStep[], cutIdx: number, flight: number[]): Cut {
  const c = centroid(treads[cutIdx].polygon);
  if (s.shape === 'spiral') {
    // Radial break along the leading edge of the cut tread.
    const dir = normalize(sub(c, s.position));
    const tangent = perp(dir);
    const sign = s.turn === 'right' ? -1 : 1;
    const lead = rotate(dir, -sign * 13.5);
    return { at: add(s.position, scale(lead, s.width / 2)), dir: lead, beyond: scale(tangent, sign), halfLength: s.width / 2 };
  }
  const k = flight.indexOf(cutIdx);
  const other = flight[k + 1] ?? flight[k - 1];
  let f: Vec2;
  if (other !== undefined) {
    const oc = centroid(treads[other].polygon);
    f = normalize(other > cutIdx ? sub(oc, c) : sub(c, oc));
  } else {
    f = { x: Math.cos((s.rotation * Math.PI) / 180), y: Math.sin((s.rotation * Math.PI) / 180) };
  }
  const lat = perp(f);
  const front = sub(c, scale(f, s.tread / 2));
  const dir = normalize(add(scale(lat, Math.cos(Math.PI / 6)), scale(f, Math.sin(Math.PI / 6))));
  let beyond = perp(dir);
  if (dot(beyond, f) < 0) beyond = scale(beyond, -1);
  return { at: front, dir, beyond, halfLength: s.width / 2 / Math.cos(Math.PI / 6) };
}

function drawBreak(ctx: PlanContext, cut: Cut, elementId: string): void {
  const z = mm(ctx, 1.2);
  const L = cut.halfLength + mm(ctx, 1);
  const P = (t: number, n = 0) => add(add(cut.at, scale(cut.dir, t)), scale(cut.beyond, n));
  // Double break line with a "Z" in the middle (ISO 128 cut symbol on stairs).
  const pts = [P(-L), P(-z), P(-z / 3, z), P(z / 3, -z), P(z), P(L)];
  ctx.b.polyline(LAYER, pts, false, { elementId, tag: 'break', lineweight: PEN.thin });
}

function drawWalkline(ctx: PlanContext, s: Stair, walk: Vec2[], mode: 'up' | 'down'): void {
  if (walk.length < 2) return;
  const { b } = ctx;
  const pts = mode === 'down' ? [...walk].reverse() : walk;
  const id = { elementId: s.id };
  const end = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const dir = normalize(sub(end, prev));
  const al = mm(ctx, 2.6);
  const aw = mm(ctx, 0.9);
  const base = sub(end, scale(dir, al));
  b.polyline(LAYER, [...pts.slice(0, -1), base], false, { ...id, tag: 'walkline', lineweight: PEN.fine });
  b.fill(LAYER, [end, add(base, scale(perp(dir), aw)), add(base, scale(perp(dir), -aw))], '#000000', { ...id, tag: 'arrow' });
  b.circle(LAYER, pts[0], mm(ctx, 0.7), { ...id, tag: 'walkline-start', lineweight: PEN.fine });
  const d0 = normalize(sub(pts[1], pts[0]));
  const labelAt = sub(pts[0], scale(d0, mm(ctx, 3.2)));
  b.text('A-ANNO-TEXT', labelAt, mode === 'up' ? 'UP' : 'DN', TEXT.small, { ...id, tag: 'stair-label', bold: true });
}

/** Railing in plan: a 50 mm band along its path. */
export function drawRailing(ctx: PlanContext, path: Vec2[], elementId: string): void {
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const c = path[i + 1];
    if (distance(a, c) < 1) continue;
    const n = scale(perp(normalize(sub(c, a))), 25);
    ctx.b.polyline('A-FLOR-HRAL', [add(a, n), add(c, n), sub(c, n), sub(a, n)], true, { elementId, tag: 'railing' });
  }
}
