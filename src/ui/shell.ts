/**
 * Application shell: layout, menus, hotbar, inventory, panels, dialogs and keyboard.
 *
 *   mountApp(root, ctx) → () => void (dispose)
 *
 * Mounts the 2D plan editor and the 3D viewport into the centre views (split with a draggable
 * divider), wires the global commands and keyboard dispatcher, toasts, dialogs, autosave, the
 * unload warning and the document title.
 */
import type { AppContext, ViewMode } from '../app/state';
import { loadInitialProject, startAutosave } from '../io';
import { mountPlanEditor } from '../plan2d';
import type { PlanHandle } from '../plan2d/types';
import { mountViewport } from '../view3d';
import type { ViewportHandle } from '../view3d/types';
import { errorMessage } from './actions';
import { registerGlobalCommands } from './commands';
import { openDXFImportDialog } from './dialogs/dxf-import';
import { openExportDialog } from './dialogs/export';
import { openAboutDialog, openHelpDialog, type HelpTab } from './dialogs/help';
import { closeAllModals, confirmDialog, isModalOpen, setModalHost, type ModalHandle } from './dialogs/modal';
import { openPalette } from './dialogs/palette';
import { openProjectDialog } from './dialogs/project';
import { logoMark, openWelcomeDialog } from './dialogs/welcome';
import { h, prefs } from './dom';
import { formatElevation } from './format';
import { mountHotbar } from './hotbar';
import { icon } from './icons';
import { mountInventory } from './inventory';
import { createKeyboardDispatcher } from './keyboard';
import { createLayout } from './layout';
import { adjacentLevelId } from './level-ops';
import { mountMenubar } from './menubar';
import { mountLevelsPanel } from './panels/levels';
import { mountOutliner } from './panels/outliner';
import { mountProperties } from './panels/properties';
import { mountQuantities } from './panels/quantities';
import { closePicker } from './pickers';
import { mountStatusbar } from './statusbar';
import { createToastHost } from './toasts';
import { mountToolbar } from './toolbar';
import { disposeTooltip } from './tooltip';
import type { MountOptions, Shell } from './types';
import './styles.css';

export type { MountOptions, Shell } from './types';

/** Document title: "<project> — Crafting", prefixed with • while there are unsaved edits. */
export function documentTitle(name: string, dirty: boolean): string {
  return `${dirty ? '• ' : ''}${name || 'Untitled Project'} — Crafting`;
}

/**
 * Whether to show the welcome screen at startup: `?welcome=1|0` wins, automated browsers skip it
 * (so scripted sessions start in the editor), otherwise only when no autosaved session exists.
 */
export async function shouldShowWelcome(): Promise<boolean> {
  const param = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('welcome') : null;
  if (param === '1' || param === 'true') return true;
  if (param === '0' || param === 'false') return false;
  if (typeof navigator !== 'undefined' && navigator.webdriver) return false;
  if (!prefs.get('welcomeOnStart', true)) return false;
  try {
    return !(await loadInitialProject());
  } catch {
    return true;
  }
}

