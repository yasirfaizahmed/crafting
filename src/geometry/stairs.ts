/**
 * Stairs from `computeStairLayout`:
 *  - masonry/concrete/stone materials → monolithic flights (solid sawtooth steps over a sloped
 *    soffit) and solid landing slabs;
 *  - wood/metal → stringers on both sides, nosed treads, closed risers (wood) or open risers
 *    (metal), and platform landings on posts;
 *  - spirals → a central column, wedge treads and a helical outer handrail.
 * Handrails (balusters + rail) follow `props.handrail`: 'both' (default), 'left', 'right', 'none'.
 * Each flight is modelled in its own frame: x = direction of travel, y = left, z up from the
 * floor/landing it starts on.
 */
import { angleDeg, dirFromDeg } from '../core/math2d';
import { getMaterial, materialFor } from '../core/materials';
import { computeStairLayout, type StairFlight, type StairLayout } from '../core/stairs';
import type { Stair } from '../core/types';
import { levelElevation, levelHeight } from './cache';
import { Model, placement, type P3 } from './model';
import type { GeometryContext, GeometryPart } from './types';

type RailSides = { left: boolean; right: boolean };

function railSides(stair: Stair): RailSides {
  const v = stair.props?.handrail;
  if (v === 'none' || v === false) return { left: false, right: false };
  if (v === 'left') return { left: true, right: false };
  if (v === 'right') return { left: false, right: true };
  return { left: true, right: true };
}

const RAIL_HEIGHT = 900;

export function buildStair(ctx: GeometryContext, stair: Stair): GeometryPart[] {
  if (!(stair.width > 0) || !(stair.tread > 0)) return [];
  const layout = computeStairLayout(stair, levelHeight(ctx, stair.levelId));
  const z0 = levelElevation(ctx, stair.levelId);
  const mat = materialFor(stair).id;
  const category = getMaterial(mat).category;
  const m = new Model(undefined, mat);
  const rails = railSides(stair);
  const railMat = category === 'wood' || category === 'metal' ? mat : 'metal-black';
  if (stair.shape === 'spiral') {
    spiral(m, stair, layout, z0, mat, railMat, rails);
    return m.parts();
  }
  const timber = category === 'wood' || category === 'metal';
  for (const fl of layout.flights ?? []) {
    const n = fl.treadIndices.length;
    if (!n) continue;
    m.group(placement(fl.start.x, fl.start.y, z0 + fl.base, angleDeg(fl.direction)), () => {
      if (timber) timberFlight(m, fl, n, mat, category === 'wood');
      else solidFlight(m, fl, n, mat);
      flightRails(m, fl, n, railMat, rails, timber && category === 'wood');
    });
  }
  for (const l of layout.landings) {
    const top = z0 + l.top;
    m.use(mat, 'body');
    if (timber) {
      const t = Math.min(120, l.top);
      m.prism(l.polygon, top - t, top);
      // Posts under the landing corners.
      const cx = l.polygon.reduce((s, p) => s + p.x, 0) / l.polygon.length;
      const cy = l.polygon.reduce((s, p) => s + p.y, 0) / l.polygon.length;
      for (const p of l.polygon) {
        const dx = cx - p.x;
        const dy = cy - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const q = { x: p.x + (dx / d) * 60, y: p.y + (dy / d) * 60 };
        m.boxC(q.x, q.y, z0, 80, 80, l.top - t);
      }
    } else {
      m.prism(l.polygon, top - Math.min(200, l.top), top);
    }
  }
  return m.parts();
}

/** Monolithic flight: sawtooth steps over a sloped soffit, extruded across the width. */
function solidFlight(m: Model, fl: StairFlight, n: number, mat: string): void {
  const g = fl.going;
  const r = fl.riserHeight;
  const W = fl.width / 2;
  const cosA = g / Math.hypot(g, r);
  const waist = Math.max(150, r * cosA + 40);
  const wv = waist / cosA;
  const soffit = (x: number) => r + (x * r) / g - wv;
  const xb = ((wv - r) * g) / r;
  const run = n * g;
  const profile: [number, number][] = [[0, 0]];
  if (xb < run - 1) profile.push([Math.max(0, xb), 0], [run, soffit(run)]);
  else profile.push([run, 0]);
  for (let i = n; i >= 1; i--) profile.push([i * g, i * r], [(i - 1) * g, i * r]);
  m.use(mat, 'body');
  m.prismY(profile, -W, W);
}

