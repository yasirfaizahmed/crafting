import { describe, expect, it } from 'vitest';
import { CATALOG } from '../../core/catalog';
import type { Wall } from '../../core/types';
import { breakAt, pickBlockAt } from './actions';
import { createTool } from './index';
import { AnnotationTool, EraserTool, EyedropperTool, MeasureTool, measureText, paintPatch, PaintTool, wallSideFromNormal } from './misc';
import { elementHit, fakeEnv, floorHit, ofType, sampleContext } from './test-utils';

describe('break and pick block', () => {
  it('LMB break removes the element in one undo step with an effect', () => {
    const ctx = sampleContext();
    const { env, effects } = fakeEnv(ctx, 'wall-200');
    const sofa = ofType(ctx, 'furniture')[0];
    ctx.selection.set([sofa.id]);
    expect(breakAt(env, elementHit(sofa, sofa.position, 400, { x: 0, y: 0, z: 1 }))).toBe(true);
    expect(ctx.store.getElement(sofa.id)).toBeUndefined();
    expect(ctx.selection.get()).toEqual([]);
    expect(effects).toEqual(['break']);
    expect(ctx.store.undoLabel).toBe('Break furniture');
    ctx.store.undo();
    expect(ctx.store.getElement(sofa.id)).toBeDefined();
  });

  it('breaking a wall cascades to its openings; locked elements are refused', () => {
    const ctx = sampleContext();
    const { env, toasts } = fakeEnv(ctx, 'wall-200');
    const door = ofType(ctx, 'door')[0];
    const host = ctx.store.getElement(door.hostId) as Wall;
    breakAt(env, elementHit(host, host.start, 100, { x: 0, y: -1, z: 0 }));
    expect(ctx.store.getElement(door.id)).toBeUndefined();
    const col = ofType(ctx, 'column')[0];
    ctx.store.update(col.id, { locked: true });
    expect(breakAt(env, elementHit(col, col.position, 100, { x: 1, y: 0, z: 0 }))).toBe(false);
    expect(toasts).toContain('This column is locked');
    expect(breakAt(env, floorHit(ctx.store.project, { x: 0, y: 0 }))).toBe(false);
  });

  it('pick block switches to the slot holding the item, else replaces the current slot', () => {
    const ctx = sampleContext();
    const { env } = fakeEnv(ctx, 'tool-select');
    const sofa = ofType(ctx, 'furniture').find((f) => f.catalogId === 'sofa-3')!;
    pickBlockAt(env, elementHit(sofa, sofa.position, 400, { x: 0, y: 0, z: 1 }));
    let ui = ctx.ui.get();
    expect(ui.hotbar[ui.hotbarIndex]).toBe('furn-sofa-3');
    const tv = ofType(ctx, 'furniture').find((f) => f.catalogId === 'tv-unit')!;
    pickBlockAt(env, elementHit(tv, tv.position, 400, { x: 0, y: 0, z: 1 }));
    ui = ctx.ui.get();
    expect(ui.hotbar[ui.hotbarIndex]).toBe('furn-tv-unit');
    expect(ui.hotbar).toHaveLength(9);
  });
});

