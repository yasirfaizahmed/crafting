/**
 * Main toolbar: view mode, camera mode, snapping, 3D display toggles, units, undo/redo with
 * labels, inventory / export / help shortcuts and sidebar toggles.
 */
import type { UIState } from '../app/state';
import { setUnits } from './commands';
import { h } from './dom';
import { icon, type IconName } from './icons';
import { commandShortcut } from './keyboard';
import type { Shell } from './types';

type BoolKey = 'snapGrid' | 'snapObjects' | 'snapAngle' | 'xray' | 'cutAboveActive' | 'shadows';

interface Segment<T extends string> {
  value: T;
  label: string;
  icon?: IconName;
  title: string;
}

export function mountToolbar(container: HTMLElement, shell: Shell): { update(): void; dispose(): void } {
  const { ctx } = shell;
  const { ui, store } = ctx;
  const updaters: (() => void)[] = [];
  const shortcutOf = (id: string) => {
    const c = ctx.commands.get(id);
    return c ? commandShortcut(c) : '';
  };
  const withKey = (title: string, id: string) => {
    const k = shortcutOf(id);
    return k ? `${title} (${k})` : title;
  };

  function segmented<T extends string>(label: string, cls: string, segs: Segment<T>[], get: () => T, set: (v: T) => void): HTMLElement {
    const group = h('div', { class: `cr-seg ${cls}`, role: 'radiogroup', 'aria-label': label });
    const btns = segs.map((s) => {
      const b = h(
        'button',
        { class: 'cr-seg-btn', type: 'button', role: 'radio', title: s.title, 'data-value': s.value, 'aria-label': s.title },
        s.icon ? icon(s.icon) : null,
        h('span', { class: 'cr-seg-label' }, s.label),
      );
      b.addEventListener('click', () => set(s.value));
      group.appendChild(b);
      return b;
    });
    group.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      e.stopPropagation();
      const i = segs.findIndex((s) => s.value === get());
      const j = (i + (e.key === 'ArrowRight' ? 1 : -1) + segs.length) % segs.length;
      set(segs[j].value);
      btns[j].focus();
    });
    updaters.push(() => {
      const v = get();
      btns.forEach((b, i) => {
        const on = segs[i].value === v;
        b.setAttribute('aria-checked', String(on));
        b.classList.toggle('is-on', on);
        b.tabIndex = on ? 0 : -1;
      });
    });
    return group;
  }

  function toggle(key: BoolKey, ic: IconName, label: string, title: string, cmdId?: string): HTMLElement {
    const b = h('button', { class: 'cr-tb-btn cr-toggle', type: 'button', 'aria-label': label, title: cmdId ? withKey(title, cmdId) : title }, icon(ic), h('span', { class: 'cr-tb-label' }, label));
    b.addEventListener('click', () => ui.set({ [key]: !ui.get()[key] } as Partial<UIState>));
    updaters.push(() => {
      const on = ui.get()[key];
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('is-on', on);
    });
    return b;
  }

  function action(ic: IconName, label: string, title: string, run: () => void, cls = ''): HTMLButtonElement {
    const b = h('button', { class: `cr-tb-btn ${cls}`.trim(), type: 'button', title, 'aria-label': label }, icon(ic), h('span', { class: 'cr-tb-label' }, label));
    b.addEventListener('click', run);
    return b;
  }

  const sep = () => h('span', { class: 'cr-tb-sep', role: 'separator', 'aria-orientation': 'vertical' });

  const undo = action('undo', 'Undo', 'Undo (Ctrl+Z)', () => store.undo(), 'cr-undo');
  const redo = action('redo', 'Redo', 'Redo (Ctrl+Shift+Z)', () => store.redo(), 'cr-redo');
  const undoLabel = undo.querySelector('.cr-tb-label')!;
  const redoLabel = redo.querySelector('.cr-tb-label')!;
  const updateHistory = () => {
    undo.disabled = !store.canUndo;
    redo.disabled = !store.canRedo;
    undoLabel.textContent = store.undoLabel ? `Undo ${store.undoLabel}` : 'Undo';
    redoLabel.textContent = store.redoLabel ? `Redo ${store.redoLabel}` : 'Redo';
    undo.title = store.undoLabel ? `Undo “${store.undoLabel}” (${shortcutOf('edit.undo') || 'Ctrl+Z'})` : 'Nothing to undo';
    redo.title = store.redoLabel ? `Redo “${store.redoLabel}” (${shortcutOf('edit.redo') || 'Ctrl+Shift+Z'})` : 'Nothing to redo';
  };

  const leftToggle = action('panelLeft', 'Levels', 'Toggle levels & outliner panel', () => shell.toggleSidebar('left'), 'cr-icon-only cr-panel-toggle');
  const rightToggle = action('panelRight', 'Properties', 'Toggle properties panel', () => shell.toggleSidebar('right'), 'cr-icon-only cr-panel-toggle');
  updaters.push(() => {
    leftToggle.setAttribute('aria-pressed', String(shell.isSidebarOpen('left')));
    rightToggle.setAttribute('aria-pressed', String(shell.isSidebarOpen('right')));
    leftToggle.classList.toggle('is-on', shell.isSidebarOpen('left'));
    rightToggle.classList.toggle('is-on', shell.isSidebarOpen('right'));
  });

  const inventoryBtn = action('chest', 'Inventory', withKey('Creative inventory', 'inventory.toggle'), () => ui.set({ inventoryOpen: !ui.get().inventoryOpen }), 'cr-inventory-btn');
  updaters.push(() => inventoryBtn.classList.toggle('is-on', ui.get().inventoryOpen));

  const bar = h(
    'div',
    { class: 'cr-toolbar-inner', role: 'toolbar', 'aria-label': 'View and editing tools' },
    leftToggle,
    sep(),
    segmented<UIState['viewMode']>(
      'View mode',
      'cr-viewmode',
      [
        { value: 'plan', label: 'Plan', icon: 'plan', title: '2D blueprint plan' },
        { value: 'split', label: 'Split', icon: 'split', title: 'Plan and 3D side by side' },
        { value: '3d', label: '3D', icon: 'cube', title: '3D world' },
      ],
      () => ui.get().viewMode,
      (v) => ui.set({ viewMode: v }),
    ),
    segmented<UIState['cameraMode']>(
      'Camera',
      'cr-camera',
      [
        { value: 'fly', label: 'Fly', icon: 'fly', title: 'Fly camera (Minecraft style, F in 3D)' },
        { value: 'orbit', label: 'Orbit', icon: 'orbit', title: 'Orbit camera (F in 3D)' },
      ],
      () => ui.get().cameraMode,
      (v) => ui.set({ cameraMode: v }),
    ),
    sep(),
    h(
      'div',
      { class: 'cr-tb-group', role: 'group', 'aria-label': 'Snapping' },
      toggle('snapGrid', 'grid', 'Grid', 'Snap to grid', 'snap.toggleGrid'),
      toggle('snapObjects', 'magnet', 'Objects', 'Snap to objects (endpoints, edges, midpoints)'),
      toggle('snapAngle', 'angle', 'Angle', 'Angle snap in 15° steps (hold Shift to suspend)'),
    ),
    sep(),
    h(
      'div',
      { class: 'cr-tb-group', role: 'group', 'aria-label': '3D display' },
      toggle('xray', 'xray', 'X-ray', 'X-ray walls (X in 3D)'),
      toggle('cutAboveActive', 'cutaway', 'Cut-away', 'Hide levels above the active level (C in 3D)'),
      toggle('shadows', 'sun', 'Shadows', 'Sun shadows'),
    ),
    sep(),
    segmented<'metric' | 'imperial'>(
      'Units',
      'cr-units',
      [
        { value: 'metric', label: 'm', title: 'Metric units (mm / m)' },
        { value: 'imperial', label: 'ft', title: 'Imperial units (feet & inches)' },
      ],
      () => ui.get().displayUnits,
      (v) => setUnits(shell, v),
    ),
    sep(),
    undo,
    redo,
    h('span', { class: 'cr-tb-spacer' }),
    inventoryBtn,
    action('download', 'Export', withKey('Export drawings & models', 'file.export'), () => shell.openDialog('export'), 'cr-primary-btn'),
    action('command', 'Commands', withKey('Command palette', 'palette'), () => shell.openDialog('palette'), 'cr-icon-only'),
    action('help', 'Help', withKey('How to play & controls', 'help'), () => shell.openDialog('help'), 'cr-icon-only'),
    sep(),
    rightToggle,
  );
  container.appendChild(bar);
  const update = () => {
    updaters.forEach((u) => u());
    updateHistory();
  };
  update();
  const unsubs = [ui.subscribe(update), store.subscribe(updateHistory)];
  return {
    update,
    dispose() {
      unsubs.forEach((u) => u());
      bar.remove();
    },
  };
}
