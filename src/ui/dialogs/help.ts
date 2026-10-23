/**
 * Help / "How to play": a quick start, every control (global, 3D world, plan) and the full,
 * searchable command list with shortcuts. Also the small About box.
 */
import type { Command } from '../../app/state';
import { menuGroups } from '../menubar';
import { h } from '../dom';
import { icon } from '../icons';
import { commandShortcut } from '../keyboard';
import type { Shell } from '../types';
import { logoMark } from './welcome';
import { openModal, type ModalHandle } from './modal';

type Row = [keys: string, action: string];

export const CONTROLS: { title: string; icon: string; rows: Row[] }[] = [
  {
    title: 'Everywhere',
    icon: '⌨️',
    rows: [
      ['1 – 9', 'Choose a hotbar slot (mouse wheel over the hotbar cycles)'],
      ['E', 'Open / close the creative inventory'],
      ['Tab', 'Cycle views: Plan → Split → 3D'],
      ['PgUp / PgDn', 'Go one level up / down'],
      ['G', 'Toggle grid snapping'],
      ['Ctrl+Z · Ctrl+Shift+Z / Ctrl+Y', 'Undo · redo'],
      ['Del / Backspace', 'Delete the selection'],
      ['Ctrl+C · Ctrl+V · Ctrl+D', 'Copy · paste · duplicate'],
      ['Ctrl+A', 'Select everything on the active level'],
      ['Ctrl+S · Ctrl+Shift+S · Ctrl+O · Ctrl+N', 'Save · save as · open · new'],
      ['Ctrl+Shift+E', 'Export drawings, BIM and 3D models'],
      ['Ctrl+K', 'Command palette (search commands and items)'],
      ['F1 / ?', 'This help'],
      ['Esc', 'Close / cancel / deselect'],
    ],
  },
  {
    title: '3D world',
    icon: '🧊',
    rows: [
      ['F', 'Switch camera: Orbit ⇄ first person (Walk or Fly, like Minecraft)'],
      ['W A S D', 'Walk / fly'],
      ['Space', 'Jump (walk) · up (fly)'],
      ['Shift', 'Sneak (walk: slower, lower, never falls off an edge) · down (fly)'],
      ['Ctrl · W W', 'Sprint (double-tap W and hold)'],
      ['Space Space', 'Double-tap: switch walking ⇄ flying'],
      ['Right click', 'Place / use the item in hand (two clicks for walls, beams, railings); hold to keep placing blocks'],
      ['Right click a door / light', 'Open or close the door · switch the light (Shift+right click places against it)'],
      ['Left click', 'Break the element you point at (hold to keep breaking)'],
      ['Middle click', 'Pick block: put the element’s item in your hand'],
      ['R · Shift+R', 'Rotate the ghost 90° · −15°'],
      ['X · C', 'X-ray walls · cut away levels above'],
      ['Right-drag · Middle-drag · Wheel', 'Orbit: rotate · pan · zoom'],
      ['Home', 'Reset the 3D camera'],
    ],
  },
  {
    title: '2D plan',
    icon: '📐',
    rows: [
      ['Left click', 'Draw / place with the item in hand'],
      ['Right click / Esc', 'Finish or cancel the current drawing'],
      ['Double-click / Enter', 'Finish a wall chain or outline'],
      ['Type a number', 'Exact length while drawing: 3.6m, 360cm, 12\'6"'],
      ['Shift (hold)', 'Temporarily disable angle snapping'],
      ['Wheel · Middle-drag / Space+drag', 'Zoom about the cursor · pan'],
      ['R', 'Rotate the ghost'],
      ['Arrow keys', 'Nudge the selection'],
      ['Home', 'Zoom to fit'],
    ],
  },
];

const STEPS: [string, string, string][] = [
  ['🎒', 'Pick an item', 'Your hotbar holds 9 items. Press 1–9 or scroll over it; press E for the creative inventory with every wall, door, window, stair, furniture piece, block and paint.'],
  ['📐', 'Draw a blueprint', 'In the Plan view, click to draw walls, drop doors and windows on walls and click inside rooms to name them. Type a length while drawing for exact sizes.'],
  ['🏗️', 'Generate 3D', 'Build → Generate 3D adds floors, ceilings, rooms and a roof from your walls. Add floors above and keep going.'],
  ['🧱', 'Build in 3D', 'Walk or fly around (F), right-click to place and left-click to break — just like Minecraft. Everything stays in sync with the plan.'],
  ['📤', 'Export real BIM', 'Export IFC for Revit / ArchiCAD, DXF and PDF drawing sets to scale, or glTF / OBJ / STL models.'],
];

function kbdList(keys: string): (HTMLElement | string)[] {
  const out: (HTMLElement | string)[] = [];
  keys.split(' · ').forEach((group, gi) => {
    if (gi) out.push(h('span', { class: 'cr-kbd-sep' }, '·'));
    group.split(' / ').forEach((k, ki) => {
      if (ki) out.push(h('span', { class: 'cr-kbd-sep' }, '/'));
      out.push(h('kbd', null, k));
    });
  });
  return out;
}

export type HelpTab = 'start' | 'controls' | 'commands';

