/**
 * Minecraft-style hotbar: 9 slots bound to ui.hotbar / ui.hotbarIndex.
 * Click selects, right-click clears, wheel cycles, drag & drop reorders (and accepts items
 * dragged from the creative inventory). The selected item's name pops above the bar and fades.
 */
import { getCatalogItem } from '../core/catalog';
import { h } from './dom';
import { cycleIndex, HOTBAR_SIZE, moveSlot, normalizeHotbar, setSlot } from './hotbar-model';
import { itemTile, itemTooltipLines } from './item-tile';
import { bindTooltip, hideTooltip } from './tooltip';
import type { Shell } from './types';

/** dataTransfer types used for hotbar / inventory drag & drop. */
export const DND_ITEM = 'application/x-crafting-item';
export const DND_SLOT = 'application/x-crafting-slot';

export interface HotbarHandle {
  el: HTMLElement;
  /** Pop the selected item's name above the bar (Minecraft style). */
  flashName(): void;
  dispose(): void;
}

export interface HotbarOptions {
  /** Show the fading item-name label (main hotbar only). */
  showName?: boolean;
  className?: string;
}

const NAME_VISIBLE_MS = 1800;
const WHEEL_STEP = 50;

export function mountHotbar(container: HTMLElement, shell: Shell, opts: HotbarOptions = {}): HotbarHandle {
  const { ui } = shell.ctx;
  const name = opts.showName ? h('div', { class: 'cr-hotbar-name', 'aria-live': 'polite' }) : null;
  const bar = h('div', { class: 'cr-hotbar', role: 'listbox', 'aria-label': 'Hotbar', 'aria-orientation': 'horizontal', tabindex: '0' });
  const wrap = h('div', { class: `cr-hotbar-wrap ${opts.className ?? ''}`.trim() }, name, bar);
  container.appendChild(wrap);
  const cleanups: (() => void)[] = [];
  let nameTimer: ReturnType<typeof setTimeout> | undefined;

  const slots = Array.from({ length: HOTBAR_SIZE }, (_, i) => {
    const slot = h('div', {
      class: 'cr-slot',
      role: 'option',
      'data-index': String(i),
      'aria-selected': 'false',
      draggable: 'true',
    });
    slot.addEventListener('click', () => ui.set({ hotbarIndex: i }));
    slot.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const hb = ui.get().hotbar;
      if (hb[i]) {
        ui.set({ hotbar: setSlot(hb, i, '') });
        hideTooltip();
      }
    });
    slot.addEventListener('dragstart', (e) => {
      const id = normalizeHotbar(ui.get().hotbar)[i];
      if (!id || !e.dataTransfer) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData(DND_SLOT, String(i));
      e.dataTransfer.setData(DND_ITEM, id);
      e.dataTransfer.setData('text/plain', id);
      e.dataTransfer.effectAllowed = 'copyMove';
      slot.classList.add('is-dragging');
      hideTooltip();
    });
    slot.addEventListener('dragend', () => slot.classList.remove('is-dragging'));
    slot.addEventListener('dragover', (e) => {
      const types = e.dataTransfer?.types ?? [];
      if (!types.includes(DND_ITEM) && !types.includes(DND_SLOT)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = types.includes(DND_SLOT) ? 'move' : 'copy';
      slot.classList.add('is-drop');
    });
    slot.addEventListener('dragleave', () => slot.classList.remove('is-drop'));
    slot.addEventListener('drop', (e) => {
      e.preventDefault();
      slot.classList.remove('is-drop');
      const dt = e.dataTransfer;
      if (!dt) return;
      const from = dt.getData(DND_SLOT);
      const item = dt.getData(DND_ITEM);
      const hb = ui.get().hotbar;
      if (from !== '') {
        const f = Number(from);
        const sel = ui.get().hotbarIndex;
        // Keep the selection on the item that was selected.
        const nextSel = sel === f ? i : sel === i ? f : sel;
        ui.set({ hotbar: moveSlot(hb, f, i), hotbarIndex: nextSel });
      } else if (item && getCatalogItem(item)) {
        ui.set({ hotbar: setSlot(hb, i, item) });
        if (ui.get().hotbarIndex === i) flashName();
      }
    });
    cleanups.push(
      bindTooltip(slot, () => {
        const it = getCatalogItem(ui.get().hotbar[i] ?? '');
        if (!it) return [{ text: `Empty slot ${i + 1}`, cls: 'is-title' }, { text: 'Drag an item here from the inventory (E)', cls: 'is-hint' }];
        return [...itemTooltipLines(it), { text: `Slot ${i + 1} · right-click to clear · drag to reorder`, cls: 'is-hint' }];
      }),
    );
    bar.appendChild(slot);
    return slot;
  });

  let wheelAcc = 0;
  bar.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const d = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      wheelAcc += d;
      if (Math.abs(wheelAcc) < WHEEL_STEP && Math.abs(d) < WHEEL_STEP) return;
      const steps = Math.sign(wheelAcc);
      wheelAcc = 0;
      ui.set({ hotbarIndex: cycleIndex(ui.get().hotbarIndex, steps) });
    },
    { passive: false },
  );
  bar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    e.stopPropagation();
    const cur = ui.get().hotbarIndex;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? HOTBAR_SIZE - 1 : cycleIndex(cur, e.key === 'ArrowRight' ? 1 : -1);
    ui.set({ hotbarIndex: next });
  });

  const rendered: string[] = [];
  const render = () => {
    const s = ui.get();
    const hb = normalizeHotbar(s.hotbar);
    slots.forEach((slot, i) => {
      const id = hb[i];
      const selected = i === s.hotbarIndex;
      slot.classList.toggle('is-selected', selected);
      slot.setAttribute('aria-selected', String(selected));
      const it = getCatalogItem(id);
      slot.setAttribute('aria-label', `Slot ${i + 1}: ${it?.name ?? 'empty'}`);
      slot.classList.toggle('is-empty', !it);
      if (rendered[i] === id) return;
      rendered[i] = id;
      slot.textContent = '';
      slot.append(itemTile(it), h('span', { class: 'cr-slot-num', 'aria-hidden': 'true' }, String(i + 1)));
    });
  };

  function flashName(): void {
    if (!name) return;
    const s = ui.get();
    const it = getCatalogItem(s.hotbar[s.hotbarIndex] ?? '');
    name.textContent = it ? it.name : 'Empty hand — Select';
    name.classList.remove('is-visible');
    // Restart the fade animation.
    void name.offsetWidth;
    name.classList.add('is-visible');
    clearTimeout(nameTimer);
    nameTimer = setTimeout(() => name.classList.remove('is-visible'), NAME_VISIBLE_MS);
  }

  render();
  const unsub = ui.subscribe((next, prev) => {
    if (next.hotbar !== prev.hotbar || next.hotbarIndex !== prev.hotbarIndex) render();
    const cur = next.hotbar[next.hotbarIndex];
    if (next.hotbarIndex !== prev.hotbarIndex || cur !== prev.hotbar[prev.hotbarIndex]) flashName();
  });

  return {
    el: wrap,
    flashName,
    dispose() {
      clearTimeout(nameTimer);
      unsub();
      cleanups.forEach((c) => c());
      wrap.remove();
    },
  };
}
