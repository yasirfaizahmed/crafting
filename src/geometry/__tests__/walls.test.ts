import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { polygonArea } from '../../core/math2d';
import type { Opening, Project, Wall } from '../../core/types';
import { computeWallFootprints, openingsOfWall, wallBaseElevation, wallHeight } from '../../core/walls';
import { buildElementGeometry, createGeometryContext } from '../index';
import { clipSlabX } from '../poly2d';
import { openingRect, wallFrame } from '../walls';
import { expectValidParts, openEdges, planBounds, testProject, volumeOf } from './helpers';

function build(project: Project, wall: Wall) {
  return buildElementGeometry(createGeometryContext(project), wall).parts;
}

/** Expected wall volume: footprint area × height − Σ (footprint ∩ opening strip) × clamped opening height. */
function expectedVolume(project: Project, wall: Wall): number {
  const f = wallFrame(createGeometryContext(project), wall)!;
  let v = polygonArea(f.ul) * f.height;
  for (const op of openingsOfWall(project, wall.id)) {
    const r = openingRect(op, f.height);
    if (!r) continue;
    v -= polygonArea(clipSlabX(f.ul, r.x0, r.x1)) * (r.y1 - r.y0);
  }
  return v;
}

const near = (a: number, b: number, rel: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.abs(b) * rel);

