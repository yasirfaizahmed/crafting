/**
 * Creative inventory (E): category tabs, search, item grid with Minecraft-style tooltips and a
 * copy of the hotbar. Click = put in the current slot (inventory stays open), Shift-click = next
 * empty slot, drag onto any hotbar slot, hover + 1–9 = put into that slot. Dropping a hotbar slot
 * onto the grid clears it.
 */
import { CATALOG, CATEGORY_LABELS, getCatalogItem, searchCatalog, type CatalogCategory, type CatalogItem } from '../core/catalog';
import { h, isTypingTarget, prefs } from './dom';
import { DND_ITEM, DND_SLOT, mountHotbar, type HotbarHandle } from './hotbar';
import { clearSlot, putInCurrentSlot, putInNextEmptySlot, setSlot } from './hotbar-model';
import { icon } from './icons';
import { CATEGORY_ICONS, itemTile, itemTooltipLines } from './item-tile';
import { bindTooltip, hideTooltip } from './tooltip';
import type { Shell } from './types';

export type InventoryTab = 'all' | CatalogCategory;

export const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as CatalogCategory[];

/** Items for a tab + query. A non-empty query searches every category. */
export function inventoryItems(tab: InventoryTab, query: string): CatalogItem[] {
  const q = query.trim().toLowerCase();
  if (q) {
    const hits = new Set(searchCatalog(q));
    // Also match category labels and descriptions ("bathroom", "flooring", "remove").
    for (const it of CATALOG) {
      if (CATEGORY_LABELS[it.category].toLowerCase().includes(q) || it.description?.toLowerCase().includes(q)) hits.add(it);
    }
    return CATALOG.filter((it) => hits.has(it));
  }
  return tab === 'all' ? CATALOG : CATALOG.filter((it) => it.category === tab);
}

export interface InventoryHandle {
  el: HTMLElement;
  /** Programmatically choose a tab (clears the search). */
  setTab(tab: InventoryTab): void;
  dispose(): void;
}

