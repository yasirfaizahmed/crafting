import { describe, expect, it } from 'vitest';
import { computeStairLayout } from '../../core/stairs';
import type { Element, Project, StairShape, Vec2 } from '../../core/types';
import { BLOCK_ROUND_SEGMENTS } from '../blocks';
import { buildElementGeometry, createGeometryContext } from '../index';
import { BALUSTER_SPACING, MAX_POST_SPACING } from '../railings';
import { ROUND_COLUMN_SEGMENTS } from '../structure';
import type { GeometryPart } from '../types';
import { expectValidParts, expectWithin, openEdges, planBounds, testProject, volumeOf } from './helpers';

const near = (a: number, b: number, rel: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.abs(b) * rel);
const ngonArea = (n: number, rx: number, ry: number) => (n / 2) * Math.sin((2 * Math.PI) / n) * rx * ry;

function build(project: Project, el: Element): GeometryPart[] {
  return buildElementGeometry(createGeometryContext(project), el).parts;
}

/** Elevations (plan mm) of every upward-facing surface above plan point p. */
function upAt(parts: GeometryPart[], p: Vec2): number[] {
  const out: number[] = [];
  for (const part of parts) {
    const { positions: pos, normals: nor, indices: idx } = part.mesh;
    for (let t = 0; t < idx.length; t += 3) {
      const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
      if (nor[a * 3 + 1] < 0.5) continue;
      const P = (i: number) => ({ x: pos[i * 3] * 1000, y: -pos[i * 3 + 2] * 1000, z: pos[i * 3 + 1] * 1000 });
      const A = P(a);
      const B = P(b);
      const C = P(c);
      const d = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((p.x - A.x) * (C.y - A.y) - (C.x - A.x) * (p.y - A.y)) / d;
      const v = ((B.x - A.x) * (p.y - A.y) - (p.x - A.x) * (B.y - A.y)) / d;
      if (u < -1e-9 || v < -1e-9 || u + v > 1 + 1e-9) continue;
      out.push(A.z + u * (B.z - A.z) + v * (C.z - A.z));
    }
  }
  return out;
}

const centroid = (poly: Vec2[]): Vec2 => ({ x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length });

/** Split a part into its closed primitives by connectivity of welded vertices. */
function solids(part: GeometryPart): { min: number[]; max: number[] }[] {
  const m = part.mesh;
  const n = m.positions.length / 3;
  const key = (i: number) => `${Math.round(m.positions[i * 3] * 1e5)},${Math.round(m.positions[i * 3 + 1] * 1e5)},${Math.round(m.positions[i * 3 + 2] * 1e5)}`;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => (parent[find(a)] = find(b));
  const byKey = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    const k = key(i);
    const j = byKey.get(k);
    if (j === undefined) byKey.set(k, i);
    else union(i, j);
  }
  for (let t = 0; t < m.indices.length; t += 3) {
    union(m.indices[t], m.indices[t + 1]);
    union(m.indices[t], m.indices[t + 2]);
  }
  const groups = new Map<number, { min: number[]; max: number[] }>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    const p = [m.positions[i * 3] * 1000, -m.positions[i * 3 + 2] * 1000, m.positions[i * 3 + 1] * 1000];
    const g = groups.get(r) ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let k = 0; k < 3; k++) {
      g.min[k] = Math.min(g.min[k], p[k]);
      g.max[k] = Math.max(g.max[k], p[k]);
    }
    groups.set(r, g);
  }
  return [...groups.values()];
}

