import { describe, expect, it } from 'vitest';
import type { Beam, Railing, Wall } from '../../core/types';
import { LinearTool } from './linear';
import { elementHit, fakeEnv, floorHit, ofType, sampleContext } from './test-utils';

const UP = { x: 0, y: 0, z: 1 };

describe('wall tool: two-click with chaining', () => {
  it('RMB sets the start, RMB commits and continues, Esc ends the chain', () => {
    const ctx = sampleContext();
    const project = ctx.store.project;
    const { env, ghost } = fakeEnv(ctx, 'wall-brick');
    const tool = new LinearTool(env, 'wall');
    const n0 = ofType(ctx, 'wall').length;

    tool.use(floorHit(project, { x: -5020, y: -5010 }));
    expect(tool.drawing).toBe(true);
    expect(ofType(ctx, 'wall').length).toBe(n0);

    tool.hover(floorHit(project, { x: -1980, y: -4900 }));
    expect(ghost.shown).toHaveLength(1);
    expect(ghost.valid).toBe(true);
    expect(ghost.labelText).toContain('3.00 m');
    expect(ctx.ui.get().toolHint).toContain('RMB place & continue');

    tool.use(floorHit(project, { x: -2000, y: -5000 }));
    let walls = ofType(ctx, 'wall');
    expect(walls.length).toBe(n0 + 1);
    const w = walls.find((x) => x.start.x === -5000 && x.start.y === -5000) as Wall;
    expect(w.end).toEqual({ x: -2000, y: -5000 });
    expect(w.thickness).toBe(230);
    expect(w.materialId).toBe('brick-red');
    expect(w.levelId).toBe(project.levels[0].id);
    expect(ctx.store.undoLabel).toBe('Place wall');

    // Chained: next segment starts where the last one ended.
    tool.use(floorHit(project, { x: -2000, y: -2000 }));
    walls = ofType(ctx, 'wall');
    expect(walls.length).toBe(n0 + 2);
    expect(walls.some((x) => x.start.x === -2000 && x.start.y === -5000 && x.end.y === -2000)).toBe(true);

    expect(tool.cancel()).toBe(true);
    expect(tool.drawing).toBe(false);
    expect(tool.cancel()).toBe(false);

    // One undo step per segment.
    ctx.store.undo();
    expect(ofType(ctx, 'wall').length).toBe(n0 + 1);
  });

  it('LMB ends the chain (consumed) but falls through to break when idle', () => {
    const ctx = sampleContext();
    const { env } = fakeEnv(ctx, 'wall-200');
    const tool = new LinearTool(env, 'wall');
    expect(tool.primary()).toBe(false);
    tool.use(floorHit(ctx.store.project, { x: 0, y: -3000 }));
    expect(tool.primary()).toBe(true);
    expect(tool.drawing).toBe(false);
  });

  it('ignores too-short segments and closes loops automatically', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const { env } = fakeEnv(ctx, 'wall-200');
    const tool = new LinearTool(env, 'wall');
    const n0 = ofType(ctx, 'wall').length;
    tool.use(floorHit(p, { x: -10000, y: -10000 }));
    tool.use(floorHit(p, { x: -10000, y: -10000 }));
    expect(ofType(ctx, 'wall').length).toBe(n0);
    tool.use(floorHit(p, { x: -6000, y: -10000 }));
    tool.use(floorHit(p, { x: -6000, y: -7000 }));
    tool.use(floorHit(p, { x: -10000, y: -7000 }));
    expect(tool.drawing).toBe(true);
    tool.use(floorHit(p, { x: -10100, y: -10080 })); // magnet to the chain origin
    expect(ofType(ctx, 'wall').length).toBe(n0 + 4);
    expect(tool.drawing).toBe(false);
  });

  it('snaps to existing wall ends and uses the project wall thickness by default', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const { env } = fakeEnv(ctx, 'wall-200');
    const tool = new LinearTool(env, 'wall');
    tool.use(floorHit(p, { x: 12150, y: -180 }));
    tool.use(floorHit(p, { x: 16000, y: 0 }));
    const w = ofType(ctx, 'wall').find((x) => x.end.x === 16000)!;
    expect(w.start).toEqual({ x: 12000, y: 0 });
    expect(w.thickness).toBe(200);
  });

  it('building on top of the top storey creates a new level in the same undo step', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const first = p.levels[1];
    const topWall = ofType(ctx, 'wall').find((w) => w.levelId === first.id && w.start.y === 0 && w.end.y === 0)!;
    const { env, toasts } = fakeEnv(ctx, 'wall-200');
    const tool = new LinearTool(env, 'wall');
    tool.use(elementHit(topWall, { x: 2000, y: 40 }, 6000, UP));
    tool.hover(elementHit(topWall, { x: 8000, y: 40 }, 6000, UP));
    expect(p.levels).toHaveLength(2);
    tool.use(elementHit(topWall, { x: 8000, y: 40 }, 6000, UP));
    expect(ctx.store.project.levels).toHaveLength(3);
    const top = ctx.store.project.levels[2];
    expect(top.elevation).toBe(6000);
    expect(top.name).toBe('Second Floor');
    const w = ofType(ctx, 'wall').find((x) => x.levelId === top.id)!;
    expect(w.start).toEqual({ x: 2000, y: 0 });
    expect(w.baseOffset).toBe(0);
    expect(ctx.ui.get().activeLevelId).toBe(top.id);
    expect(toasts.some((t) => t.includes('Second Floor'))).toBe(true);
    // The chain continues on the new level (no further level).
    tool.use(floorHit(ctx.store.project, { x: 8000, y: 4000 }, top.id));
    expect(ctx.store.project.levels).toHaveLength(3);
    expect(ofType(ctx, 'wall').filter((x) => x.levelId === top.id)).toHaveLength(2);
    // Undo the first segment: wall and level go together.
    ctx.store.undo();
    ctx.store.undo();
    expect(ctx.store.project.levels).toHaveLength(2);
  });

  it('pointing at the top of a ground-floor wall targets the storey above', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const g = ofType(ctx, 'wall').find((w) => w.levelId === p.levels[0].id)!;
    const { env } = fakeEnv(ctx, 'wall-200');
    const tool = new LinearTool(env, 'wall');
    tool.use(elementHit(g, { x: 1000, y: 0 }, 3000, UP));
    tool.use(elementHit(g, { x: 4000, y: 0 }, 3000, UP));
    const w = ofType(ctx, 'wall').find((x) => x.start.x === 1000 && x.end.x === 4000)!;
    expect(w.levelId).toBe(p.levels[1].id);
  });

  it('offsets walls placed on raised surfaces', () => {
    const ctx = sampleContext();
    const block = ofType(ctx, 'block')[0];
    const { env } = fakeEnv(ctx, 'wall-200');
    const tool = new LinearTool(env, 'wall');
    // The sample chimney block stands on the roof level (top at +7.5 m): a wall on it lands on a
    // new storey at +6.0 m, raised 1.5 m and filling up to that storey's ceiling.
    tool.use(elementHit(block, { x: 5000, y: 3800 }, 7500, UP));
    tool.use(elementHit(block, { x: 7000, y: 3800 }, 7500, UP));
    const w = ofType(ctx, 'wall').find((x) => x.start.x === 5000 && x.start.y === 4000)!;
    const top = ctx.store.project.levels[2];
    expect(top.elevation).toBe(6000);
    expect(w.levelId).toBe(top.id);
    expect(w.baseOffset).toBe(1500);
    expect(w.height).toBe(1500);
  });
});

