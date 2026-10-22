import { it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import type { Wall } from '../../core/types';
import { buildElementGeometry, createGeometryContext } from '../index';
import { openEdges } from './helpers';

it('debug', () => {
  const p = createSampleProject();
  const ctx = createGeometryContext(p);
  for (const w of Object.values(p.elements).filter((e): e is Wall => e.type === 'wall')) {
    const parts = buildElementGeometry(ctx, w).parts;
    if (!openEdges(parts)) continue;
    const count = new Map<string, number>();
    const key = (pos: Float32Array, i: number) => `${Math.round(pos[i * 3] * 1000)},${Math.round(-pos[i * 3 + 2] * 1000)},${Math.round(pos[i * 3 + 1] * 1000)}`;
    for (const part of parts) {
      const m = part.mesh;
      for (let t = 0; t < m.indices.length; t += 3) {
        for (let e = 0; e < 3; e++) {
          const a = key(m.positions, m.indices[t + e]);
          const b = key(m.positions, m.indices[t + ((e + 1) % 3)]);
          if (a === b) continue;
          const r = `${b}>${a}`;
          if ((count.get(r) ?? 0) > 0) count.set(r, count.get(r)! - 1);
          else count.set(`${a}>${b}`, (count.get(`${a}>${b}`) ?? 0) + 1);
        }
      }
    }
    for (const [k, c] of count) if (c) console.log('OPEN', k, c);
  }
});
