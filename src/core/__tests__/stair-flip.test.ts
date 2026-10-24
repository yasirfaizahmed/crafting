import { describe, expect, it } from 'vitest';
import { createElement } from '../defaults';
import { boundsOf, centroid, dirFromDeg, dot, perp, sub } from '../math2d';
import { computeStairLayout, mirrorStair, reverseStair } from '../stairs';
import type { Stair, StairShape, Vec2 } from '../types';

const H = 3000;
const SHAPES: StairShape[] = ['straight', 'l-shape', 'u-shape', 'open-well', 'spiral'];

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

describe('open-well stair (three flights, two corner landings)', () => {
  const ow = (props: Partial<Stair> = {}) => stair('open-well', { rotation: 0, position: { x: 0, y: 0 }, width: 1000, tread: 280, ...props });

  it('splits the treads into three flights around a well, with two landings', () => {
    const l = computeStairLayout(ow(), H); // 18 risers → 17 tread levels = 5 + landing + 5 + landing + 5
    expect(l.flights?.map((f) => f.treadIndices.length)).toEqual([5, 5, 5]);
    expect(l.landings).toHaveLength(2);
    expect(l.treads).toHaveLength(15);
    // Walking order rises one riser at a time, ending one riser below the floor above.
    const tops = [
      ...l.flights![0].treadIndices.map((i) => l.treads[i].top),
      l.landings[0].top,
      ...l.flights![1].treadIndices.map((i) => l.treads[i].top),
      l.landings[1].top,
      ...l.flights![2].treadIndices.map((i) => l.treads[i].top),
    ];
    tops.forEach((t, i) => expect(t).toBeCloseTo((i + 1) * l.riserHeight, 6));
    expect(tops.at(-1)).toBeCloseTo(H - l.riserHeight, 6);
  });

  it('leaves an open well as wide as the middle flight between the side flights', () => {
    const s = ow({ turn: 'left', secondFlightTreads: 4 });
    const l = computeStairLayout(s, H);
    const [f1, f2, f3] = l.flights!;
    expect(f2.treadIndices).toHaveLength(4);
    // Flight 1 runs up +x on y ∈ [−500, 500]; flight 3 comes back down −x on the far side of the well.
    const ys = (i: number) => l.treads[i].polygon.map((p) => p.y);
    const f1Max = Math.max(...f1.treadIndices.flatMap(ys));
    const f3Min = Math.min(...f3.treadIndices.flatMap(ys));
    expect(f3Min - f1Max).toBeCloseTo(4 * 280, 6);
    expect(f3.direction.x).toBeCloseTo(-1, 9);
    // Flights and landings never overlap (rotation 0: every part is an axis-aligned rectangle).
    const boxes = l.footprint.map((poly) => boundsOf(poly));
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const w = Math.min(boxes[i].maxX, boxes[j].maxX) - Math.max(boxes[i].minX, boxes[j].minX);
        const h = Math.min(boxes[i].maxY, boxes[j].maxY) - Math.max(boxes[i].minY, boxes[j].minY);
        expect(Math.max(0, w) * Math.max(0, h)).toBeLessThan(1e-6);
      }
  });

  it('turns right like the sketch: up one side, across the head, down the other side', () => {
    const l = computeStairLayout(ow({ turn: 'right', rotation: 90 }), H);
    const dirs = l.flights!.map((f) => [Math.round(f.direction.x) + 0, Math.round(f.direction.y) + 0]);
    expect(dirs).toEqual([
      [0, 1],
      [1, 0],
      [0, -1],
    ]);
  });

  it('falls back to a two-flight U when there are too few risers', () => {
    expect(computeStairLayout(ow({ rise: 600 }), H).flights?.length ?? 0).toBeLessThan(3);
  });
});

