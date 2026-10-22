import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { createElement, createProject } from '../defaults';
import { polygonArea } from '../math2d';
import type { Project, Vec2, Wall } from '../types';
import { computeWallFootprints, openingFits, openingsOfWall, projectOntoWall, wallsTouch, type WallFootprint } from '../walls';

function project(walls: [Vec2, Vec2, number?][]): { p: Project; ws: Wall[] } {
  const p = createProject();
  const ws = walls.map(([start, end, thickness]) => createElement('wall', p.levels[0].id, { start, end, thickness: thickness ?? 200 }));
  for (const w of ws) p.elements[w.id] = w;
  return { p, ws };
}

const close = (a: Vec2, b: Vec2) => {
  expect(a.x).toBeCloseTo(b.x, 3);
  expect(a.y).toBeCloseTo(b.y, 3);
};

describe('wall footprints', () => {
  it('square caps a free wall', () => {
    const { p, ws } = project([[{ x: 0, y: 0 }, { x: 4000, y: 0 }]]);
    const fp = computeWallFootprints(p, p.levels[0].id).get(ws[0].id)!;
    close(fp.startLeft, { x: 0, y: 100 });
    close(fp.startRight, { x: 0, y: -100 });
    close(fp.endLeft, { x: 4000, y: 100 });
    close(fp.endRight, { x: 4000, y: -100 });
    expect(polygonArea(fp.polygon)).toBeCloseTo(4000 * 200);
  });

  it('miters an L corner', () => {
    const { p, ws } = project([
      [{ x: 0, y: 0 }, { x: 4000, y: 0 }],
      [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }],
    ]);
    const fps = computeWallFootprints(p, p.levels[0].id);
    const a = fps.get(ws[0].id)!;
    const b = fps.get(ws[1].id)!;
    close(a.endLeft, { x: 3900, y: 100 });
    close(a.endRight, { x: 4100, y: -100 });
    close(b.startLeft, { x: 3900, y: 100 });
    close(b.startRight, { x: 4100, y: -100 });
  });

  it('closes a rectangle with all corners mitered and consistent', () => {
    const { p, ws } = project([
      [{ x: 0, y: 0 }, { x: 4000, y: 0 }],
      [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }],
      [{ x: 4000, y: 3000 }, { x: 0, y: 3000 }],
      [{ x: 0, y: 3000 }, { x: 0, y: 0 }],
    ]);
    const fps = computeWallFootprints(p, p.levels[0].id);
    const total = ws.reduce((s, w) => s + polygonArea(fps.get(w.id)!.polygon), 0);
    // Outer 4200x3200 minus inner 3800x2800.
    expect(total).toBeCloseTo(4200 * 3200 - 3800 * 2800, 1);
  });

  it('handles reversed walls at a corner', () => {
    const { p, ws } = project([
      [{ x: 4000, y: 0 }, { x: 0, y: 0 }],
      [{ x: 4000, y: 0 }, { x: 4000, y: 3000 }],
    ]);
    const fps = computeWallFootprints(p, p.levels[0].id);
    const a = fps.get(ws[0].id)!;
    // Wall a runs west; its left side is south (y<0).
    close(a.startLeft, { x: 4100, y: -100 });
    close(a.startRight, { x: 3900, y: 100 });
  });

  it('trims a T junction against the host face', () => {
    const { p, ws } = project([
      [{ x: 0, y: 0 }, { x: 6000, y: 0 }],
      [{ x: 3000, y: 0 }, { x: 3000, y: 3000 }, 100],
    ]);
    const fp = computeWallFootprints(p, p.levels[0].id).get(ws[1].id)!;
    close(fp.startLeft, { x: 2950, y: 100 });
    close(fp.startRight, { x: 3050, y: 100 });
    expect(wallsTouch(ws[0], ws[1])).toBe(true);
  });

  it('fills the hub of a 3-way junction', () => {
    const { p, ws } = project([
      [{ x: 0, y: 0 }, { x: 3000, y: 0 }],
      [{ x: 0, y: 0 }, { x: -3000, y: 0 }],
      [{ x: 0, y: 0 }, { x: 0, y: 3000 }],
    ]);
    const fps = computeWallFootprints(p, p.levels[0].id);
    const total = ws.reduce((s, w) => s + polygonArea(fps.get(w.id)!.polygon), 0);
    // 6000x200 horizontal bar + 3000-100 vertical stem x 200
    expect(total).toBeCloseTo(6000 * 200 + 2900 * 200, 0);
  });

  it('falls back to square caps for collinear walls', () => {
    const { p, ws } = project([
      [{ x: 0, y: 0 }, { x: 3000, y: 0 }],
      [{ x: 3000, y: 0 }, { x: 6000, y: 0 }],
    ]);
    const fps = computeWallFootprints(p, p.levels[0].id);
    close(fps.get(ws[0].id)!.endLeft, { x: 3000, y: 100 });
    close(fps.get(ws[1].id)!.startRight, { x: 3000, y: -100 });
  });

  it('produces a valid footprint for every wall in the sample', () => {
    const sp = createSampleProject();
    for (const level of sp.levels) {
      const fps: Map<string, WallFootprint> = computeWallFootprints(sp, level.id);
      for (const fp of fps.values()) {
        expect(polygonArea(fp.polygon)).toBeGreaterThan(0);
        for (const q of fp.polygon) expect(Number.isFinite(q.x) && Number.isFinite(q.y)).toBe(true);
      }
    }
  });
});

describe('openings', () => {
  it('every sample opening fits its host wall', () => {
    const sp = createSampleProject();
    for (const el of Object.values(sp.elements)) {
      if (el.type !== 'door' && el.type !== 'window') continue;
      const host = sp.elements[el.hostId] as Wall;
      expect(host?.type).toBe('wall');
      expect(openingFits(sp, host, el)).toBe(true);
      expect(openingsOfWall(sp, host.id)).toContainEqual(el);
    }
  });

  it('projects points onto walls', () => {
    const w = { start: { x: 0, y: 0 }, end: { x: 0, y: 5000 } };
    const r = projectOntoWall(w, { x: -300, y: 1200 });
    expect(r.offset).toBeCloseTo(1200);
    expect(r.lateral).toBeCloseTo(300); // left of a north-running wall is west (-x)
  });
});
