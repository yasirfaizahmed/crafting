import { describe, expect, it } from 'vitest';
import { polygonArea } from '../../core/math2d';
import { Model, chain, determinant, placement, rotateX, rotateZ, translate } from '../model';
import { chordAtX, clipSlabX, ellipse, offsetPolygon, rectRegion, roundedRect, triangulate } from '../poly2d';
import { expectValidParts, openEdges, planBounds, volumeOf } from './helpers';

const close = (a: number, b: number, rel = 1e-4) => expect(Math.abs(a - b)).toBeLessThanOrEqual(Math.abs(b) * rel + 1e-3);
const ngon = (n: number, r: number) => 0.5 * n * r * r * Math.sin((2 * Math.PI) / n);

describe('Model primitives are closed, outward-wound solids', () => {
  const cases: [string, (m: Model) => void, number][] = [
    ['box', (m) => m.box(0, 0, 0, 100, 200, 300), 100 * 200 * 300],
    ['box with swapped corners', (m) => m.box(100, 200, 300, 0, 0, 0), 100 * 200 * 300],
    ['boxC', (m) => m.boxC(5, 5, 10, 40, 60, 80), 40 * 60 * 80],
    ['prism (concave L)', (m) => m.prism([[0, 0], [300, 0], [300, 100], [100, 100], [100, 300], [0, 300]], 0, 50), (300 * 100 + 100 * 200) * 50],
    ['prism (clockwise ring)', (m) => m.prism([[0, 0], [0, 100], [100, 100], [100, 0]], 0, 10), 100 * 100 * 10],
    ['prism with hole', (m) => m.prism([[0, 0], [400, 0], [400, 400], [0, 400]], 0, 20, [[[100, 100], [300, 100], [300, 300], [100, 300]]]), (160000 - 40000) * 20],
    ['prismY (x-z profile)', (m) => m.prismY([[0, 0], [300, 0], [0, 200]], -50, 50), 0.5 * 300 * 200 * 100],
    ['prismX (y-z profile)', (m) => m.prismX([[0, 0], [300, 0], [300, 200]], 10, 110), 0.5 * 300 * 200 * 100],
    ['cylinder', (m) => m.cylinder(0, 0, 0, 100, 50, 24), ngon(24, 50) * 100],
    ['elliptic cylinder', (m) => m.cylinder(0, 0, 0, 100, 50, 32, 50, 20), ngon(32, 1) * 50 * 20 * 100],
    ['cone', (m) => m.cylinder(0, 0, 0, 300, 100, 16, 0), (ngon(16, 100) * 300) / 3],
    ['frustum', (m) => m.cylinder(0, 0, 0, 90, 60, 12, 30), (90 / 3) * (ngon(12, 60) + ngon(12, 30) + Math.sqrt(ngon(12, 60) * ngon(12, 30)))],
    ['cylinderX', (m) => m.cylinderX(0, 200, 0, 0, 40, 16), ngon(16, 40) * 200],
    ['cylinderY', (m) => m.cylinderY(-100, 100, 5, 5, 40, 16), ngon(16, 40) * 200],
    ['tube (diagonal)', (m) => m.tube([0, 0, 0], [100, 200, 300], 20, 8), ngon(8, 20) * Math.hypot(100, 200, 300)],
    ['bar (vertical)', (m) => m.bar([0, 0, 0], [0, 0, 500], 40, 20), 40 * 20 * 500],
    ['bar (sloped)', (m) => m.bar([0, 0, 0], [300, 0, 400], 50, 30), 50 * 30 * 500],
    ['tray', (m) => m.tray([[0, 0], [200, 0], [200, 100], [0, 100]], [[20, 20], [180, 20], [180, 80], [20, 80]], 0, 10, 50), 200 * 100 * 10 + (20000 - 160 * 60) * 40],
  ];
  for (const [name, build, expected] of cases) {
    it(name, () => {
      const m = new Model();
      build(m);
      const parts = m.parts();
      expectValidParts(parts);
      close(volumeOf(parts), expected, 1e-4);
      expect(openEdges(parts)).toBe(0);
    });
  }

  it('sphere volume approaches the ellipsoid volume', () => {
    const m = new Model();
    m.sphere(0, 0, 0, 100, 60, 40, 32, 16);
    const v = volumeOf(m.parts());
    const exact = (4 / 3) * Math.PI * 100 * 60 * 40;
    expect(v).toBeGreaterThan(exact * 0.95);
    expect(v).toBeLessThan(exact);
    expect(openEdges(m.parts())).toBe(0);
  });

  it('keeps outward winding under mirroring and arbitrary rotations', () => {
    const build = (m: Model) => {
      m.box(0, 0, 0, 100, 100, 100);
      m.cylinder(300, 0, 0, 100, 50, 12);
      m.sphere(0, 400, 0, 50, 50, 50, 12, 8);
    };
    const ref = new Model();
    build(ref);
    const expected = volumeOf(ref.parts());
    expect(expected).toBeGreaterThan(1e6);
    for (const root of [placement(1000, 2000, 300, 37, true), chain(rotateX(30), rotateZ(-110), translate(5, 6, 7))]) {
      const m = new Model(root);
      build(m);
      close(volumeOf(m.parts()), expected, 1e-3);
      expect(openEdges(m.parts())).toBe(0);
    }
    expect(determinant(placement(0, 0, 0, 10, true))).toBeLessThan(0);
  });

  it('places local coordinates into plan space (mirror flips local x)', () => {
    const m = new Model(placement(1000, 0, 500, 90, true));
    m.box(0, 0, 0, 100, 10, 10);
    const b = planBounds(m.parts());
    // Local +x is mirrored to −x, then rotated 90° → plan −y.
    expect(b.minY).toBeCloseTo(-100, 3);
    expect(b.maxY).toBeCloseTo(0, 3);
    expect(b.minZ).toBeCloseTo(500, 3);
  });

  it('buckets geometry by material and role in insertion order', () => {
    const m = new Model(undefined, 'concrete');
    m.box(0, 0, 0, 1, 1, 1);
    m.use('glass-clear', 'glass');
    m.box(0, 0, 0, 1, 1, 1);
    m.use('concrete');
    m.box(2, 0, 0, 3, 1, 1);
    const parts = m.parts();
    expect(parts.map((p) => [p.materialId, p.role])).toEqual([
      ['concrete', 'body'],
      ['glass-clear', 'glass'],
    ]);
  });

  it('skips degenerate primitives', () => {
    const m = new Model();
    m.box(0, 0, 0, 0, 10, 10);
    m.cylinder(0, 0, 0, 0, 10);
    m.prism([[0, 0], [1, 1]], 0, 1);
    m.tube([0, 0, 0], [0, 0, 0], 5);
    expect(m.isEmpty).toBe(true);
    expect(m.parts()).toEqual([]);
  });
});

