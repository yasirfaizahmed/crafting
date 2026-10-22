import { describe, expect, it, vi } from 'vitest';
import { createElement } from '../../core/defaults';
import { commitPlacement, groundLevel, levelAboveTop, levelContaining, levelName, resolveBuildTarget, settledTarget, targetLevelId } from './levels';
import { elementHit, fakeEnv, floorHit, ofType, sampleContext } from './test-utils';

const UP = { x: 0, y: 0, z: 1 };

describe('level targeting', () => {
  const ctx = sampleContext();
  const p = ctx.store.project;
  const [ground, first] = p.levels;
  const gWall = ofType(ctx, 'wall').find((w) => w.levelId === ground.id)!;
  const fWall = ofType(ctx, 'wall').find((w) => w.levelId === first.id)!;
  const fSlab = ofType(ctx, 'slab').find((s) => s.levelId === first.id)!;

  it('names storeys conventionally', () => {
    expect(levelName(0)).toBe('Ground Floor');
    expect(levelName(2)).toBe('Second Floor');
    expect(levelName(14)).toBe('Level 14');
  });

  it('finds the ground and containing levels', () => {
    expect(groundLevel(p).id).toBe(ground.id);
    expect(levelContaining(p, 4500).id).toBe(first.id);
    expect(levelContaining(p, -500).id).toBe(ground.id);
    const above = levelAboveTop(p);
    expect(above.elevation).toBe(6000);
    expect(above.height).toBe(3000);
  });

  it('floor and ground hits use their level', () => {
    expect(resolveBuildTarget(p, floorHit(p, { x: 0, y: 0 }))).toMatchObject({ levelId: ground.id, offset: 0 });
    expect(resolveBuildTarget(p, floorHit(p, { x: 0, y: 0 }, first.id))).toMatchObject({ levelId: first.id, offset: 0, levelElevation: 3000 });
  });

  it('upward faces at a level datum snap to that level', () => {
    expect(resolveBuildTarget(p, elementHit(gWall, { x: 0, y: 0 }, 3000, UP))).toMatchObject({ levelId: first.id, offset: 0 });
    expect(resolveBuildTarget(p, elementHit(fSlab, { x: 0, y: 0 }, 3040, UP))).toMatchObject({ levelId: first.id, offset: 0 });
  });

  it('vertical faces build on the element storey floor', () => {
    expect(resolveBuildTarget(p, elementHit(fWall, { x: 0, y: 0 }, 4200, { x: 1, y: 0, z: 0 }))).toMatchObject({ levelId: first.id, offset: 0 });
  });

  it('mid-storey surfaces give an offset above the datum', () => {
    const table = createElement('furniture', ground.id, { catalogId: 'dining-table-6' });
    expect(resolveBuildTarget(p, elementHit(table, { x: 0, y: 0 }, 750, UP))).toMatchObject({ levelId: ground.id, offset: 750 });
  });

  it('the top of the top storey creates a new level', () => {
    const t = resolveBuildTarget(p, elementHit(fWall, { x: 0, y: 0 }, 6000, UP));
    expect(t.levelId).toBeUndefined();
    expect(t.create).toMatchObject({ elevation: 6000, name: 'Second Floor' });
    expect(targetLevelId(t)).toBe(t.create!.id);
    expect(settledTarget(t)).toMatchObject({ levelId: t.create!.id, create: undefined });
  });

  it('commitPlacement adds the level and the element in one undo step', () => {
    const c2 = sampleContext();
    const { env } = fakeEnv(c2, 'block-brick');
    const t = resolveBuildTarget(c2.store.project, elementHit(fWall, { x: 0, y: 0 }, 6000, UP));
    const els = commitPlacement(env, 'Place block', t, (levelId) => [createElement('block', levelId, {})]);
    expect(els).toHaveLength(1);
    expect(c2.store.project.levels).toHaveLength(3);
    expect(c2.ui.get().activeLevelId).toBe(t.create!.id);
    c2.store.undo();
    expect(c2.store.project.levels).toHaveLength(2);
    expect(c2.store.getElement(els![0].id)).toBeUndefined();
  });

  it('commitPlacement reports failures without throwing', () => {
    const c2 = sampleContext();
    const { env, toasts } = fakeEnv(c2, 'block-brick');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = commitPlacement(env, 'Place block', { levelElevation: 0, levelHeight: 3000, offset: 0 }, () => []);
    warn.mockRestore();
    expect(r).toBeNull();
    expect(toasts).toContain('Could not place here');
  });
});
