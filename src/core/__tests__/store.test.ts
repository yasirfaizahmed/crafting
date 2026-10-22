import { describe, expect, it } from 'vitest';
import { createElement, createLevel, createProject } from '../defaults';
import { DocumentStore, type ChangeSet } from '../store';

function setup() {
  const project = createProject('Test');
  const store = new DocumentStore(project);
  const levelId = project.levels[0].id;
  const changes: ChangeSet[] = [];
  store.subscribe((c) => changes.push(c));
  return { store, levelId, changes };
}

describe('DocumentStore', () => {
  it('adds, updates and removes with undo/redo', () => {
    const { store, levelId, changes } = setup();
    const wall = createElement('wall', levelId, { start: { x: 0, y: 0 }, end: { x: 3000, y: 0 } });
    store.add(wall);
    expect(store.getElement(wall.id)).toBeDefined();
    expect(changes.at(-1)!.added).toEqual([wall.id]);

    store.update(wall.id, { thickness: 300 });
    expect((store.getElement(wall.id) as typeof wall).thickness).toBe(300);
    expect(changes.at(-1)!.previous[wall.id]).toMatchObject({ thickness: 200 });

    store.undo();
    expect((store.getElement(wall.id) as typeof wall).thickness).toBe(200);
    expect(changes.at(-1)!.origin).toBe('undo');
    store.redo();
    expect((store.getElement(wall.id) as typeof wall).thickness).toBe(300);

    store.remove(wall.id);
    expect(store.getElement(wall.id)).toBeUndefined();
    store.undo();
    expect(store.getElement(wall.id)).toBeDefined();
  });

  it('groups a transaction into one undo step and cascades hosted openings', () => {
    const { store, levelId } = setup();
    const wall = createElement('wall', levelId, { start: { x: 0, y: 0 }, end: { x: 5000, y: 0 } });
    const door = createElement('door', levelId, { hostId: wall.id, offset: 1000 });
    store.transact('Wall with door', (tx) => {
      tx.add(wall);
      tx.add(door);
    });
    expect(store.elements).toHaveLength(2);
    store.remove(wall.id);
    expect(store.elements).toHaveLength(0);
    store.undo();
    expect(store.elements).toHaveLength(2);
    store.undo();
    expect(store.elements).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });

  it('rolls back a failing transaction', () => {
    const { store, levelId, changes } = setup();
    const wall = createElement('wall', levelId);
    expect(() =>
      store.transact('Boom', (tx) => {
        tx.add(wall);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(store.elements).toHaveLength(0);
    expect(changes).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });

  it('manages levels with undo, sorting by elevation and cascade delete', () => {
    const { store, levelId } = setup();
    const upper = createLevel({ name: 'L2', elevation: 3000 });
    const basement = createLevel({ name: 'B1', elevation: -3000 });
    store.transact('Levels', (tx) => {
      tx.addLevel(upper);
      tx.addLevel(basement);
    });
    expect(store.project.levels.map((l) => l.name)).toEqual(['B1', 'Ground Floor', 'L2']);
    store.add(createElement('wall', upper.id));
    store.transact('Remove L2', (tx) => tx.removeLevel(upper.id));
    expect(store.project.levels).toHaveLength(2);
    expect(store.elements).toHaveLength(0);
    store.undo();
    expect(store.project.levels).toHaveLength(3);
    expect(store.elements).toHaveLength(1);
    expect(() => store.transact('x', (tx) => tx.add(createElement('wall', 'nope')))).toThrow();
    expect(store.getLevel(levelId)).toBeDefined();
  });

  it('skips no-op transactions', () => {
    const { store, changes } = setup();
    store.transact('Nothing', () => undefined);
    expect(changes).toHaveLength(0);
    expect(store.canUndo).toBe(false);
  });
});
