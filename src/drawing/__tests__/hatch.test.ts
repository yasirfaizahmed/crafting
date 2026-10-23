import { describe, expect, it } from 'vitest';
import { distance, pointInPolygon, rectPolygon } from '../../core/math2d';
import { clipSegment, unionOutline } from '../geom';
import { HATCHES, hatchFamilies, hatchLines } from '../hatch';

const total = (segs: [{ x: number; y: number }, { x: number; y: number }][]) => segs.reduce((s, [a, b]) => s + distance(a, b), 0);
const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

describe('hatchLines', () => {
  const square = rectPolygon(0, 0, 100, 100);

  it('fills a square with continuous lines whose total length is area / spacing', () => {
    const segs = hatchLines(square, [], 'brick', 5);
    expect(segs.length).toBeGreaterThan(20);
    expect(total(segs)).toBeCloseTo(10000 / 5, -1);
    for (const [a, b] of segs) {
      for (const p of [a, b]) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-6);
        expect(p.x).toBeLessThanOrEqual(100 + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(-1e-6);
        expect(p.y).toBeLessThanOrEqual(100 + 1e-6);
      }
    }
  });

  it('leaves holes empty (even-odd)', () => {
    const hole = rectPolygon(30, 30, 70, 70);
    const segs = hatchLines(square, [hole], 'brick', 5);
    expect(total(segs)).toBeCloseTo((10000 - 1600) / 5, -1);
    for (const [a, b] of segs) expect(pointInPolygon(mid(a, b), hole)).toBe(false);
  });

  it('clips concave outlines', () => {
    const L = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 40 },
      { x: 40, y: 40 },
      { x: 40, y: 100 },
      { x: 0, y: 100 },
    ];
    const segs = hatchLines(L, [], 'brick', 4);
    expect(segs.length).toBeGreaterThan(10);
    for (const [a, b] of segs) expect(pointInPolygon(mid(a, b), L)).toBe(true);
    expect(total(segs)).toBeCloseTo((10000 - 3600) / 4, -1);
  });

  it('applies dash patterns and dots, staying inside the region', () => {
    for (const pattern of ['steel', 'stone', 'glass', 'concrete', 'insulation', 'wood', 'earth'] as const) {
      const segs = hatchLines(square, [], pattern, 3);
      expect(segs.length, pattern).toBeGreaterThan(0);
      for (const [a, b] of segs) expect(pointInPolygon(mid(a, b), rectPolygon(-0.01, -0.01, 100.01, 100.01))).toBe(true);
    }
    const dotted = hatchLines(square, [], 'glass', 3);
    expect(dotted.some(([a, b]) => distance(a, b) === 0)).toBe(true);
    // Dashed patterns cover less than continuous ones.
    expect(total(hatchLines(square, [], 'concrete', 3))).toBeLessThan(total(hatchLines(square, [], 'brick', 3)));
  });

  it('returns nothing for none / solid or degenerate input', () => {
    expect(hatchLines(square, [], 'none', 5)).toEqual([]);
    expect(hatchLines(square, [], 'solid', 5)).toEqual([]);
    expect(hatchLines(square.slice(0, 2), [], 'brick', 5)).toEqual([]);
    expect(hatchLines(square, [], 'brick', 0)).toEqual([]);
  });

  it('rotates the pattern with the angle argument', () => {
    const a = hatchLines(rectPolygon(0, 0, 100, 10), [], 'brick', 2, 0);
    const b = hatchLines(rectPolygon(0, 0, 100, 10), [], 'brick', 2, -45);
    // At −45° the lines are horizontal: each spans the full 100 mm width.
    expect(Math.max(...b.map(([p, q]) => distance(p, q)))).toBeCloseTo(100, 3);
    expect(Math.max(...a.map(([p, q]) => distance(p, q)))).toBeLessThan(20);
  });

  it('pattern families are consistent with their DXF definitions', () => {
    for (const [name, def] of Object.entries(HATCHES)) {
      const fams = hatchFamilies(name as keyof typeof HATCHES, 10);
      expect(fams.length).toBe(def.families.length);
      for (const f of fams) expect(Math.hypot(f.offset.x, f.offset.y)).toBeGreaterThan(0);
    }
  });
});

describe('geometry helpers', () => {
  it('clips segments to rings and their complement', () => {
    const sq = rectPolygon(0, 0, 10, 10);
    const inside = clipSegment({ x: -5, y: 5 }, { x: 15, y: 5 }, [sq]);
    expect(inside).toHaveLength(1);
    expect(inside[0][0].x).toBeCloseTo(0);
    expect(inside[0][1].x).toBeCloseTo(10);
    const outside = clipSegment({ x: -5, y: 5 }, { x: 15, y: 5 }, [sq], true);
    expect(outside).toHaveLength(2);
  });

  it('unions abutting polygons without internal joint lines', () => {
    const a = rectPolygon(0, 0, 10, 2);
    const b = rectPolygon(10, 0, 20, 2);
    const { outline, seams } = unionOutline([{ polygon: a, key: 'x' }, { polygon: b, key: 'x' }]);
    expect(outline.some(([p, q]) => Math.abs(p.x - 10) < 1e-6 && Math.abs(q.x - 10) < 1e-6)).toBe(false);
    expect(total(outline)).toBeCloseTo(44, 6);
    expect(seams).toHaveLength(0);
    const mixed = unionOutline([{ polygon: a, key: 'x' }, { polygon: b, key: 'y' }]);
    expect(total(mixed.seams)).toBeCloseTo(2, 6);
  });
});
