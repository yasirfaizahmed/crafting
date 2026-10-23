/**
 * Outliner: elements of the active level grouped by type (with counts). Click selects and frames
 * the element ('zoom-to'); Shift/Ctrl-click toggles; eye = hidden, lock = locked; filter box.
 */
import type { Element, ElementType } from '../../core/types';
import { batched, h, prefs } from '../dom';
import { icon } from '../icons';
import { elementDetail, elementIcon, elementName } from '../labels';
import { TYPE_ICONS, TYPE_LABELS, TYPE_ORDER } from '../quantities';
import type { Shell } from '../types';

export interface OutlinerHandle {
  el: HTMLElement;
  dispose(): void;
}

/** Elements of a level grouped by type in display order (pure; used by tests). */
export function groupElements(elements: readonly Element[], filter = ''): { type: ElementType; items: Element[] }[] {
  const f = filter.trim().toLowerCase();
  const out: { type: ElementType; items: Element[] }[] = [];
  for (const type of TYPE_ORDER) {
    const items = elements
      .filter((e) => e.type === type)
      .filter((e) => !f || elementName(e).toLowerCase().includes(f) || TYPE_LABELS[e.type][0].toLowerCase().includes(f))
      .sort((a, b) => elementName(a).localeCompare(elementName(b), undefined, { numeric: true }));
    if (items.length) out.push({ type, items });
  }
  return out;
}

