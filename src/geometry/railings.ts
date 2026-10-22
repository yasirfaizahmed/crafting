/**
 * Railings along a plan polyline: posts at every vertex and at most 1.2 m apart, a continuous top
 * rail, and an infill per style — balusters at ~110 mm centres ('bars'), glass panels between
 * posts ('glass') or a solid upstand ('solid').
 */
import { distance, normalize, sub } from '../core/math2d';
import { getMaterial, hasMaterial, materialFor } from '../core/materials';
import type { Railing, Vec2 } from '../core/types';
import { levelElevation } from './cache';
import { Model, type P3 } from './model';
import { dedupe } from './poly2d';
import type { GeometryContext, GeometryPart } from './types';

export const MAX_POST_SPACING = 1200;
export const BALUSTER_SPACING = 110;

const isGlass = (id: string) => hasMaterial(id) && getMaterial(id).category === 'glass';

export function buildRailing(ctx: GeometryContext, r: Railing): GeometryPart[] {
  const path = dedupe((r.path ?? []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)), 1);
  if (path.length < 2 || !(r.height > 60)) return [];
  const H = r.height;
  const z = levelElevation(ctx, r.levelId) + r.baseOffset;
  const mat = materialFor(r).id;
  const glass = isGlass(mat) ? mat : 'glass-clear';
  const frame = isGlass(mat) ? 'aluminium' : mat;
  const m = new Model(undefined, frame);
  const post = 50;
  const railW = 60;
  const railH = 45;

  // Posts: path vertices plus evenly spaced intermediates.
  const posts: Vec2[] = [];
  const segments: { a: Vec2; b: Vec2; stations: Vec2[] }[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    const n = Math.max(1, Math.ceil(distance(a, b) / MAX_POST_SPACING));
    const stations = Array.from({ length: n + 1 }, (_, k) => ({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }));
    segments.push({ a, b, stations });
    for (const s of stations) if (!posts.some((p) => distance(p, s) < 1)) posts.push(s);
  }
  m.use(frame, 'frame');
  for (const p of posts) m.box(p.x - post / 2, p.y - post / 2, z, p.x + post / 2, p.y + post / 2, z + H - railH);

  // Top rail, extended at both ends so corners close.
  for (const { a, b } of segments) {
    const d = normalize(sub(b, a));
    const e = railW / 2;
    const pa: P3 = [a.x - d.x * e, a.y - d.y * e, z + H - railH / 2];
    const pb: P3 = [b.x + d.x * e, b.y + d.y * e, z + H - railH / 2];
    m.bar(pa, pb, railW, railH);
  }

  for (const { stations } of segments) {
    for (let k = 0; k + 1 < stations.length; k++) {
      const a = stations[k];
      const b = stations[k + 1];
      const len = distance(a, b);
      const d = normalize(sub(b, a));
      const at = (t: number, zz: number): P3 => [a.x + d.x * t, a.y + d.y * t, zz];
      const clear0 = post / 2;
      const clear1 = len - post / 2;
      if (clear1 - clear0 < 20) continue;
      if (r.style === 'glass') {
        m.use(glass, 'glass');
        m.bar(at(clear0 + 15, z + 80 + (H - railH - 140) / 2), at(clear1 - 15, z + 80 + (H - railH - 140) / 2), 12, H - railH - 140);
        m.use(frame, 'frame');
      } else if (r.style === 'solid') {
        m.use(mat, 'panel');
        m.bar(at(clear0, z + (H - railH) / 2), at(clear1, z + (H - railH) / 2), 40, H - railH);
        m.use(frame, 'frame');
      } else {
        // Bottom rail + balusters.
        m.bar(at(clear0, z + 100), at(clear1, z + 100), 40, 30);
        const n = Math.max(1, Math.round((clear1 - clear0) / BALUSTER_SPACING));
        const step = (clear1 - clear0) / n;
        for (let i = 1; i < n; i++) {
          const t = clear0 + i * step;
          const p = at(t, 0);
          m.box(p[0] - 9, p[1] - 9, z + 115, p[0] + 9, p[1] + 9, z + H - railH);
        }
      }
    }
  }
  return m.parts();
}