export function mountApp(root: HTMLElement, ctx: AppContext, opts: MountOptions = {}): () => void {
  const { store, ui, events } = ctx;
  root.textContent = '';
  root.classList.add('cr-app');
  const layout = createLayout(root);
  setModalHost(root);
  const toasts = createToastHost(root);
  const disposers: (() => void)[] = [];
  const dialogs = new Map<string, ModalHandle>();

  const shell: Shell = {
    ctx,
    root,
    plan: null,
    viewport: null,
    toast: (message, kind = 'info') => void toasts.show(message, kind),
    confirm: (o) => confirmDialog(o),
    openDialog: (name, options) => openDialog(name, options),
    toggleSidebar: (side, open) => {
      layout.toggleSidebar(side, open);
      toolbar.update();
    },
    isSidebarOpen: (side) => layout.isSidebarOpen(side),
    showTab: (tab) => showTab(tab),
    clipboard: { data: null, pastes: 0 },
    refresh: () => refresh(),
  };

  // --- top: brand, menus, document title, toolbar --------------------------------
  const brand = h('div', { class: 'cr-brand', title: 'Crafting' }, logoMark(), h('span', { class: 'cr-brand-name' }, 'Crafting'));
  const docTitle = h('button', { class: 'cr-doc-title', type: 'button', title: 'Project settings' });
  docTitle.addEventListener('click', () => openDialog('project'));
  const menus = h('nav', { class: 'cr-menus', 'aria-label': 'Application menu' });
  layout.menubar.append(brand, menus, docTitle);
  disposers.push(mountMenubar(menus, shell));
  const toolbar = mountToolbar(layout.toolbar, shell);
  disposers.push(() => toolbar.dispose());

  // --- left sidebar: levels + outliner ---------------------------------------------
  const levelsPanel = mountLevelsPanel(layout.left, shell);
  const outliner = mountOutliner(layout.left, shell);
  disposers.push(() => levelsPanel.dispose(), () => outliner.dispose());

  // --- right sidebar: properties | quantities tabs ----------------------------------
  const tabBar = h('div', { class: 'cr-side-tabs', role: 'tablist', 'aria-label': 'Inspector' });
  const propsHost = h('div', { class: 'cr-side-panel', role: 'tabpanel', 'data-tab': 'properties' });
  const qtyHost = h('div', { class: 'cr-side-panel', role: 'tabpanel', 'data-tab': 'quantities', hidden: true });
  const tabDefs = [
    { id: 'properties' as const, label: 'Properties', ic: 'sliders' as const },
    { id: 'quantities' as const, label: 'Quantities', ic: 'chart' as const },
  ];
  const tabBtns = tabDefs.map((t) => {
    const b = h('button', { class: 'cr-side-tab', type: 'button', role: 'tab', 'data-tab': t.id, 'aria-selected': 'false' }, icon(t.ic), h('span', null, t.label));
    b.addEventListener('click', () => showTab(t.id));
    tabBar.appendChild(b);
    return b;
  });
  tabBar.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = activeTab === 'properties' ? 'quantities' : 'properties';
    showTab(next);
    tabBtns[next === 'properties' ? 0 : 1].focus();
  });
  layout.right.append(tabBar, propsHost, qtyHost);
  const properties = mountProperties(propsHost, shell);
  const quantities = mountQuantities(qtyHost, shell);
  disposers.push(() => properties.dispose(), () => quantities.dispose());
  let activeTab: 'properties' | 'quantities' = prefs.get<string>('rightTab', 'properties') === 'quantities' ? 'quantities' : 'properties';
  function showTab(tab: 'properties' | 'quantities'): void {
    activeTab = tab;
    prefs.set('rightTab', tab);
    if (!layout.isSidebarOpen('right')) shell.toggleSidebar('right', true);
    tabBtns.forEach((b, i) => {
      const on = tabDefs[i].id === tab;
      b.setAttribute('aria-selected', String(on));
      b.classList.toggle('is-on', on);
      b.tabIndex = on ? 0 : -1;
    });
    propsHost.hidden = tab !== 'properties';
    qtyHost.hidden = tab !== 'quantities';
    quantities.setVisible(tab === 'quantities');
  }
  // Initial tab without forcing the sidebar open.
  tabBtns.forEach((b, i) => {
    const on = tabDefs[i].id === activeTab;
    b.setAttribute('aria-selected', String(on));
    b.classList.toggle('is-on', on);
    b.tabIndex = on ? 0 : -1;
  });
  propsHost.hidden = activeTab !== 'properties';
  qtyHost.hidden = activeTab !== 'quantities';
  quantities.setVisible(activeTab === 'quantities');

  // --- dock: level chip, hotbar, inventory button ---------------------------------
  const levelName = h('span', { class: 'cr-dock-level-name' });
  const levelElev = h('span', { class: 'cr-dock-level-elev' });
  const levelUp = h('button', { class: 'cr-icon-btn is-sm', type: 'button', title: 'Level up (PgUp)', 'aria-label': 'Level up' }, icon('chevronUp'));
  const levelDown = h('button', { class: 'cr-icon-btn is-sm', type: 'button', title: 'Level down (PgDn)', 'aria-label': 'Level down' }, icon('chevronDown'));
  levelUp.addEventListener('click', () => void ctx.commands.run('level.up'));
  levelDown.addEventListener('click', () => void ctx.commands.run('level.down'));
  const levelChip = h(
    'div',
    { class: 'cr-dock-level', role: 'group', 'aria-label': 'Active level' },
    h('button', { class: 'cr-dock-level-btn', type: 'button', title: 'Levels panel', onClick: () => openDialog('levels') }, icon('layers'), h('span', { class: 'cr-dock-level-text' }, levelName, levelElev)),
    h('span', { class: 'cr-dock-level-arrows' }, levelUp, levelDown),
  );
  const hotbarSlot = h('div', { class: 'cr-dock-hotbar' });
  const invBtn = h(
    'button',
    { class: 'cr-dock-inv', type: 'button', title: 'Creative inventory (E)', 'aria-label': 'Open creative inventory' },
    icon('chest'),
    h('span', null, 'Inventory'),
    h('kbd', null, 'E'),
  );
  invBtn.addEventListener('click', () => ui.set({ inventoryOpen: !ui.get().inventoryOpen }));
  layout.dock.append(h('div', { class: 'cr-dock-side is-left' }, levelChip), hotbarSlot, h('div', { class: 'cr-dock-side is-right' }, invBtn));
  const hotbar = mountHotbar(hotbarSlot, shell, { showName: true });
  disposers.push(() => hotbar.dispose());
  const updateDock = () => {
    const s = ui.get();
    const lv = store.getLevel(s.activeLevelId);
    levelName.textContent = lv?.name ?? '—';
    levelElev.textContent = lv ? formatElevation(lv.elevation, s.displayUnits) : '';
    levelUp.disabled = !adjacentLevelId(store.project, s.activeLevelId, 1);
    levelDown.disabled = !adjacentLevelId(store.project, s.activeLevelId, -1);
    invBtn.classList.toggle('is-on', s.inventoryOpen);
  };

  // --- status bar, inventory ---------------------------------------------------------
  const status = mountStatusbar(layout.status, shell);
  disposers.push(() => status.dispose());
  const inventory = mountInventory(layout.center, shell);
  disposers.push(() => inventory.dispose());

  // --- views ---------------------------------------------------------------------------
  const mountView = <T>(host: HTMLElement, name: string, fn: () => T): T | null => {
    try {
      return fn();
    } catch (err) {
      console.error(`Crafting: the ${name} failed to start`, err);
      host.appendChild(h('div', { class: 'cr-view-error' }, h('strong', null, `The ${name} could not start`), h('span', null, errorMessage(err))));
      return null;
    }
  };
  shell.plan = mountView<PlanHandle>(layout.plan, '2D plan', () => (opts.mountPlan ?? mountPlanEditor)(layout.plan, ctx));
  shell.viewport = mountView<ViewportHandle>(layout.view3d, '3D view', () => (opts.mountViewport ?? mountViewport)(layout.view3d, ctx));
  disposers.push(() => {
    shell.plan?.dispose();
    shell.viewport?.dispose();
  });
  disposers.push(
    layout.onViewsResize(() => {
      const mode = ui.get().viewMode;
      if (mode !== '3d') shell.plan?.resize();
      if (mode !== 'plan') shell.viewport?.resize();
    }),
  );

  let lastMode: ViewMode | null = null;
  const applyViewMode = (mode: ViewMode) => {
    if (mode === lastMode) return;
    lastMode = mode;
    const hiddenHost = mode === 'plan' ? layout.view3d : mode === '3d' ? layout.plan : null;
    if (hiddenHost && document.pointerLockElement && hiddenHost.contains(document.pointerLockElement)) document.exitPointerLock?.();
    const refocus = !!hiddenHost && hiddenHost.contains(document.activeElement);
    layout.setViewMode(mode);
    shell.plan?.setActive(mode !== '3d');
    shell.viewport?.setActive(mode !== 'plan');
    if (mode !== '3d') shell.plan?.resize();
    if (mode !== 'plan') shell.viewport?.resize();
    if (refocus) {
      const visible = mode === '3d' ? layout.view3d : layout.plan;
      (visible.matches('[tabindex]') ? visible : visible.querySelector<HTMLElement>('[tabindex]'))?.focus({ preventScroll: true });
    }
  };
  applyViewMode(ui.get().viewMode);

  // --- dialogs -------------------------------------------------------------------------
  function openDialog(name: string, options: Record<string, unknown> = {}): void {
    const existing = dialogs.get(name);
    if (existing && !existing.closed) {
      if (name === 'palette') existing.close();
      return;
    }
    if (ui.get().inventoryOpen) ui.set({ inventoryOpen: false });
    closePicker();
    let m: ModalHandle | null = null;
    try {
      switch (name) {
        case 'welcome':
          m = openWelcomeDialog(shell);
          break;
        case 'export':
          m = openExportDialog(shell, { format: typeof options.format === 'string' ? options.format : undefined });
          break;
        case 'project':
        case 'settings':
          m = openProjectDialog(shell);
          break;
        case 'help':
          m = openHelpDialog(shell, (typeof options.tab === 'string' ? options.tab : 'start') as HelpTab);
          break;
        case 'shortcuts':
          m = openHelpDialog(shell, 'controls');
          break;
        case 'palette':
          m = openPalette(shell);
          break;
        case 'dxf-import':
          m = openDXFImportDialog(shell);
          break;
        case 'about':
          m = openAboutDialog();
          break;
        case 'levels':
          shell.toggleSidebar('left', true);
          levelsPanel.focus();
          return;
        default:
          shell.toast(`Unknown dialog “${name}”`, 'warning');
          return;
      }
    } catch (err) {
      console.error(err);
      shell.toast(`Could not open ${name}: ${errorMessage(err)}`, 'error');
      return;
    }
    if (m) dialogs.set(name, m);
  }

  // --- commands, keyboard, events ---------------------------------------------------
  disposers.push(registerGlobalCommands(shell));
  const keyboard = createKeyboardDispatcher(ctx.commands, {
    isBlocked: () => isModalOpen(),
    onError: (err, cmd) => {
      console.error(`Command ${cmd.id} failed`, err);
      shell.toast(`${cmd.label} failed: ${errorMessage(err)}`, 'error');
    },
  });
  disposers.push(() => keyboard.dispose());
  disposers.push(
    events.on('toast', ({ message, kind }) => shell.toast(message, kind)),
    events.on('open-dialog', ({ name, options }) => openDialog(name, options)),
  );

  // --- title, dirty state, autosave -------------------------------------------------
  const updateTitle = () => {
    const name = store.project.info.name;
    document.title = documentTitle(name, store.isDirty);
    docTitle.textContent = '';
    docTitle.append(h('span', { class: 'cr-doc-name' }, name || 'Untitled Project'));
    if (store.isDirty) docTitle.append(h('span', { class: 'cr-doc-dirty', title: 'Unsaved changes', 'aria-label': 'Unsaved changes' }, '•'));
  };
  function refresh(): void {
    updateTitle();
    updateDock();
    toolbar.update();
    status.update();
  }
  refresh();
  disposers.push(
    store.subscribe(() => {
      updateTitle();
      updateDock();
    }),
    ui.subscribe((next, prev) => {
      if (next.viewMode !== prev.viewMode) applyViewMode(next.viewMode);
      if (next.activeLevelId !== prev.activeLevelId || next.displayUnits !== prev.displayUnits || next.inventoryOpen !== prev.inventoryOpen) updateDock();
    }),
  );

  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!store.isDirty) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  disposers.push(() => window.removeEventListener('beforeunload', onBeforeUnload));

  if (opts.autosave !== false) {
    try {
      const stop = startAutosave(ctx);
      disposers.push(() => stop());
    } catch (err) {
      console.warn('Crafting: autosave unavailable', err);
      shell.toast('Autosave is unavailable in this browser — remember to save your project (Ctrl+S).', 'warning');
    }
  }

  let disposed = false;
  const welcome = opts.showWelcome !== undefined ? Promise.resolve(opts.showWelcome) : shouldShowWelcome();
  void welcome.then((show) => {
    if (show && !disposed && !isModalOpen()) openDialog('welcome');
  });

  return () => {
    disposed = true;
    closeAllModals();
    closePicker();
    for (const d of disposers.reverse()) {
      try {
        d();
      } catch (err) {
        console.error(err);
      }
    }
    toasts.dispose();
    disposeTooltip();
    layout.dispose();
    setModalHost(null);
    root.classList.remove('cr-app', 'has-left', 'has-right');
  };
}
