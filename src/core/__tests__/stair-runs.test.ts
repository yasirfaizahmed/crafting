import { describe, expect, it } from 'vitest';
import { createElement } from '../defaults';
import { boundsOf, centroid, dirFromDeg, dot, perp } from '../math2d';
import { computeStairLayout, editableRuns, mirrorStair, resolveStairRuns, reverseStair, stairChecks } from '../stairs';
import type { Stair, StairRuns, Vec2 } from '../types';

const H = 3000;
const make = (runs: StairRuns, props: Partial<Stair> = {}): Stair =>
  createElement('stair', 'lvl', { position: { x: 1000, y: 500 }, rotation: 0, width: 1000, tread: 280, runs, ...props });

const key = (p: Vec2) => `${Math.round(p.x)},${Math.round(p.y)}`;
const places = (s: Stair) => {
  const l = computeStairLayout(s, H);
  return [...l.treads, ...l.landings].map((t) => key(centroid(t.polygon))).sort();
};

describe('custom stair runs', () => {
  it('uses every flight’s own tread count, going and width; riser height = rise / Σ(treads + 1)', () => {
    const s = make({
      flights: [{ treads: 6, going: 300, width: 1200 }, { treads: 4 }, { treads: 3, width: 900 }],
      landings: [{ turn: 'left', angle: 90 }, { turn: 'none', depth: 1500 }],
    });
    const l = computeStairLayout(s, H);
    expect(l.riserCount).toBe(7 + 5 + 4);
    expect(l.riserHeight).toBeCloseTo(3000 / 16, 9);
    expect(l.flights!.map((f) => [f.treadIndices.length, f.going, f.width])).toEqual([
      [6, 300, 1200],
      [4, 280, 1000],
      [3, 280, 900],
    ]);
    // The final riser lands on the floor above.
    const last = l.flights![2];
    expect(l.treads[last.treadIndices.at(-1)!].top + l.riserHeight).toBeCloseTo(H, 6);
    // Landing tops sit one riser above the flight below them.
    expect(l.landings[0].top).toBeCloseTo(7 * l.riserHeight, 6);
    expect(l.landings[1].top).toBeCloseTo(12 * l.riserHeight, 6);
  });

  it('places a 90° landing as wide as the incoming flight and as deep as the outgoing one', () => {
    const s = make({ flights: [{ treads: 5, width: 1200 }, { treads: 5, width: 900 }], landings: [{ turn: 'right', angle: 90 }] });
    const l = computeStairLayout(s, H);
    const b = boundsOf(l.landings[0].polygon);
    expect(b.maxX - b.minX).toBeCloseTo(900, 6); // depth along travel = outgoing width
    expect(b.maxY - b.minY).toBeCloseTo(1200, 6); // across = incoming width
    expect(l.flights![1].direction.y).toBeCloseTo(-1, 9); // turned right from +x
    expect(l.flights![1].start.x).toBeCloseTo(1000 + 5 * 280 + 450, 6); // flush with the far edge
  });

  it('opens a well of `gap` between the flights of a half turn', () => {
    const s = make({ flights: [{ treads: 6 }, { treads: 6, width: 800 }], landings: [{ turn: 'left', angle: 180, gap: 400 }] });
    const l = computeStairLayout(s, H);
    const y1 = Math.max(...l.flights![0].treadIndices.flatMap((i) => l.treads[i].polygon.map((p) => p.y)));
    const y2 = Math.min(...l.flights![1].treadIndices.flatMap((i) => l.treads[i].polygon.map((p) => p.y)));
    expect(y2 - y1).toBeCloseTo(400, 6);
    expect(l.flights![1].direction.x).toBeCloseTo(-1, 9);
  });

  it('supports straight landings and long multi-turn stairs', () => {
    const s = make({
      flights: [{ treads: 3 }, { treads: 3 }, { treads: 3 }, { treads: 3 }],
      landings: [{ turn: 'left' }, { turn: 'left' }, { turn: 'left' }],
    });
    const l = computeStairLayout(s, H);
    expect(l.landings).toHaveLength(3);
    const dirs = l.flights!.map((f) => [Math.round(f.direction.x) + 0, Math.round(f.direction.y) + 0]);
    expect(dirs).toEqual([
      [1, 0],
      [0, 1],
      [-1, 0],
      [0, -1],
    ]);
    const straight = computeStairLayout(make({ flights: [{ treads: 6 }, { treads: 6 }], landings: [{ turn: 'none', depth: 1100 }] }), H);
    expect(straight.flights![1].start.x).toBeCloseTo(1000 + 6 * 280 + 1100, 6);
  });

  it('turns presets into editable runs that reproduce them exactly', () => {
    for (const shape of ['straight', 'l-shape', 'u-shape', 'open-well'] as const) {
      const preset = createElement('stair', 'lvl', { shape, position: { x: 200, y: 300 }, rotation: 35, width: 1000, tread: 270, turn: 'right' });
      const custom = { ...preset, runs: editableRuns(preset, H)! };
      expect(places(custom)).toEqual(places(preset));
      expect(computeStairLayout(custom, H).riserHeight).toBeCloseTo(computeStairLayout(preset, H).riserHeight, 9);
    }
    expect(editableRuns(createElement('stair', 'lvl', { shape: 'spiral' }), H)).toBeNull();
  });

  it('mirrors and reverses custom stairs in place, exactly', () => {
    const s = make(
      {
        flights: [{ treads: 5, width: 1100 }, { treads: 3, going: 300 }, { treads: 6, width: 900 }],
        landings: [{ turn: 'left', angle: 180, gap: 250 }, { turn: 'none', depth: 1300 }],
      },
      { rotation: 20, handrails: 'left' },
    );
    const r = reverseStair(s, H);
    expect(places(r)).toEqual(places(s));
    expect(r.handrails).toBe('right');
    expect(places(reverseStair(r, H))).toEqual(places(s));

    const m = mirrorStair(s, H);
    const n = perp(dirFromDeg(s.rotation));
    const lat = computeStairLayout(s, H).footprint.flat().map((p) => dot({ x: p.x - s.position.x, y: p.y - s.position.y }, n));
    const c = (Math.min(...lat) + Math.max(...lat)) / 2;
    const reflect = (p: Vec2): Vec2 => {
      const d = dot({ x: p.x - s.position.x, y: p.y - s.position.y }, n) - c;
      return { x: p.x - 2 * d * n.x, y: p.y - 2 * d * n.y };
    };
    const l = computeStairLayout(s, H);
    expect(places(m)).toEqual([...l.treads, ...l.landings].map((t) => key(reflect(centroid(t.polygon)))).sort());
    expect(m.runs!.landings[0].turn).toBe('right');
  });

  it('fills defaults when resolving', () => {
    const r = resolveStairRuns(make({ flights: [{ treads: 4 }, { treads: 4 }], landings: [] }), H)!;
    expect(r.landings).toEqual([{ turn: 'none', angle: 90, depth: 1000, gap: 100, extendLeft: 0, extendRight: 0, beyond: 0 }]);
  });
});

describe('stairChecks', () => {
  it('flags steep risers, short goings, narrow flights and long flights', () => {
    const steep = make({ flights: [{ treads: 9, going: 220, width: 750 }], landings: [] });
    const by = Object.fromEntries(stairChecks(steep, H).map((c) => [c.label, c.ok]));
    expect(by['Riser height']).toBe(false); // 3000 / 10 = 300 mm
    expect(by['Going']).toBe(false);
    expect(by['Width']).toBe(false);
    const good = make({ flights: [{ treads: 8 }, { treads: 8 }], landings: [{ turn: 'left', angle: 90 }] });
    expect(stairChecks(good, H).every((c) => c.ok)).toBe(true);
    const long = make({ flights: [{ treads: 17 }], landings: [] });
    expect(stairChecks(long, H).find((c) => c.label === 'Risers per flight')!.ok).toBe(false);
  });
});