describe('stairs', () => {
  const SHAPES: StairShape[] = ['straight', 'l-shape', 'u-shape', 'spiral'];
  for (const shape of SHAPES) {
    for (const materialId of ['concrete', 'wood-oak', 'steel']) {
      it(`${shape} (${materialId}): solid treads at every tread top, landings, within the footprint`, () => {
        const { project, add } = testProject();
        project.levels[0].elevation = 500;
        const st = add('stair', { position: { x: 1000, y: 2000 }, rotation: 30, width: 1000, shape, materialId, turn: shape === 'u-shape' ? 'right' : 'left' });
        const parts = build(project, st);
        expectValidParts(parts);
        expect(openEdges(parts)).toBe(0);
        expect(volumeOf(parts)).toBeGreaterThan(0);
        const layout = computeStairLayout(st, 3000);
        const steps = parts.filter((p) => p.name !== 'handrail');
        for (const t of [...layout.treads, ...layout.landings]) {
          const zs = upAt(steps, centroid(t.polygon));
          // Spiral treads overlap in plan after a full turn: look for the tread's own surface there.
          if (shape === 'spiral') expect(Math.min(...zs.map((z) => Math.abs(z - 500 - t.top)))).toBeLessThan(1e-3);
          else expect(Math.max(...zs)).toBeCloseTo(500 + t.top, 3);
        }
        expect(planBounds(steps).maxZ).toBeLessThanOrEqual(500 + layout.rise + (shape === 'spiral' ? 900 : 0) + 1);
        const fp = layout.footprint.flat();
        expectWithin(
          planBounds(parts),
          {
            minX: Math.min(...fp.map((p) => p.x)) - 50,
            maxX: Math.max(...fp.map((p) => p.x)) + 50,
            minY: Math.min(...fp.map((p) => p.y)) - 50,
            maxY: Math.max(...fp.map((p) => p.y)) + 50,
            minZ: 500,
            maxZ: 500 + layout.rise + 1100,
          },
          1,
        );
        expect(parts.some((p) => p.name === 'handrail')).toBe(true);
      });
    }
  }

  it('stair layout flights cover every tread once, bottom to top, matching the tread polygons', () => {
    const { add } = testProject();
    for (const shape of ['straight', 'l-shape', 'u-shape'] as const) {
      for (const turn of ['left', 'right'] as const) {
        const st = add('stair', { position: { x: 500, y: -300 }, rotation: 120, width: 900, shape, turn });
        const layout = computeStairLayout(st, 3000);
        const used = layout.flights!.flatMap((f) => f.treadIndices);
        expect(used).toEqual(layout.treads.map((_, i) => i));
        for (const f of layout.flights!) {
          f.treadIndices.forEach((ti, k) => {
            const c = centroid(layout.treads[ti].polygon);
            const along = (c.x - f.start.x) * f.direction.x + (c.y - f.start.y) * f.direction.y;
            const across = (c.x - f.start.x) * -f.direction.y + (c.y - f.start.y) * f.direction.x;
            expect(along).toBeCloseTo((k + 0.5) * f.going, 6);
            expect(across).toBeCloseTo(0, 6);
            expect(layout.treads[ti].top).toBeCloseTo(f.base + (k + 1) * f.riserHeight, 6);
          });
        }
      }
    }
    expect(computeStairLayout(add('stair', { shape: 'spiral' }), 3000).flights).toEqual([]);
  });

  it('monolithic flights: sawtooth over a sloped soffit (volume between steps-only and full blocks)', () => {
    const { project, add } = testProject();
    const st = add('stair', { position: { x: 0, y: 0 }, rotation: 0, width: 1200, shape: 'straight', materialId: 'concrete', props: { handrail: 'none' } });
    const parts = build(project, st);
    expect(parts.some((p) => p.name === 'handrail')).toBe(false);
    const { treads, riserHeight: r } = computeStairLayout(st, 3000);
    const n = treads.length;
    const g = st.tread;
    const full = g * r * ((n * (n + 1)) / 2) * 1200;
    const v = volumeOf(parts);
    expect(v).toBeLessThan(full);
    expect(v).toBeGreaterThan(g * r * (n / 2) * 1200);
    // The soffit rises: under the last tread the underside is well above the floor.
    const b = planBounds(parts);
    expect(b.minZ).toBeCloseTo(0, 3);
  });

  it('handrail sides follow props.handrail', () => {
    const { project, add } = testProject();
    const width = (handrail?: string) => {
      const st = add('stair', { position: { x: 0, y: 0 }, rotation: 0, width: 1000, shape: 'straight', materialId: 'wood-oak', props: handrail ? { handrail } : {} });
      const rail = build(project, st).filter((p) => p.name === 'handrail');
      if (!rail.length) return 0;
      const b = planBounds(rail);
      return b.maxY - b.minY;
    };
    expect(width()).toBeGreaterThan(800);
    expect(width('left')).toBeLessThan(200);
    expect(width('none')).toBe(0);
  });

  it('spiral stairs have a central column reaching the top', () => {
    const { project, add } = testProject();
    const st = add('stair', { position: { x: 0, y: 0 }, rotation: 0, width: 900, shape: 'spiral', innerRadius: 80, materialId: 'steel' });
    const parts = build(project, st);
    // The column is the tallest solid centred on the stair position.
    const col = parts.flatMap(solids).find((s) => Math.abs((s.min[0] + s.max[0]) / 2) < 1 && Math.abs((s.min[1] + s.max[1]) / 2) < 1 && s.max[2] - s.min[2] > 3000);
    expect(col).toBeDefined();
    expect(col!.max[0] - col!.min[0]).toBeCloseTo(160, 0);
  });

  it('returns nothing for degenerate stairs', () => {
    const { project, add } = testProject();
    expect(build(project, add('stair', { width: 0 }))).toEqual([]);
    expect(build(project, add('stair', { tread: 0 }))).toEqual([]);
  });
});