export function mountInventory(host: HTMLElement, shell: Shell): InventoryHandle {
  const { ui } = shell.ctx;
  let tab: InventoryTab = prefs.get<InventoryTab>('inventoryTab', 'structure');
  if (tab !== 'all' && !CATEGORY_LABELS[tab]) tab = 'structure';
  let query = '';
  let hovered: string | null = null;
  const cleanups: (() => void)[] = [];

  const search = h('input', {
    class: 'cr-inv-search-input',
    type: 'search',
    placeholder: `Search ${CATALOG.length} items…`,
    'aria-label': 'Search items',
    autocomplete: 'off',
    spellcheck: 'false',
  });
  const closeBtn = h('button', { class: 'cr-icon-btn', type: 'button', 'aria-label': 'Close inventory', title: 'Close (E / Esc)' }, icon('x'));
  const tabs = h('div', { class: 'cr-inv-tabs', role: 'tablist', 'aria-orientation': 'vertical', 'aria-label': 'Categories' });
  const title = h('div', { class: 'cr-inv-cat-title' });
  const grid = h('div', { class: 'cr-inv-grid', role: 'listbox', 'aria-label': 'Items' });
  const status = h('div', { class: 'cr-inv-status', 'aria-live': 'polite' });
  const hotbarHost = h('div', { class: 'cr-inv-hotbar' });
  const panel = h(
    'section',
    { class: 'cr-inv', role: 'dialog', 'aria-label': 'Creative inventory', 'aria-modal': 'false' },
    h(
      'header',
      { class: 'cr-inv-head' },
      h('div', { class: 'cr-inv-heading' }, h('span', { class: 'cr-inv-chest', 'aria-hidden': 'true' }, icon('chest')), h('h2', null, 'Creative Inventory'), h('span', { class: 'cr-inv-infinite' }, '∞ infinite')),
      h('label', { class: 'cr-inv-search' }, icon('search'), search),
      closeBtn,
    ),
    h('div', { class: 'cr-inv-main' }, tabs, h('div', { class: 'cr-inv-panel', role: 'tabpanel' }, title, grid)),
    h(
      'footer',
      { class: 'cr-inv-foot' },
      h('div', { class: 'cr-inv-foot-row' }, h('span', { class: 'cr-inv-foot-label' }, 'Hotbar'), status),
      hotbarHost,
      h(
        'div',
        { class: 'cr-inv-hints' },
        h('span', null, h('kbd', null, 'Click'), ' put in selected slot'),
        h('span', null, h('kbd', null, 'Shift'), '+', h('kbd', null, 'Click'), ' next empty slot'),
        h('span', null, h('kbd', null, '1'), '–', h('kbd', null, '9'), ' while hovering'),
        h('span', null, 'Drag onto the hotbar · drop a slot here to clear it'),
      ),
    ),
  );
  const layer = h('div', { class: 'cr-inv-layer', hidden: true }, h('div', { class: 'cr-inv-backdrop' }), panel);
  host.appendChild(layer);
  const miniHotbar: HotbarHandle = mountHotbar(hotbarHost, shell, { className: 'is-mini' });

  layer.querySelector('.cr-inv-backdrop')!.addEventListener('pointerdown', () => ui.set({ inventoryOpen: false }));
  closeBtn.addEventListener('click', () => ui.set({ inventoryOpen: false }));

  // --- tabs -------------------------------------------------------------------
  const tabDefs: { id: InventoryTab; label: string; icon: string }[] = [
    { id: 'all', label: 'All items', icon: '🔍' },
    ...CATEGORY_ORDER.map((c) => ({ id: c as InventoryTab, label: CATEGORY_LABELS[c], icon: CATEGORY_ICONS[c] })),
  ];
  const tabBtns = tabDefs.map((t) => {
    const count = inventoryItems(t.id, '').length;
    const b = h(
      'button',
      { class: 'cr-inv-tab', type: 'button', role: 'tab', 'data-tab': t.id, 'aria-selected': 'false', title: t.label },
      h('span', { class: 'cr-inv-tab-ic', 'aria-hidden': 'true' }, t.icon),
      h('span', { class: 'cr-inv-tab-label' }, t.label),
      h('span', { class: 'cr-inv-tab-count' }, String(count)),
    );
    b.addEventListener('click', () => setTab(t.id));
    tabs.appendChild(b);
    return b;
  });
  tabs.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = tabBtns.indexOf(document.activeElement as HTMLButtonElement);
    const j = (Math.max(0, i) + (e.key === 'ArrowDown' ? 1 : -1) + tabBtns.length) % tabBtns.length;
    tabBtns[j].focus();
    setTab(tabDefs[j].id);
  });

  function setTab(t: InventoryTab): void {
    tab = t;
    query = '';
    search.value = '';
    prefs.set('inventoryTab', t);
    renderGrid();
  }

  // --- grid -------------------------------------------------------------------
  const currentSlotLabel = () => `slot ${ui.get().hotbarIndex + 1}`;

  const pick = (id: string, shift: boolean) => {
    const s = ui.get();
    if (shift) {
      const r = putInNextEmptySlot(s, id);
      ui.set({ hotbar: r.hotbar });
      status.textContent = `${getCatalogItem(id)?.name} → slot ${r.slot + 1}`;
      popSlot(r.slot);
    } else {
      ui.set(putInCurrentSlot(s, id));
      status.textContent = `${getCatalogItem(id)?.name} → ${currentSlotLabel()}`;
      popSlot(s.hotbarIndex);
    }
    markHeld();
  };

  const popSlot = (i: number) => {
    for (const root of [shell.root, panel]) {
      const slot = root.querySelectorAll<HTMLElement>(`.cr-slot[data-index="${i}"]`);
      slot.forEach((s) => {
        s.classList.remove('is-pop');
        void s.offsetWidth;
        s.classList.add('is-pop');
      });
    }
  };

  const markHeld = () => {
    const s = ui.get();
    const held = s.hotbar[s.hotbarIndex];
    const inBar = new Set(s.hotbar);
    grid.querySelectorAll<HTMLElement>('.cr-inv-item').forEach((b) => {
      b.classList.toggle('is-held', b.dataset.id === held);
      b.classList.toggle('is-in-hotbar', inBar.has(b.dataset.id ?? ''));
    });
  };

  let itemCleanups: (() => void)[] = [];
  function renderGrid(): void {
    itemCleanups.forEach((c) => c());
    itemCleanups = [];
    const items = inventoryItems(tab, query);
    tabBtns.forEach((b, i) => {
      const on = !query && tabDefs[i].id === tab;
      b.setAttribute('aria-selected', String(on));
      b.classList.toggle('is-on', on);
      b.tabIndex = on || (query && i === 0) ? 0 : -1;
    });
    title.textContent = '';
    if (query) title.append(h('strong', null, `${items.length} result${items.length === 1 ? '' : 's'}`), ` for “${query}”`);
    else {
      const def = tabDefs.find((t) => t.id === tab)!;
      title.append(h('span', { class: 'cr-inv-cat-ic' }, def.icon), h('strong', null, def.label), h('span', { class: 'cr-inv-cat-count' }, `${items.length} items`));
    }
    grid.textContent = '';
    grid.classList.toggle('is-paint', !query && tab === 'paint');
    if (!items.length) {
      grid.appendChild(h('div', { class: 'cr-inv-empty' }, `No items match “${query}”. Try “wall”, “sofa”, “oak” or “window”.`));
      return;
    }
    for (const it of items) {
      const b = h(
        'button',
        { class: 'cr-inv-item', type: 'button', role: 'option', 'data-id': it.id, 'aria-label': it.name, draggable: 'true' },
        itemTile(it),
        it.category === 'paint' ? h('span', { class: 'cr-inv-item-name' }, it.name.replace(/^[^—]*—\s*/, '')) : null,
      );
      b.addEventListener('click', (e) => pick(it.id, e.shiftKey));
      b.addEventListener('pointerenter', () => {
        hovered = it.id;
        status.textContent = it.name;
      });
      b.addEventListener('pointerleave', () => {
        if (hovered === it.id) hovered = null;
      });
      b.addEventListener('focus', () => {
        hovered = it.id;
        status.textContent = `${it.name} — Enter to put in ${currentSlotLabel()}`;
      });
      b.addEventListener('blur', () => {
        if (hovered === it.id) hovered = null;
      });
      b.addEventListener('dragstart', (e) => {
        if (!e.dataTransfer) return;
        e.dataTransfer.setData(DND_ITEM, it.id);
        e.dataTransfer.setData('text/plain', it.id);
        e.dataTransfer.effectAllowed = 'copy';
        hideTooltip();
      });
      itemCleanups.push(bindTooltip(b, () => [...itemTooltipLines(it), { text: `Click → ${currentSlotLabel()} · Shift-click → next empty slot`, cls: 'is-hint' }]));
      grid.appendChild(b);
    }
    markHeld();
  }

  grid.addEventListener('keydown', (e) => {
    const items = [...grid.querySelectorAll<HTMLButtonElement>('.cr-inv-item')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const cols = Math.max(1, items.filter((b) => b.offsetTop === items[0].offsetTop).length);
    const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? cols : e.key === 'ArrowUp' ? -cols : 0;
    if (!delta) return;
    e.preventDefault();
    e.stopPropagation();
    items[Math.max(0, Math.min(items.length - 1, i + delta))]?.focus();
  });
  // Drop a hotbar slot onto the grid to clear it ("destroy item").
  grid.addEventListener('dragover', (e) => {
    if (e.dataTransfer?.types.includes(DND_SLOT)) {
      e.preventDefault();
      grid.classList.add('is-trash');
    }
  });
  grid.addEventListener('dragleave', () => grid.classList.remove('is-trash'));
  grid.addEventListener('drop', (e) => {
    grid.classList.remove('is-trash');
    const from = e.dataTransfer?.getData(DND_SLOT);
    if (from === undefined || from === '') return;
    e.preventDefault();
    ui.set({ hotbar: clearSlot(ui.get().hotbar, Number(from)) });
  });

  // --- search -----------------------------------------------------------------
  search.addEventListener('input', () => {
    query = search.value;
    renderGrid();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (search.value) {
        search.value = '';
        query = '';
        renderGrid();
      } else ui.set({ inventoryOpen: false });
    } else if (e.key === 'e' && !search.value && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Minecraft muscle memory: E closes the inventory (Shift+E types a capital E).
      e.preventDefault();
      e.stopPropagation();
      ui.set({ inventoryOpen: false });
    } else if (e.key === 'Enter') {
      const first = grid.querySelector<HTMLButtonElement>('.cr-inv-item');
      if (first) {
        e.preventDefault();
        pick(first.dataset.id!, e.shiftKey);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      grid.querySelector<HTMLButtonElement>('.cr-inv-item')?.focus();
    }
  });

  // Hover + number key puts the hovered item into that slot; Esc closes.
  const onKey = (e: KeyboardEvent) => {
    if (!ui.get().inventoryOpen) return;
    if (e.key === 'Escape' && !isTypingTarget(e.target)) {
      e.preventDefault();
      e.stopPropagation();
      ui.set({ inventoryOpen: false });
      return;
    }
    if (isTypingTarget(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^[1-9]$/.test(e.key) && hovered) {
      e.preventDefault();
      e.stopPropagation();
      const slot = Number(e.key) - 1;
      ui.set({ hotbar: setSlot(ui.get().hotbar, slot, hovered) });
      status.textContent = `${getCatalogItem(hovered)?.name} → slot ${slot + 1}`;
      popSlot(slot);
      markHeld();
    }
  };
  window.addEventListener('keydown', onKey, true);

  // --- open / close -----------------------------------------------------------
  let lastFocus: HTMLElement | null = null;
  const sync = (open: boolean, wasOpen: boolean) => {
    layer.hidden = !open;
    shell.root.classList.toggle('is-inventory-open', open);
    if (open && !wasOpen) {
      lastFocus = document.activeElement as HTMLElement | null;
      renderGrid();
      search.focus();
    } else if (!open && wasOpen) {
      hideTooltip();
      hovered = null;
      if (panel.contains(document.activeElement)) {
        (document.activeElement as HTMLElement).blur();
        if (lastFocus?.isConnected && !lastFocus.closest('.cr-inv')) lastFocus.focus();
      }
    }
  };
  sync(ui.get().inventoryOpen, false);
  const unsub = ui.subscribe((next, prev) => {
    if (next.inventoryOpen !== prev.inventoryOpen) sync(next.inventoryOpen, prev.inventoryOpen);
    else if (next.inventoryOpen && (next.hotbar !== prev.hotbar || next.hotbarIndex !== prev.hotbarIndex)) markHeld();
  });

  return {
    el: layer,
    setTab,
    dispose() {
      unsub();
      window.removeEventListener('keydown', onKey, true);
      itemCleanups.forEach((c) => c());
      cleanups.forEach((c) => c());
      miniHotbar.dispose();
      layer.remove();
    },
  };
}