describe('poly2d', () => {
  it('triangulates polygons with holes with CCW triangles covering the area', () => {
    const outer = roundedRect(0, 0, 1000, 600, 100, 4);
    const hole = [...ellipse(500, 300, 150, 100, 16)].reverse();
    const { points, tris } = triangulate(outer, [hole]);
    let area = 0;
    for (const [a, b, c] of tris) {
      const cr = (points[b].x - points[a].x) * (points[c].y - points[a].y) - (points[c].x - points[a].x) * (points[b].y - points[a].y);
      expect(cr).toBeGreaterThanOrEqual(0);
      area += cr / 2;
    }
    expect(area).toBeCloseTo(polygonArea(outer) - polygonArea(hole), 3);
  });

  it('clips polygons to slabs and measures chords', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(polygonArea(clipSlabX(sq, 25, 75))).toBeCloseTo(5000);
    expect(clipSlabX(sq, 200, 300)).toEqual([]);
    expect(chordAtX(sq, 50)).toEqual([[0, 100]]);
    expect(chordAtX(sq, 150)).toEqual([]);
    const tri = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 0, y: 100 },
    ];
    expect(chordAtX(tri, 50)[0][1]).toBeCloseTo(50);
  });

  it('offsets polygons outward and inward', () => {
    const sq = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(polygonArea(offsetPolygon(sq, 10))).toBeCloseTo(120 * 120);
    expect(polygonArea(offsetPolygon(sq, -10))).toBeCloseTo(80 * 80);
  });

  describe('rectRegion', () => {
    const bounds = { x0: 0, x1: 1000, y0: 0, y1: 500 };
    const area = (r: ReturnType<typeof rectRegion>) =>
      r.polygons.reduce((s, p) => s + polygonArea(p.outer) - p.holes.reduce((h, x) => h + polygonArea(x), 0), 0);

    it('returns the rectangle without holes', () => {
      const r = rectRegion(bounds, []);
      expect(r.loops).toHaveLength(1);
      expect(area(r)).toBe(500000);
    });
    it('keeps an interior hole as a hole', () => {
      const r = rectRegion(bounds, [{ x0: 200, x1: 400, y0: 100, y1: 300 }]);
      expect(r.polygons).toHaveLength(1);
      expect(r.polygons[0].holes).toHaveLength(1);
      expect(area(r)).toBe(500000 - 40000);
    });
    it('turns a hole touching the boundary into a notch', () => {
      const r = rectRegion(bounds, [{ x0: 200, x1: 400, y0: -50, y1: 300 }]);
      expect(r.polygons).toHaveLength(1);
      expect(r.polygons[0].holes).toHaveLength(0);
      expect(r.polygons[0].outer).toHaveLength(8);
      expect(area(r)).toBe(500000 - 60000);
    });
    it('splits the region when a hole cuts through', () => {
      const r = rectRegion(bounds, [{ x0: 200, x1: 400, y0: 0, y1: 500 }]);
      expect(r.polygons).toHaveLength(2);
      expect(area(r)).toBe(400000);
    });
    it('handles overlapping holes and holes touching at a corner', () => {
      const r = rectRegion(bounds, [
        { x0: 100, x1: 300, y0: 100, y1: 300 },
        { x0: 200, x1: 400, y0: 200, y1: 400 },
        { x0: 400, x1: 500, y0: 100, y1: 200 },
      ]);
      const expected = 500000 - (40000 + 40000 - 10000) - 10000;
      expect(area(r)).toBe(expected);
      let tri = 0;
      for (const pg of r.polygons) {
        const { points, tris } = triangulate(pg.outer, pg.holes);
        for (const [a, b, c] of tris)
          tri += ((points[b].x - points[a].x) * (points[c].y - points[a].y) - (points[c].x - points[a].x) * (points[b].y - points[a].y)) / 2;
      }
      expect(tri).toBeCloseTo(expected, 3);
    });
    it('returns nothing for a fully covered or empty region', () => {
      expect(rectRegion(bounds, [{ x0: -10, x1: 2000, y0: -10, y1: 600 }]).polygons).toHaveLength(0);
      expect(rectRegion({ x0: 0, x1: 0, y0: 0, y1: 10 }, []).polygons).toHaveLength(0);
    });
  });
});
