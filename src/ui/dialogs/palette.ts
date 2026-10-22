/**
 * Command palette (Ctrl+K): fuzzy search over registered commands and catalog items.
 * Enter runs the command / puts the item in hand.
 */
import type { Command } from '../../app/state';
import { CATALOG, CATEGORY_LABELS, type CatalogItem } from '../../core/catalog';
import { holdCatalogItem } from '../actions';
import { PALETTE_HIDDEN } from '../commands';
import { h } from '../dom';
import { fuzzyRank, highlightRuns, type FuzzyMatch } from '../fuzzy';
import { icon } from '../icons';
import { itemTile } from '../item-tile';
import { commandShortcut } from '../keyboard';
import type { Shell } from '../types';
import { openModal, type ModalHandle } from './modal';

export type PaletteEntry = { kind: 'command'; command: Command } | { kind: 'item'; item: CatalogItem };

/** Ranked palette entries for a query. Empty query: commands first (menu order), no items. */
export function paletteResults(commands: readonly Command[], query: string, limit = 40): { entry: PaletteEntry; match: FuzzyMatch }[] {
  const cmds = commands.filter((c) => !PALETTE_HIDDEN.has(c.id) && !/^hotbar\.\d$/.test(c.id));
  const entries: PaletteEntry[] = [...cmds.map((command) => ({ kind: 'command' as const, command })), ...(query.trim() ? CATALOG.map((item) => ({ kind: 'item' as const, item })) : [])];
  const ranked = fuzzyRank(entries, query, (e) =>
    e.kind === 'command' ? [e.command.label, `${e.command.group} ${e.command.label}`] : [e.item.name, `${CATEGORY_LABELS[e.item.category]} ${(e.item.keywords ?? []).join(' ')}`],
    limit,
  );
  return ranked.map((r) => ({ entry: r.item, match: r.field === 0 ? r.match : { score: r.match.score, indices: [] } }));
}

export function openPalette(shell: Shell): ModalHandle {
  const input = h('input', {
    class: 'cr-palette-input',
    type: 'text',
    placeholder: 'Type a command or an item name…',
    'aria-label': 'Search commands and items',
    autocomplete: 'off',
    spellcheck: 'false',
    role: 'combobox',
    'aria-expanded': 'true',
    'aria-controls': 'cr-palette-list',
  });
  const list = h('div', { class: 'cr-palette-list', id: 'cr-palette-list', role: 'listbox', 'aria-label': 'Results' });
  let results: { entry: PaletteEntry; match: FuzzyMatch }[] = [];
  let active = 0;

  const label = (text: string, m: FuzzyMatch) => highlightRuns(text, m.indices).map((r) => (r.hit ? h('mark', null, r.text) : r.text));
  const render = () => {
    results = paletteResults(shell.ctx.commands.all(), input.value);
    active = Math.min(active, Math.max(0, results.length - 1));
    list.textContent = '';
    if (!results.length) {
      list.appendChild(h('div', { class: 'cr-palette-empty' }, `Nothing matches “${input.value}”.`));
      return;
    }
    let lastKind = '';
    results.forEach((r, i) => {
      const kind = r.entry.kind;
      if (kind !== lastKind) {
        list.appendChild(h('div', { class: 'cr-palette-section' }, kind === 'command' ? 'Commands' : 'Items — put in hand'));
        lastKind = kind;
      }
      let row: HTMLElement;
      if (r.entry.kind === 'command') {
        const c = r.entry.command;
        let enabled = true;
        try {
          enabled = c.enabled ? c.enabled() : true;
        } catch {
          enabled = false;
        }
        row = h(
          'div',
          { class: `cr-palette-row ${enabled ? '' : 'is-disabled'}`, role: 'option', id: `cr-pal-${i}`, 'data-command': c.id, 'aria-disabled': enabled ? undefined : 'true' },
          h('span', { class: 'cr-palette-ic' }, icon('command')),
          h('span', { class: 'cr-palette-label' }, ...label(c.label, r.match)),
          h('span', { class: 'cr-palette-group' }, c.group),
          commandShortcut(c) ? h('kbd', null, commandShortcut(c)) : null,
        );
      } else {
        const it = r.entry.item;
        row = h(
          'div',
          { class: 'cr-palette-row is-item', role: 'option', id: `cr-pal-${i}`, 'data-item': it.id },
          itemTile(it, 'is-xs'),
          h('span', { class: 'cr-palette-label' }, ...label(it.name, r.match)),
          h('span', { class: 'cr-palette-group' }, CATEGORY_LABELS[it.category]),
        );
      }
      row.addEventListener('pointermove', () => {
        if (active !== i) setActive(i);
      });
      row.addEventListener('click', () => choose(i));
      list.appendChild(row);
    });
    setActive(active);
  };
  const rows = () => [...list.querySelectorAll<HTMLElement>('.cr-palette-row')];
  const setActive = (i: number) => {
    active = i;
    rows().forEach((r, k) => {
      r.classList.toggle('is-active', k === i);
      r.setAttribute('aria-selected', String(k === i));
    });
    input.setAttribute('aria-activedescendant', `cr-pal-${i}`);
    rows()[i]?.scrollIntoView?.({ block: 'nearest' });
  };
  const choose = (i: number) => {
    const r = results[i];
    if (!r) return;
    if (r.entry.kind === 'command') {
      const c = r.entry.command;
      if (c.enabled && !c.enabled()) return;
      modal.close();
      void shell.ctx.commands.run(c.id).catch((err) => shell.toast(String(err?.message ?? err), 'error'));
    } else {
      modal.close();
      holdCatalogItem(shell, r.entry.item.id);
      shell.toast(`${r.entry.item.name} is now in your hand`, 'info');
    }
  };
  input.addEventListener('input', () => {
    active = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = results.length;
      if (n) setActive((active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      setActive(Math.max(0, Math.min(results.length - 1, active + (e.key === 'PageDown' ? 8 : -8))));
    }
  });
  const modal = openModal({
    title: 'Command Palette',
    bare: true,
    size: 'md',
    className: 'cr-palette-modal',
    body: h('div', { class: 'cr-palette' }, h('label', { class: 'cr-palette-search' }, icon('search'), input, h('kbd', null, 'Esc')), list),
    footer: [h('span', { class: 'cr-palette-hint' }, h('kbd', null, '↑'), h('kbd', null, '↓'), ' navigate · ', h('kbd', null, 'Enter'), ' run / hold item')],
    initialFocus: input,
  });
  render();
  return modal;
}
