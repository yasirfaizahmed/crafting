/**
 * Project settings dialog: project information and modelling defaults, applied as ONE undo step
 * (tx.updateInfo + tx.updateSettings).
 */
import type { ProjectInfo, ProjectSettings, UnitSystem } from '../../core/types';
import { parseLength } from '../../core/units';
import { h } from '../dom';
import { displayLength, normalizeDeg, parseAngle } from '../format';
import type { Shell } from '../types';
import { openModal, type ModalHandle } from './modal';

export interface ProjectFormValues {
  name: string;
  author: string;
  address: string;
  description: string;
  units: string;
  gridSize: string;
  wallThickness: string;
  levelHeight: string;
  northAngle: string;
}

export type ProjectFormResult =
  | { ok: true; info: Partial<ProjectInfo>; settings: Partial<ProjectSettings> }
  | { ok: false; errors: Partial<Record<keyof ProjectFormValues, string>> };

/** Validate the form and return only the changed info/settings fields. */
export function parseProjectForm(v: ProjectFormValues, info: ProjectInfo, settings: ProjectSettings): ProjectFormResult {
  const errors: Partial<Record<keyof ProjectFormValues, string>> = {};
  const units: UnitSystem = v.units === 'imperial' ? 'imperial' : 'metric';
  const len = (key: 'gridSize' | 'wallThickness' | 'levelHeight', min: number, max: number): number | null => {
    const mm = parseLength(v[key], units);
    if (mm === null || !Number.isFinite(mm)) errors[key] = units === 'imperial' ? `Enter a length like 1' or 6"` : 'Enter a length like 200, 0.5m or 50cm';
    else if (mm < min || mm > max) errors[key] = `Must be between ${displayLength(min, units)} and ${displayLength(max, units)}`;
    else return mm;
    return null;
  };
  const gridSize = len('gridSize', 1, 10_000);
  const wallThickness = len('wallThickness', 10, 2000);
  const levelHeight = len('levelHeight', 500, 20_000);
  const north = parseAngle(v.northAngle || '0');
  if (north === null) errors.northAngle = 'Enter an angle in degrees';
  const name = v.name.trim();
  if (!name) errors.name = 'The project needs a name';
  if (Object.keys(errors).length) return { ok: false, errors };

  const nextInfo: Partial<ProjectInfo> = {};
  const setInfo = <K extends 'name' | 'author' | 'address' | 'description'>(k: K, val: string) => {
    if (info[k] !== val) nextInfo[k] = val;
  };
  setInfo('name', name);
  setInfo('author', v.author.trim());
  setInfo('address', v.address.trim());
  setInfo('description', v.description);
  const nextSettings: Partial<ProjectSettings> = {};
  if (settings.units !== units) nextSettings.units = units;
  const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  if (!close(settings.gridSize, gridSize!)) nextSettings.gridSize = gridSize!;
  if (!close(settings.wallThickness, wallThickness!)) nextSettings.wallThickness = wallThickness!;
  if (!close(settings.levelHeight, levelHeight!)) nextSettings.levelHeight = levelHeight!;
  const n = normalizeDeg(north!);
  if (!close(settings.northAngle, n)) nextSettings.northAngle = n;
  return { ok: true, info: nextInfo, settings: nextSettings };
}

