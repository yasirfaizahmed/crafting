import { describe, expect, it } from 'vitest';
import type { Project, Roof, RoofShape, Slab } from '../../core/types';
import { buildElementGeometry, createGeometryContext, roofPlanes } from '../index';
import { FLAT_ROOF_DEFAULT_MATERIAL } from '../roofs';
import { expectValidParts, expectWithin, openEdges, planBounds, testProject, volumeOf } from './helpers';

const rect = (x0: number, y0: number, x1: number, y1: number) => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

const near = (a: number, b: number, rel: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.abs(b) * rel);

function build(project: Project, el: Slab | Roof) {
  return buildElementGeometry(createGeometryContext(project), el).parts;
}

describe('slabs', () => {
  it('extrudes the outline down from the top with holes cut through', () => {
    const { project, add } = testProject();
    const s = add('slab', { outline: rect(0, 0, 6000, 4000), holes: [rect(1000, 1000, 2000, 3000), rect(4000, 1000, 5000, 2000)], thickness: 250, topOffset: 0, kind: 'floor' });
    const parts = build(project, s);
    expectValidParts(parts);
    expect(openEdges(parts)).toBe(0);
    near(volumeOf(parts), (24e6 - 2e6 - 1e6) * 250, 1e-6);
    expect(planBounds(parts)).toMatchObject({ minX: 0, maxX: 6000, minY: 0, maxY: 4000, minZ: -250, maxZ: 0 });
  });

  it('handles concave (L) outlines, clockwise input and duplicate points', () => {
    const { project, add } = testProject();
    const L = [
      { x: 0, y: 0 },
      { x: 0, y: 4000 },
      { x: 2000, y: 4000 },
      { x: 2000, y: 2000 },
      { x: 2000, y: 2000 },
      { x: 5000, y: 2000 },
      { x: 5000, y: 0 },
    ];
    const s = add('slab', { outline: L, thickness: 200, topOffset: 3000, kind: 'ceiling' });
    const parts = build(project, s);
    expect(openEdges(parts)).toBe(0);
    near(volumeOf(parts), (2000 * 4000 + 3000 * 2000) * 200, 1e-6);
    expect(planBounds(parts).maxZ).toBeCloseTo(3000, 3);
  });

  it('puts floor finishes on the top face only', () => {
    const { project, add } = testProject();
    const s = add('slab', { outline: rect(0, 0, 3000, 3000), thickness: 200, topOffset: 0, kind: 'floor', materialId: 'wood-floor-oak' });
    const parts = build(project, s);
    const top = parts.find((p) => p.materialId === 'wood-floor-oak')!;
    expect(top.role).toBe('finish');
    for (let i = 1; i < top.mesh.normals.length; i += 3) expect(top.mesh.normals[i]).toBeCloseTo(1, 6);
    expect(parts.find((p) => p.materialId !== 'wood-floor-oak')?.materialId).toBe('plaster-white');
    expect(openEdges(parts)).toBe(0);
  });

  it('builds foundations and terraces at their level elevation, ignores bad holes and empty outlines', () => {
    const { project, add } = testProject();
    project.levels[0].elevation = 1000;
    const f = add('slab', { outline: rect(0, 0, 2000, 2000), holes: [rect(1500, 1500, 2500, 2500)], thickness: 400, topOffset: 0, kind: 'foundation' });
    const parts = build(project, f);
    near(volumeOf(parts), 4e6 * 400, 1e-6);
    expect(planBounds(parts).minZ).toBeCloseTo(600, 3);
    expect(planBounds(parts).maxZ).toBeCloseTo(1000, 3);
    expect(build(project, add('slab', { outline: [{ x: 0, y: 0 }, { x: 1, y: 1 }], thickness: 200, topOffset: 0, kind: 'terrace' }))).toEqual([]);
    expect(build(project, add('slab', { outline: rect(0, 0, 1000, 1000), thickness: 0, topOffset: 0, kind: 'terrace' }))).toEqual([]);
  });
});