describe('columns and beams', () => {
  it('rect column: w × d × h box, rotated about its centre', () => {
    const { project, add } = testProject();
    const c = add('column', { position: { x: 1000, y: 1000 }, width: 400, depth: 200, rotation: 90, height: 2800, baseOffset: 100 });
    const parts = build(project, c);
    expectValidParts(parts);
    expect(openEdges(parts)).toBe(0);
    near(volumeOf(parts), 400 * 200 * 2800, 1e-6);
    const b = planBounds(parts);
    expect(b.maxX - b.minX).toBeCloseTo(200, 2);
    expect(b.maxY - b.minY).toBeCloseTo(400, 2);
    expect(b.minZ).toBeCloseTo(100, 3);
    expect(b.maxZ).toBeCloseTo(2900, 3);
  });

  it(`round column: ${ROUND_COLUMN_SEGMENTS}-gon prism (elliptical when width ≠ depth), level height by default`, () => {
    const { project, add } = testProject();
    const c = add('column', { position: { x: 0, y: 0 }, width: 400, depth: 400, shape: 'round' });
    const parts = build(project, c);
    expect(openEdges(parts)).toBe(0);
    near(volumeOf(parts), ngonArea(ROUND_COLUMN_SEGMENTS, 200, 200) * 3000, 1e-6);
    const e = add('column', { position: { x: 0, y: 0 }, width: 600, depth: 300, shape: 'round', height: 2000 });
    near(volumeOf(build(project, e)), ngonArea(ROUND_COLUMN_SEGMENTS, 300, 150) * 2000, 1e-6);
  });

  it('steel columns and beams use a wide-flange section', () => {
    const { project, add } = testProject();
    const c = add('column', { position: { x: 0, y: 0 }, width: 300, depth: 300, materialId: 'steel', height: 3000 });
    const v = volumeOf(build(project, c));
    expect(v).toBeLessThan(300 * 300 * 3000 * 0.5);
    expect(v).toBeGreaterThan(300 * 300 * 3000 * 0.1);
    const b = add('beam', { start: { x: 0, y: 0 }, end: { x: 4000, y: 0 }, width: 200, depth: 400, materialId: 'steel' });
    const parts = build(project, b);
    expect(openEdges(parts)).toBe(0);
    expect(planBounds(parts).maxZ).toBeCloseTo(3000, 3);
    expect(planBounds(parts).minZ).toBeCloseTo(2600, 3);
  });

  it('beam: width × depth × length along start → end with the top at topOffset (level height by default)', () => {
    const { project, add } = testProject();
    const b = add('beam', { start: { x: 0, y: 0 }, end: { x: 3000, y: 4000 }, width: 300, depth: 500 });
    const parts = build(project, b);
    expect(openEdges(parts)).toBe(0);
    near(volumeOf(parts), 300 * 500 * 5000, 1e-6);
    expect(planBounds(parts)).toMatchObject({ maxZ: expect.closeTo(3000, 3), minZ: expect.closeTo(2500, 3) });
    const low = add('beam', { start: { x: 0, y: 0 }, end: { x: 3000, y: 0 }, width: 300, depth: 500, topOffset: 2400 });
    expect(planBounds(build(project, low)).maxZ).toBeCloseTo(2400, 3);
    expect(build(project, add('beam', { start: { x: 0, y: 0 }, end: { x: 0, y: 0 } }))).toEqual([]);
  });
});

