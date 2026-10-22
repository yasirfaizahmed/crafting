import { describe, expect, it } from 'vitest';
import { createElement } from '../../core/defaults';
import type { Block, Door, Furniture, Wall } from '../../core/types';
import { moveElements, previewSet, rotateElements, translateElement } from './move';
import { SelectTool } from './select';
import { elementHit, fakeEnv, floorHit, ofType, sampleContext } from './test-utils';

describe('moveElements', () => {
  it('moves both wall ends and keeps joined neighbours attached', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const g = p.levels[0].id;
    const walls = ofType(ctx, 'wall').filter((w) => w.levelId === g);
    const east = walls.find((w) => w.start.x === 12000 && w.end.x === 12000)!;
    const r = moveElements(p, [east.id], { x: 1000, y: 0 });
    expect(r.valid).toBe(true);
    const byId = new Map(r.elements.map((e) => [e.id, e as Wall]));
    expect(byId.get(east.id)!.start).toEqual({ x: 13000, y: 0 });
    expect(byId.get(east.id)!.end).toEqual({ x: 13000, y: 8000 });
    const south = walls.find((w) => w.start.y === 0 && w.end.y === 0 && w.thickness === 250)!;
    expect(byId.get(south.id)!.end).toEqual({ x: 13000, y: 0 });
    expect(byId.get(south.id)!.start).toEqual({ x: 0, y: 0 });
    // The interior wall T-joined into the east wall follows (its end at x = 12000).
    const tJoined = walls.find((w) => w.start.y === 4500 && w.end.y === 4500)!;
    expect(byId.get(tJoined.id)!.end).toEqual({ x: 13000, y: 4500 });
    // Unrelated walls are untouched.
    const west = walls.find((w) => w.start.x === 0 && w.end.x === 0)!;
    expect(byId.has(west.id)).toBe(false);
  });

  it('slides openings along their host and clamps them', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const door = ofType(ctx, 'door').find((d) => d.offset === 2500 && d.width === 1000)!;
    const r = moveElements(p, [door.id], { x: 700, y: 3000 });
    expect((r.elements[0] as Door).offset).toBe(3200);
    const far = moveElements(p, [door.id], { x: -50000, y: 0 });
    expect((far.elements[0] as Door).offset).toBe(500);
    // Onto the window at offset 8500 → invalid.
    expect(moveElements(p, [door.id], { x: 5800, y: 0 }).valid).toBe(false);
  });

  it('translates furniture, blocks, slabs; skips locked elements', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const sofa = ofType(ctx, 'furniture')[0];
    const block = ofType(ctx, 'block')[0];
    p.elements[block.id] = { ...block, locked: true };
    const r = moveElements(p, [sofa.id, block.id], { x: 100, y: -200 });
    expect(r.elements).toHaveLength(1);
    expect((r.elements[0] as Furniture).position).toEqual({ x: sofa.position.x + 100, y: sofa.position.y - 200 });
    const slab = ofType(ctx, 'slab').find((s) => s.holes?.length)!;
    const moved = translateElement(slab, { x: 10, y: 20 });
    expect(moved.outline[0]).toEqual({ x: slab.outline[0].x + 10, y: slab.outline[0].y + 20 });
    expect(moved.holes![0][0]).toEqual({ x: slab.holes![0][0].x + 10, y: slab.holes![0][0].y + 20 });
  });

  it('previews hosts of moved openings and openings of moved walls', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const door = ofType(ctx, 'door').find((d) => d.offset === 2500 && d.width === 1000)!;
    const set = previewSet(p, moveElements(p, [door.id], { x: 300, y: 0 }).elements);
    expect(set.map((e) => e.id)).toContain(door.hostId);
    const host = p.elements[door.hostId] as Wall;
    const set2 = previewSet(p, moveElements(p, [host.id], { x: 0, y: -500 }).elements);
    expect(set2.map((e) => e.id)).toContain(door.id);
  });

  it('rotates furniture and blocks in place', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const sofa = ofType(ctx, 'furniture')[0];
    expect((rotateElements(p, [sofa.id], 90)[0] as Furniture).rotation).toBe((sofa.rotation + 90) % 360);
    const b = createElement('block', p.levels[0].id, { position: { x: 0, y: 0, z: 0 }, size: { x: 1000, y: 500, z: 500 } });
    p.elements[b.id] = b;
    const rb = rotateElements(p, [b.id], 90)[0] as Block;
    expect(rb.rotation).toBe(90);
    // Centre (500, 250) is preserved.
    expect(rb.position.x).toBeCloseTo(750, 6);
    expect(rb.position.y).toBeCloseTo(-250, 6);
    expect(rotateElements(p, [ofType(ctx, 'wall')[0].id], 90)).toEqual([]);
  });
});