describe('roofs', () => {
  const SHAPES: RoofShape[] = ['flat', 'gable', 'hip', 'shed', 'pyramid'];
  const W = 8000;
  const D = 5000;

  function house(shape: RoofShape, extra: Partial<Roof> = {}) {
    const t = testProject();
    const walls = rect(0, 0, W, D).map((p, i, a) => t.add('wall', { start: p, end: a[(i + 1) % 4], thickness: 200, materialId: 'brick-red' }));
    const roof = t.add('roof', { outline: rect(0, 0, W, D), shape, pitch: 30, overhang: 500, thickness: 200, ridgeAngle: 0, ...extra });
    return { ...t, walls, roof };
  }

  for (const shape of SHAPES) {
    it(`${shape}: closed solid within the overhang rectangle, from the eave up to the ridge`, () => {
      const { project, roof } = house(shape);
      const parts = build(project, roof);
      expectValidParts(parts);
      expect(openEdges(parts)).toBe(0);
      expect(volumeOf(parts)).toBeGreaterThan(0);
      const rp = roofPlanes(project, roof)!;
      expect(rp.eaveElevation).toBe(3000);
      const k = Math.tan(Math.PI / 6);
      // The shed's highest point is its overhanging high eave.
      const ridgeRise = shape === 'flat' ? 0 : shape === 'shed' ? (D + 500) * k : (Math.min(W, D) / 2) * k;
      expect(rp.ridgeElevation).toBeCloseTo(3000 + ridgeRise + rp.verticalThickness, 3);
      expectWithin(planBounds(parts), { minX: -500, maxX: W + 500, minY: -500, maxY: D + 500, minZ: 3000 - 500 * k - 1, maxZ: rp.ridgeElevation }, 1);
      // Body volume: every pitched plane has vertical thickness dz over the whole covered area.
      const body = parts.filter((p) => p.name !== 'infill' && p.name !== 'parapet' && p.name !== 'coping');
      near(volumeOf(body), (W + 1000) * (D + 1000) * rp.verticalThickness, 1e-6);
      // Soffits face down, top surfaces face up.
      const soffit = parts.find((p) => p.name === 'soffit')!;
      for (let i = 1; i < soffit.mesh.normals.length; i += 3) expect(soffit.mesh.normals[i]).toBeLessThan(0);
    });
  }

  it('gable: two planes, a ridge along the ridge angle, gable infills in the wall material', () => {
    const { project, roof } = house('gable');
    const rp = roofPlanes(project, roof)!;
    expect(rp.planes).toHaveLength(2);
    const ridges = rp.lines.filter((l) => l.kind === 'ridge');
    expect(ridges).toHaveLength(1);
    expect(ridges[0].a.y).toBeCloseTo(D / 2, 3);
    expect(Math.abs(ridges[0].a.x - ridges[0].b.x)).toBeCloseTo(W + 1000, 3);
    expect(rp.lines.filter((l) => l.kind === 'eave')).toHaveLength(2);
    expect(rp.lines.filter((l) => l.kind === 'verge')).toHaveLength(4);
    const parts = build(project, roof);
    const infill = parts.filter((p) => p.name === 'infill');
    expect(infill.length).toBeGreaterThan(0);
    expect(infill.every((p) => p.materialId === 'brick-red')).toBe(true);
    // Gable triangles sit on the end walls (x ≈ 0 and x ≈ W) and reach the roof underside at the ridge.
    const b = planBounds(infill);
    expect(b.minX).toBeGreaterThanOrEqual(-101);
    expect(b.maxX).toBeLessThanOrEqual(W + 101);
    expect(b.maxZ).toBeCloseTo(3000 + (D / 2) * Math.tan(Math.PI / 6), 1);
    expect(b.minZ).toBeCloseTo(3000, 3);
  });

  it('hip and pyramid: four planes with hips; pyramid meets at one apex', () => {
    const hip = house('hip');
    const rp = roofPlanes(hip.project, hip.roof)!;
    expect(rp.planes).toHaveLength(4);
    expect(rp.lines.filter((l) => l.kind === 'hip')).toHaveLength(4);
    expect(rp.lines.filter((l) => l.kind === 'ridge')).toHaveLength(1);
    const pyr = house('pyramid');
    const pp = roofPlanes(pyr.project, pyr.roof)!;
    expect(pp.planes).toHaveLength(4);
    expect(pp.lines.filter((l) => l.kind === 'ridge')).toHaveLength(0);
    const apex = pp.planes.map((pl) => pl.polygon[pl.elevations.indexOf(Math.max(...pl.elevations))]);
    for (const p of apex) {
      expect(p.x).toBeCloseTo(W / 2, 3);
      expect(p.y).toBeCloseTo(D / 2, 3);
    }
  });

  it('shed: one plane rising to the left of the ridge direction', () => {
    const { project, roof } = house('shed', { pitch: 10 });
    const rp = roofPlanes(project, roof)!;
    expect(rp.planes).toHaveLength(1);
    expect(rp.planes[0].downhill.y).toBeCloseTo(-1, 6);
    expect(rp.planes[0].pitch).toBeCloseTo(10, 6);
  });

  it('flat: polygon outline with overhang, optional parapet and a membrane by default', () => {
    const { project, roof } = house('flat', { overhang: 0 });
    const parts = build(project, roof);
    expect(parts.find((p) => p.name === undefined && p.role === 'body')?.materialId).toBe(FLAT_ROOF_DEFAULT_MATERIAL);
    expect(parts.some((p) => p.name === 'parapet' && p.materialId === 'brick-red')).toBe(true);
    expect(planBounds(parts).maxZ).toBeCloseTo(3000 + 200 + 300 + 30, 3);
    const none = house('flat', { overhang: 0, props: { parapet: 0 } });
    expect(build(none.project, none.roof).some((p) => p.name === 'parapet')).toBe(false);
    const tiles = house('flat', { materialId: 'roof-slate' });
    expect(build(tiles.project, tiles.roof)[0].materialId).toBe('roof-slate');
  });

  it('follows ridgeAngle (rotated rectangle) and baseOffset', () => {
    const t = testProject();
    const outline = rect(0, 0, W, D).map((p) => ({ x: p.x * Math.cos(Math.PI / 6) - p.y * Math.sin(Math.PI / 6), y: p.x * Math.sin(Math.PI / 6) + p.y * Math.cos(Math.PI / 6) }));
    const roof = t.add('roof', { outline, shape: 'gable', pitch: 35, overhang: 300, thickness: 180, ridgeAngle: 30, baseOffset: 2700 });
    const parts = build(t.project, roof);
    expect(openEdges(parts)).toBe(0);
    const rp = roofPlanes(t.project, roof)!;
    expect(rp.eaveElevation).toBe(2700);
    const ridge = rp.lines.find((l) => l.kind === 'ridge')!;
    const dir = Math.atan2(ridge.b.y - ridge.a.y, ridge.b.x - ridge.a.x);
    expect((dir + 2 * Math.PI) % Math.PI).toBeCloseTo(Math.PI / 6, 6);
    near(volumeOf(parts.filter((p) => p.name !== 'infill')), (W + 600) * (D + 600) * rp.verticalThickness, 1e-6);
  });

  it('builds gable infill without walls below (plaster) and nothing for degenerate roofs', () => {
    const t = testProject();
    const roof = t.add('roof', { outline: rect(0, 0, 4000, 3000), shape: 'gable', pitch: 40, overhang: 0, thickness: 200, ridgeAngle: 0 });
    const parts = build(t.project, roof);
    expect(parts.find((p) => p.name === 'infill')?.materialId).toBe('plaster-white');
    expect(openEdges(parts)).toBe(0);
    expect(build(t.project, t.add('roof', { outline: rect(0, 0, 0, 3000), shape: 'gable', pitch: 30, overhang: 0, thickness: 200, ridgeAngle: 0 }))).toEqual([]);
    expect(roofPlanes(t.project, t.add('roof', { outline: [], shape: 'hip', pitch: 30, overhang: 0, thickness: 200, ridgeAngle: 0 }))).toBeNull();
  });
});
