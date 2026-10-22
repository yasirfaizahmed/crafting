/**
 * Application menubar generated from the command registry (groups → menus), with shortcuts,
 * check marks, disabled states and full keyboard navigation (WAI-ARIA menubar pattern).
 */
import type { Command } from '../app/state';
import { commandChecked, MENU_HIDDEN, MENU_LAYOUT, MENU_ORDER } from './commands';
import { batched, h } from './dom';
import { commandShortcut } from './keyboard';
import type { Shell } from './types';

type MenuEntry = Command | '-';

/** Ordered menu entries for a group: the declared layout first, then other commands of the group. */
export function menuEntries(group: string, commands: readonly Command[]): MenuEntry[] {
  const inGroup = commands.filter((c) => c.group === group && !MENU_HIDDEN.has(c.id));
  const byId = new Map(inGroup.map((c) => [c.id, c]));
  const out: MenuEntry[] = [];
  const layout = MENU_LAYOUT[group] ?? [];
  for (const id of layout) {
    if (id === '-') out.push('-');
    else if (byId.has(id)) out.push(byId.get(id)!);
  }
  const listed = new Set(layout);
  const extra = inGroup.filter((c) => !listed.has(c.id));
  if (extra.length) {
    out.push('-');
    out.push(...extra);
  }
  // Collapse separators.
  return out.filter((e, i, arr) => e !== '-' || (i > 0 && i < arr.length - 1 && arr[i - 1] !== '-'));
}

/** Menu titles in display order: the standard groups, then other registered groups before Help. */
export function menuGroups(commands: readonly Command[]): string[] {
  const groups = new Set(commands.filter((c) => !MENU_HIDDEN.has(c.id)).map((c) => c.group));
  const extra = [...groups].filter((g) => !MENU_ORDER.includes(g)).sort();
  const ordered = MENU_ORDER.filter((g) => g !== 'Help' && groups.has(g));
  return [...ordered, ...extra, ...(groups.has('Help') ? ['Help'] : [])];
}

