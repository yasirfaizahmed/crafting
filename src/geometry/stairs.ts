/**
 * Stairs from `computeStairLayout`, following the stair's construction settings:
 *  - structure 'solid' (default for masonry/concrete/stone) → monolithic flights: sawtooth steps over
 *    a sloped soffit, and solid landing slabs;
 *  - structure 'stringers' (default for wood/metal) → stringers on both sides, nosed treads, closed or
 *    open risers, and platform landings on posts;
 *  - spirals → a central column, wedge treads and a helical outer handrail.
 * Handrails follow `handrails` (or the legacy `props.handrail`): along each flight, and as guards on
 * the open edges of every landing (including the well of a half-turn landing).
 * Each flight is modelled in its own frame: x = direction of travel, y = left, z up from the
 * floor/landing it starts on. Parts are named (treads, risers, stringers, landings, posts,
 * balusters, handrail) so their materials can be overridden.
 */
import { add, angleDeg, dirFromDeg, normalize, perp, scale, sub } from '../core/math2d';
import { getMaterial, materialFor } from '../core/materials';
import { computeStairLayout, type StairFlight, type StairLayout } from '../core/stairs';
import type { Stair, Vec2 } from '../core/types';
import { levelElevation, levelHeight } from './cache';
import { Model, placement, type P3 } from './model';
import type { GeometryContext, GeometryPart } from './types';

type RailSides = { left: boolean; right: boolean };

/** Resolved construction settings of a stair. */
interface Build {
  mat: string;
  railMat: string;
  solid: boolean;
  closedRisers: boolean;
  /** Timber-style posts and balusters (square) rather than slim metal ones (round). */
  timber: boolean;
  nosing: number;
  treadThickness: number;
  stringerThickness: number;
  landingThickness: number;
  railHeight: number;
  /** Clear gap between balusters, mm. */
  gap: number;
  rails: RailSides;
}

function railSides(stair: Stair): RailSides {
  const v = stair.handrails ?? stair.props?.handrail;
  if (v === 'none' || v === false) return { left: false, right: false };
  if (v === 'left') return { left: true, right: false };
  if (v === 'right') return { left: false, right: true };
  return { left: true, right: true };
}

function resolveBuild(stair: Stair): Build {
  const mat = materialFor(stair).id;
  const category = getMaterial(mat).category;
  const woodOrMetal = category === 'wood' || category === 'metal';
  const solid = stair.structure === 'solid' || (stair.structure !== 'stringers' && !woodOrMetal);
  return {
    mat,
    railMat: woodOrMetal ? mat : 'metal-black',
    solid,
    closedRisers: stair.risers === 'closed' || (stair.risers !== 'open' && category !== 'metal'),
    timber: category !== 'metal',
    nosing: Math.max(0, stair.nosing ?? 25),
    treadThickness: Math.max(10, stair.treadThickness ?? 40),
    stringerThickness: Math.max(10, stair.stringerThickness ?? 45),
    landingThickness: Math.max(20, stair.landingThickness ?? (solid ? 200 : 120)),
    railHeight: Math.max(300, stair.railHeight ?? 900),
    gap: Math.max(30, stair.balusterSpacing ?? 110),
    rails: railSides(stair),
  };
}

