import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { createElement, createProject } from '../../core/defaults';
import { polygonArea } from '../../core/math2d';
import { detectOuterBoundaries, detectRooms, roomAtPoint } from '../../core/rooms';
import type { Project, Vec2, Wall } from '../../core/types';

type Seg = [Vec2, Vec2, Partial<Wall>?];

function withWalls(segs: Seg[]): Project {
  const p = createProject();
  for (const [start, end, extra] of segs) {
    const w = createElement('wall', p.levels[0].id, { start, end, thickness: 200, ...(extra ?? {}) });
    p.elements[w.id] = w;
  }
  return p;
}

const rect = (x0: number, y0: number, x1: number, y1: number, extra?: Partial<Wall>): Seg[] => [
  [{ x: x0, y: y0 }, { x: x1, y: y0 }, extra],
  [{ x: x1, y: y0 }, { x: x1, y: y1 }, extra],
  [{ x: x1, y: y1 }, { x: x0, y: y1 }, extra],
  [{ x: x0, y: y1 }, { x: x0, y: y0 }, extra],
];

const lvl = (p: Project) => p.levels[0].id;

describe('detectRooms edge cases', () => {
  it('handles collinear overlapping walls without duplicate rooms', () => {
    const p = withWalls([
      ...rect(0, 0, 6000, 4000),
      // A second wall overlapping half of the south wall.
      [{ x: 2000, y: 0 }, { x: 6000, y: 0 }],
      // And one fully duplicating the east wall in the opposite direction.
      [{ x: 6000, y: 4000 }, { x: 6000, y: 0 }],
    ]);
    const rooms = detectRooms(p, lvl(p));
    expect(rooms).toHaveLength(1);
    expect(rooms[0].area).toBeCloseTo(5800 * 3800, -3);
  });

  it('closes rooms when a partition is drawn only to the face of the host wall', () => {
    const p = withWalls([
      ...rect(0, 0, 6000, 4000),
      // Partition from the inner face of the south wall (y = 100) to the inner face of the north wall.
      [{ x: 3000, y: 100 }, { x: 3000, y: 3900 }, { thickness: 100 }],
    ]);
    const rooms = detectRooms(p, lvl(p));
    expect(rooms).toHaveLength(2);
    for (const r of rooms) expect(r.area).toBeCloseTo((3000 - 100 - 50) * 3800, -3);
  });

  it('closes sloppy L corners whose endpoints stop inside the other wall', () => {
    const p = withWalls([
      [{ x: 0, y: 0 }, { x: 5000, y: 0 }],
      [{ x: 5000, y: 60 }, { x: 5000, y: 4000 }],
      [{ x: 5000, y: 4000 }, { x: 0, y: 4000 }],
      [{ x: 0, y: 4000 }, { x: 0, y: 0 }],
    ]);
    expect(detectRooms(p, lvl(p))).toHaveLength(1);
  });

  it('treats a free-standing wall group inside a room as an island (nested rooms)', () => {
    const p = withWalls([...rect(0, 0, 10000, 8000), ...rect(4000, 3000, 6000, 5000, { thickness: 100 })]);
    const rooms = detectRooms(p, lvl(p)).sort((a, b) => b.area - a.area);
    expect(rooms).toHaveLength(2);
    const [outer, inner] = rooms;
    expect(outer.holes).toHaveLength(1);
    // Outer clear area minus the island's outer face footprint (2100 × 2100).
    expect(outer.area).toBeCloseTo(9800 * 7800 - 2100 * 2100, -3);
    expect(inner.area).toBeCloseTo(1900 * 1900, -3);
    expect(roomAtPoint(p, lvl(p), { x: 5000, y: 4000 })?.area).toBeCloseTo(inner.area, -3);
    expect(roomAtPoint(p, lvl(p), { x: 1000, y: 1000 })?.area).toBeCloseTo(outer.area, -3);
    // Inside the island's walls: on neither floor.
    expect(roomAtPoint(p, lvl(p), { x: 4000, y: 4000 })).toBeUndefined();
  });

  it('insets by the correct face for left / right justified walls', () => {
    // Location lines on the room's inner face: left-justified CCW loop keeps the body outside (to the right).
    const left = withWalls(rect(0, 0, 5000, 4000, { justification: 'left' }));
    const l = detectRooms(left, lvl(left));
    expect(l).toHaveLength(1);
    expect(l[0].area).toBeCloseTo(5000 * 4000, -3);
    // Right-justified CCW loop puts the body inside the room.
    const right = withWalls(rect(0, 0, 5000, 4000, { justification: 'right' }));
    const r = detectRooms(right, lvl(right));
    expect(r[0].area).toBeCloseTo(4600 * 3600, -3);
  });

  it('ignores slivers and open chains', () => {
    const open = withWalls(rect(0, 0, 5000, 4000).slice(0, 3));
    expect(detectRooms(open, lvl(open))).toHaveLength(0);
    const tiny = withWalls(rect(0, 0, 400, 400));
    expect(detectRooms(tiny, lvl(tiny))).toHaveLength(0);
  });

  it('still finds the sample house rooms', () => {
    const sp = createSampleProject();
    expect(detectRooms(sp, sp.levels[0].id)).toHaveLength(4);
    expect(detectRooms(sp, sp.levels[1].id)).toHaveLength(2);
  });
});

describe('detectOuterBoundaries', () => {
  it('returns the outer face outline of the sample ground floor', () => {
    const sp = createSampleProject();
    const b = detectOuterBoundaries(sp, sp.levels[0].id);
    expect(b).toHaveLength(1);
    expect(polygonArea(b[0].polygon)).toBeCloseTo(12250 * 8250, -3);
    expect(b[0].area).toBeGreaterThan(0);
    expect(b[0].wallIds).toHaveLength(4);
  });

  it('returns one outline per separate building and skips islands', () => {
    const p = withWalls([...rect(0, 0, 5000, 4000), ...rect(10000, 0, 14000, 3000), ...rect(1500, 1500, 3500, 2500, { thickness: 100 })]);
    const b = detectOuterBoundaries(p, lvl(p));
    expect(b).toHaveLength(2);
    expect(polygonArea(b[0].polygon)).toBeCloseTo(5200 * 4200, -3);
  });
});