export function openHelpDialog(shell: Shell, tab: HelpTab = 'start'): ModalHandle {
  const tabs: { id: HelpTab; label: string }[] = [
    { id: 'start', label: 'How to play' },
    { id: 'controls', label: 'Controls' },
    { id: 'commands', label: 'All commands' },
  ];
  const tabBar = h('div', { class: 'cr-tabs', role: 'tablist', 'aria-label': 'Help sections' });
  const panels = new Map<HelpTab, HTMLElement>();

  // How to play
  panels.set(
    'start',
    h(
      'div',
      { class: 'cr-help-start' },
      h('ol', { class: 'cr-steps' }, ...STEPS.map(([ic, title, text], i) => h('li', { class: 'cr-step' }, h('span', { class: 'cr-step-ic', 'aria-hidden': 'true' }, ic), h('div', null, h('strong', null, `${i + 1}. ${title}`), h('p', null, text))))),
      h('p', { class: 'cr-help-note' }, 'Tip: the plan and the 3D world edit the same model — select something in one and it highlights in the other. Every edit can be undone.'),
    ),
  );

  // Controls
  panels.set(
    'controls',
    h(
      'div',
      { class: 'cr-help-controls' },
      ...CONTROLS.map((sec) =>
        h(
          'section',
          { class: 'cr-help-card' },
          h('h3', null, h('span', { 'aria-hidden': 'true' }, sec.icon), sec.title),
          h('table', { class: 'cr-keys-table' }, h('tbody', null, ...sec.rows.map(([k, a]) => h('tr', null, h('td', { class: 'cr-keys' }, ...kbdList(k)), h('td', null, a))))),
        ),
      ),
    ),
  );

  // Commands
  let modalRef: ModalHandle | null = null;
  const filter = h('input', { class: 'cr-input', type: 'search', placeholder: 'Filter commands…', 'aria-label': 'Filter commands' });
  const cmdList = h('div', { class: 'cr-help-commands' });
  const renderCommands = () => {
    const q = filter.value.trim().toLowerCase();
    const all = shell.ctx.commands.all().filter((c) => !/^hotbar\.\d$/.test(c.id));
    cmdList.textContent = '';
    for (const g of menuGroups(all)) {
      const items = all.filter((c) => c.group === g && (!q || c.label.toLowerCase().includes(q) || c.id.includes(q)));
      if (!items.length) continue;
      cmdList.appendChild(h('h4', { class: 'cr-prop-section-title' }, g));
      const dl = h('div', { class: 'cr-cmd-rows' });
      for (const c of items) dl.appendChild(commandRow(shell, c, () => modalRef?.close()));
      cmdList.appendChild(dl);
    }
    if (!cmdList.childElementCount) cmdList.appendChild(h('p', { class: 'cr-empty' }, `No command matches “${filter.value}”.`));
  };
  filter.addEventListener('input', renderCommands);
  renderCommands();
  panels.set('commands', h('div', { class: 'cr-help-cmds' }, filter, cmdList));

  const content = h('div', { class: 'cr-help-body' });
  const btns = tabs.map((t) => {
    const b = h('button', { class: 'cr-tab', type: 'button', role: 'tab', 'data-tab': t.id }, t.label);
    b.addEventListener('click', () => show(t.id));
    tabBar.appendChild(b);
    return b;
  });
  tabBar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === current);
    const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    show(tabs[j].id);
    btns[j].focus();
  });
  let current: HelpTab = tab;
  const show = (t: HelpTab) => {
    current = t;
    btns.forEach((b, i) => {
      const on = tabs[i].id === t;
      b.setAttribute('aria-selected', String(on));
      b.classList.toggle('is-on', on);
      b.tabIndex = on ? 0 : -1;
    });
    content.textContent = '';
    content.appendChild(panels.get(t)!);
  };
  show(tab);
  const close = h('button', { class: 'cr-btn is-primary', type: 'button' }, 'Got it');
  const modal = openModal({
    title: 'How to Play Crafting',
    subtitle: 'Controls, shortcuts and commands',
    size: 'lg',
    className: 'cr-help-modal',
    body: h('div', { class: 'cr-help' }, tabBar, content),
    footer: [h('span', { class: 'cr-help-foot' }, icon('keyboard'), 'Press ', h('kbd', null, 'F1'), ' or ', h('kbd', null, '?'), ' any time'), h('span', { class: 'cr-flex' }), close],
    initialFocus: btns[tabs.findIndex((t) => t.id === tab)],
  });
  modalRef = modal;
  close.addEventListener('click', () => modal.close());
  return modal;
}

function commandRow(shell: Shell, c: Command, beforeRun: () => void): HTMLElement {
  const sc = commandShortcut(c);
  const b = h('button', { class: 'cr-cmd-row', type: 'button', title: c.id }, h('span', null, c.label), sc ? h('kbd', null, sc) : null);
  b.addEventListener('click', () => {
    // Close help first so the command's own dialogs and focus work normally.
    beforeRun();
    void shell.ctx.commands.run(c.id).catch((err) => shell.toast(String(err?.message ?? err), 'error'));
  });
  return b;
}

export function openAboutDialog(): ModalHandle {
  const ok = h('button', { class: 'cr-btn is-primary', type: 'button' }, 'Close');
  const modal = openModal({
    title: 'About Crafting',
    size: 'sm',
    className: 'cr-about-modal',
    body: h(
      'div',
      { class: 'cr-about' },
      logoMark(),
      h('h3', null, 'Crafting'),
      h('p', null, 'Free architectural, structural and interior design that plays like Minecraft creative mode.'),
      h('p', { class: 'cr-about-meta' }, 'Real BIM output: IFC4, DXF, PDF, SVG, PNG, glTF/GLB, OBJ, STL.'),
      h('p', { class: 'cr-about-meta' }, 'Model units: millimetres · AIA/ISO 13567 layers · ISO 128 lineweights.'),
    ),
    footer: [h('span', { class: 'cr-flex' }), ok],
    initialFocus: ok,
  });
  ok.addEventListener('click', () => modal.close());
  return modal;
}
