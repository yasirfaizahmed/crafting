import { describe, expect, it } from 'vitest';
import { boundsOf, polygonArea } from '../../core/math2d';
import type { Roof, Slab } from '../../core/types';
import { buildingLevelAt, floodFillOutline, rectFromCorners, rectValid, roofFootprint, RoofTool, SlabTool } from './area';
import { resolveBuildTarget } from './levels';
import { elementHit, fakeEnv, floorHit, ofType, sampleContext } from './test-utils';

describe('roof footprint', () => {
  it('bounds the storey walls at their outer faces with the ridge along the longer side', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const fp = roofFootprint(p, p.levels[1].id)!;
    const b = boundsOf(fp.outline);
    expect(b).toEqual({ minX: -125, minY: -125, maxX: 12125, maxY: 8125 });
    expect(fp.ridgeAngle).toBe(0);
  });

  it('runs the ridge north-south for deep buildings', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    // Rotate the house: swap x/y of every ground-floor wall.
    for (const w of ofType(ctx, 'wall')) {
      if (w.levelId !== p.levels[0].id) continue;
      p.elements[w.id] = { ...w, start: { x: w.start.y, y: w.start.x }, end: { x: w.end.y, y: w.end.x } };
    }
    expect(roofFootprint(p, p.levels[0].id)!.ridgeAngle).toBe(90);
  });

  it('returns null for storeys without walls and finds the highest storey at a point', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    expect(roofFootprint(p, 'nope')).toBeNull();
    expect(buildingLevelAt(p, { x: 6000, y: 4000 })).toBe(p.levels[1].id);
    expect(buildingLevelAt(p, { x: 30000, y: 4000 })).toBeUndefined();
  });
});

describe('roof tool', () => {
  it('one click on a building restyles its existing roof; on a new storey it adds an auto roof', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const { env, ghost } = fakeEnv(ctx, 'roof-hip');
    const tool = new RoofTool(env);
    const roof = ofType(ctx, 'roof')[0];
    tool.hover(elementHit(roof, { x: 6000, y: 4000 }, 7000, { x: 0, y: 0.5, z: 0.86 }));
    expect(ghost.options?.hide).toEqual([roof.id]);
    tool.use(elementHit(roof, { x: 6000, y: 4000 }, 7000, { x: 0, y: 0.5, z: 0.86 }));
    const r = ctx.store.getElement(roof.id) as Roof;
    expect(r.shape).toBe('hip');
    expect(r.pitch).toBe(30);
    expect(r.materialId).toBe('roof-shingles-grey');
    expect(ctx.store.undoLabel).toBe('Change roof');

    // Remove the roof, then a click on a first-floor wall builds a new one over that storey.
    ctx.store.remove(roof.id);
    const wall = ofType(ctx, 'wall').find((w) => w.levelId === p.levels[1].id)!;
    tool.use(elementHit(wall, { x: 0, y: 2000 }, 4500, { x: -1, y: 0, z: 0 }));
    const roofs = ofType(ctx, 'roof');
    expect(roofs).toHaveLength(1);
    expect(roofs[0].levelId).toBe(p.levels[1].id);
    expect(boundsOf(roofs[0].outline)).toEqual({ minX: -125, minY: -125, maxX: 12125, maxY: 8125 });
    expect(roofs[0].shape).toBe('hip');
    expect(ctx.store.undoLabel).toBe('Place roof');
  });

  it('two clicks on open ground make a rectangular roof', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const { env, ghost } = fakeEnv(ctx, 'roof-shed');
    const tool = new RoofTool(env);
    tool.use(floorHit(p, { x: 20000, y: 0 }));
    tool.hover(floorHit(p, { x: 24000, y: 6000 }));
    expect(ghost.shown).toHaveLength(1);
    expect(ghost.labelText).toContain('4.00 m × 6.00 m');
    tool.use(floorHit(p, { x: 24000, y: 6000 }));
    const r = ofType(ctx, 'roof').find((x) => x.shape === 'shed')!;
    expect(boundsOf(r.outline)).toEqual({ minX: 20000, minY: 0, maxX: 24000, maxY: 6000 });
    expect(r.ridgeAngle).toBe(90);
    expect(tool.primary()).toBe(false);
  });
});

describe('slab tool', () => {
  it('rectangle helpers', () => {
    expect(rectFromCorners({ x: 10, y: 50 }, { x: 0, y: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 50 },
      { x: 0, y: 50 },
    ]);
    expect(rectValid({ x: 0, y: 0 }, { x: 50, y: 500 })).toBe(false);
    expect(rectValid({ x: 0, y: 0 }, { x: 500, y: 500 })).toBe(true);
  });

  it('one click inside an enclosed room fills its floor', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const { env, ghost, toasts } = fakeEnv(ctx, 'slab-tile');
    const tool = new SlabTool(env);
    const hit = floorHit(p, { x: 7000, y: 6000 }); // kitchen
    tool.hover(hit);
    expect(ghost.shown).toHaveLength(1);
    expect(ghost.valid).toBe(true);
    tool.use(hit);
    const slab = ofType(ctx, 'slab').find((s) => s.materialId === 'tile-grey') as Slab;
    expect(slab).toBeTruthy();
    expect(slab.levelId).toBe(p.levels[0].id);
    expect(slab.topOffset).toBe(0);
    // Kitchen clear area: (8940 − 5060) × (7875 − 4560).
    expect(polygonArea(slab.outline)).toBeCloseTo(3880 * 3315, -2);
    expect(ctx.store.undoLabel).toBe('Fill room floor');
    // Again: refused as a duplicate.
    tool.use(hit);
    expect(toasts).toContain('This room already has this floor');
    expect(ofType(ctx, 'slab').filter((s) => s.materialId === 'tile-grey')).toHaveLength(1);
  });

  it('a floor for a new storey on top of the walls covers the room below', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const g = ofType(ctx, 'wall').find((w) => w.levelId === p.levels[0].id)!;
    const target = resolveBuildTarget(p, elementHit(g, { x: 0, y: 0 }, 3000, { x: 0, y: 0, z: 1 }));
    expect(target.levelId).toBe(p.levels[1].id);
    const outline = floodFillOutline(p, { ...target, levelId: undefined }, { x: 7000, y: 6000 });
    expect(outline).not.toBeNull();
    expect(boundsOf(outline!)).toEqual({ minX: 5000, minY: 4500, maxX: 9000, maxY: 8000 });
  });

  it('outside rooms it draws a two-click rectangle; LMB cancels', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const { env } = fakeEnv(ctx, 'slab-concrete');
    const tool = new SlabTool(env);
    const n0 = ofType(ctx, 'slab').length;
    tool.use(floorHit(p, { x: -6000, y: -6000 }));
    expect(tool.primary()).toBe(true);
    tool.use(floorHit(p, { x: -6000, y: -6000 }));
    tool.use(floorHit(p, { x: -6050, y: -6000 })); // too small: ignored, still drawing
    expect(ofType(ctx, 'slab').length).toBe(n0);
    tool.use(floorHit(p, { x: -3000, y: -4000 }));
    const s = ofType(ctx, 'slab').find((x) => x.outline[0].x === -6000)!;
    expect(boundsOf(s.outline)).toEqual({ minX: -6000, minY: -6000, maxX: -3000, maxY: -4000 });
    expect(s.kind).toBe('floor');
  });
});
