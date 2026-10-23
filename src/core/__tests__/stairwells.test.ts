import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { buildElementGeometry, createGeometryContext } from '../../geometry';
import { createElement, createLevel, createProject } from '../defaults';
import { affectedIds } from '../dependencies';
import { pointInPolygon, polygonArea, rectPolygon } from '../math2d';
import { DocumentStore, type ChangeSet } from '../store';
import { slabHoles, slabNetArea, stairwellOpenings, stairwellOutline } from '../stairwells';
import type { Project, Slab, Stair } from '../types';

/** Two storeys (3 m), a 6 × 5 m floor slab on the upper one and a straight stair on the ground floor. */
function twoStoreys(stairProps: Partial<Stair> = {}): { p: Project; stair: Stair; floor: Slab } {
  const p = createProject();
  const ground = p.levels[0];
  const upper = createLevel({ name: 'Upper', elevation: 3000, height: 3000 });
  p.levels.push(upper);
  // 17 treads × 250 mm = 4250 mm run along +x, 1000 mm wide, centred on y = 1500.
  const stair = createElement('stair', ground.id, { position: { x: 1000, y: 1500 }, rotation: 0, width: 1000, tread: 250, ...stairProps });
  const floor = createElement('slab', upper.id, { outline: rectPolygon(0, 0, 6000, 5000), thickness: 200 });
  for (const el of [stair, floor]) p.elements[el.id] = el;
  return { p, stair, floor };
}

/** Area of upward-facing triangles of a mesh (m²). */
function topArea(positions: Float32Array, normals: Float32Array, indices: Uint32Array): number {
  let a = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const [i0, i1, i2] = [indices[i] * 3, indices[i + 1] * 3, indices[i + 2] * 3];
    if (normals[i0 + 1] < 0.99) continue;
    const ux = positions[i1] - positions[i0];
    const uz = positions[i1 + 2] - positions[i0 + 2];
    const vx = positions[i2] - positions[i0];
    const vz = positions[i2 + 2] - positions[i0 + 2];
    a += Math.abs(ux * vz - uz * vx) / 2;
  }
  return a;
}

