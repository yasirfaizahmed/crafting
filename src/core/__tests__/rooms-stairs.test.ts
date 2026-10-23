import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { createElement, createProject } from '../defaults';
import { detectRooms, roomAtPoint } from '../rooms';
import { computeStairLayout } from '../stairs';
import type { Project, Vec2 } from '../types';

function withWalls(segs: [Vec2, Vec2, number?][]): Project {
  const p = createProject();
  for (const [start, end, t] of segs) {
    const w = createElement('wall', p.levels[0].id, { start, end, thickness: t ?? 200 });
    p.elements[w.id] = w;
  }
  return p;
}

const rect = (x0: number, y0: number, x1: number, y1: number): [Vec2, Vec2][] => [
  [{ x: x0, y: y0 }, { x: x1, y: y0 }],
  [{ x: x1, y: y0 }, { x: x1, y: y1 }],
  [{ x: x1, y: y1 }, { x: x0, y: y1 }],
  [{ x: x0, y: y1 }, { x: x0, y: y0 }],
];

describe('detectRooms', () => {
  it('finds one room inside a rectangle of walls with clear area', () => {
    const p = withWalls(rect(0, 0, 5000, 4000));
    const rooms = detectRooms(p, p.levels[0].id);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].area).toBeCloseTo(4800 * 3800, -2);
    expect(rooms[0].wallIds).toHaveLength(4);
  });

  it('splits a rectangle with a partition (T junctions) into two rooms', () => {
    const p = withWalls([...rect(0, 0, 6000, 4000), [{ x: 3000, y: 0 }, { x: 3000, y: 4000 }, 100]]);
    const rooms = detectRooms(p, p.levels[0].id).sort((a, b) => a.polygon[0].x - b.polygon[0].x);
    expect(rooms).toHaveLength(2);
    expect(rooms[0].area).toBeCloseTo((3000 - 100 - 50) * 3800, -2);
    expect(roomAtPoint(p, p.levels[0].id, { x: 4500, y: 2000 })).toBeDefined();
    expect(roomAtPoint(p, p.levels[0].id, { x: 9000, y: 2000 })).toBeUndefined();
  });

  it('handles crossing walls and ignores dangling walls', () => {
    const p = withWalls([
      ...rect(0, 0, 6000, 6000),
      [{ x: 3000, y: -1000 }, { x: 3000, y: 7000 }],
      [{ x: 1000, y: 3000 }, { x: 2000, y: 3000 }],
    ]);
    expect(detectRooms(p, p.levels[0].id)).toHaveLength(2);
  });

  it('detects the sample house rooms', () => {
    const sp = createSampleProject();
    expect(detectRooms(sp, sp.levels[0].id).length).toBe(4);
    expect(detectRooms(sp, sp.levels[1].id).length).toBe(2); // the 3 m bathroom wall is dangling
  });
});

describe('computeStairLayout', () => {
  const base = createElement('stair', 'l', { position: { x: 0, y: 0 }, rotation: 0, width: 1000, tread: 280, maxRiser: 175 });
  it('lays out a straight stair', () => {
    const l = computeStairLayout(base, 3000);
    expect(l.riserCount).toBe(18);
    expect(l.treads).toHaveLength(17);
    expect(l.treads.at(-1)!.top).toBeCloseTo((3000 / 18) * 17);
    expect(l.walkline.at(-1)!.x).toBeCloseTo(17 * 280);
  });
  for (const shape of ['l-shape', 'u-shape', 'open-well', 'spiral'] as const) {
    it(`lays out a ${shape} stair with monotonically rising treads`, () => {
      const l = computeStairLayout({ ...base, shape }, 3000);
      const tops = [...l.treads.map((t) => t.top), ...l.landings.map((t) => t.top)].sort((a, b) => a - b);
      expect(tops.length).toBe(17);
      for (const t of l.treads) expect(t.polygon.length).toBeGreaterThanOrEqual(4);
      expect(new Set(tops.map((x) => x.toFixed(3))).size).toBe(17);
    });
  }
});
