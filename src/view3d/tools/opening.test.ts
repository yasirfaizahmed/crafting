import { describe, expect, it } from 'vitest';
import { getCatalogItem } from '../../core/catalog';
import type { Door, Wall } from '../../core/types';
import { hostWallOf, OpeningTool, planOpening, playerOnRightSide } from './opening';
import { elementHit, fakeEnv, floorHit, ofType, sampleContext } from './test-utils';

function southWall(ctx: ReturnType<typeof sampleContext>): Wall {
  const p = ctx.store.project;
  return ofType(ctx, 'wall').find((w) => w.levelId === p.levels[0].id && w.start.y === 0 && w.end.y === 0 && w.thickness === 250)!;
}

describe('door side and hinge', () => {
  it('knows which side of a wall the player stands on', () => {
    const ctx = sampleContext();
    const w = southWall(ctx); // runs west → east: left = north (inside), right = south (outside)
    expect(playerOnRightSide(w, { x: 3000, y: -5000 })).toBe(true);
    expect(playerOnRightSide(w, { x: 3000, y: 2000 })).toBe(false);
  });

  it('doors swing toward the player and snap along the wall', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const w = southWall(ctx);
    const item = getCatalogItem('door-single')!;
    const outside = planOpening(p, item, w, { x: 4237, y: -100 }, { x: 4000, y: -6000 }, { hinge: 'left', step: 100 });
    expect(outside.element.offset).toBe(4200);
    expect((outside.element as Door).flip).toBe(true);
    expect(outside.valid).toBe(true);
    const inside = planOpening(p, item, w, { x: 4237, y: 100 }, { x: 4000, y: 3000 }, { hinge: 'right', step: 100 });
    expect((inside.element as Door).flip).toBe(false);
    expect((inside.element as Door).hinge).toBe('right');
  });

  it('clamps openings inside the wall and rejects overlaps', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const w = southWall(ctx);
    const item = getCatalogItem('door-single')!;
    expect(planOpening(p, item, w, { x: 100, y: 0 }, undefined, { step: 100 }).element.offset).toBe(450);
    // The sample entrance door sits at offset 2500 (1000 wide).
    const clash = planOpening(p, item, w, { x: 2900, y: 0 }, undefined, { step: 100 });
    expect(clash.valid).toBe(false);
    expect(clash.reason).toBe('Overlaps another opening');
    const garage = getCatalogItem('door-garage')!;
    const short = ofType(ctx, 'wall').find((x) => x.levelId === p.levels[1].id && x.end.x === 3000)!; // 3 m partition
    expect(planOpening(p, garage, short, { x: 1500, y: 4500 }, undefined, { step: 100 }).valid).toBe(true);
    const tall = getCatalogItem('window-tall')!;
    expect(planOpening(p, tall, short, { x: 1500, y: 4500 }, undefined, { step: 100 }).valid).toBe(true);
  });

  it('finds the host wall from a wall or an opening hit', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const w = southWall(ctx);
    const door = ofType(ctx, 'door').find((d) => d.hostId === w.id)!;
    expect(hostWallOf(p, elementHit(w, { x: 0, y: 0 }, 100, { x: 0, y: -1, z: 0 }))?.id).toBe(w.id);
    expect(hostWallOf(p, elementHit(door, { x: 0, y: 0 }, 100, { x: 0, y: -1, z: 0 }))?.id).toBe(w.id);
    expect(hostWallOf(p, floorHit(p, { x: 0, y: 0 }))).toBeUndefined();
  });
});

describe('opening tool', () => {
  it('ghosts on walls, R flips the hinge, RMB places one undo step', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const w = southWall(ctx);
    const { env, ghost, toasts } = fakeEnv(ctx, 'door-single', { position: { x: 6000, y: -8000 } });
    const tool = new OpeningTool(env);
    const hit = elementHit(w, { x: 6020, y: -125 }, 1000, { x: 0, y: -1, z: 0 });
    tool.hover(hit);
    expect(ghost.shown[0].type).toBe('door');
    expect(ghost.shown[1].id).toBe(w.id); // host rebuilt with the hole
    expect(ghost.options?.hide).toEqual([w.id]);
    expect(tool.key({ key: 'r', shiftKey: false, ctrlKey: false, altKey: false })).toBe(true);
    expect((ghost.shown[0] as Door).hinge).toBe('right');
    tool.use(hit);
    const d = ofType(ctx, 'door').find((x) => x.hostId === w.id && x.offset === 6000)!;
    expect(d.hinge).toBe('right');
    expect(d.flip).toBe(true);
    expect(d.width).toBe(900);
    expect(ctx.store.undoLabel).toBe('Place door');
    // Same place again overlaps.
    tool.use(hit);
    expect(toasts).toContain('Overlaps another opening');
    // Not a wall.
    tool.hover(floorHit(p, { x: 0, y: -3000 }));
    expect(ghost.shown).toEqual([]);
  });

  it('windows take their sill from the template', () => {
    const ctx = sampleContext();
    const w = southWall(ctx);
    const { env } = fakeEnv(ctx, 'window-awning');
    const tool = new OpeningTool(env);
    expect(tool.key({ key: 'r', shiftKey: false, ctrlKey: false, altKey: false })).toBe(false);
    tool.use(elementHit(w, { x: 5500, y: -125 }, 1700, { x: 0, y: -1, z: 0 }));
    const win = ofType(ctx, 'window').find((x) => x.hostId === w.id && x.offset === 5500)!;
    expect(win.sill).toBe(1500);
    expect(win.style).toBe('awning');
  });
});