describe('stairwells', () => {
  it('cuts the stair footprint out of the floor above', () => {
    const { p, floor } = twoStoreys();
    const holes = slabHoles(p, floor);
    expect(holes).toHaveLength(1);
    expect(polygonArea(holes[0])).toBeCloseTo(4250 * 1000, -3);
    expect(slabNetArea(p, floor)).toBeCloseTo(6000 * 5000 - 4250 * 1000, -3);
    // The opening sits over the stair: x 1000…5250, y 1000…2000.
    expect(pointInPolygon({ x: 3000, y: 1500 }, holes[0])).toBe(true);
    expect(pointInPolygon({ x: 3000, y: 2500 }, holes[0])).toBe(false);
  });

  it('leaves the floor the stair stands on, foundations and opted-out slabs solid', () => {
    const { p, stair, floor } = twoStoreys();
    const base = createElement('slab', stair.levelId, { outline: rectPolygon(0, 0, 6000, 5000) });
    const foundation = createElement('slab', stair.levelId, { outline: rectPolygon(0, 0, 6000, 5000), kind: 'foundation', topOffset: 3000 });
    for (const el of [base, foundation]) p.elements[el.id] = el;
    expect(slabHoles(p, base)).toEqual([]);
    expect(slabHoles(p, foundation)).toEqual([]);
    expect(slabHoles(p, { ...floor, stairOpenings: false })).toEqual([]);
    expect(slabHoles(p, { ...floor, stairOpenings: true })).toHaveLength(1);
  });

  it('cuts the ceiling of the stair’s own storey', () => {
    const { p, stair } = twoStoreys();
    const ceiling = createElement('slab', stair.levelId, { outline: rectPolygon(0, 0, 6000, 5000), kind: 'ceiling', topOffset: 3000, thickness: 20 });
    p.elements[ceiling.id] = ceiling;
    expect(slabHoles(p, ceiling)).toHaveLength(1);
  });

  it('clips an opening that runs past the slab edge so it stays strictly inside', () => {
    // Stair against the slab edge: its side lies on y = 0 and it runs past x = 6000.
    const { p, floor } = twoStoreys({ position: { x: 3000, y: 500 } });
    const [hole] = slabHoles(p, floor);
    expect(hole).toBeDefined();
    for (const q of hole) {
      expect(q.x).toBeGreaterThan(0);
      expect(q.x).toBeLessThan(6000);
      expect(q.y).toBeGreaterThan(0);
      expect(pointInPolygon(q, floor.outline)).toBe(true);
    }
    expect(polygonArea(hole)).toBeCloseTo((6000 - 1 - 3000) * (1000 - 1), -3);
  });

  it('ignores stairs that do not reach the slab and stairs outside it', () => {
    const { p, floor } = twoStoreys();
    const p2 = structuredClone(p);
    const stair = Object.values(p2.elements).find((e): e is Stair => e.type === 'stair')!;
    stair.rise = 1000;
    expect(slabHoles(p2, floor)).toEqual([]);
    const { p: p3, floor: f3 } = twoStoreys({ position: { x: 20_000, y: 20_000 } });
    expect(slabHoles(p3, f3)).toEqual([]);
  });

  it('cuts a round opening for spiral stairs', () => {
    const { p, floor } = twoStoreys({ shape: 'spiral', position: { x: 3000, y: 2500 }, width: 900 });
    const [hole] = slabHoles(p, floor);
    expect(hole.length).toBeGreaterThan(20);
    expect(polygonArea(hole)).toBeCloseTo(Math.PI * 900 * 900, -5); // 48-gon ≈ 99.7 % of the circle
  });

  it('covers L and U stairs with one opening over the whole stair', () => {
    for (const shape of ['l-shape', 'u-shape', 'open-well'] as const) {
      const { p, stair, floor } = twoStoreys({ shape, position: { x: 1500, y: 1500 } });
      const outline = stairwellOutline({ ...stair, shape }, 3000);
      expect(outline).toHaveLength(4);
      expect(stairwellOpenings(p, floor)).toHaveLength(1);
    }
  });

  it('does not duplicate an opening the user already drew (sample house)', () => {
    const sp = createSampleProject();
    const first = Object.values(sp.elements).find((e): e is Slab => e.type === 'slab' && e.levelId === sp.levels[1].id)!;
    expect(first.holes).toHaveLength(1);
    expect(slabHoles(sp, first)).toHaveLength(1);
  });

  it('follows the stair: moving and deleting update the opening, and 3D slabs rebuild', () => {
    const { p, stair, floor } = twoStoreys();
    const store = new DocumentStore(p);
    const changes: ChangeSet[] = [];
    store.subscribe((c) => changes.push(c));
    store.update<Stair>(stair.id, { position: { x: 1000, y: 3500 } });
    expect(affectedIds(store.project, changes.at(-1)!)?.has(floor.id)).toBe(true);
    expect(pointInPolygon({ x: 3000, y: 3500 }, slabHoles(store.project, floor)[0])).toBe(true);
    store.remove(stair.id);
    expect(affectedIds(store.project, changes.at(-1)!)?.has(floor.id)).toBe(true);
    expect(slabHoles(store.project, floor)).toEqual([]);
  });

  it('removes the opening from the 3D slab mesh', () => {
    const { p, floor } = twoStoreys();
    const area = (s: Slab) => {
      const part = buildElementGeometry(createGeometryContext(p), s).parts[0];
      return topArea(part.mesh.positions, part.mesh.normals, part.mesh.indices);
    };
    expect(area({ ...floor, stairOpenings: false })).toBeCloseTo(30, 2);
    expect(area(floor)).toBeCloseTo(30 - 4.25, 2);
  });
});