describe('landing extensions (stretching a platform on any side)', () => {
  const custom = (runs: Stair['runs'], props: Partial<Stair> = {}) => stair('straight', { rotation: 0, position: { x: 0, y: 0 }, width: 1000, tread: 280, runs, ...props });
  const landing = (s: Stair, i = 0) => boundsOf(computeStairLayout(s, H).landings[i].polygon);
  const flightStart = (s: Stair, i: number) => computeStairLayout(s, H).flights![i].start;

  it('quarter turn: the outer side and the far edge past the next flight grow only the platform', () => {
    // Up +x, turn left (+y). Landing: x ∈ [1960, 2960], y ∈ [−500, 500].
    const base = custom({ flights: [{ treads: 7 }, { treads: 8 }], landings: [{ turn: 'left', angle: 90 }] });
    const b0 = landing(base);
    const outer = custom({ ...base.runs!, landings: [{ turn: 'left', angle: 90, extendRight: 400 }] });
    expect(landing(outer).minY).toBeCloseTo(b0.minY - 400, 6);
    expect(landing(outer).maxY).toBeCloseTo(b0.maxY, 6);
    expect(key(flightStart(outer, 1))).toBe(key(flightStart(base, 1)));
    const past = custom({ ...base.runs!, landings: [{ turn: 'left', angle: 90, beyond: 300 }] });
    expect(landing(past).maxX).toBeCloseTo(b0.maxX + 300, 6);
    expect(key(flightStart(past, 1))).toBe(key(flightStart(base, 1)));
  });

  it('quarter turn: stretching the side the next flight leaves from moves that flight out', () => {
    const base = custom({ flights: [{ treads: 7 }, { treads: 8 }], landings: [{ turn: 'left', angle: 90 }] });
    const run = custom({ ...base.runs!, landings: [{ turn: 'left', angle: 90, extendLeft: 500 }] });
    expect(landing(run).maxY).toBeCloseTo(landing(base).maxY + 500, 6);
    expect(flightStart(run, 1).y).toBeCloseTo(flightStart(base, 1).y + 500, 6);
    expect(flightStart(run, 1).x).toBeCloseTo(flightStart(base, 1).x, 6);
  });

  it('straight and half-turn landings widen on either side without moving any flight', () => {
    const straight = { flights: [{ treads: 7 }, { treads: 8 }], landings: [{ turn: 'none' as const }] };
    const s = custom({ ...straight, landings: [{ turn: 'none', extendLeft: 300, extendRight: 200 }] });
    expect(landing(s).maxY).toBeCloseTo(800, 6);
    expect(landing(s).minY).toBeCloseTo(-700, 6);
    expect(key(flightStart(s, 1))).toBe(key(flightStart(custom(straight), 1)));
    const half = { flights: [{ treads: 7 }, { treads: 8 }], landings: [{ turn: 'right' as const, angle: 180 as const }] };
    const u = custom({ ...half, landings: [{ turn: 'right', angle: 180, extendLeft: 250, extendRight: 350 }] });
    const plain = landing(custom(half));
    expect(landing(u).maxY).toBeCloseTo(plain.maxY + 250, 6);
    expect(landing(u).minY).toBeCloseTo(plain.minY - 350, 6);
    expect(key(flightStart(u, 1))).toBe(key(flightStart(custom(half), 1)));
  });

  const cases: [string, Stair['runs']][] = [
    ['quarter, all extras', { flights: [{ treads: 6 }, { treads: 5, width: 900 }], landings: [{ turn: 'left', angle: 90, extendLeft: 300, extendRight: 450, beyond: 200, depth: 1400 }] }],
    ['quarter right, outer only', { flights: [{ treads: 6, width: 1100 }, { treads: 5 }], landings: [{ turn: 'right', angle: 90, extendLeft: 350 }] }],
    ['straight', { flights: [{ treads: 6 }, { treads: 5 }], landings: [{ turn: 'none', extendLeft: 120, depth: 1300 }] }],
    ['half turn', { flights: [{ treads: 6 }, { treads: 5, width: 800 }], landings: [{ turn: 'left', angle: 180, gap: 250, extendRight: 300, extendLeft: 150, depth: 1500 }] }],
    [
      'open well with deep, wide landings',
      {
        flights: [{ treads: 5 }, { treads: 4 }, { treads: 5 }],
        landings: [
          { turn: 'right', angle: 90, extendLeft: 400, depth: 1300 },
          { turn: 'right', angle: 90, extendRight: 250, beyond: 150 },
        ],
      },
    ],
  ];
  for (const [name, runs] of cases) {
    it(`${name}: reversing and mirroring keep every platform in place`, () => {
      const s = custom(runs, { rotation: 25, position: { x: 1500, y: -700 } });
      const r = reverseStair(s, H);
      expectSamePlaces(r, s);
      expectSameBox(r, s);
      const rl = computeStairLayout(r, H).landings.map((l) => Math.round(Math.abs(boundsArea(l.polygon)))).sort();
      expect(rl).toEqual(computeStairLayout(s, H).landings.map((l) => Math.round(Math.abs(boundsArea(l.polygon)))).sort());
      expectSamePlaces(reverseStair(r, H), s);
      const m = mirrorStair(s, H);
      expectSameBox(m, s);
      expectSamePlaces(mirrorStair(m, H), s);
    });
  }
});

/** Tread and landing centroids of `a` and `b` coincide (within 0.5 mm, in any order). */
function expectSamePlaces(a: Stair, b: Stair): void {
  const pts = (s: Stair) => {
    const l = computeStairLayout(s, H);
    return [...l.treads, ...l.landings].map((t) => centroid(t.polygon));
  };
  const pa = pts(a);
  const pb = pts(b);
  expect(pa).toHaveLength(pb.length);
  for (const p of pa) expect(pb.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 0.5)).toBe(true);
}

/** Footprint extents of `a` equal those of `b` in `b`'s frame (within 0.5 mm). */
function expectSameBox(a: Stair, b: Stair): void {
  const f = dirFromDeg(b.rotation);
  const n = perp(f);
  const box = (s: Stair) => {
    const r = boundsOf(computeStairLayout(s, H).footprint.flat().map((p) => ({ x: dot(p, f), y: dot(p, n) })));
    return [r.minX, r.minY, r.maxX, r.maxY];
  };
  box(a).forEach((v, i) => expect(v).toBeCloseTo(box(b)[i], 0));
}

/** Shoelace area of a polygon. */
function boundsArea(poly: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) a += poly[i].x * poly[(i + 1) % poly.length].y - poly[(i + 1) % poly.length].x * poly[i].y;
  return a / 2;
}