describe('wall geometry', () => {
  it('builds a free-standing wall as a watertight box', () => {
    const { project, add } = testProject();
    const w = add('wall', { start: { x: 0, y: 0 }, end: { x: 4000, y: 0 }, thickness: 200 });
    const parts = build(project, w);
    expectValidParts(parts);
    expect(parts).toHaveLength(1);
    expect(parts[0].materialId).toBe('plaster-white');
    near(volumeOf(parts), 4000 * 200 * 3000, 1e-5);
    expect(openEdges(parts)).toBe(0);
    const b = planBounds(parts);
    expect(b).toMatchObject({ minX: 0, maxX: 4000, minZ: 0, maxZ: 3000 });
    expect(b.minY).toBeCloseTo(-100, 3);
    expect(b.maxY).toBeCloseTo(100, 3);
  });

  it('cuts a window through the full thickness (jambs, sill, head reveals)', () => {
    const { project, add } = testProject();
    const w = add('wall', { start: { x: 0, y: 0 }, end: { x: 5000, y: 0 }, thickness: 250, materialId: 'brick-red' });
    add('window', { hostId: w.id, offset: 2500, width: 1200, height: 1200, sill: 900 });
    const parts = build(project, w);
    expectValidParts(parts);
    near(volumeOf(parts), 5000 * 250 * 3000 - 1200 * 250 * 1200, 1e-5);
    expect(openEdges(parts)).toBe(0);
    // A ray through the window centre hits no wall triangle.
    expect(hitsAt(parts, 2500, 1500)).toBe(false);
    expect(hitsAt(parts, 1000, 1500)).toBe(true);
  });

  it('leaves no bottom face under a door with sill 0', () => {
    const { project, add } = testProject();
    const w = add('wall', { start: { x: 0, y: 0 }, end: { x: 4000, y: 0 }, thickness: 200 });
    add('door', { hostId: w.id, offset: 2000, width: 900, height: 2100, sill: 0 });
    const parts = build(project, w);
    near(volumeOf(parts), 4000 * 200 * 3000 - 900 * 200 * 2100, 1e-5);
    expect(openEdges(parts)).toBe(0);
    for (const t of triangles(parts)) {
      const cz = (t[0][2] + t[1][2] + t[2][2]) / 3;
      const cx = (t[0][0] + t[1][0] + t[2][0]) / 3;
      if (Math.abs(cz) < 1e-6) expect(cx < 1550 || cx > 2450).toBe(true);
    }
  });

  it('clamps openings taller than the wall (notch at the top)', () => {
    const { project, add } = testProject();
    const w = add('wall', { start: { x: 0, y: 0 }, end: { x: 4000, y: 0 }, thickness: 200, height: 2400 });
    add('window', { hostId: w.id, offset: 2000, width: 1000, height: 2000, sill: 1000 });
    const parts = build(project, w);
    near(volumeOf(parts), 4000 * 200 * 2400 - 1000 * 200 * 1400, 1e-5);
    expect(openEdges(parts)).toBe(0);
    expect(planBounds(parts).maxZ).toBeCloseTo(2400, 3);
  });

  it('handles an opening clipped by the wall end and a full-height cut splitting the wall', () => {
    const { project, add } = testProject();
    const w = add('wall', { start: { x: 0, y: 0 }, end: { x: 3000, y: 0 }, thickness: 200 });
    add('window', { hostId: w.id, offset: 100, width: 800, height: 1000, sill: 1000 });
    add('door', { hostId: w.id, offset: 2000, width: 600, height: 3500, sill: 0 });
    const parts = build(project, w);
    expectValidParts(parts);
    near(volumeOf(parts), 3000 * 200 * 3000 - 500 * 200 * 1000 - 600 * 200 * 3000, 1e-5);
    expect(openEdges(parts)).toBe(0);
  });

  it('handles adjacent and overlapping openings robustly', () => {
    const { project, add } = testProject();
    const w = add('wall', { start: { x: 0, y: 0 }, end: { x: 6000, y: 0 }, thickness: 200 });
    add('door', { hostId: w.id, offset: 1000, width: 1000, height: 2100 });
    add('window', { hostId: w.id, offset: 2000, width: 1000, height: 1000, sill: 1100 });
    add('window', { hostId: w.id, offset: 4000, width: 1000, height: 1000, sill: 1000 });
    add('window', { hostId: w.id, offset: 4500, width: 1000, height: 1000, sill: 1500 });
    const parts = build(project, w);
    expectValidParts(parts);
    const cut = 1000 * 2100 + 1000 * 1000 + (1000 * 1000 + 1000 * 1000 - 500 * 500);
    near(volumeOf(parts), 6000 * 200 * 3000 - cut * 200, 1e-5);
    expect(openEdges(parts)).toBe(0);
  });

  it('returns nothing for zero-length walls and ignores degenerate openings', () => {
    const { project, add } = testProject();
    const z = add('wall', { start: { x: 100, y: 100 }, end: { x: 100, y: 100 } });
    expect(build(project, z)).toEqual([]);
    const w = add('wall', { start: { x: 0, y: 0 }, end: { x: 2000, y: 0 } });
    add('window', { hostId: w.id, offset: 1000, width: 0, height: 1000, sill: 900 });
    add('window', { hostId: w.id, offset: 1000, width: 500, height: 1000, sill: 5000 });
    near(volumeOf(build(project, w)), 2000 * 200 * 3000, 1e-5);
  });

  it('respects baseOffset, explicit height and level elevation', () => {
    const { project, add } = testProject();
    project.levels[0].elevation = 1000;
    const w = add('wall', { start: { x: 0, y: 0 }, end: { x: 2000, y: 0 }, baseOffset: 300, height: 1200 });
    const b = planBounds(build(project, w));
    expect(b.minZ).toBeCloseTo(1300, 3);
    expect(b.maxZ).toBeCloseTo(2500, 3);
    expect(wallBaseElevation(project, w)).toBe(1300);
  });

  it('places left/right justified bodies on the correct side of the location line', () => {
    const { project, add } = testProject();
    const l = add('wall', { start: { x: 0, y: 0 }, end: { x: 2000, y: 0 }, justification: 'left', thickness: 200 });
    const r = add('wall', { start: { x: 0, y: 5000 }, end: { x: 2000, y: 5000 }, justification: 'right', thickness: 200 });
    const bl = planBounds(build(project, l));
    expect(bl.maxY).toBeCloseTo(0, 3);
    expect(bl.minY).toBeCloseTo(-200, 3);
    const br = planBounds(build(project, r));
    expect(br.minY).toBeCloseTo(5000, 3);
    expect(br.maxY).toBeCloseTo(5200, 3);
  });

  it('puts left/right finishes in separate parts facing the right way', () => {
    const { project, add } = testProject();
    const w = add('wall', { start: { x: 0, y: 0 }, end: { x: 3000, y: 0 }, leftFinishId: 'paint-sage', rightFinishId: 'brick-white', materialId: 'block-cmu' });
    add('window', { hostId: w.id, offset: 1500, width: 1000, height: 1000, sill: 900 });
    const parts = build(project, w);
    const left = parts.find((p) => p.name === 'left')!;
    const right = parts.find((p) => p.name === 'right')!;
    expect(left).toMatchObject({ materialId: 'paint-sage', role: 'finish' });
    expect(right).toMatchObject({ materialId: 'brick-white', role: 'finish' });
    expect(parts.find((p) => p.role === 'body')!.materialId).toBe('block-cmu');
    // Wall runs along +x: left = plan +y = world −z.
    for (let i = 0; i < left.mesh.normals.length; i += 3) expect(left.mesh.normals[i + 2]).toBeCloseTo(-1, 5);
    for (let i = 0; i < right.mesh.normals.length; i += 3) expect(right.mesh.normals[i + 2]).toBeCloseTo(1, 5);
    expect(openEdges(parts)).toBe(0);
    near(volumeOf(parts), 3000 * 200 * 3000 - 1000 * 200 * 1000, 1e-5);
  });

  it('uses join-aware footprints at L, T and X junctions', () => {
    const { project, add } = testProject();
    const a = add('wall', { start: { x: 0, y: 0 }, end: { x: 4000, y: 0 } });
    const b = add('wall', { start: { x: 4000, y: 0 }, end: { x: 4000, y: 3000 } });
    const t = add('wall', { start: { x: 2000, y: 0 }, end: { x: 2000, y: 3000 }, thickness: 100 });
    const x1 = add('wall', { start: { x: 6000, y: -1000 }, end: { x: 6000, y: 1000 } });
    const x2 = add('wall', { start: { x: 5000, y: 0 }, end: { x: 6000, y: 0 } });
    const x3 = add('wall', { start: { x: 6000, y: 0 }, end: { x: 7000, y: 0 } });
    add('window', { hostId: a.id, offset: 3600, width: 500, height: 800, sill: 1000 }); // runs into the miter zone
    const fps = computeWallFootprints(project, project.levels[0].id);
    for (const w of [a, b, t, x1, x2, x3]) {
      const parts = build(project, w);
      expectValidParts(parts);
      expect(openEdges(parts)).toBe(0);
      near(volumeOf(parts), expectedVolume(project, w), 1e-4);
      expect(polygonArea(fps.get(w.id)!.polygon)).toBeGreaterThan(0);
    }
  });

  it('uses glass role for glass walls', () => {
    const { project, add } = testProject();
    const w = add('wall', { start: { x: 0, y: 0 }, end: { x: 2000, y: 0 }, thickness: 60, materialId: 'glass-clear' });
    expect(build(project, w)[0]).toMatchObject({ role: 'glass', materialId: 'glass-clear' });
  });

  it('matches footprint area × height − openings for every sample wall (within 1%)', () => {
    const p = createSampleProject();
    const ctx = createGeometryContext(p);
    const walls = Object.values(p.elements).filter((e): e is Wall => e.type === 'wall');
    expect(walls.length).toBeGreaterThan(10);
    for (const w of walls) {
      const parts = buildElementGeometry(ctx, w).parts;
      expectValidParts(parts);
      expect(openEdges(parts)).toBe(0);
      const fp = ctx.footprints(w.levelId).get(w.id)!;
      const H = wallHeight(p, w);
      const ops: Opening[] = openingsOfWall(p, w.id);
      const simple = polygonArea(fp.polygon) * H - ops.reduce((s, o) => s + o.width * w.thickness * Math.min(o.height, H - o.sill), 0);
      near(volumeOf(parts), simple, 0.01);
    }
  });
});

type T3 = [number, number, number][];

/** Triangles in plan mm (x, y, z=elevation). */
function triangles(parts: ReturnType<typeof build>): T3[] {
  const out: T3[] = [];
  for (const p of parts) {
    const pos = p.mesh.positions;
    const v = (i: number): [number, number, number] => [pos[i * 3] * 1000, -pos[i * 3 + 2] * 1000, pos[i * 3 + 1] * 1000];
    for (let i = 0; i < p.mesh.indices.length; i += 3) out.push([v(p.mesh.indices[i]), v(p.mesh.indices[i + 1]), v(p.mesh.indices[i + 2])]);
  }
  return out;
}

/** Does a ray along plan y at (x, z) hit any triangle? */
function hitsAt(parts: ReturnType<typeof build>, x: number, z: number): boolean {
  for (const t of triangles(parts)) {
    const [a, b, c] = t.map((p) => [p[0], p[2]]);
    const d = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    if (Math.abs(d) < 1e-9) continue;
    const u = ((x - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (z - a[1])) / d;
    const v = ((b[0] - a[0]) * (z - a[1]) - (x - a[0]) * (b[1] - a[1])) / d;
    if (u >= 0 && v >= 0 && u + v <= 1) return true;
  }
  return false;
}
