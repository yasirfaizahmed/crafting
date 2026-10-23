import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { DocumentStore } from '../../core/store';
import type { Element, Opening, Wall } from '../../core/types';
import { copyElements, duplicateElements, pasteOffset, preparePaste, translateElement } from '../clipboard';

function setup() {
  const store = new DocumentStore(createSampleProject());
  const [ground, first] = store.project.levels;
  const isOpening = (e: Element): e is Opening => e.type === 'door' || e.type === 'window';
  const host = store.elementsOnLevel(ground.id).find((w): w is Wall => w.type === 'wall' && store.elements.some((o) => isOpening(o) && o.hostId === w.id))!;
  const hosted = store.elements.filter((o): o is Opening => isOpening(o) && o.hostId === host.id);
  return { store, ground, first, host, hosted, isOpening };
}

describe('copyElements', () => {
  it('copies walls together with the openings they host (deep copies)', () => {
    const { store, host, hosted } = setup();
    const data = copyElements(store.project, [host.id])!;
    expect(data.elements.map((e) => e.id).sort()).toEqual([host.id, ...hosted.map((o) => o.id)].sort());
    expect(data.sourceLevelId).toBe(host.levelId);
    (data.elements[0] as Wall).thickness = 1;
    expect((store.getElement(data.elements[0].id) as Wall).thickness).not.toBe(1);
  });

  it('returns null for an empty or unknown selection', () => {
    const { store } = setup();
    expect(copyElements(store.project, [])).toBeNull();
    expect(copyElements(store.project, ['nope'])).toBeNull();
  });
});

describe('preparePaste', () => {
  it('assigns fresh ids, remaps hosted openings to the pasted walls and offsets geometry', () => {
    const { store, host, hosted, ground, isOpening } = setup();
    const data = copyElements(store.project, [host.id])!;
    const out = preparePaste(store.project, data, { levelId: ground.id, offset: { x: 500, y: -500 } });
    expect(out).toHaveLength(1 + hosted.length);
    const ids = new Set(out.map((e) => e.id));
    expect(ids.has(host.id)).toBe(false);
    const wall = out.find((e): e is Wall => e.type === 'wall')!;
    expect(wall.start).toEqual({ x: host.start.x + 500, y: host.start.y - 500 });
    for (const o of out.filter(isOpening)) {
      expect(o.hostId).toBe(wall.id);
      expect(o.levelId).toBe(ground.id);
    }
    // Insertable as one transaction.
    store.transact('Paste', (tx) => out.forEach((e) => tx.add(e)));
    expect(store.elements.filter((e) => isOpening(e) && e.hostId === wall.id)).toHaveLength(hosted.length);
  });

  it('moves elements to another level (paste in place)', () => {
    const { store, host, first } = setup();
    const data = copyElements(store.project, [host.id])!;
    const offset = pasteOffset(data, first.id, 500, 1);
    expect(offset).toEqual({ x: 0, y: 0 });
    const out = preparePaste(store.project, data, { levelId: first.id, offset });
    expect(out.every((e) => e.levelId === first.id)).toBe(true);
    expect((out.find((e) => e.type === 'wall') as Wall).start).toEqual(host.start);
  });

  it('openings copied without their wall are re-hosted on the same wall without overlapping', () => {
    const { store, hosted, ground, host } = setup();
    const one = hosted[0];
    const out = preparePaste(store.project, copyElements(store.project, [one.id])!, { levelId: ground.id, offset: { x: 0, y: 0 } });
    if (out.length) {
      const o = out[0] as Opening;
      expect(o.hostId).toBe(host.id);
      expect(o.offset).not.toBe(one.offset);
      expect(o.id).not.toBe(one.id);
    }
    // On another level the host does not exist: nothing is pasted.
    expect(preparePaste(store.project, copyElements(store.project, [one.id])!, { levelId: store.project.levels[1].id, offset: { x: 0, y: 0 } })).toEqual([]);
  });
});

describe('pasteOffset / duplicate / translate', () => {
  it('repeated pastes on the source level step by the grid', () => {
    const { store, host, ground } = setup();
    const data = copyElements(store.project, [host.id])!;
    expect(pasteOffset(data, ground.id, 500, 1)).toEqual({ x: 500, y: -500 });
    expect(pasteOffset(data, ground.id, 500, 3)).toEqual({ x: 1500, y: -1500 });
  });

  it('duplicates on each element’s own level, offset by one grid step', () => {
    const { store, host } = setup();
    const furn = store.elements.find((e) => e.type === 'furniture')!;
    const out = duplicateElements(store.project, [host.id, furn.id], 250);
    const f2 = out.find((e) => e.type === 'furniture') as Extract<Element, { type: 'furniture' }>;
    expect(f2.levelId).toBe(furn.levelId);
    expect(f2.position).toEqual({ x: (furn as typeof f2).position.x + 250, y: (furn as typeof f2).position.y - 250 });
    expect(out.find((e) => e.type === 'wall')!.levelId).toBe(host.levelId);
  });

  it('translates every geometric element type', () => {
    const { store } = setup();
    for (const el of store.elements) {
      const moved = translateElement(el, { x: 10, y: 20 });
      expect(moved).not.toBe(el);
      if (el.type === 'slab' || el.type === 'room' || el.type === 'roof') expect(moved.type === el.type && (moved as typeof el).outline[0].x).toBe(el.outline[0].x + 10);
      if (el.type === 'block') expect((moved as typeof el).position.z).toBe(el.position.z);
    }
  });
});
