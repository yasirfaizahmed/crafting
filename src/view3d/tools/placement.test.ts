import { describe, expect, it } from 'vitest';
import { createElement } from '../../core/defaults';
import type { Block, Furniture, Stair } from '../../core/types';
import { autoBackToWall, blockCellMin, blockOccupied, blockPositionForCell, BlockTool, ColumnTool, facePlayerRotation, FurnitureTool, rotationFacing, StairTool, voxelCell } from './placement';
import { elementHit, fakeEnv, floorHit, ofType, sampleContext } from './test-utils';

const SIZE = { x: 500, y: 500, z: 500 };

describe('voxel adjacency', () => {
  const ctx = sampleContext();
  const p = ctx.store.project;
  const ground = p.levels[0];
  const b = createElement('block', ground.id, { position: { x: 1000, y: 2000, z: 0 }, size: { ...SIZE } });
  p.elements[b.id] = b;

  it.each([
    [{ x: 0, y: 0, z: 1 }, { x: 1000, y: 2000, z: 500 }],
    [{ x: 0, y: 0, z: -1 }, { x: 1000, y: 2000, z: -500 }],
    [{ x: 1, y: 0, z: 0 }, { x: 1500, y: 2000, z: 0 }],
    [{ x: -1, y: 0, z: 0 }, { x: 500, y: 2000, z: 0 }],
    [{ x: 0, y: 1, z: 0 }, { x: 1000, y: 2500, z: 0 }],
    [{ x: 0, y: -1, z: 0 }, { x: 1000, y: 1500, z: 0 }],
  ])('face normal %j → cell %j', (normal, cell) => {
    const r = voxelCell(p, elementHit(b, { x: 1250, y: 2250 }, 250, normal), SIZE);
    expect(r.cell).toEqual(cell);
    expect(r.target.levelId).toBe(ground.id);
  });

  it('stacks smaller blocks flush against the face of a bigger one', () => {
    const big = createElement('block', ground.id, { position: { x: 0, y: 0, z: 0 }, size: { x: 1000, y: 1000, z: 1000 } });
    p.elements[big.id] = big;
    expect(voxelCell(p, elementHit(big, { x: 500, y: 500 }, 1000, { x: 0, y: 0, z: 1 }), SIZE).cell).toEqual({ x: 0, y: 0, z: 1000 });
    expect(voxelCell(p, elementHit(big, { x: 1000, y: 500 }, 300, { x: 1, y: 0, z: 0 }), SIZE).cell).toEqual({ x: 1000, y: 0, z: 0 });
    delete p.elements[big.id];
  });

  it('fills the grid cell under the pointer on floors', () => {
    expect(voxelCell(p, floorHit(p, { x: -3250, y: -2750 }), SIZE).cell).toEqual({ x: -3500, y: -3000, z: 0 });
    expect(voxelCell(p, floorHit(p, { x: 10, y: 499 }), SIZE).cell).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('steps out of wall faces into the adjacent cell at the hit height', () => {
    const wall = ofType(ctx, 'wall').find((w) => w.levelId === ground.id && w.start.y === 0 && w.end.y === 0)!;
    // South face of the south wall (outer face at y = −125), 1.2 m up.
    const r = voxelCell(p, elementHit(wall, { x: 3100, y: -125 }, 1200, { x: 0, y: -1, z: 0 }), SIZE);
    expect(r.cell).toEqual({ x: 3000, y: -500, z: 1000 });
  });

  it('builds on top of the top storey on a new level', () => {
    const fWall = ofType(ctx, 'wall').find((w) => w.levelId === p.levels[1].id)!;
    const r = voxelCell(p, elementHit(fWall, { x: 120, y: 3000 }, 6000, { x: 0, y: 0, z: 1 }), SIZE);
    expect(r.target.create?.elevation).toBe(6000);
    expect(r.cell.z).toBe(0);
  });

  it('round-trips cell ⇄ position for rotated blocks', () => {
    for (const rot of [0, 90, 180, 270]) {
      const size = { x: 1000, y: 500, z: 500 };
      const pos = blockPositionForCell({ x: 2000, y: 3000, z: 0 }, size, rot);
      expect(blockCellMin({ position: pos, size, rotation: rot })).toEqual({ x: 2000, y: 3000, z: 0 });
    }
  });

  it('detects occupied cells', () => {
    expect(blockOccupied(p, ground.id, { x: 1000, y: 2000, z: 0 }, SIZE, 0)).toBe(true);
    expect(blockOccupied(p, ground.id, { x: 1000, y: 2000, z: 500 }, SIZE, 0)).toBe(false);
    expect(blockOccupied(p, undefined, { x: 1000, y: 2000, z: 0 }, SIZE, 0)).toBe(false);
  });
});

describe('block tool', () => {
  it('places voxels on faces, refuses occupied cells, uses the grid size', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const { env, ghost, toasts } = fakeEnv(ctx, 'block-stone');
    const tool = new BlockTool(env);
    expect(tool.blockSize()).toEqual(SIZE);
    const n0 = ofType(ctx, 'block').length;
    tool.use(floorHit(p, { x: -1700, y: -1200 }));
    const first = ofType(ctx, 'block').find((b) => b.position.x === -2000 && b.position.y === -1500) as Block;
    expect(first.materialId).toBe('stone-granite');
    expect(ctx.store.undoLabel).toBe('Place block');
    tool.use(elementHit(first, { x: -1750, y: -1250 }, 500, { x: 0, y: 0, z: 1 }));
    expect(ofType(ctx, 'block').some((b) => b.position.z === 500 && b.position.x === -2000)).toBe(true);
    // The same cell again is occupied.
    tool.hover(floorHit(p, { x: -1700, y: -1200 }));
    expect(ghost.valid).toBe(false);
    tool.use(floorHit(p, { x: -1700, y: -1200 }));
    expect(toasts).toContain('This cell is occupied');
    expect(ofType(ctx, 'block').length).toBe(n0 + 2);
  });
});

describe('furniture placement', () => {
  it('faces the player, snapped to 90°', () => {
    expect(facePlayerRotation({ x: 0, y: 0 }, { x: 0, y: -5000 })).toBe(0);
    expect(facePlayerRotation({ x: 0, y: 0 }, { x: 0, y: 5000 })).toBe(180);
    expect(facePlayerRotation({ x: 0, y: 0 }, { x: 5000, y: 300 })).toBe(90);
    expect(facePlayerRotation({ x: 0, y: 0 }, { x: -5000, y: 300 })).toBe(270);
    expect(rotationFacing({ x: 0, y: 1 })).toBe(180);
  });

  it('backs against a nearby wall face and looks into the room', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    // Kitchen north wall (y = 8000, inner face 7875). A 600-deep cabinet 200 mm off the wall.
    const r = autoBackToWall(p, p.levels[0].id, { x: 6500, y: 7375 }, 600, 600)!;
    expect(r).not.toBeNull();
    expect(r.position.y).toBeCloseTo(7875 - 301, 0);
    expect(r.rotation).toBe(0); // front (−y) looks south, back against the north wall
    // Far from walls: nothing.
    expect(autoBackToWall(p, p.levels[0].id, { x: 8000, y: 2200 }, 1200, 600)).toBeNull();
  });

  it('places the catalog item with default elevation; R rotates; wall faces stand against the wall', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const { env, ghost } = fakeEnv(ctx, 'furn-armchair', { position: { x: 3000, y: -6000 } });
    const tool = new FurnitureTool(env);
    tool.hover(floorHit(p, { x: 3020, y: -2030 }));
    expect(ghost.shown).toHaveLength(1);
    const g = ghost.shown[0] as Furniture;
    expect(g.position).toEqual({ x: 3000, y: -2050 });
    expect(g.rotation).toBe(0);
    expect(tool.key({ key: 'r', shiftKey: false, ctrlKey: false, altKey: false })).toBe(true);
    expect((ghost.shown[0] as Furniture).rotation).toBe(90);
    tool.use(floorHit(p, { x: 3020, y: -2030 }));
    const placed = ofType(ctx, 'furniture').find((f) => f.catalogId === 'armchair')!;
    expect(placed.rotation).toBe(90);
    expect(ctx.store.undoLabel).toBe('Place furniture');

    // Wall cabinets keep their catalog elevation; aiming at a wall face backs them onto it.
    const cab = fakeEnv(ctx, 'furn-wall-cabinet');
    const t2 = new FurnitureTool(cab.env);
    const wall = ofType(ctx, 'wall').find((w) => w.levelId === p.levels[0].id && w.start.y === 8000 && w.end.y === 8000)!;
    t2.use(elementHit(wall, { x: 6000, y: 7875 }, 1600, { x: 0, y: -1, z: 0 }));
    const c = ofType(ctx, 'furniture').find((f) => f.catalogId === 'wall-cabinet')!;
    expect(c.elevation).toBe(1450);
    expect(c.position.y).toBeCloseTo(7875 - 177, 0);
    expect(c.rotation).toBe(0);
  });

  it('stairs run in the player facing direction; columns snap to grid points', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const s = fakeEnv(ctx, 'stair-straight', { yaw: 178 });
    new StairTool(s.env).use(floorHit(p, { x: -2030, y: -4040 }));
    const stair = ofType(ctx, 'stair').find((x) => x.position.x === -2000) as Stair;
    expect(stair.position).toEqual({ x: -2000, y: -4000 });
    expect(stair.rotation).toBe(180);

    const c = fakeEnv(ctx, 'column-round');
    const tool = new ColumnTool(c.env);
    tool.use(floorHit(p, { x: -2740, y: -5260 }));
    const col = ofType(ctx, 'column').find((x) => x.shape === 'round')!;
    expect(col.position).toEqual({ x: -2500, y: -5500 });
    tool.hover(floorHit(p, { x: -2600, y: -5400 }));
    expect(c.ghost.valid).toBe(false);
  });
});
