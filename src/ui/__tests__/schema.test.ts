import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { createElement } from '../../core/defaults';
import { DocumentStore } from '../../core/store';
import type { Element, Slab, Stair, Wall } from '../../core/types';
import { applyFieldEdit, commonFields, commonValue, computedInfo, ELEMENT_SCHEMAS, formatFieldValue, parseFieldInput, schemaFor, type FieldDef } from '../schema';

const field = (type: Element['type'], key: string): FieldDef => {
  const f = schemaFor(type).fields.find((x) => x.key === key);
  if (!f) throw new Error(`no field ${type}.${key}`);
  return f;
};

function setup() {
  const store = new DocumentStore(createSampleProject());
  const ground = store.project.levels[0];
  const walls = store.elementsOnLevel(ground.id).filter((e): e is Wall => e.type === 'wall');
  return { store, ground, walls };
}

describe('field parsing', () => {
  it('accepts unit strings for lengths in metric and imperial', () => {
    const t = field('wall', 'thickness');
    expect(parseFieldInput(t, '250', 'metric')).toEqual({ ok: true, value: 250 });
    expect(parseFieldInput(t, '0.3m', 'metric')).toEqual({ ok: true, value: 300 });
    expect(parseFieldInput(t, '24 cm', 'metric')).toEqual({ ok: true, value: 240 });
    const imp = parseFieldInput(t, '10"', 'imperial');
    expect(imp.ok && imp.value).toBeCloseTo(254);
    const ft = parseFieldInput(field('wall', 'length'), `8'6"`, 'imperial');
    expect(ft.ok && ft.value).toBeCloseTo(2590.8);
  });

  it('rejects garbage and out-of-range values with a helpful message', () => {
    const t = field('wall', 'thickness');
    const bad = parseFieldInput(t, 'thick', 'metric');
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/2\.4m/);
    expect(parseFieldInput(t, '5', 'metric')).toMatchObject({ ok: false, error: expect.stringContaining('Minimum') });
    expect(parseFieldInput(t, '', 'metric').ok).toBe(false);
  });

  it('optional fields store undefined when emptied; angles wrap', () => {
    expect(parseFieldInput(field('wall', 'height'), '  ', 'metric')).toEqual({ ok: true, value: undefined });
    expect(parseFieldInput(field('furniture', 'rotation'), '-90°', 'metric')).toEqual({ ok: true, value: 270 });
    expect(parseFieldInput(field('door', 'style'), 'garage', 'metric')).toEqual({ ok: true, value: 'garage' });
    expect(parseFieldInput(field('door', 'style'), 'portal', 'metric').ok).toBe(false);
  });

  it('formats lengths in the display units', () => {
    const t = field('wall', 'thickness');
    expect(formatFieldValue(t, 250, 'metric')).toBe('250 mm');
    expect(formatFieldValue(t, 2537, 'metric')).toBe('2.537 m');
    expect(formatFieldValue(t, 304.8, 'imperial')).toBe(`1'-0"`);
    expect(formatFieldValue(field('roof', 'pitch'), 35, 'metric')).toBe('35°');
  });

  it('every element type has a schema with unique keys', () => {
    for (const [type, s] of Object.entries(ELEMENT_SCHEMAS)) {
      expect(s.type).toBe(type);
      const keys = s.fields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('applyFieldEdit', () => {
  it('edits one wall in one undoable transaction', () => {
    const { store, walls } = setup();
    const w = walls[0];
    const n = applyFieldEdit(store, [w.id], field('wall', 'thickness'), 300);
    expect(n).toBe(1);
    expect((store.getElement(w.id) as Wall).thickness).toBe(300);
    expect(store.undoLabel).toBe('Edit wall thickness');
    store.undo();
    expect((store.getElement(w.id) as Wall).thickness).toBe(w.thickness);
  });

  it('edits a multi-selection with one undo step and reports mixed values', () => {
    const { store, walls } = setup();
    const ids = walls.slice(0, 3).map((w) => w.id);
    const t = field('wall', 'thickness');
    applyFieldEdit(store, [ids[0]], t, 180);
    expect(commonValue(t, ids.map((id) => store.getElement(id)!), store.project).mixed).toBe(true);
    const undoDepth = () => (store as unknown as { undoStack: unknown[] }).undoStack.length;
    const before = undoDepth();
    applyFieldEdit(store, ids, t, 220);
    expect(undoDepth()).toBe(before + 1);
    expect(commonValue(t, ids.map((id) => store.getElement(id)!), store.project)).toEqual({ value: 220, mixed: false });
  });

  it('wall length moves the end point along the wall direction', () => {
    const { store, walls } = setup();
    const w = walls.find((x) => x.start.y === x.end.y && x.end.x > x.start.x)!;
    applyFieldEdit(store, [w.id], field('wall', 'length'), 5000);
    const after = store.getElement(w.id) as Wall;
    expect(after.start).toEqual(w.start);
    expect(after.end.x).toBeCloseTo(w.start.x + 5000);
    expect(after.end.y).toBeCloseTo(w.start.y);
  });

  it('moving a wall to another level carries its hosted openings', () => {
    const { store, walls } = setup();
    const first = store.project.levels[1];
    const host = walls.find((w) => store.elements.some((e) => (e.type === 'door' || e.type === 'window') && e.hostId === w.id))!;
    applyFieldEdit(store, [host.id], field('wall', 'levelId'), first.id);
    const openings = store.elements.filter((e) => (e.type === 'door' || e.type === 'window') && e.hostId === host.id);
    expect(openings.length).toBeGreaterThan(0);
    expect(openings.every((o) => o.levelId === first.id)).toBe(true);
    expect(store.getElement(host.id)!.levelId).toBe(first.id);
  });

  it('skips locked elements and nested axis fields replace the whole vector', () => {
    const { store, walls } = setup();
    store.update(walls[0].id, { locked: true });
    expect(applyFieldEdit(store, [walls[0].id], field('wall', 'thickness'), 400)).toBe(0);
    const stair = store.elements.find((e): e is Stair => e.type === 'stair')!;
    applyFieldEdit(store, [stair.id], field('stair', 'position.x'), 1234);
    expect((store.getElement(stair.id) as Stair).position).toEqual({ x: 1234, y: stair.position.y });
  });

  it('furniture model change resets dimension overrides', () => {
    const { store } = setup();
    const f = store.elements.find((e) => e.type === 'furniture')!;
    store.update(f.id, { width: 999 });
    applyFieldEdit(store, [f.id], field('furniture', 'catalogId'), 'armchair');
    const after = store.getElement(f.id) as Extract<Element, { type: 'furniture' }>;
    expect(after.catalogId).toBe('armchair');
    expect(after.width).toBeUndefined();
  });
});

describe('commonFields', () => {
  it('keeps only fields shared by every selected type (and visible for each)', () => {
    const { store, walls } = setup();
    const slab = store.elements.find((e): e is Slab => e.type === 'slab')!;
    const keys = commonFields([walls[0], slab]).map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['name', 'levelId', 'thickness', 'materialId']));
    expect(keys).not.toContain('length');
    expect(keys).not.toContain('kind');
    const flat = createElement('roof', walls[0].levelId, { shape: 'flat', outline: [] });
    expect(commonFields([flat]).map((f) => f.key)).not.toContain('pitch');
  });
});

describe('computedInfo', () => {
  it('reports wall quantities, stair riser count and slab area', () => {
    const { store, walls } = setup();
    const wallRows = computedInfo(walls[0], store.project, 'metric').map((r) => r.label);
    expect(wallRows).toEqual(expect.arrayContaining(['Length', 'Gross area', 'Net area', 'Volume']));
    const stair = store.elements.find((e): e is Stair => e.type === 'stair')!;
    const risers = computedInfo(stair, store.project, 'metric').find((r) => r.label === 'Risers')!;
    expect(risers.value).toMatch(/^\d+ × \d+ mm$/);
    const slab = store.elements.find((e): e is Slab => e.type === 'slab')!;
    expect(computedInfo(slab, store.project, 'metric').find((r) => r.label === 'Area')!.value).toMatch(/m²$/);
  });
});