describe('paint tool', () => {
  it('maps hit normals to wall faces', () => {
    const w = { start: { x: 0, y: 0 }, end: { x: 1000, y: 0 } };
    expect(wallSideFromNormal(w, { x: 0, y: 1, z: 0 })).toBe('left');
    expect(wallSideFromNormal(w, { x: 0, y: -1, z: 0 })).toBe('right');
    expect(wallSideFromNormal(w, { x: 0, y: 0, z: 1 })).toBeNull();
  });

  it('paints the clicked wall side, other elements get their material', () => {
    const ctx = sampleContext();
    const { env } = fakeEnv(ctx, 'paint-paint-sage');
    const tool = new PaintTool(env);
    const w = ofType(ctx, 'wall').find((x) => x.thickness === 120)!;
    const n = { x: -(w.end.y - w.start.y), y: w.end.x - w.start.x };
    const len = Math.hypot(n.x, n.y);
    tool.use(elementHit(w, w.start, 1000, { x: n.x / len, y: n.y / len, z: 0 }));
    expect((ctx.store.getElement(w.id) as Wall).leftFinishId).toBe('paint-sage');
    expect(ctx.store.undoLabel).toBe('Paint wall (left face)');
    tool.use(elementHit(w, w.start, 1000, { x: -n.x / len, y: -n.y / len, z: 0 }));
    expect((ctx.store.getElement(w.id) as Wall).rightFinishId).toBe('paint-sage');
    tool.use(elementHit(w, w.start, 3000, { x: 0, y: 0, z: 1 }));
    expect(ctx.store.getElement(w.id)!.materialId).toBe('paint-sage');
    const block = ofType(ctx, 'block')[0];
    expect(paintPatch(block, { x: 0, y: 0, z: 1 }, 'brick-red')).toBeNull();
    expect(paintPatch(block, { x: 0, y: 0, z: 1 }, 'copper')?.label).toBe('Paint block');
  });
});

describe('measure, eraser, eyedropper, annotations', () => {
  it('measures distances between two clicks without creating elements', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const n = Object.keys(p.elements).length;
    const { env, ghost } = fakeEnv(ctx, 'tool-measure');
    const tool = new MeasureTool(env);
    tool.use(floorHit(p, { x: -3000, y: -3000 }));
    tool.hover(floorHit(p, { x: 0, y: -7000 }));
    expect(ghost.linePoints).toHaveLength(2);
    tool.use(floorHit(p, { x: 0, y: -7000 }));
    expect(tool.result).toBeCloseTo(5000, 6);
    expect(ghost.labelText).toBe('5.00 m');
    expect(Object.keys(ctx.store.project.elements).length).toBe(n);
    expect(tool.primary()).toBe(true);
    expect(tool.result).toBeNull();
    expect(measureText({ point: { x: 0, y: 0 }, elevation: 0 }, { point: { x: 3000, y: 0 }, elevation: 4000 })).toBe('5.00 m (plan 3.00 m, Δh 4.00 m)');
  });

  it('eraser breaks with both buttons; eyedropper picks', () => {
    const ctx = sampleContext();
    const [a, b] = ofType(ctx, 'furniture');
    const er = new EraserTool(fakeEnv(ctx, 'tool-eraser').env);
    er.use(elementHit(a, a.position, 100, { x: 0, y: 0, z: 1 }));
    expect(er.primary(elementHit(b, b.position, 100, { x: 0, y: 0, z: 1 }))).toBe(true);
    expect(ctx.store.getElement(a.id)).toBeUndefined();
    expect(ctx.store.getElement(b.id)).toBeUndefined();
    const wall = ofType(ctx, 'wall')[0];
    const ey = new EyedropperTool(fakeEnv(ctx, 'tool-eyedropper').env);
    expect(ey.primary(elementHit(wall, wall.start, 100, { x: 1, y: 0, z: 0 }))).toBe(true);
    expect(ctx.ui.get().hotbar[ctx.ui.get().hotbarIndex]).toBe('wall-brick');
  });

  it('annotation items point to the plan view', () => {
    const ctx = sampleContext();
    const f = fakeEnv(ctx, 'dimension');
    new AnnotationTool(f.env).use(floorHit(ctx.store.project, { x: 0, y: 0 }));
    expect(f.toasts).toEqual(['Use the plan view for annotations']);
  });

  it('every catalog item gets a tool', () => {
    const ctx = sampleContext();
    for (const item of CATALOG) {
      const tool = createTool(fakeEnv(ctx, item.id).env);
      expect(tool, item.id).toBeDefined();
      tool.hover(null);
      tool.dispose();
    }
  });
});