export function mountOutliner(container: HTMLElement, shell: Shell): OutlinerHandle {
  const { store, ui, selection, events } = shell.ctx;
  const collapsed = new Set<string>(prefs.get<string[]>('outlinerCollapsed', ['dimension', 'label']));
  let filter = '';
  const filterInput = h('input', { class: 'cr-input cr-filter', type: 'search', placeholder: 'Filter elements…', 'aria-label': 'Filter elements' });
  const count = h('span', { class: 'cr-panel-count' });
  const tree = h('div', { class: 'cr-outliner', role: 'tree', 'aria-label': 'Elements on the active level', 'aria-multiselectable': 'true' });
  const el = h(
    'section',
    { class: 'cr-panel cr-outliner-panel', 'aria-label': 'Outliner' },
    h('header', { class: 'cr-panel-head' }, icon('list'), h('h3', null, 'Outliner'), count),
    h('div', { class: 'cr-panel-tools' }, h('label', { class: 'cr-search-field' }, icon('search'), filterInput)),
    tree,
  );
  container.appendChild(el);
  filterInput.addEventListener('input', () => {
    filter = filterInput.value;
    render.flush();
  });
  filterInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && filterInput.value) {
      e.stopPropagation();
      filterInput.value = '';
      filter = '';
      render.flush();
    }
  });

  let anchor: string | null = null;
  const onRowClick = (e: MouseEvent, id: string, ordered: string[]) => {
    if (e.shiftKey && anchor && ordered.includes(anchor)) {
      const a = ordered.indexOf(anchor);
      const b = ordered.indexOf(id);
      const range = ordered.slice(Math.min(a, b), Math.max(a, b) + 1);
      selection.set([...new Set([...selection.get(), ...range])]);
      return;
    }
    if (e.ctrlKey || e.metaKey) {
      selection.toggle(id);
      anchor = id;
      return;
    }
    anchor = id;
    selection.set([id]);
    events.emit('zoom-to', { ids: [id] });
  };

  const toggleFlag = (ids: string[], flag: 'hidden' | 'locked') => {
    const els = ids.map((id) => store.getElement(id)).filter((e): e is Element => !!e);
    if (!els.length) return;
    const value = !els.every((e) => e[flag]);
    const label = `${value ? (flag === 'hidden' ? 'Hide' : 'Lock') : flag === 'hidden' ? 'Show' : 'Unlock'} ${els.length === 1 ? elementName(els[0]) : `${els.length} elements`}`;
    store.transact(label, (tx) => els.forEach((e) => tx.update(e.id, { [flag]: value || undefined })));
  };

  const render = batched(() => {
    const levelId = ui.get().activeLevelId;
    const units = ui.get().displayUnits;
    const elements = store.elementsOnLevel(levelId);
    const groups = groupElements(elements, filter);
    const sel = new Set(selection.get());
    count.textContent = String(elements.length);
    const ordered = groups.flatMap((g) => (collapsed.has(g.type) && !filter ? [] : g.items.map((i) => i.id)));
    const scroll = tree.scrollTop;
    tree.textContent = '';
    if (!groups.length) {
      tree.appendChild(
        h('div', { class: 'cr-empty' }, filter ? `Nothing matches “${filter}”.` : h('span', null, 'This level is empty.', h('br'), 'Pick an item from the hotbar and start building!')),
      );
      return;
    }
    for (const g of groups) {
      const isCollapsed = collapsed.has(g.type) && !filter;
      const allHidden = g.items.every((e) => e.hidden);
      const groupEye = h(
        'button',
        { class: `cr-icon-btn is-sm cr-ol-flag ${allHidden ? 'is-on' : ''}`, type: 'button', title: allHidden ? `Show all ${TYPE_LABELS[g.type][1].toLowerCase()}` : `Hide all ${TYPE_LABELS[g.type][1].toLowerCase()}`, 'aria-label': `Toggle visibility of ${TYPE_LABELS[g.type][1]}` },
        icon(allHidden ? 'eyeOff' : 'eye'),
      );
      groupEye.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFlag(
          g.items.map((i) => i.id),
          'hidden',
        );
      });
      const head = h(
        'div',
        { class: 'cr-ol-group', role: 'treeitem', 'aria-expanded': String(!isCollapsed), tabindex: '-1' },
        h('span', { class: 'cr-ol-chev' }, icon(isCollapsed ? 'chevronRight' : 'chevronDown')),
        h('span', { class: 'cr-ol-ic', 'aria-hidden': 'true' }, TYPE_ICONS[g.type]),
        h('span', { class: 'cr-ol-group-label' }, TYPE_LABELS[g.type][1]),
        h('span', { class: 'cr-ol-group-count' }, String(g.items.length)),
        groupEye,
      );
      head.addEventListener('click', () => {
        if (collapsed.has(g.type)) collapsed.delete(g.type);
        else collapsed.add(g.type);
        prefs.set('outlinerCollapsed', [...collapsed]);
        render.flush();
      });
      head.addEventListener('dblclick', (e) => {
        e.preventDefault();
        selection.set(g.items.map((i) => i.id));
      });
      tree.appendChild(head);
      if (isCollapsed) continue;
      const groupEl = h('div', { class: 'cr-ol-items', role: 'group' });
      for (const item of g.items) {
        const isSel = sel.has(item.id);
        const eye = h(
          'button',
          { class: `cr-icon-btn is-sm cr-ol-flag ${item.hidden ? 'is-on' : ''}`, type: 'button', title: item.hidden ? 'Show' : 'Hide', 'aria-label': item.hidden ? 'Show element' : 'Hide element', 'aria-pressed': String(!!item.hidden) },
          icon(item.hidden ? 'eyeOff' : 'eye'),
        );
        const lock = h(
          'button',
          { class: `cr-icon-btn is-sm cr-ol-flag ${item.locked ? 'is-on' : ''}`, type: 'button', title: item.locked ? 'Unlock' : 'Lock', 'aria-label': item.locked ? 'Unlock element' : 'Lock element', 'aria-pressed': String(!!item.locked) },
          icon(item.locked ? 'lock' : 'unlock'),
        );
        eye.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleFlag(isSel ? [...selection.get()] : [item.id], 'hidden');
        });
        lock.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleFlag(isSel ? [...selection.get()] : [item.id], 'locked');
        });
        const detail = elementDetail(item, units);
        const row = h(
          'div',
          {
            class: `cr-ol-row ${isSel ? 'is-selected' : ''} ${item.hidden ? 'is-hidden' : ''} ${item.locked ? 'is-locked' : ''}`,
            role: 'treeitem',
            'aria-selected': String(isSel),
            tabindex: '-1',
            'data-id': item.id,
            title: `${elementName(item)}${detail ? ` — ${detail}` : ''}`,
          },
          h('span', { class: 'cr-ol-ic', 'aria-hidden': 'true' }, elementIcon(item)),
          h('span', { class: 'cr-ol-name' }, elementName(item)),
          detail ? h('span', { class: 'cr-ol-detail' }, detail) : null,
          h('span', { class: 'cr-ol-flags' }, lock, eye),
        );
        row.addEventListener('click', (e) => onRowClick(e, item.id, ordered));
        row.addEventListener('dblclick', () => shell.showTab('properties'));
        row.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onRowClick(e as unknown as MouseEvent, item.id, ordered);
          } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            const rows = [...tree.querySelectorAll<HTMLElement>('.cr-ol-row')];
            rows[rows.indexOf(row) + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
          }
        });
        groupEl.appendChild(row);
      }
      tree.appendChild(groupEl);
    }
    const selRow = tree.querySelector<HTMLElement>('.cr-ol-row.is-selected');
    if (selRow) selRow.tabIndex = 0;
    else tree.querySelector<HTMLElement>('.cr-ol-row')?.setAttribute('tabindex', '0');
    tree.scrollTop = scroll;
  });

  const scrollToSelection = () => {
    const first = tree.querySelector<HTMLElement>('.cr-ol-row.is-selected');
    if (first && typeof first.scrollIntoView === 'function' && !el.contains(document.activeElement)) first.scrollIntoView({ block: 'nearest' });
  };

  render.flush();
  const unsubs = [
    store.subscribe(() => render.schedule()),
    ui.subscribe((n, p) => {
      if (n.activeLevelId !== p.activeLevelId || n.displayUnits !== p.displayUnits) render.schedule();
    }),
    selection.subscribe((ids) => {
      // Reveal groups that contain newly selected elements.
      for (const id of ids) {
        const e = store.getElement(id);
        if (e) collapsed.delete(e.type);
      }
      render.flush();
      scrollToSelection();
    }),
  ];
  return {
    el,
    dispose() {
      render.cancel();
      unsubs.forEach((u) => u());
      el.remove();
    },
  };
}