export function openProjectDialog(shell: Shell): ModalHandle {
  const { store, ui } = shell.ctx;
  const { info, settings } = store.project;
  const u = settings.units;
  const input = (value: string, attrs: Record<string, unknown> = {}) => h('input', { class: 'cr-input', type: 'text', value, autocomplete: 'off', ...attrs });
  const els = {
    name: input(info.name, { 'aria-required': 'true' }),
    author: input(info.author, { placeholder: 'Your name or practice' }),
    address: input(info.address, { placeholder: 'Street, city' }),
    description: h('textarea', { class: 'cr-input cr-textarea', rows: '3', placeholder: 'Brief, notes…' }),
    units: h('select', { class: 'cr-select' }, h('option', { value: 'metric' }, 'Metric (mm, m)'), h('option', { value: 'imperial' }, 'Imperial (ft, in)')),
    gridSize: input(displayLength(settings.gridSize, u), { inputmode: 'decimal' }),
    wallThickness: input(displayLength(settings.wallThickness, u), { inputmode: 'decimal' }),
    levelHeight: input(displayLength(settings.levelHeight, u), { inputmode: 'decimal' }),
    northAngle: input(`${settings.northAngle}°`, { inputmode: 'decimal' }),
  };
  els.description.value = info.description;
  els.units.value = settings.units;
  const errs = new Map<keyof ProjectFormValues, HTMLElement>();
  const field = (key: keyof ProjectFormValues, label: string, hint?: string, wide = false) => {
    const err = h('span', { class: 'cr-field-error', hidden: true });
    errs.set(key, err);
    return h('label', { class: `cr-field ${wide ? 'is-wide' : ''}` }, h('span', { class: 'cr-field-label' }, label), els[key], hint ? h('span', { class: 'cr-field-hint' }, hint) : null, err);
  };
  // Re-express lengths when switching units so the numbers keep their meaning.
  els.units.addEventListener('change', () => {
    const from: UnitSystem = els.units.value === 'imperial' ? 'metric' : 'imperial';
    const to: UnitSystem = els.units.value === 'imperial' ? 'imperial' : 'metric';
    for (const k of ['gridSize', 'wallThickness', 'levelHeight'] as const) {
      const mm = parseLength(els[k].value, from);
      if (mm !== null) els[k].value = displayLength(mm, to);
    }
  });
  const created = new Date(info.created);
  const body = h(
    'form',
    { class: 'cr-form', novalidate: true },
    h(
      'fieldset',
      { class: 'cr-fieldset' },
      h('legend', null, 'Project information'),
      h('div', { class: 'cr-form-grid' }, field('name', 'Project name', undefined, true), field('author', 'Author'), field('address', 'Site address'), field('description', 'Description', undefined, true)),
    ),
    h(
      'fieldset',
      { class: 'cr-fieldset' },
      h('legend', null, 'Units & modelling defaults'),
      h(
        'div',
        { class: 'cr-form-grid' },
        field('units', 'Display units', 'The model is always stored in millimetres'),
        field('gridSize', 'Snap grid', 'Plan and 3D snapping step'),
        field('wallThickness', 'Default wall thickness'),
        field('levelHeight', 'Default level height', 'Floor-to-floor height of new levels'),
        field('northAngle', 'True north', 'Angle from plan +Y to geographic north (IFC)'),
      ),
    ),
    h('p', { class: 'cr-form-meta' }, `Created ${Number.isNaN(created.getTime()) ? '—' : created.toLocaleDateString()} · ${store.project.levels.length} levels · ${Object.keys(store.project.elements).length} elements`),
  );
  const save = h('button', { class: 'cr-btn is-primary', type: 'button' }, 'Apply');
  const cancel = h('button', { class: 'cr-btn', type: 'button' }, 'Cancel');
  const modal = openModal({ title: 'Project Settings', subtitle: info.name, size: 'md', className: 'cr-project-modal', body, footer: [h('span', { class: 'cr-flex' }), cancel, save], initialFocus: els.name });
  const apply = () => {
    const values = Object.fromEntries(Object.entries(els).map(([k, el]) => [k, el.value])) as unknown as ProjectFormValues;
    const res = parseProjectForm(values, store.project.info, store.project.settings);
    errs.forEach((e) => (e.hidden = true));
    if (!res.ok) {
      for (const [k, msg] of Object.entries(res.errors)) {
        const e = errs.get(k as keyof ProjectFormValues);
        if (e) {
          e.hidden = false;
          e.textContent = msg ?? '';
        }
      }
      return;
    }
    if (Object.keys(res.info).length || Object.keys(res.settings).length) {
      store.transact('Edit project settings', (tx) => {
        if (Object.keys(res.info).length) tx.updateInfo(res.info);
        if (Object.keys(res.settings).length) tx.updateSettings(res.settings);
      });
      if (res.settings.units) ui.set({ displayUnits: res.settings.units });
      shell.toast('Project settings updated', 'success');
      shell.refresh();
    }
    modal.close();
  };
  save.addEventListener('click', apply);
  cancel.addEventListener('click', () => modal.close());
  body.addEventListener('submit', (e) => {
    e.preventDefault();
    apply();
  });
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      apply();
    }
  });
  return modal;
}
