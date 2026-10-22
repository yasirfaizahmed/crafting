/**
 * Levels panel: storeys top → bottom with elevation, height and element count. Click to activate,
 * double-click to rename, edit elevation/height inline, add above/below, delete with confirm.
 */
import type { Level } from '../../core/types';
import { parseLength } from '../../core/units';
import { batched, h } from '../dom';
import { displayLength, formatElevation } from '../format';
import { icon } from '../icons';
import { canRemoveLevel, fallbackLevelId, insertLevel, levelElementCounts, levelsTopDown, removeLevel } from '../level-ops';
import type { Shell } from '../types';

export interface LevelsPanelHandle {
  el: HTMLElement;
  focus(): void;
  dispose(): void;
}

export function mountLevelsPanel(container: HTMLElement, shell: Shell): LevelsPanelHandle {
  const { store, ui } = shell.ctx;
  const list = h('ul', { class: 'cr-levels', role: 'listbox', 'aria-label': 'Levels' });
  const addAbove = h('button', { class: 'cr-icon-btn', type: 'button', title: 'Add level above the active level', 'aria-label': 'Add level above' }, icon('plus'), icon('arrowUp', 'cr-icon-xs'));
  const addBelow = h('button', { class: 'cr-icon-btn', type: 'button', title: 'Add level below the active level', 'aria-label': 'Add level below' }, icon('plus'), icon('arrowDown', 'cr-icon-xs'));
  const count = h('span', { class: 'cr-panel-count' });
  const el = h(
    'section',
    { class: 'cr-panel cr-levels-panel', 'aria-label': 'Levels' },
    h('header', { class: 'cr-panel-head' }, icon('layers'), h('h3', null, 'Levels'), count, h('span', { class: 'cr-flex' }), addAbove, addBelow),
    list,
    h('p', { class: 'cr-panel-foot' }, h('kbd', null, 'PgUp'), ' / ', h('kbd', null, 'PgDn'), ' switch level · double-click to rename'),
  );
  container.appendChild(el);

  let editing: string | null = null;
  let renaming: string | null = null;

  const add = (where: 'above' | 'below') => {
    const l = insertLevel(store, ui.get().activeLevelId, where);
    ui.set({ activeLevelId: l.id });
    shell.toast(`Added ${l.name} at ${formatElevation(l.elevation, ui.get().displayUnits)}`, 'success');
  };
  addAbove.addEventListener('click', () => add('above'));
  addBelow.addEventListener('click', () => add('below'));

  const del = async (level: Level, n: number) => {
    if (!canRemoveLevel(store.project)) {
      shell.toast('A project needs at least one level', 'warning');
      return;
    }
    const ok = await shell.confirm({
      title: `Delete “${level.name}”?`,
      message: n ? `This removes the level and its ${n} element${n === 1 ? '' : 's'}. You can undo this with Ctrl+Z.` : 'This level is empty. You can undo this with Ctrl+Z.',
      confirmLabel: 'Delete level',
      danger: true,
    });
    if (!ok) return;
    const next = fallbackLevelId(store.project, level.id);
    if (ui.get().activeLevelId === level.id && next) ui.set({ activeLevelId: next });
    removeLevel(store, level.id);
    shell.toast(`Deleted ${level.name}`, 'info');
  };

  const commitRename = (level: Level, value: string) => {
    renaming = null;
    const name = value.trim();
    if (name && name !== level.name) store.transact(`Rename level ${name}`, (tx) => tx.updateLevel(level.id, { name }));
    else render.schedule();
  };

  function editor(level: Level): HTMLElement {
    const units = ui.get().displayUnits;
    const name = h('input', { class: 'cr-input', type: 'text', value: level.name, 'aria-label': 'Level name' });
    const elev = h('input', { class: 'cr-input', type: 'text', value: displayLength(level.elevation, units), 'aria-label': 'Elevation', inputmode: 'decimal' });
    const height = h('input', { class: 'cr-input', type: 'text', value: displayLength(level.height, units), 'aria-label': 'Floor-to-floor height', inputmode: 'decimal' });
    const err = h('p', { class: 'cr-field-error', hidden: true });
    const save = h('button', { class: 'cr-btn is-primary is-sm', type: 'submit' }, 'Apply');
    const cancel = h('button', { class: 'cr-btn is-sm', type: 'button' }, 'Cancel');
    const form = h(
      'form',
      { class: 'cr-level-editor' },
      h('label', { class: 'cr-mini-field' }, h('span', null, 'Name'), name),
      h('div', { class: 'cr-mini-row' }, h('label', { class: 'cr-mini-field' }, h('span', null, 'Elevation'), elev), h('label', { class: 'cr-mini-field' }, h('span', null, 'Height'), height)),
      err,
      h('div', { class: 'cr-mini-actions' }, cancel, save),
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const ev = parseLength(elev.value, units);
      const ht = parseLength(height.value, units);
      if (ev === null || ht === null || ht <= 0) {
        err.hidden = false;
        err.textContent = units === 'imperial' ? `Enter lengths like 10' or 9'6"` : 'Enter lengths like 3000, 3m or 300cm (height > 0)';
        return;
      }
      if (store.project.levels.some((l) => l.id !== level.id && Math.abs(l.elevation - ev) < 1)) {
        err.hidden = false;
        err.textContent = 'Another level already uses this elevation';
        return;
      }
      editing = null;
      const patch: Partial<Level> = {};
      if (name.value.trim() && name.value.trim() !== level.name) patch.name = name.value.trim();
      if (Math.abs(ev - level.elevation) > 0.01) patch.elevation = ev;
      if (Math.abs(ht - level.height) > 0.01) patch.height = ht;
      if (Object.keys(patch).length) store.transact(`Edit level ${patch.name ?? level.name}`, (tx) => tx.updateLevel(level.id, patch));
      else render.schedule();
    });
    cancel.addEventListener('click', () => {
      editing = null;
      render.schedule();
    });
    form.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        editing = null;
        render.schedule();
      }
    });
    setTimeout(() => elev.focus(), 0);
    return form;
  }

  const render = batched(() => {
    const units = ui.get().displayUnits;
    const active = ui.get().activeLevelId;
    const counts = levelElementCounts(store.project);
    const levels = levelsTopDown(store.project);
    count.textContent = String(levels.length);
    list.textContent = '';
    for (const level of levels) {
      const n = counts.get(level.id) ?? 0;
      const isActive = level.id === active;
      const nameEl =
        renaming === level.id
          ? h('input', { class: 'cr-input cr-level-rename', type: 'text', value: level.name, 'aria-label': 'Level name' })
          : h('span', { class: 'cr-level-name' }, level.name);
      const editBtn = h('button', { class: 'cr-icon-btn is-sm', type: 'button', title: 'Edit elevation & height', 'aria-label': `Edit ${level.name}` }, icon('pencil'));
      const delBtn = h(
        'button',
        { class: 'cr-icon-btn is-sm is-danger', type: 'button', title: canRemoveLevel(store.project) ? 'Delete level' : 'A project needs at least one level', 'aria-label': `Delete ${level.name}`, disabled: !canRemoveLevel(store.project) },
        icon('trash'),
      );
      const row = h(
        'li',
        { class: `cr-level-row ${isActive ? 'is-active' : ''}`, role: 'option', 'aria-selected': String(isActive), tabindex: isActive ? '0' : '-1', 'data-level': level.id },
        h('span', { class: 'cr-level-marker', 'aria-hidden': 'true' }),
        h(
          'div',
          { class: 'cr-level-main' },
          nameEl,
          h('span', { class: 'cr-level-meta' }, h('span', { title: 'Elevation (top of floor)' }, formatElevation(level.elevation, units)), h('span', { class: 'cr-dot' }, '·'), h('span', { title: 'Floor-to-floor height' }, `H ${displayLength(level.height, units)}`)),
        ),
        h('span', { class: 'cr-level-count', title: `${n} element${n === 1 ? '' : 's'}` }, String(n)),
        h('div', { class: 'cr-level-actions' }, editBtn, delBtn),
      );
      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button, input')) return;
        ui.set({ activeLevelId: level.id });
      });
      row.addEventListener('dblclick', (e) => {
        if ((e.target as HTMLElement).closest('button, input')) return;
        renaming = level.id;
        render.flush();
      });
      row.addEventListener('keydown', (e) => {
        if (e.target !== row) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          ui.set({ activeLevelId: level.id });
        } else if (e.key === 'F2') {
          e.preventDefault();
          renaming = level.id;
          render.flush();
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          e.stopPropagation();
          const rows = [...list.querySelectorAll<HTMLElement>('.cr-level-row')];
          const i = rows.indexOf(row);
          const next = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
          if (next) {
            ui.set({ activeLevelId: next.dataset.level! });
            list.querySelector<HTMLElement>(`[data-level="${next.dataset.level}"]`)?.focus();
          }
        }
      });
      editBtn.addEventListener('click', () => {
        editing = editing === level.id ? null : level.id;
        render.flush();
      });
      delBtn.addEventListener('click', () => void del(level, n));
      list.appendChild(row);
      if (nameEl instanceof HTMLInputElement) {
        nameEl.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') commitRename(level, nameEl.value);
          else if (e.key === 'Escape') {
            renaming = null;
            render.flush();
          }
        });
        nameEl.addEventListener('blur', () => renaming === level.id && commitRename(level, nameEl.value));
        setTimeout(() => {
          nameEl.focus();
          nameEl.select();
        }, 0);
      }
      if (editing === level.id) list.appendChild(h('li', { class: 'cr-level-edit-row' }, editor(level)));
    }
  });
  render.flush();

  const unsubs = [
    store.subscribe((c) => {
      if (c.levelsChanged || c.reset || c.added.length || c.removed.length || c.settingsChanged) {
        if (c.reset) editing = renaming = null;
        render.schedule();
      }
    }),
    ui.subscribe((n, p) => {
      if (n.activeLevelId !== p.activeLevelId || n.displayUnits !== p.displayUnits) render.schedule();
    }),
  ];

  return {
    el,
    focus() {
      list.querySelector<HTMLElement>('.cr-level-row.is-active')?.focus();
    },
    dispose() {
      render.cancel();
      unsubs.forEach((u) => u());
      el.remove();
    },
  };
}