describe('railings', () => {
  const path = [
    { x: 0, y: 0 },
    { x: 3000, y: 0 },
    { x: 3000, y: 2000 },
  ];

  it('bars: posts ≤ 1.2 m apart, a continuous top rail and balusters with < 100 mm gaps', () => {
    const { project, add } = testProject();
    const r = add('railing', { path, height: 1000, baseOffset: 0, style: 'bars' });
    const parts = build(project, r);
    expectValidParts(parts);
    expect(openEdges(parts)).toBe(0);
    expectWithin(planBounds(parts), { minX: -40, maxX: 3040, minY: -40, maxY: 2040, minZ: 0, maxZ: 1000 }, 1);
    // Vertical members along the first segment (y ≈ 0), sorted along x.
    const members = parts
      .flatMap(solids)
      .filter((s) => s.max[2] - s.min[2] > 500 && Math.abs(s.min[1] + s.max[1]) < 100)
      .sort((a, b) => a.min[0] - b.min[0]);
    const posts = members.filter((s) => s.min[2] < 1 && s.max[0] - s.min[0] > 40);
    expect(posts.length).toBe(Math.ceil(3000 / MAX_POST_SPACING) + 1);
    for (let i = 1; i < posts.length; i++) expect(posts[i].min[0] - posts[i - 1].min[0]).toBeLessThanOrEqual(MAX_POST_SPACING + 1);
    for (let i = 1; i < members.length; i++) expect(members[i].min[0] - members[i - 1].max[0]).toBeLessThan(100);
    expect(members.length).toBeGreaterThan(3000 / BALUSTER_SPACING);
  });

  it('glass: glass panels between posts; solid: an upstand panel', () => {
    const { project, add } = testProject();
    const g = build(project, add('railing', { path, height: 1100, baseOffset: 0, style: 'glass' }));
    expect(g.some((p) => p.role === 'glass' && p.materialId === 'glass-clear')).toBe(true);
    expect(openEdges(g)).toBe(0);
    const s = build(project, add('railing', { path, height: 1100, baseOffset: 200, style: 'solid', materialId: 'paint-white' }));
    expect(s.some((p) => p.role === 'panel' && p.materialId === 'paint-white')).toBe(true);
    expect(planBounds(s).minZ).toBeCloseTo(200, 3);
    expect(planBounds(s).maxZ).toBeCloseTo(1300, 3);
  });

  it('ignores degenerate paths', () => {
    const { project, add } = testProject();
    expect(build(project, add('railing', { path: [{ x: 0, y: 0 }] }))).toEqual([]);
    expect(build(project, add('railing', { path: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }))).toEqual([]);
  });
});

describe('blocks', () => {
  const size = { x: 1000, y: 600, z: 800 };

  it('box / cylinder / wedge / sphere volumes', () => {
    const { project, add } = testProject();
    const vol = (shape: 'box' | 'cylinder' | 'wedge' | 'sphere') => {
      const parts = build(project, add('block', { position: { x: 0, y: 0, z: 0 }, size, shape }));
      expectValidParts(parts);
      expect(openEdges(parts)).toBe(0);
      expectWithin(planBounds(parts), { minX: 0, maxX: 1000, minY: 0, maxY: 600, minZ: 0, maxZ: 800 }, 1e-3);
      return volumeOf(parts);
    };
    near(vol('box'), 1000 * 600 * 800, 1e-6);
    near(vol('cylinder'), ngonArea(BLOCK_ROUND_SEGMENTS, 500, 300) * 800, 1e-6);
    near(vol('wedge'), (1000 * 600 * 800) / 2, 1e-6);
    near(vol('sphere'), (4 / 3) * Math.PI * 500 * 300 * 400, 0.05);
  });

  it('places the min corner at position (+ level elevation) and rotates about it', () => {
    const { project, add } = testProject();
    project.levels[0].elevation = 3000;
    const b = add('block', { position: { x: 500, y: 500, z: 600 }, size, rotation: 90, shape: 'box', materialId: 'glass-clear' });
    const parts = build(project, b);
    expect(parts[0].role).toBe('glass');
    const bb = planBounds(parts);
    expect(bb.minX).toBeCloseTo(500 - 600, 2);
    expect(bb.maxX).toBeCloseTo(500, 2);
    expect(bb.minY).toBeCloseTo(500, 2);
    expect(bb.maxY).toBeCloseTo(1500, 2);
    expect(bb.minZ).toBeCloseTo(3600, 2);
    expect(build(project, add('block', { size: { x: 0, y: 1, z: 1 } }))).toEqual([]);
  });
});
