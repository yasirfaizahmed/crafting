import { describe, expect, it } from 'vitest';
import { CommandRegistry } from '../../app/state';
import { createProject } from '../../core/defaults';
import { EXPORTERS } from '../../export';
import { QUICK_HOLD, MENU_LAYOUT, nextViewMode } from '../commands';
import { defaultDXFLayers } from '../dialogs/dxf-import';
import { defaultExportLevels, exportOptionGroups, formatBytes, friendlyExportError } from '../dialogs/export';
import { paletteResults } from '../dialogs/palette';
import { parseProjectForm, type ProjectFormValues } from '../dialogs/project';
import { displayLength, formatElevation, parseAngle, timeAgo } from '../format';
import { fuzzyMatch, fuzzyRank, highlightRuns } from '../fuzzy';
import { menuEntries, menuGroups } from '../menubar';
import { computeQuantities, quantitiesToCSV } from '../quantities';
import { createSampleProject } from '../../app/sample';
import { documentTitle } from '../shell';

describe('fuzzy matching', () => {
  it('matches subsequences and prefers word starts and contiguous runs', () => {
    expect(fuzzyMatch('gen3d', 'Generate 3D from Blueprint')).not.toBeNull();
    expect(fuzzyMatch('xyz', 'Generate 3D')).toBeNull();
    const a = fuzzyMatch('undo', 'Undo')!;
    const b = fuzzyMatch('undo', 'Round door')!;
    expect(a.score).toBeGreaterThan(b?.score ?? -Infinity);
    expect(fuzzyMatch('ws', 'Wall Snap')!.indices).toEqual([0, 5]);
    const ranked = fuzzyRank(['Export…', 'Expand selection', 'Text label'], 'exp', (s) => [s]);
    expect(ranked.map((r) => r.item)).toEqual(['Export…', 'Expand selection']);
    expect(highlightRuns('Wall', [0, 1])).toEqual([
      { text: 'Wa', hit: true },
      { text: 'll', hit: false },
    ]);
  });

  it('palette lists commands and catalog items', () => {
    const reg = new CommandRegistry();
    reg.register({ id: 'build.generate3d', label: 'Generate 3D from Blueprint', group: 'Build', run: () => undefined });
    reg.register({ id: 'hotbar.1', label: 'Hotbar Slot 1', group: 'Build', run: () => undefined });
    reg.register({ id: 'plan.importUnderlay', label: 'Trace Blueprint Image…', group: 'Build', run: () => undefined });
    expect(paletteResults(reg.all(), '').map((r) => (r.entry.kind === 'command' ? r.entry.command.id : ''))).toEqual(['build.generate3d']);
    const res = paletteResults(reg.all(), 'generate');
    expect(res[0].entry.kind === 'command' && res[0].entry.command.id).toBe('build.generate3d');
    const sofa = paletteResults(reg.all(), 'sofa');
    expect(sofa.some((r) => r.entry.kind === 'item' && r.entry.item.id.includes('sofa'))).toBe(true);
  });
});

describe('menus', () => {
  it('lays out groups in the standard order, appends extra commands and collapses separators', () => {
    const reg = new CommandRegistry();
    const run = () => undefined;
    reg.register({ id: 'edit.undo', label: 'Undo', group: 'Edit', run });
    reg.register({ id: 'file.new', label: 'New', group: 'File', run });
    reg.register({ id: 'help', label: 'Help', group: 'Help', run });
    reg.register({ id: 'zzz.custom', label: 'Custom', group: 'Tools', run });
    reg.register({ id: 'edit.extra', label: 'Extra', group: 'Edit', run });
    reg.register({ id: 'hotbar.1', label: 'Slot', group: 'Build', run });
    expect(menuGroups(reg.all())).toEqual(['File', 'Edit', 'Tools', 'Help']);
    const edit = menuEntries('Edit', reg.all()).map((e) => (e === '-' ? '-' : e.id));
    expect(edit).toEqual(['edit.undo', '-', 'edit.extra']);
    expect(MENU_LAYOUT.Build).toEqual(expect.arrayContaining(QUICK_HOLD.map((id) => `build.hold.${id}`)));
  });

  it('cycles view modes plan → split → 3D', () => {
    expect(nextViewMode('plan')).toBe('split');
    expect(nextViewMode('split')).toBe('3d');
    expect(nextViewMode('3d')).toBe('plan');
  });
});

