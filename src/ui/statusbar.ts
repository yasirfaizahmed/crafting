/**
 * Status bar: tool hint, item in hand, active level, selection count, snap state, units and
 * save/autosave state.
 */
import { activeItem } from '../app/state';
import type { CatalogItem } from '../core/catalog';
import { formatLength } from '../core/units';
import { h } from './dom';
import { formatElevation, pluralize } from './format';
import { icon } from './icons';
import type { Shell } from './types';

/** Default hint for the item in hand when the active tool has not set one. */
export function defaultHint(item: CatalogItem): string {
  switch (item.tool) {
    case 'select':
      return 'Select: click to select, Shift-click to add, drag to move · Del deletes · Ctrl+D duplicates';
    case 'wall':
    case 'beam':
    case 'railing':
      return `${item.name}: click to start, click again to place (chains) · Esc to finish · type a length for exact sizes`;
    case 'slab':
      return `${item.name}: click inside a room to fill it, or draw an outline`;
    case 'roof':
      return `${item.name}: click a building to roof it automatically, or draw an outline`;
    case 'door':
    case 'window':
      return `${item.name}: click on a wall to insert · R flips`;
    case 'furniture':
    case 'stair':
    case 'column':
    case 'label':
      return `${item.name}: click to place · R rotates 90° (Shift+R −15°)`;
    case 'block':
      return `${item.name}: right-click a face to stack blocks, left-click to break`;
    case 'paint':
      return `${item.name}: click a surface to paint it`;
    case 'eraser':
      return 'Break: click an element to remove it';
    case 'eyedropper':
      return 'Pick block: click an element to copy it into your hand';
    case 'measure':
      return 'Measure: click two points';
    case 'room':
      return 'Room: click inside walls to create a named space with area';
    case 'dimension':
      return 'Dimension: click two points, then the offset';
    default:
      return item.name;
  }
}

export function mountStatusbar(container: HTMLElement, shell: Shell): { update(): void; dispose(): void } {
  const { ui, store, selection } = shell.ctx;
  const hint = h('span', { class: 'cr-status-hint', 'aria-live': 'polite' });
  const hand = h('span', { class: 'cr-status-item cr-status-hand', title: 'Item in hand' });
  const level = h('button', { class: 'cr-status-item cr-status-btn', type: 'button', title: 'Active level (PgUp / PgDn)' });
  const sel = h('button', { class: 'cr-status-item cr-status-btn', type: 'button', title: 'Selection — show its properties' });
  const snap = h('button', { class: 'cr-status-item cr-status-btn', type: 'button', title: 'Snapping (G toggles grid snap)' });
  const unitsEl = h('button', { class: 'cr-status-item cr-status-btn', type: 'button', title: 'Display units' });
  const save = h('span', { class: 'cr-status-item cr-status-save', title: 'Save state' });
  const bar = h('div', { class: 'cr-status-inner' }, hint, h('span', { class: 'cr-flex' }), hand, level, sel, snap, unitsEl, save);
  container.appendChild(bar);
  level.addEventListener('click', () => shell.openDialog('levels'));
  sel.addEventListener('click', () => shell.showTab('properties'));
  snap.addEventListener('click', () => ui.set({ snapGrid: !ui.get().snapGrid }));
  unitsEl.addEventListener('click', () => void shell.ctx.commands.run('view.units'));

  const update = () => {
    const s = ui.get();
    const item = activeItem(s);
    hint.textContent = s.toolHint || defaultHint(item);
    hand.textContent = '';
    hand.append(h('span', { class: 'cr-status-glyph', 'aria-hidden': 'true' }, item.icon), item.name);
    const lv = store.getLevel(s.activeLevelId);
    level.textContent = '';
    level.append(icon('layers'), lv ? `${lv.name} ${formatElevation(lv.elevation, s.displayUnits)}` : '—');
    const n = selection.get().length;
    sel.textContent = n ? `${pluralize(n, 'selected', 'selected')}` : 'Nothing selected';
    sel.classList.toggle('is-on', n > 0);
    snap.textContent = '';
    const parts = [s.snapGrid ? `Grid ${formatLength(store.project.settings.gridSize, s.displayUnits)}` : null, s.snapObjects ? 'Objects' : null, s.snapAngle ? '15°' : null].filter(Boolean);
    snap.append(icon('magnet'), parts.length ? parts.join(' · ') : 'Snap off');
    snap.classList.toggle('is-off', !parts.length);
    unitsEl.textContent = s.displayUnits === 'metric' ? 'Metric (mm)' : 'Imperial (ft-in)';
    save.textContent = '';
    const dirty = store.isDirty;
    save.classList.toggle('is-dirty', dirty);
    save.append(h('span', { class: 'cr-status-dot', 'aria-hidden': 'true' }), dirty ? 'Autosaved · not saved to file' : store.canUndo || store.canRedo ? 'Saved' : 'Autosave on');
    save.title = dirty ? 'Your session is autosaved in this browser. Use File → Save (Ctrl+S) to write a .craft file.' : 'No unsaved changes';
  };
  update();
  const unsubs = [ui.subscribe(update), store.subscribe(update), selection.subscribe(update)];
  return {
    update,
    dispose() {
      unsubs.forEach((u) => u());
      bar.remove();
    },
  };
}
