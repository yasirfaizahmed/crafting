import { describe, expect, it } from 'vitest';
import { createElement } from '../defaults';
import { boundsOf, centroid, dirFromDeg, dot, perp, sub } from '../math2d';
import { computeStairLayout, mirrorStair, reverseStair } from '../stairs';
import type { Stair, StairShape, Vec2 } from '../types';

const H = 3000;
const SHAPES: StairShape[] = ['straight', 'l-shape', 'u-shape', 'spiral'];

const stair = (shape: StairShape, props: Partial<Stair> = {}): Stair =>
  createElement('stair', 'lvl', { shape, position: { x: 2000, y: 1000 }, rotation: 30, width: 1000, tread: 260, ...props });

const key = (p: Vec2) => `${Math.round(p.x)},${Math.round(p.y)}`;
/** Tread and landing centroids, order-independent. */
const places = (s: Stair) => {
  const l = computeStairLayout(s, H);
  return [...l.treads, ...l.landings].map((t) => key(centroid(t.polygon))).sort();
};
/** Footprint extents measured along the axes of `frame` (the original stair's direction of travel). */
const bbox = (s: Stair, frame: Stair) => {
  const f = dirFromDeg(frame.rotation);
  const n = perp(f);
  const b = boundsOf(computeStairLayout(s, H).footprint.flat().map((p) => ({ x: dot(p, f), y: dot(p, n) })));
  return [b.minX, b.minY, b.maxX, b.maxY].map((v) => Math.round(v));
};

describe('reverseStair (flip up/down in place)', () => {
  for (const shape of SHAPES) {
    it(`${shape}: same treads and landing, walked the other way`, () => {
      const s = stair(shape);
      const r = reverseStair(s, H);
      expect(places(r)).toEqual(places(s));
      expect(bbox(r, s)).toEqual(bbox(s, s));
      // The new foot is the old top, and the old foot is the new top.
      const a = computeStairLayout(s, H).walkline;
      const b = computeStairLayout(r, H).walkline;
      expect(key(b[0])).toBe(key(a[a.length - 1]));
      expect(key(b[b.length - 1])).toBe(key(a[0]));
      // Flipping twice gives the original stair back.
      expect(places(reverseStair(r, H))).toEqual(places(s));
      expect(key(reverseStair(r, H).position)).toBe(key(s.position));
    });
  }

  it('keeps the landing in place for an odd split by swapping flight lengths', () => {
    const odd = { ...stair('l-shape'), firstFlightTreads: 10 };
    const r = reverseStair(odd, H);
    expect(r.firstFlightTreads).toBe(computeStairLayout(odd, H).treads.length - 10);
    expect(places(r)).toEqual(places(odd));
  });
});

describe('mirrorStair (flip left/right in place)', () => {
  for (const shape of SHAPES) {
    it(`${shape}: reflected image in the same footprint`, () => {
      const s = stair(shape);
      const m = mirrorStair(s, H);
      expect(m.turn).toBe('right');
      expect(bbox(m, s)).toEqual(bbox(s, s));
      if (shape === 'spiral') {
        // Winds the other way from the same first step.
        expect(m.position).toEqual(s.position);
        expect(m.rotation).toBe(s.rotation);
        return;
      }
      // Every tread reflects across the footprint's centre line along the direction of travel.
      const f = dirFromDeg(s.rotation);
      const n = perp(f);
      const lat = computeStairLayout(s, H).footprint.flat().map((p) => dot(sub(p, s.position), n));
      const c = (Math.min(...lat) + Math.max(...lat)) / 2;
      const reflect = (p: Vec2): Vec2 => {
        const d = dot(sub(p, s.position), n) - c;
        return { x: p.x - 2 * d * n.x, y: p.y - 2 * d * n.y };
      };
      const l = computeStairLayout(s, H);
      const expected = [...l.treads, ...l.landings].map((t) => key(reflect(centroid(t.polygon)))).sort();
      expect(places(m)).toEqual(expected);
      expect(places(mirrorStair(m, H))).toEqual(places(s));
    });
  }

  it('swaps a one-sided handrail and leaves other props alone', () => {
    const s = stair('straight', { props: { handrail: 'left', note: 'x' } });
    expect(mirrorStair(s, H).props).toEqual({ handrail: 'right', note: 'x' });
    expect(reverseStair(s, H).props).toEqual({ handrail: 'right', note: 'x' });
    expect(mirrorStair(stair('straight'), H).props).toBeUndefined();
  });
});

describe('firstFlightTreads', () => {
  it('moves the landing and is clamped to leave at least one tread per flight', () => {
    const base = stair('l-shape');
    const total = computeStairLayout(base, H).treads.length;
    expect(computeStairLayout({ ...base, firstFlightTreads: 3 }, H).flights?.[0].treadIndices).toHaveLength(3);
    expect(computeStairLayout({ ...base, firstFlightTreads: 0 }, H).flights?.[0].treadIndices).toHaveLength(1);
    expect(computeStairLayout({ ...base, firstFlightTreads: 99 }, H).flights?.[1].treadIndices).toHaveLength(1);
    expect(computeStairLayout({ ...base, firstFlightTreads: 3 }, H).treads).toHaveLength(total);
  });
});