describe('export dialog helpers', () => {
  it('shows the right option groups per format', () => {
    const get = (f: string) => exportOptionGroups(EXPORTERS.find((e) => e.format === f)!);
    expect(get('pdf')).toMatchObject({ levels: true, drawing: true, paper: true, pixels: false });
    expect(get('png-3d')).toMatchObject({ levels: false, pixels: true, drawing: false });
    expect(get('png-plan')).toMatchObject({ dpi: true, drawing: true });
    expect(Object.values(get('craft')).some(Boolean)).toBe(false);
    expect(get('ifc')).toMatchObject({ levels: true, content: true, drawing: false });
  });

  it('defaults to the active level for drawings and every level for models', () => {
    const dxf = EXPORTERS.find((e) => e.format === 'dxf')!;
    const glb = EXPORTERS.find((e) => e.format === 'glb')!;
    expect(defaultExportLevels(dxf, ['a', 'b'], 'b')).toEqual(['b']);
    expect(defaultExportLevels(glb, ['a', 'b'], 'b')).toEqual(['a', 'b']);
  });

  it('gives friendly errors and sizes', () => {
    expect(friendlyExportError({ label: 'IFC 4 (BIM)' }, new Error('IFC export not implemented yet'))).toMatch(/not available in this build/);
    expect(friendlyExportError({ label: 'PDF' }, new Error('disk full'))).toBe('PDF export failed: disk full');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('pre-selects wall layers for DXF import', () => {
    expect(defaultDXFLayers([{ name: 'A-WALL', entityCount: 10 }, { name: 'A-DOOR', entityCount: 3 }])).toEqual(['A-WALL']);
    expect(defaultDXFLayers([{ name: 'Lines', entityCount: 4 }, { name: 'Empty', entityCount: 0 }])).toEqual(['Lines']);
  });
});

describe('project settings form', () => {
  const p = createProject('House');
  const base: ProjectFormValues = { name: 'House', author: '', address: '', description: '', units: 'metric', gridSize: '500 mm', wallThickness: '200', levelHeight: '3m', northAngle: '0°' };

  it('returns only changed fields, parsing lengths with units', () => {
    const r = parseProjectForm({ ...base, name: ' Villa ', gridSize: '25cm', northAngle: '-10' }, p.info, p.settings);
    expect(r).toEqual({ ok: true, info: { name: 'Villa' }, settings: { gridSize: 250, northAngle: 350 } });
    const same = parseProjectForm({ ...base, levelHeight: '3000' }, p.info, p.settings);
    expect(same).toEqual({ ok: true, info: {}, settings: {} });
  });

  it('validates names, lengths and ranges', () => {
    const r = parseProjectForm({ ...base, name: '', wallThickness: 'thick', levelHeight: '0.1m' }, p.info, p.settings);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(['levelHeight', 'name', 'wallThickness']);
  });

  it('switching to imperial interprets bare numbers as inches', () => {
    const r = parseProjectForm({ ...base, units: 'imperial', gridSize: '12', wallThickness: `8"`, levelHeight: `10'` }, p.info, p.settings);
    expect(r.ok && r.settings.units).toBe('imperial');
    expect(r.ok && r.settings.gridSize).toBeCloseTo(304.8);
    expect(r.ok && r.settings.levelHeight).toBeCloseTo(3048);
  });
});

describe('formatting', () => {
  it('formats lengths, elevations, angles and times', () => {
    expect(displayLength(2500, 'metric')).toBe('2.5 m');
    expect(displayLength(3000, 'metric')).toBe('3 m');
    expect(displayLength(120, 'metric')).toBe('120 mm');
    expect(formatElevation(0, 'metric')).toBe('±0.00');
    expect(formatElevation(3000, 'metric')).toBe('+3.00 m');
    expect(formatElevation(-2800, 'metric')).toBe('−2.80 m');
    expect(parseAngle('45°')).toBe(45);
    expect(parseAngle('abc')).toBeNull();
    expect(timeAgo(new Date(Date.now() - 5 * 60_000).toISOString())).toBe('5 min ago');
    expect(documentTitle('House', true)).toBe('• House — Crafting');
    expect(documentTitle('', false)).toBe('Untitled Project — Crafting');
  });
});

describe('quantities', () => {
  it('computes live take-off figures and CSV for the sample house', () => {
    const p = createSampleProject();
    const q = computeQuantities(p);
    expect(q.total).toBe(Object.keys(p.elements).length);
    expect(q.walls.count).toBeGreaterThan(0);
    expect(q.walls.length).toBeGreaterThan(0);
    expect(q.walls.netArea).toBeLessThan(q.walls.grossArea);
    expect(q.totalFloorArea).toBeGreaterThan(0);
    expect(Object.values(q.doorsByStyle).reduce((a, b) => a + b, 0)).toBe(q.counts.door);
    const ground = computeQuantities(p, [p.levels[0].id]);
    expect(ground.total).toBeLessThan(q.total);
    const csv = quantitiesToCSV(q, 'metric');
    expect(csv.split('\n').length).toBeGreaterThan(5);
  });
});