export function mountMenubar(container: HTMLElement, shell: Shell): () => void {
  const { commands } = shell.ctx;
  const bar = h('div', { class: 'cr-menubar-menus', role: 'menubar', 'aria-label': 'Main menu' });
  container.appendChild(bar);
  let openGroup: string | null = null;
  let menuEl: HTMLElement | null = null;
  let titles: HTMLButtonElement[] = [];

  const renderTitles = () => {
    const groups = menuGroups(commands.all());
    bar.textContent = '';
    titles = groups.map((g, i) => {
      const b = h(
        'button',
        {
          class: 'cr-menu-title',
          type: 'button',
          role: 'menuitem',
          'aria-haspopup': 'menu',
          'aria-expanded': 'false',
          'data-group': g,
          tabindex: i === 0 ? '0' : '-1',
        },
        g,
      );
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        if (openGroup === g) close();
        else open(g, false);
      });
      b.addEventListener('pointerenter', () => {
        if (openGroup && openGroup !== g) open(g, false);
      });
      b.addEventListener('keydown', (e) => onTitleKey(e, i));
      b.addEventListener('click', (e) => {
        // Keyboard activation (Enter/Space) arrives as click without pointerdown.
        if ((e as MouseEvent).detail === 0) open(g, true);
      });
      bar.appendChild(b);
      return b;
    });
  };

  const onTitleKey = (e: KeyboardEvent, i: number) => {
    const n = titles.length;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
      titles.forEach((t, k) => t.setAttribute('tabindex', k === j ? '0' : '-1'));
      titles[j].focus();
      if (openGroup) open(titles[j].dataset.group!, true);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      open(titles[i].dataset.group!, true);
    }
  };

  const close = (refocus = false) => {
    if (!menuEl) return;
    const g = openGroup;
    menuEl.remove();
    menuEl = null;
    openGroup = null;
    titles.forEach((t) => {
      t.setAttribute('aria-expanded', 'false');
      t.classList.remove('is-open');
    });
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onDocKey, true);
    if (refocus) titles.find((t) => t.dataset.group === g)?.focus();
  };

  const onOutside = (e: PointerEvent) => {
    if (menuEl?.contains(e.target as Node) || bar.contains(e.target as Node)) return;
    close();
  };

  // A menu opened with the mouse has no focus inside it yet: Esc / arrows still apply.
  const onDocKey = (e: KeyboardEvent) => {
    if (!menuEl || menuEl.contains(document.activeElement)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const items = [...menuEl.querySelectorAll<HTMLElement>('.cr-menu-item')];
      (e.key === 'ArrowDown' ? items[0] : items[items.length - 1])?.focus();
    }
  };

  const open = (group: string, focusFirst: boolean) => {
    close();
    const title = titles.find((t) => t.dataset.group === group);
    if (!title) return;
    openGroup = group;
    title.setAttribute('aria-expanded', 'true');
    title.classList.add('is-open');
    const entries = menuEntries(group, commands.all());
    const items: HTMLButtonElement[] = [];
    const menu = h('div', { class: 'cr-menu', role: 'menu', 'aria-label': group });
    for (const entry of entries) {
      if (entry === '-') {
        menu.appendChild(h('div', { class: 'cr-menu-sep', role: 'separator' }));
        continue;
      }
      const checked = commandChecked(shell, entry.id);
      let enabled = true;
      try {
        enabled = entry.enabled ? entry.enabled() : true;
      } catch {
        enabled = false;
      }
      const label = entry.id === 'edit.undo' && shell.ctx.store.undoLabel ? `Undo ${shell.ctx.store.undoLabel}` : entry.id === 'edit.redo' && shell.ctx.store.redoLabel ? `Redo ${shell.ctx.store.redoLabel}` : entry.label;
      const item = h(
        'button',
        {
          class: 'cr-menu-item',
          type: 'button',
          role: checked === undefined ? 'menuitem' : 'menuitemcheckbox',
          'aria-checked': checked === undefined ? undefined : String(checked),
          'aria-disabled': enabled ? undefined : 'true',
          'data-command': entry.id,
          tabindex: '-1',
        },
        h('span', { class: `cr-menu-check ${checked ? 'is-on' : ''}`, 'aria-hidden': 'true' }, checked ? '✓' : ''),
        h('span', { class: 'cr-menu-label' }, label),
        h('span', { class: 'cr-menu-kbd' }, commandShortcut(entry)),
      );
      if (!enabled) item.classList.add('is-disabled');
      item.addEventListener('click', () => {
        if (!enabled) return;
        close();
        void shell.ctx.commands.run(entry.id).catch((err) => shell.toast(String(err?.message ?? err), 'error'));
      });
      item.addEventListener('pointerenter', () => item.focus());
      items.push(item);
      menu.appendChild(item);
    }
    menu.addEventListener('keydown', (e) => {
      const idx = items.indexOf(document.activeElement as HTMLButtonElement);
      const ti = titles.indexOf(title);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        items[(idx + d + items.length) % items.length]?.focus();
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        items[e.key === 'Home' ? 0 : items.length - 1]?.focus();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const j = (ti + (e.key === 'ArrowRight' ? 1 : -1) + titles.length) % titles.length;
        open(titles[j].dataset.group!, true);
      } else if (e.key === 'Tab') {
        close();
      }
      // Keep global shortcuts from firing while navigating the menu.
      e.stopPropagation();
    });
    const r = title.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    menu.style.left = `${Math.max(0, r.left - cr.left)}px`;
    container.appendChild(menu);
    menuEl = menu;
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onDocKey, true);
    if (focusFirst) items[0]?.focus();
  };

  renderTitles();
  const rerender = batched(() => {
    if (openGroup) close();
    renderTitles();
  });
  const unsub = commands.subscribe(rerender.schedule);
  return () => {
    rerender.cancel();
    close();
    unsub();
    bar.remove();
  };
}