export function buildStair(ctx: GeometryContext, stair: Stair): GeometryPart[] {
  if (!(stair.width > 0) || !(stair.tread > 0)) return [];
  const layout = computeStairLayout(stair, levelHeight(ctx, stair.levelId));
  const z0 = levelElevation(ctx, stair.levelId);
  const b = resolveBuild(stair);
  const m = new Model(undefined, b.mat);
  if (stair.shape === 'spiral' && !layout.runs) {
    spiral(m, stair, layout, z0, b);
    return m.parts();
  }
  for (const fl of layout.flights ?? []) {
    const n = fl.treadIndices.length;
    if (!n) continue;
    m.group(placement(fl.start.x, fl.start.y, z0 + fl.base, angleDeg(fl.direction)), () => {
      if (b.solid) solidFlight(m, fl, n, b);
      else timberFlight(m, fl, n, b);
      flightRails(m, fl, n, b);
    });
  }
  layout.landings.forEach((l, i) => {
    const top = z0 + l.top;
    const t = Math.min(b.landingThickness, l.top);
    m.use(b.mat, 'body', 'landings');
    m.prism(l.polygon, top - t, top);
    if (!b.solid) {
      // Posts under the landing corners.
      m.use(b.mat, 'body', 'posts');
      const cx = l.polygon.reduce((s, p) => s + p.x, 0) / l.polygon.length;
      const cy = l.polygon.reduce((s, p) => s + p.y, 0) / l.polygon.length;
      for (const p of l.polygon) {
        const dx = cx - p.x;
        const dy = cy - p.y;
        const d = Math.hypot(dx, dy) || 1;
        m.boxC(p.x + (dx / d) * 60, p.y + (dy / d) * 60, z0, 80, 80, l.top - t);
      }
    }
    for (const edge of landingGuardEdges(layout, i)) {
      if (b.rails[edge.side]) guardRail(m, edge.a, edge.b, top, inwardOf(edge, l.polygon), b);
    }
  });
  return m.parts();
}

/**
 * Monolithic flight: sawtooth steps over a sloped soffit, extruded across the width. Flights that
 * start on a landing let the soffit run down to the landing's underside.
 */
function solidFlight(m: Model, fl: StairFlight, n: number, b: Build): void {
  const g = fl.going;
  const r = fl.riserHeight;
  const W = fl.width / 2;
  const cosA = g / Math.hypot(g, r);
  const waist = Math.max(150, r * cosA + 40);
  const wv = waist / cosA;
  const bottom = -Math.min(b.landingThickness, Math.max(0, fl.base));
  const soffit = (x: number) => r + (x * r) / g - wv;
  const xb = ((bottom - r + wv) * g) / r;
  const run = n * g;
  const profile: [number, number][] = [];
  if (xb <= 0) profile.push([0, soffit(0)], [run, soffit(run)]);
  else if (xb < run - 1) profile.push([0, bottom], [xb, bottom], [run, soffit(run)]);
  else profile.push([0, bottom], [run, bottom]);
  for (let i = n; i >= 1; i--) profile.push([i * g, i * r], [(i - 1) * g, i * r]);
  m.use(b.mat, 'body', 'treads');
  m.prismY(profile, -W, W);
}

/** Stringers, nosed treads and (closed) risers. */
function timberFlight(m: Model, fl: StairFlight, n: number, b: Build): void {
  const g = fl.going;
  const r = fl.riserHeight;
  const W = fl.width / 2;
  const run = n * g;
  const st = Math.min(b.stringerThickness, W / 4);
  const top = (n + 1) * r;
  const depth = 260;
  const xb = ((depth - r) * g) / r;
  const profile: [number, number][] = [[0, 0]];
  if (xb > 0 && xb < run - 1) profile.push([xb, 0], [run, top - depth]);
  else if (xb >= run - 1) profile.push([run, 0]);
  else profile.push([run, Math.max(0, top - depth)]);
  profile.push([run, top], [0, Math.min(top, r + 50)]);
  m.use(b.mat, 'body', 'stringers');
  m.prismY(profile, -W, -W + st);
  m.prismY(profile, W - st, W);
  const tt = Math.min(b.treadThickness, r * 0.8);
  m.use(b.mat, 'body', 'treads');
  for (let i = 0; i < n; i++) {
    const zt = (i + 1) * r;
    m.box(i * g - (i === 0 ? 0 : b.nosing), -W + st, zt - tt, (i + 1) * g, W - st, zt);
  }
  if (!b.closedRisers) return;
  m.use(b.mat, 'body', 'risers');
  for (let i = 0; i < n; i++) m.box(i * g, -W + st, Math.max(0, i * r - tt), i * g + 18, W - st, (i + 1) * r - tt);
  // Last riser up to the landing / floor above.
  m.box(run, -W + st, Math.max(0, n * r - tt), run + 18, W - st, top - tt);
}

