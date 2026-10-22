import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { nearestEndpoint, normalizeDeg, snapAngleFrom, snapDeg, snapPlanPoint, snapToGrid, wallSnapTargets } from './snapping';

describe('grid snapping', () => {
  it('rounds to the nearest grid point', () => {
    expect(snapToGrid({ x: 740, y: -260 }, 500)).toEqual({ x: 500, y: -500 });
    expect(snapToGrid({ x: 760, y: 1249 }, 500)).toEqual({ x: 1000, y: 1000 });
  });

  it('uses the fine step when grid snapping is off', () => {
    const r = snapPlanPoint({ x: 1234, y: 567 }, { grid: 500, snapGrid: false, snapAngle: false });
    expect(r).toEqual({ point: { x: 1230, y: 570 }, kind: 'free' });
  });

  it('snaps to the grid when enabled', () => {
    expect(snapPlanPoint({ x: 1234, y: 567 }, { grid: 500, snapGrid: true, snapAngle: false })).toEqual({ point: { x: 1000, y: 500 }, kind: 'grid' });
  });
});

describe('endpoint magnet', () => {
  it('prefers wall ends within the magnet radius over the grid', () => {
    const r = snapPlanPoint({ x: 12180, y: 220 }, { grid: 500, snapGrid: true, snapAngle: true, endpoints: [{ x: 12000, y: 0 }] });
    expect(r.kind).toBe('endpoint');
    expect(r.point).toEqual({ x: 12000, y: 0 });
  });

  it('ignores ends beyond the magnet radius', () => {
    expect(nearestEndpoint({ x: 0, y: 0 }, [{ x: 400, y: 0 }], 300)).toBeUndefined();
    expect(nearestEndpoint({ x: 0, y: 0 }, [{ x: 400, y: 0 }, { x: 0, y: 250 }], 300)).toEqual({ x: 0, y: 250 });
  });

  it('collects wall endpoints and lines of a level', () => {
    const p = createSampleProject();
    const t = wallSnapTargets(p, p.levels[0].id);
    expect(t.endpoints).toContainEqual({ x: 12000, y: 8000 });
    expect(t.lines.length).toBe(7);
    expect(wallSnapTargets(p, undefined).endpoints).toEqual([]);
  });
});

describe('angle snapping', () => {
  it('snaps the direction to 15° steps and the length to the step', () => {
    const r = snapAngleFrom({ x: 0, y: 0 }, { x: 1000, y: 560 }, 15, 100);
    expect(r.angle).toBe(30);
    expect(Math.hypot(r.point.x, r.point.y)).toBeCloseTo(1100, 0);
  });

  it('keeps axis-aligned segments on the grid', () => {
    const r = snapPlanPoint({ x: 3120, y: 140 }, { grid: 500, snapGrid: true, snapAngle: true, from: { x: 0, y: 0 } });
    expect(r.kind).toBe('angle');
    expect(r.point).toEqual({ x: 3000, y: 0 });
  });

  it('meets a nearby wall line exactly (T junction)', () => {
    const lines = [{ a: { x: 5000, y: -5000 }, b: { x: 5000, y: 5000 } }];
    const r = snapPlanPoint({ x: 4960, y: 30 }, { grid: 500, snapGrid: false, snapAngle: true, from: { x: 0, y: 0 }, lines });
    expect(r.kind).toBe('line');
    expect(r.point.x).toBeCloseTo(5000, 6);
    expect(r.point.y).toBeCloseTo(0, 6);
  });

  it('projects onto a wall line without a previous point', () => {
    const lines = [{ a: { x: 0, y: 0 }, b: { x: 10000, y: 0 } }];
    const r = snapPlanPoint({ x: 3333, y: 90 }, { grid: 500, snapGrid: false, snapAngle: true, lines });
    expect(r).toEqual({ point: { x: 3333, y: 0 }, kind: 'line' });
  });

  it('normalises angles', () => {
    expect(normalizeDeg(270)).toBe(-90);
    expect(normalizeDeg(-180)).toBe(180);
    expect(snapDeg(-44, 90)).toBe(0);
    expect(snapDeg(-46, 90)).toBe(270);
  });
});
