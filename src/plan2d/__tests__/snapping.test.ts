import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { createElement } from '../../core/defaults';
import type { Vec2, Wall } from '../../core/types';
import { buildSnapScene, snapPoint, snapToGrid, type SnapOptions } from '../snapping';

const wall = (start: Vec2, end: Vec2): Wall => createElement('wall', 'L', { start, end });

// An L of walls plus a crossing wall.
const walls = [wall({ x: 0, y: 0 }, { x: 4000, y: 0 }), wall({ x: 4000, y: 0 }, { x: 4000, y: 3000 }), wall({ x: 2000, y: -1000 }, { x: 2000, y: 1000 })];
const scene = buildSnapScene(walls);
const base: SnapOptions = { grid: true, objects: true, angle: true, gridSize: 500, tolerance: 100 };

describe('snapPoint', () => {
  it('snaps to the grid when nothing else is near', () => {
    const r = snapPoint({ x: 8260, y: 7740 }, scene, base);
    expect(r.kind).toBe('grid');
    expect(r.point).toEqual({ x: 8500, y: 7500 });
    expect(snapToGrid({ x: 260, y: -240 }, 500)).toEqual({ x: 500, y: -0 });
  });

  it('prefers endpoints over midpoints and intersections', () => {
    expect(snapPoint({ x: 3950, y: 40 }, scene, base)).toMatchObject({ kind: 'endpoint', point: { x: 4000, y: 0 } });
    expect(snapPoint({ x: 4040, y: 1530 }, scene, base)).toMatchObject({ kind: 'midpoint', point: { x: 4000, y: 1500 } });
    // The crossing wall meets the first wall in the middle of both.
    const x = snapPoint({ x: 2030, y: 40 }, scene, base);
    expect(['intersection', 'midpoint']).toContain(x.kind);
    expect(x.point).toEqual({ x: 2000, y: 0 });
  });

  it('snaps to the nearest point on a wall', () => {
    const r = snapPoint({ x: 3100, y: 60 }, scene, { ...base, grid: false });
    expect(r.kind).toBe('nearest');
    expect(r.point.y).toBeCloseTo(0);
    expect(r.point.x).toBeCloseTo(3100);
    expect(r.targetId).toBe(walls[0].id);
  });

  it('finds perpendicular feet from the previous point', () => {
    const r = snapPoint({ x: 4060, y: 2210 }, scene, { ...base, angle: false, from: { x: 1000, y: 2200 } });
    expect(r.kind).toBe('perpendicular');
    expect(r.point).toEqual({ x: 4000, y: 2200 });
  });

  it('constrains to 15° steps and rounds the length to the grid', () => {
    const from = { x: 10000, y: 10000 };
    const r = snapPoint({ x: 10000 + 2600, y: 10000 + 1400 }, scene, { ...base, from });
    expect(r.kind).toBe('angle');
    expect(r.angle).toBe(30);
    const len = Math.hypot(r.point.x - from.x, r.point.y - from.y);
    expect(Math.abs(len / 500 - Math.round(len / 500))).toBeLessThan(1e-6);
    // Shift (angle disabled) → plain grid.
    const free = snapPoint({ x: 12600, y: 11400 }, scene, { ...base, from, angle: false });
    expect(free.kind).toBe('grid');
    expect(free.point).toEqual({ x: 12500, y: 11500 });
  });

  it('creates horizontal/vertical alignment guides from existing endpoints', () => {
    // x aligned with the corner (4000) and y aligned with the top of the east wall (3000).
    const r = snapPoint({ x: 4060, y: 7930 }, scene, { ...base, grid: false });
    expect(r.kind).toBe('alignment');
    expect(r.point.x).toBe(4000);
    expect(r.guides[0].from).toEqual({ x: 4000, y: 3000 });
    const both = snapPoint({ x: 70, y: 2950 }, scene, { ...base, grid: false });
    expect(both.kind).toBe('alignment');
    expect(both.point).toEqual({ x: 0, y: 3000 });
    expect(both.guides).toHaveLength(2);
  });

  it('intersects the angle ray with alignment guides (tracking)', () => {
    const from = { x: 0, y: 3000 };
    // Going east along 0°, aligned with the x of the far corner.
    const r = snapPoint({ x: 3950, y: 3020 }, buildSnapScene(walls.slice(0, 1)), { ...base, grid: false, from, track: [{ x: 4000, y: -2000 }] });
    expect(r.kind).toBe('alignment');
    expect(r.point.x).toBeCloseTo(4000);
    expect(r.point.y).toBeCloseTo(3000);
  });

  it('respects disabled object snapping and exclusions', () => {
    const r = snapPoint({ x: 3950, y: 40 }, scene, { ...base, objects: false });
    expect(r.kind).toBe('grid');
    const ex = buildSnapScene(walls, { exclude: new Set([walls[0].id, walls[1].id]) });
    expect(snapPoint({ x: 3950, y: 40 }, ex, base).kind).not.toBe('endpoint');
    const raw = snapPoint({ x: 3950, y: 40 }, scene, { ...base, objects: false, grid: false });
    expect(raw).toMatchObject({ kind: 'none', point: { x: 3950, y: 40 } });
  });

  it('builds a scene from the sample project with crossings', () => {
    const sp = createSampleProject();
    const s = buildSnapScene(Object.values(sp.elements).filter((e) => e.levelId === sp.levels[0].id));
    expect(s.points.length).toBeGreaterThan(20);
    // The kitchen partition T-joins the east-west wall at (9000, 4500).
    expect(s.intersections.some((p) => Math.abs(p.x - 9000) < 1 && Math.abs(p.y - 4500) < 1)).toBe(true);
  });
});