function flightRails(m: Model, fl: StairFlight, n: number, b: Build): void {
  if (!b.rails.left && !b.rails.right) return;
  const g = fl.going;
  const r = fl.riserHeight;
  const W = fl.width / 2;
  const run = n * g;
  const pitch = (x: number) => r + (x * r) / g; // nosing line
  const railZ = (x: number) => pitch(x) + b.railHeight;
  const inset = b.timber ? 22 : 30;
  const post = b.timber ? 80 : 40;
  const bw = b.timber ? 32 : 16;
  for (const [on, s] of [
    [b.rails.left, 1],
    [b.rails.right, -1],
  ] as const) {
    if (!on) continue;
    const y = s * (W - inset);
    const x0 = Math.min(40, run / 4);
    const x1 = Math.max(x0 + 1, run - 40);
    m.use(b.railMat, 'detail', 'posts');
    m.boxC(x0, y, 0, post, post, Math.max(r, railZ(x0) + 60));
    m.boxC(x1, y, pitch(x1) - r, post, post, Math.max(r, railZ(x1) + 60 - (pitch(x1) - r)));
    // Balusters: as many per tread as the clear gap allows.
    m.use(b.railMat, 'detail', 'balusters');
    const per = Math.max(1, Math.ceil(g / (b.gap + bw)));
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < per; k++) {
        const x = i * g + ((k + 0.5) * g) / per;
        if (x < x0 + post / 2 + 10 || x > x1 - post / 2 - 10) continue;
        const zb = (i + 1) * r;
        const zt = railZ(x) - 20;
        if (b.timber) m.boxC(x, y, zb, bw, bw, zt - zb);
        else m.cylinder(x, y, zb, zt, bw / 2, 8);
      }
    }
    m.use(b.railMat, 'detail', 'handrail');
    const a: P3 = [x0, y, railZ(x0) + 20];
    const c: P3 = [x1, y, railZ(x1) + 20];
    if (b.timber) m.bar(a, c, 55, 45);
    else m.tube(a, c, 22, 10);
  }
}

interface GuardEdge {
  a: Vec2;
  b: Vec2;
  /** Which handrail setting (looking up the stair) this edge belongs to. */
  side: 'left' | 'right';
}

/**
 * Open edges of landing `i` that need a guard: the sides of straight landings, the outside of a
 * turn, the unused part of a quarter landing's inside edge and the well of a half turn.
 */
export function landingGuardEdges(layout: StairLayout, i: number): GuardEdge[] {
  const runs = layout.runs;
  const fin = layout.flights?.[i];
  if (!runs || !fin) return [];
  const spec = runs.landings[i];
  const wIn = runs.flights[i].width;
  const wOut = runs.flights[i + 1]?.width ?? wIn;
  const d = fin.direction;
  const left = perp(d);
  const E = add(fin.start, scale(d, fin.treadIndices.length * fin.going));
  const at = (f: number, l: number): Vec2 => add(E, add(scale(d, f), scale(left, l)));
  const D = spec.depth;
  const out: GuardEdge[] = [];
  if (spec.turn === 'none') {
    const h = Math.max(wIn, wOut) / 2;
    out.push({ a: at(0, h), b: at(D, h), side: 'left' }, { a: at(0, -h), b: at(D, -h), side: 'right' });
    return out;
  }
  const s = spec.turn === 'left' ? 1 : -1;
  const outside: GuardEdge['side'] = s > 0 ? 'right' : 'left';
  const inside: GuardEdge['side'] = s > 0 ? 'left' : 'right';
  if (spec.angle === 90) {
    out.push({ a: at(D, -wIn / 2), b: at(D, wIn / 2), side: outside }, { a: at(0, (-s * wIn) / 2), b: at(D, (-s * wIn) / 2), side: outside });
    if (D - wOut > 1) out.push({ a: at(0, (s * wIn) / 2), b: at(D - wOut, (s * wIn) / 2), side: inside });
    return out;
  }
  const off = s * (wIn / 2 + spec.gap + wOut / 2);
  const l0 = (-s * wIn) / 2;
  const l1 = off + (s * wOut) / 2;
  out.push(
    { a: at(D, l0), b: at(D, l1), side: outside },
    { a: at(0, l0), b: at(D, l0), side: outside },
    { a: at(0, l1), b: at(D, l1), side: outside },
  );
  if (spec.gap > 1) out.push({ a: at(0, (s * wIn) / 2), b: at(0, s * (wIn / 2 + spec.gap)), side: inside });
  return out;
}

