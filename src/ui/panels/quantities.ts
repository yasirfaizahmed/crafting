/**
 * Quantities panel: live take-off for the active level or the whole project, with CSV export.
 */
import { formatArea, formatLength, formatVolume } from '../../core/units';
import { downloadBlob } from '../../io';
import { batched, h, prefs } from '../dom';
import { icon } from '../icons';
import { computeQuantities, quantitiesToCSV, TYPE_ICONS, TYPE_LABELS, TYPE_ORDER } from '../quantities';
import type { Shell } from '../types';

export interface QuantitiesHandle {
  el: HTMLElement;
  /** Pause recomputation while the tab is hidden. */
  setVisible(visible: boolean): void;
  dispose(): void;
}

type Scope = 'level' | 'project';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ');

export function mountQuantities(container: HTMLElement, shell: Shell): QuantitiesHandle {
  const { store, ui } = shell.ctx;
  let scope: Scope = prefs.get<Scope>('quantitiesScope', 'level');
  let visible = true;
  let stale = false;
  const scopeBtns = (['level', 'project'] as Scope[]).map((s) =>
    h('button', { class: 'cr-seg-btn', type: 'button', role: 'radio', 'data-scope': s }, s === 'level' ? 'Active level' : 'All levels'),
  );
  scopeBtns.forEach((b) =>
    b.addEventListener('click', () => {
      scope = b.dataset.scope as Scope;
      prefs.set('quantitiesScope', scope);
      render.flush();
    }),
  );
  const csv = h('button', { class: 'cr-btn is-sm', type: 'button', title: 'Download the take-off as CSV (opens in Excel / Sheets)' }, icon('csv'), 'CSV');
  const body = h('div', { class: 'cr-qty-body' });
  const el = h(
    'section',
    { class: 'cr-panel cr-qty', 'aria-label': 'Quantities' },
    h('div', { class: 'cr-qty-tools' }, h('div', { class: 'cr-seg is-sm', role: 'radiogroup', 'aria-label': 'Scope' }, ...scopeBtns), h('span', { class: 'cr-flex' }), csv),
    body,
  );
  container.appendChild(el);

  const levelIds = () => (scope === 'level' ? [ui.get().activeLevelId] : undefined);
  csv.addEventListener('click', () => {
    const q = computeQuantities(store.project, levelIds());
    const text = quantitiesToCSV(q, ui.get().displayUnits, (id) => store.getLevel(id)?.name ?? id);
    const name = (store.project.info.name || 'project').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-');
    downloadBlob(new Blob([text], { type: 'text/csv' }), `${name}-quantities.csv`);
    shell.toast('Quantities exported as CSV', 'success');
  });

  const card = (title: string, ...rows: (HTMLElement | null)[]) => h('div', { class: 'cr-qty-card' }, h('h4', { class: 'cr-prop-section-title' }, title), ...rows);
  const kv = (k: string, v: string, strong = false) => h('div', { class: `cr-qty-row ${strong ? 'is-total' : ''}` }, h('span', null, k), h('span', { class: 'cr-qty-val' }, v));

  const render = batched(() => {
    if (!visible) {
      stale = true;
      return;
    }
    stale = false;
    const u = ui.get().displayUnits;
    scopeBtns.forEach((b) => {
      const on = b.dataset.scope === scope;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', String(on));
    });
    const q = computeQuantities(store.project, levelIds());
    body.textContent = '';
    if (!q.total) {
      body.appendChild(h('div', { class: 'cr-empty' }, scope === 'level' ? 'Nothing built on this level yet.' : 'The project is empty.'));
      return;
    }
    // Counts as chips.
    const chips = h('div', { class: 'cr-qty-chips' });
    for (const t of TYPE_ORDER) {
      const n = q.counts[t];
      if (n) chips.appendChild(h('span', { class: 'cr-chip', title: TYPE_LABELS[t][1] }, h('span', { 'aria-hidden': 'true' }, TYPE_ICONS[t]), h('b', null, String(n)), ` ${TYPE_LABELS[t][n === 1 ? 0 : 1].toLowerCase()}`));
    }
    body.appendChild(card(`Elements · ${q.total}`, chips));
    if (q.walls.count)
      body.appendChild(
        card(
          'Walls',
          kv('Total length', formatLength(q.walls.length, u)),
          kv('Gross area (one face)', formatArea(q.walls.grossArea, u)),
          kv('Net area (less openings)', formatArea(q.walls.netArea, u)),
          kv('Volume', formatVolume(q.walls.volume, u)),
        ),
      );
    if (q.rooms.length) {
      const multiLevel = scope === 'project' && store.project.levels.length > 1;
      body.appendChild(
        card(
          'Net floor area',
          ...q.rooms.map((r) => kv(`${r.number ? `${r.number} ` : ''}${r.name}${multiLevel ? ` · ${store.getLevel(r.levelId)?.name ?? ''}` : ''}`, formatArea(r.area, u))),
          kv('Total', formatArea(q.totalFloorArea, u), true),
        ),
      );
    }
    if (q.slabs.count || q.concreteVolume)
      body.appendChild(
        card(
          'Slabs & concrete',
          q.slabs.count ? kv(`Slab area (${q.slabs.count})`, formatArea(q.slabs.area, u)) : null,
          q.slabs.count ? kv('Slab volume', formatVolume(q.slabs.volume, u)) : null,
          kv('Concrete estimate', formatVolume(q.concreteVolume, u), true),
        ),
      );
    const doors = Object.entries(q.doorsByStyle);
    const windows = Object.entries(q.windowsByStyle);
    if (doors.length || windows.length)
      body.appendChild(
        card(
          'Doors & windows',
          ...doors.map(([s, n]) => kv(`🚪 ${cap(s)} door`, `× ${n}`)),
          ...windows.map(([s, n]) => kv(`🪟 ${cap(s)} window`, `× ${n}`)),
          kv('Total openings', `${(q.counts.door ?? 0) + (q.counts.window ?? 0)}`, true),
        ),
      );
    const furn = Object.entries(q.furnitureByName).sort((a, b) => b[1] - a[1]);
    if (furn.length) body.appendChild(card('Furniture & fixtures', ...furn.map(([n, c]) => kv(n, `× ${c}`))));
    body.appendChild(h('p', { class: 'cr-panel-tip' }, 'Estimates from the model geometry. Areas in ', u === 'metric' ? 'm²' : 'ft²', '; wall areas are one face, net of openings.'));
  });
  render.flush();
  const unsubs = [
    store.subscribe(() => render.schedule()),
    ui.subscribe((n, p) => {
      if (n.activeLevelId !== p.activeLevelId || n.displayUnits !== p.displayUnits) render.schedule();
    }),
  ];
  return {
    el,
    setVisible(v) {
      visible = v;
      if (v && stale) render.flush();
    },
    dispose() {
      render.cancel();
      unsubs.forEach((u) => u());
      el.remove();
    },
  };
}
