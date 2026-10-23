import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { CATALOG, CATEGORY_LABELS, DEFAULT_HOTBAR } from '../../core/catalog';
import { createLevel, createProject } from '../../core/defaults';
import { DocumentStore } from '../../core/store';
import { clearSlot, cycleIndex, firstEmptySlot, HOTBAR_SIZE, holdItem, moveSlot, normalizeHotbar, putInCurrentSlot, putInNextEmptySlot, setSlot, shiftClickSlot } from '../hotbar-model';
import { inventoryItems } from '../inventory';
import { adjacentLevelId, canRemoveLevel, fallbackLevelId, insertLevel, levelElementCounts, levelsTopDown, planInsertLevel, removeLevel, storeyName, suggestLevelName } from '../level-ops';

describe('hotbar model', () => {
  it('normalises to 9 slots and drops unknown ids', () => {
    const hb = normalizeHotbar(['wall-200', 'bogus']);
    expect(hb).toHaveLength(HOTBAR_SIZE);
    expect(hb[0]).toBe('wall-200');
    expect(hb[1]).toBe('');
  });

  it('sets, clears, swaps and cycles slots', () => {
    const hb = [...DEFAULT_HOTBAR];
    expect(setSlot(hb, 3, 'furn-armchair')[3]).toBe('furn-armchair');
    expect(clearSlot(hb, 0)[0]).toBe('');
    const moved = moveSlot(hb, 1, 4);
    expect(moved[1]).toBe(hb[4]);
    expect(moved[4]).toBe(hb[1]);
    expect(moveSlot(hb, 1, 99)).toEqual(normalizeHotbar(hb));
    expect(cycleIndex(8, 1)).toBe(0);
    expect(cycleIndex(0, -1)).toBe(8);
    expect(cycleIndex(4, -13)).toBe(0);
  });

  it('inventory click fills the current slot, shift-click the next empty one', () => {
    const ui = { hotbar: setSlot(clearSlot(DEFAULT_HOTBAR, 6), 7, ''), hotbarIndex: 2 };
    expect(putInCurrentSlot(ui, 'furn-armchair')).toEqual({ hotbar: setSlot(ui.hotbar, 2, 'furn-armchair'), hotbarIndex: 2 });
    const r = putInNextEmptySlot(ui, 'furn-armchair');
    expect(r.slot).toBe(6);
    expect(r.hotbar[6]).toBe('furn-armchair');
    expect(r.hotbarIndex).toBe(2);
    expect(firstEmptySlot(ui.hotbar, 7)).toBe(7);
    // Full hotbar: replace the slot after the current one.
    expect(shiftClickSlot(DEFAULT_HOTBAR, 8)).toBe(0);
  });

  it('holding an item selects its slot when it is already on the hotbar', () => {
    const ui = { hotbar: [...DEFAULT_HOTBAR], hotbarIndex: 0 };
    expect(holdItem(ui, DEFAULT_HOTBAR[5]).hotbarIndex).toBe(5);
    const r = holdItem(ui, 'furn-armchair');
    expect(r.hotbarIndex).toBe(0);
    expect(r.hotbar[0]).toBe('furn-armchair');
  });
});

describe('inventory items', () => {
  it('filters by category tab and searches every category', () => {
    expect(inventoryItems('all', '')).toHaveLength(CATALOG.length);
    for (const cat of Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[]) {
      expect(inventoryItems(cat, '').every((i) => i.category === cat)).toBe(true);
    }
    const sofas = inventoryItems('paint', 'sofa');
    expect(sofas.length).toBeGreaterThan(0);
    expect(sofas.every((i) => /sofa/i.test(i.name) || (i.keywords ?? []).some((k) => k.includes('sofa')))).toBe(true);
    // Category labels are searchable too.
    expect(inventoryItems('all', 'bathroom').some((i) => i.category === 'bath')).toBe(true);
    expect(inventoryItems('all', 'zzzz-nothing')).toEqual([]);
  });
});

describe('level operations', () => {
  it('orders levels and finds neighbours', () => {
    const p = createSampleProject();
    const [g, f] = p.levels;
    expect(levelsTopDown(p).map((l) => l.id)).toEqual([f.id, g.id]);
    expect(adjacentLevelId(p, g.id, 1)).toBe(f.id);
    expect(adjacentLevelId(p, f.id, 1)).toBeUndefined();
    expect(adjacentLevelId(p, f.id, -1)).toBe(g.id);
    expect(fallbackLevelId(p, f.id)).toBe(g.id);
    const counts = levelElementCounts(p);
    expect([...counts.values()].reduce((a, b) => a + b, 0)).toBe(Object.keys(p.elements).length);
  });

  it('adds a level above the top using the neighbour elevation + height', () => {
    const p = createSampleProject();
    const top = p.levels[1];
    const plan = planInsertLevel(p, top.id, 'above');
    expect(plan.level.elevation).toBe(top.elevation + top.height);
    expect(plan.level.name).toBe('Second Floor');
    expect(plan.shifts).toEqual([]);
  });

  it('inserting between levels pushes the upper levels up', () => {
    const p = createSampleProject();
    const [g, f] = p.levels;
    const plan = planInsertLevel(p, g.id, 'above');
    expect(plan.level.elevation).toBe(g.elevation + g.height);
    expect(plan.shifts).toEqual([{ id: f.id, elevation: f.elevation + p.settings.levelHeight }]);
  });

  it('adds a basement below the lowest level', () => {
    const p = createSampleProject();
    const plan = planInsertLevel(p, p.levels[0].id, 'below');
    expect(plan.level.elevation).toBe(-p.settings.levelHeight);
    expect(plan.level.name).toBe('Basement');
  });

  it('insert / remove are single undo steps; the last level cannot be removed', () => {
    const store = new DocumentStore(createSampleProject());
    const n = store.project.levels.length;
    const l = insertLevel(store, store.project.levels[0].id, 'above');
    expect(store.project.levels).toHaveLength(n + 1);
    expect(store.project.levels.map((x) => x.elevation)).toEqual([...store.project.levels.map((x) => x.elevation)].sort((a, b) => a - b));
    store.undo();
    expect(store.project.levels).toHaveLength(n);
    expect(store.getLevel(l.id)).toBeUndefined();

    const first = store.project.levels[1];
    const onFirst = store.elementsOnLevel(first.id).length;
    expect(onFirst).toBeGreaterThan(0);
    expect(removeLevel(store, first.id)).toBe(true);
    expect(store.elementsOnLevel(first.id)).toHaveLength(0);
    store.undo();
    expect(store.elementsOnLevel(first.id)).toHaveLength(onFirst);

    const single = new DocumentStore(createProject());
    expect(canRemoveLevel(single.project)).toBe(false);
    expect(removeLevel(single, single.project.levels[0].id)).toBe(false);
  });

  it('suggests conventional, unique storey names', () => {
    expect(storeyName(0)).toBe('Ground Floor');
    expect(storeyName(2)).toBe('Second Floor');
    expect(storeyName(-2)).toBe('Basement 2');
    const p = createProject();
    p.levels.push(createLevel({ name: 'First Floor', elevation: 3000 }));
    expect(suggestLevelName(p, 3000)).toMatch(/^Level \d+$/);
  });
});