/** Unit normal of the edge pointing into the landing. */
function inwardOf(e: GuardEdge, poly: Vec2[]): Vec2 {
  const n = perp(normalize(sub(e.b, e.a)));
  const c = poly.reduce((acc, p) => add(acc, scale(p, 1 / poly.length)), { x: 0, y: 0 });
  const mid = scale(add(e.a, e.b), 0.5);
  return (c.x - mid.x) * n.x + (c.y - mid.y) * n.y >= 0 ? n : scale(n, -1);
}

/** Posts, balusters and a level top rail along a landing edge (plan mm, at elevation z). */
function guardRail(m: Model, a0: Vec2, b0: Vec2, z: number, inward: Vec2, b: Build): void {
  const a = add(a0, scale(inward, 30));
  const c = add(b0, scale(inward, 30));
  const len = Math.hypot(c.x - a.x, c.y - a.y);
  if (len < 50) return;
  const post = b.timber ? 80 : 40;
  const bw = b.timber ? 32 : 16;
  const top = z + b.railHeight;
  m.use(b.railMat, 'detail', 'posts');
  for (const p of [a, c]) m.boxC(p.x, p.y, z, post, post, b.railHeight + 60);
  m.use(b.railMat, 'detail', 'balusters');
  const count = Math.max(0, Math.floor((len - post) / (b.gap + bw)));
  for (let k = 1; k <= count; k++) {
    const t = k / (count + 1);
    const p = add(a, scale(sub(c, a), t));
    if (b.timber) m.boxC(p.x, p.y, z, bw, bw, b.railHeight - 20);
    else m.cylinder(p.x, p.y, z, top - 20, bw / 2, 8);
  }
  m.use(b.railMat, 'detail', 'handrail');
  const pa: P3 = [a.x, a.y, top + 20];
  const pc: P3 = [c.x, c.y, top + 20];
  if (b.timber) m.bar(pa, pc, 55, 45);
  else m.tube(pa, pc, 22, 10);
}

function spiral(m: Model, stair: Stair, layout: StairLayout, z0: number, b: Build): void {
  const c = stair.position;
  const outer = stair.width;
  const inner = Math.min(outer * 0.6, stair.innerRadius ?? 100);
  m.use(b.mat, 'body', 'posts');
  m.cylinder(c.x, c.y, z0, z0 + layout.rise + b.railHeight, Math.max(40, inner), 20);
  const tt = Math.min(b.treadThickness + 10, layout.riserHeight * 0.4);
  m.use(b.mat, 'body', 'treads');
  for (const t of layout.treads) m.prism(t.polygon, z0 + t.top - tt, z0 + t.top);
  if (!b.rails.left && !b.rails.right) return;
  // Helical outer rail with one baluster per tread.
  const sign = stair.turn === 'right' ? -1 : 1;
  const step = 27;
  const rr = outer - 30;
  const pts: P3[] = [];
  m.use(b.railMat, 'detail', 'balusters');
  layout.treads.forEach((t, i) => {
    const d = dirFromDeg(stair.rotation + sign * (i + 0.5) * step);
    const p = { x: c.x + d.x * rr, y: c.y + d.y * rr };
    const zt = z0 + t.top + b.railHeight;
    m.cylinder(p.x, p.y, z0 + t.top, zt - 15, 9, 8);
    pts.push([p.x, p.y, zt]);
  });
  m.use(b.railMat, 'detail', 'handrail');
  for (let i = 0; i + 1 < pts.length; i++) m.tube(pts[i], pts[i + 1], 20, 8);
}