/** Stringers, nosed treads and risers. */
function timberFlight(m: Model, fl: StairFlight, n: number, mat: string, closedRisers: boolean): void {
  const g = fl.going;
  const r = fl.riserHeight;
  const W = fl.width / 2;
  const run = n * g;
  const st = Math.min(45, W / 4);
  const top = (n + 1) * r;
  const depth = 260;
  const xb = ((depth - r) * g) / r;
  const profile: [number, number][] = [[0, 0]];
  if (xb > 0 && xb < run - 1) profile.push([xb, 0], [run, top - depth]);
  else if (xb >= run - 1) profile.push([run, 0]);
  else profile.push([run, Math.max(0, top - depth)]);
  profile.push([run, top], [0, Math.min(top, r + 50)]);
  m.use(mat, 'body');
  m.prismY(profile, -W, -W + st);
  m.prismY(profile, W - st, W);
  const tt = Math.min(40, r * 0.4);
  const nosing = 25;
  m.use(mat, 'body');
  for (let i = 0; i < n; i++) {
    const zt = (i + 1) * r;
    m.box(i * g - (i === 0 ? 0 : nosing), -W + st, zt - tt, (i + 1) * g, W - st, zt);
    if (closedRisers) m.box(i * g, -W + st, Math.max(0, i * r - tt), i * g + 18, W - st, zt - tt);
  }
}

function flightRails(m: Model, fl: StairFlight, n: number, mat: string, sides: RailSides, timber: boolean): void {
  if (!sides.left && !sides.right) return;
  const g = fl.going;
  const r = fl.riserHeight;
  const W = fl.width / 2;
  const run = n * g;
  const pitch = (x: number) => r + (x * r) / g; // nosing line
  const railZ = (x: number) => pitch(x) + RAIL_HEIGHT;
  const inset = timber ? 22 : 30;
  m.use(mat, 'detail', 'handrail');
  for (const [on, s] of [
    [sides.left, 1],
    [sides.right, -1],
  ] as const) {
    if (!on) continue;
    const y = s * (W - inset);
    const x0 = Math.min(40, run / 4);
    const x1 = Math.max(x0 + 1, run - 40);
    // Newel posts.
    const post = timber ? 80 : 40;
    m.boxC(x0, y, 0, post, post, Math.max(r, railZ(x0) + 60));
    m.boxC(x1, y, pitch(x1) - r, post, post, Math.max(r, railZ(x1) + 60 - (pitch(x1) - r)));
    // Balusters: one or two per tread keeping gaps under 100 mm-ish for timber spacing.
    const per = g >= 220 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < per; k++) {
        const x = i * g + ((k + 0.5) * g) / per;
        if (x < x0 + post / 2 + 10 || x > x1 - post / 2 - 10) continue;
        const zb = (i + 1) * r;
        const zt = railZ(x) - 20;
        if (timber) m.boxC(x, y, zb, 32, 32, zt - zb);
        else m.cylinder(x, y, zb, zt, 8, 8);
      }
    }
    // Rail along the pitch line.
    const a: P3 = [x0, y, railZ(x0) + 20];
    const b: P3 = [x1, y, railZ(x1) + 20];
    if (timber) m.bar(a, b, 55, 45);
    else m.tube(a, b, 22, 10);
  }
}

function spiral(m: Model, stair: Stair, layout: StairLayout, z0: number, mat: string, railMat: string, sides: RailSides): void {
  const c = stair.position;
  const outer = stair.width;
  const inner = Math.min(outer * 0.6, stair.innerRadius ?? 100);
  m.use(mat, 'body');
  m.cylinder(c.x, c.y, z0, z0 + layout.rise + RAIL_HEIGHT, Math.max(40, inner), 20);
  const tt = Math.min(50, layout.riserHeight * 0.4);
  for (const t of layout.treads) m.prism(t.polygon, z0 + t.top - tt, z0 + t.top);
  if (!sides.left && !sides.right) return;
  // Helical outer rail with one baluster per tread.
  m.use(railMat, 'detail', 'handrail');
  const sign = stair.turn === 'right' ? -1 : 1;
  const step = 27;
  const rr = outer - 30;
  const pts: P3[] = [];
  layout.treads.forEach((t, i) => {
    const a = stair.rotation + sign * (i + 0.5) * step;
    const d = dirFromDeg(a);
    const p = { x: c.x + d.x * rr, y: c.y + d.y * rr };
    const zt = z0 + t.top + RAIL_HEIGHT;
    m.cylinder(p.x, p.y, z0 + t.top, zt - 15, 9, 8);
    pts.push([p.x, p.y, zt]);
  });
  for (let i = 0; i + 1 < pts.length; i++) m.tube(pts[i], pts[i + 1], 20, 8);
}