describe('beam and railing tools', () => {
  it('beams pointed at a wall top rest flush with it on that storey', () => {
    const ctx = sampleContext();
    const g = ofType(ctx, 'wall').find((w) => w.levelId === ctx.store.project.levels[0].id)!;
    const { env } = fakeEnv(ctx, 'beam-timber');
    const tool = new LinearTool(env, 'beam');
    tool.use(elementHit(g, { x: 0, y: 0 }, 3000, UP));
    tool.use(elementHit(g, { x: 0, y: 8000 }, 3000, UP));
    const b = ofType(ctx, 'beam')[0] as Beam;
    expect(b.levelId).toBe(g.levelId);
    expect(b.topOffset).toBe(3000);
    expect(b.width).toBe(150);
    expect(ctx.store.undoLabel).toBe('Place beam');
  });

  it('railing chains extend one railing path', () => {
    const ctx = sampleContext();
    const p = ctx.store.project;
    const n0 = ofType(ctx, 'railing').length;
    const { env } = fakeEnv(ctx, 'railing-glass');
    const tool = new LinearTool(env, 'railing');
    tool.use(floorHit(p, { x: -3000, y: -3000 }));
    tool.use(floorHit(p, { x: -1000, y: -3000 }));
    tool.use(floorHit(p, { x: -1000, y: -1000 }));
    const rails = ofType(ctx, 'railing');
    expect(rails.length).toBe(n0 + 1);
    const r = rails.find((x) => x.path.length === 3) as Railing;
    expect(r.path).toEqual([
      { x: -3000, y: -3000 },
      { x: -1000, y: -3000 },
      { x: -1000, y: -1000 },
    ]);
    expect(r.style).toBe('glass');
    expect(ctx.store.undoLabel).toBe('Extend railing');
  });
});