describe('select tool', () => {
  it('LMB selects, Shift toggles, empty click clears', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const { env } = fakeEnv(ctx, 'tool-select');
    const tool = new SelectTool(env);
    const [a, b] = ofType(ctx, 'furniture');
    tool.primary(elementHit(a, a.position, 0, { x: 0, y: 0, z: 1 }));
    expect(ctx.selection.get()).toEqual([a.id]);
    tool.primary(elementHit(b, b.position, 0, { x: 0, y: 0, z: 1 }), { shift: true });
    expect(ctx.selection.get()).toEqual([a.id, b.id]);
    tool.primary(elementHit(a, a.position, 0, { x: 0, y: 0, z: 1 }), { shift: true });
    expect(ctx.selection.get()).toEqual([b.id]);
    tool.primary(floorHit(p, { x: 0, y: 0 }));
    expect(ctx.selection.get()).toEqual([]);
  });

  it('drags move the selection in one undo step; Esc cancels; R rotates', () => {
    const ctx = sampleContext();
    const { env, ghost } = fakeEnv(ctx, 'tool-select');
    const tool = new SelectTool(env);
    const sofa = ofType(ctx, 'furniture').find((f) => f.catalogId === 'sofa-3')!;
    const grab = elementHit(sofa, { x: 8000, y: 1000 }, 850, { x: 0, y: 0, z: 1 });
    expect(tool.beginDrag(grab, false)).toBe(true);
    expect(ctx.selection.get()).toEqual([sofa.id]);
    tool.dragTo({ x: 8730, y: 1240 });
    expect(ghost.options?.solid).toBe(true);
    expect(ghost.options?.hide).toEqual([sofa.id]);
    tool.endDrag(true);
    const moved = ctx.store.getElement(sofa.id) as Furniture;
    expect(moved.position).toEqual({ x: 8700, y: 1200 });
    expect(ctx.store.undoLabel).toBe('Move furniture');

    tool.beginDrag(grab, false);
    tool.dragTo({ x: 9000, y: 3000 });
    expect(tool.cancel()).toBe(true);
    expect((ctx.store.getElement(sofa.id) as Furniture).position).toEqual({ x: 8700, y: 1200 });

    expect(tool.key({ key: 'R', shiftKey: true, ctrlKey: false, altKey: false })).toBe(true);
    expect((ctx.store.getElement(sofa.id) as Furniture).rotation).toBe(345);
    expect(ctx.store.undoLabel).toBe('Rotate furniture');
  });

  it('refuses to drag locked elements', () => {
    const ctx = sampleContext();
    const { env, toasts } = fakeEnv(ctx, 'tool-select');
    const tool = new SelectTool(env);
    const sofa = ofType(ctx, 'furniture')[0];
    ctx.store.update(sofa.id, { locked: true });
    expect(tool.beginDrag(elementHit(sofa, sofa.position, 0, { x: 0, y: 0, z: 1 }), false)).toBe(false);
    expect(toasts).toContain('Selection is locked');
  });
});
