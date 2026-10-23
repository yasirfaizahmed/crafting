/**
 * Global commands (ARCHITECTURE.md "Controls") registered by the shell, plus the menu layout.
 * Other modules register their own commands (plan2d: build.generate3d, view3d: view.toggleCamera…);
 * those appear in the menus/palette automatically under their group.
 */
import type { Command, ViewMode } from '../app/state';
import { getCatalogItem } from '../core/catalog';
import { EXPORTERS } from '../export';
import {
  copySelection,
  deleteSelection,
  duplicateSelection,
  flipSelectedStairs,
  holdCatalogItem,
  newProject,
  openProject,
  openSample,
  pasteClipboard,
  saveProject,
  selectAllOnLevel,
  selectedStairs,
  traceImage,
} from './actions';
import { HOTBAR_SIZE } from './hotbar-model';
import { adjacentLevelId, insertLevel } from './level-ops';
import type { Shell } from './types';

const VIEW_CYCLE: ViewMode[] = ['plan', 'split', '3d'];

/** Next view mode for Tab (plan → split → 3D → plan). */
export function nextViewMode(mode: ViewMode): ViewMode {
  return VIEW_CYCLE[(VIEW_CYCLE.indexOf(mode) + 1) % VIEW_CYCLE.length];
}

/** Tab cycles views only when focus is not on a UI control (keeps Tab focus navigation usable). */
function focusOnCanvasOrBody(): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body || a === document.documentElement) return true;
  return !!a.closest('.cr-view-host');
}

/** Hotbar items offered as quick "hold" commands in the Build menu. */
export const QUICK_HOLD = ['tool-select', 'wall-200', 'slab-wood', 'door-single', 'window-casement', 'stair-straight', 'roof-gable', 'column-rect', 'block-brick', 'room', 'dimension', 'tool-eraser'];

export function registerGlobalCommands(shell: Shell): () => void {
  const { ctx } = shell;
  const { store, ui, selection, commands } = ctx;
  const hasSelection = () => selection.get().length > 0;
  const toggle = (key: 'snapGrid' | 'snapObjects' | 'snapAngle' | 'shadows' | 'showGrid' | 'showLevelBelow') => () =>
    ui.set({ [key]: !ui.get()[key] } as Partial<ReturnType<typeof ui.get>>);
  const setLevel = (dir: 1 | -1) => () => {
    const id = adjacentLevelId(store.project, ui.get().activeLevelId, dir);
    if (id) {
      ui.set({ activeLevelId: id });
      shell.toast(`Level: ${store.getLevel(id)?.name}`, 'info');
    }
  };

  const list: Command[] = [
    // File
    { id: 'file.new', label: 'New Project', group: 'File', keys: ['ctrl+n'], run: () => void newProject(shell) },
    { id: 'file.open', label: 'Open Project…', group: 'File', keys: ['ctrl+o'], run: () => openProject(shell) },
    { id: 'file.openSample', label: 'Open Sample House', group: 'File', run: () => openSample(shell) },
    { id: 'file.save', label: 'Save', group: 'File', keys: ['ctrl+s'], run: () => void saveProject(shell) },
    { id: 'file.saveAs', label: 'Save As…', group: 'File', keys: ['ctrl+shift+s'], run: () => void saveProject(shell, true) },
    { id: 'file.importDXF', label: 'Import DXF Blueprint…', group: 'File', run: () => shell.openDialog('dxf-import') },
    { id: 'file.traceImage', label: 'Trace a Blueprint Image…', group: 'File', run: () => traceImage(shell) },
    { id: 'file.export', label: 'Export…', group: 'File', keys: ['ctrl+shift+e'], run: () => shell.openDialog('export') },
    { id: 'project.settings', label: 'Project Settings…', group: 'File', run: () => shell.openDialog('project') },
    // Edit
    { id: 'edit.undo', label: 'Undo', group: 'Edit', keys: ['ctrl+z'], enabled: () => store.canUndo, run: () => void store.undo() },
    { id: 'edit.redo', label: 'Redo', group: 'Edit', keys: ['ctrl+shift+z', 'ctrl+y'], enabled: () => store.canRedo, run: () => void store.redo() },
    { id: 'edit.cut', label: 'Cut', group: 'Edit', keys: ['ctrl+x'], enabled: hasSelection, run: () => copySelection(shell, true) },
    { id: 'edit.copy', label: 'Copy', group: 'Edit', keys: ['ctrl+c'], enabled: hasSelection, run: () => copySelection(shell) },
    { id: 'edit.paste', label: 'Paste', group: 'Edit', keys: ['ctrl+v'], enabled: () => !!shell.clipboard.data, run: () => pasteClipboard(shell) },
    { id: 'edit.duplicate', label: 'Duplicate', group: 'Edit', keys: ['ctrl+d'], enabled: hasSelection, run: () => duplicateSelection(shell) },
    { id: 'edit.delete', label: 'Delete', group: 'Edit', keys: ['delete', 'backspace'], shortcut: 'Del', enabled: hasSelection, run: () => void deleteSelection(shell) },
    { id: 'edit.selectAll', label: 'Select All on Level', group: 'Edit', keys: ['ctrl+a'], run: () => selectAllOnLevel(shell) },
    {
      id: 'edit.mirrorStair',
      label: 'Mirror Stair (Flip Left ↔ Right)',
      group: 'Edit',
      keys: ['m'],
      enabled: () => selectedStairs(shell).length > 0,
      run: () => void flipSelectedStairs(shell, 'mirror'),
    },
    {
      id: 'edit.flipStairDirection',
      label: 'Flip Stair Direction (Up ↔ Down)',
      group: 'Edit',
      keys: ['shift+m'],
      enabled: () => selectedStairs(shell).length > 0,
      run: () => void flipSelectedStairs(shell, 'reverse'),
    },
    {
      id: 'edit.deselect',
      label: 'Deselect / Close',
      group: 'Edit',
      keys: ['escape'],
      run: () => {
        if (ui.get().inventoryOpen) ui.set({ inventoryOpen: false });
        else selection.clear();
      },
    },
    { id: 'snap.toggleGrid', label: 'Snap to Grid', group: 'Edit', keys: ['g'], run: toggle('snapGrid') },
    { id: 'snap.toggleObjects', label: 'Snap to Objects', group: 'Edit', run: toggle('snapObjects') },
    { id: 'snap.toggleAngle', label: 'Angle Snap (15°)', group: 'Edit', run: toggle('snapAngle') },
    // View
    { id: 'view.mode.plan', label: '2D Plan', group: 'View', run: () => ui.set({ viewMode: 'plan' }) },
    { id: 'view.mode.split', label: 'Split View', group: 'View', run: () => ui.set({ viewMode: 'split' }) },
    { id: 'view.mode.3d', label: '3D World', group: 'View', run: () => ui.set({ viewMode: '3d' }) },
    { id: 'view.cycle', label: 'Cycle Views', group: 'View', keys: ['tab'], when: focusOnCanvasOrBody, run: () => ui.set({ viewMode: nextViewMode(ui.get().viewMode) }) },
    { id: 'view.camera.fly', label: 'Fly Camera', group: 'View', run: () => ui.set({ cameraMode: 'fly' }) },
    { id: 'view.camera.orbit', label: 'Orbit Camera', group: 'View', run: () => ui.set({ cameraMode: 'orbit' }) },
    { id: 'view.frameAll', label: 'Zoom to Fit', group: 'View', run: () => ctx.events.emit('zoom-to', { ids: [] }) },
    { id: 'view.zoomSelection', label: 'Zoom to Selection', group: 'View', enabled: hasSelection, run: () => ctx.events.emit('zoom-to', { ids: [...selection.get()] }) },
    { id: 'view.shadows', label: 'Sun Shadows', group: 'View', run: toggle('shadows') },
    { id: 'view.showGrid', label: 'Show Grid', group: 'View', run: toggle('showGrid') },
    { id: 'view.levelBelow', label: 'Show Level Below', group: 'View', run: toggle('showLevelBelow') },
    { id: 'view.units', label: 'Toggle Metric / Imperial', group: 'View', run: () => setUnits(shell, ui.get().displayUnits === 'metric' ? 'imperial' : 'metric') },
    { id: 'view.leftPanel', label: 'Levels & Outliner Panel', group: 'View', run: () => shell.toggleSidebar('left') },
    { id: 'view.rightPanel', label: 'Properties Panel', group: 'View', run: () => shell.toggleSidebar('right') },
    { id: 'level.up', label: 'Level Up', group: 'View', keys: ['pageup'], enabled: () => !!adjacentLevelId(store.project, ui.get().activeLevelId, 1), run: setLevel(1) },
    { id: 'level.down', label: 'Level Down', group: 'View', keys: ['pagedown'], enabled: () => !!adjacentLevelId(store.project, ui.get().activeLevelId, -1), run: setLevel(-1) },
    // Build
    { id: 'inventory.toggle', label: 'Creative Inventory', group: 'Build', keys: ['e'], run: () => ui.set({ inventoryOpen: !ui.get().inventoryOpen }) },
    {
      id: 'level.add',
      label: 'Add Empty Level Above',
      group: 'Build',
      run: () => {
        const l = insertLevel(store, ui.get().activeLevelId, 'above');
        ui.set({ activeLevelId: l.id });
        shell.toast(`Added ${l.name}`, 'success');
      },
    },
    {
      id: 'level.addBelow',
      label: 'Add Empty Level Below',
      group: 'Build',
      run: () => {
        const l = insertLevel(store, ui.get().activeLevelId, 'below');
        ui.set({ activeLevelId: l.id });
        shell.toast(`Added ${l.name}`, 'success');
      },
    },
    ...QUICK_HOLD.filter((id) => getCatalogItem(id)).map(
      (id): Command => ({ id: `build.hold.${id}`, label: getCatalogItem(id)!.name, group: 'Build', run: () => holdCatalogItem(shell, id) }),
    ),
    // Export
    ...EXPORTERS.map((e): Command => ({ id: `export.${e.format}`, label: `${e.label}…`, group: 'Export', run: () => shell.openDialog('export', { format: e.format }) })),
    // Help
    { id: 'help', label: 'How to Play & Controls', group: 'Help', keys: ['f1', '?'], shortcut: 'F1', run: () => shell.openDialog('help') },
    { id: 'palette', label: 'Command Palette…', group: 'Help', keys: ['ctrl+k'], run: () => shell.openDialog('palette') },
    { id: 'help.welcome', label: 'Welcome Screen', group: 'Help', run: () => shell.openDialog('welcome') },
    { id: 'help.about', label: 'About Crafting', group: 'Help', run: () => shell.openDialog('about') },
  ];
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    list.push({ id: `hotbar.${i + 1}`, label: `Hotbar Slot ${i + 1}`, group: 'Build', keys: [String(i + 1)], run: () => ui.set({ hotbarIndex: i }) });
  }
  const offs = list.map((c) => commands.register(c));
  return () => offs.forEach((off) => off());
}

/** Change project display units (one undo step; ui.displayUnits follows the project setting). */
export function setUnits(shell: Shell, units: 'metric' | 'imperial'): void {
  const { store, ui } = shell.ctx;
  if (store.project.settings.units !== units) store.transact(`Units: ${units === 'metric' ? 'Metric' : 'Imperial'}`, (tx) => tx.updateSettings({ units }));
  ui.set({ displayUnits: units });
}

/** Menu structure for the shell's own commands ('-' = separator). Unlisted commands are appended. */
export const MENU_LAYOUT: Record<string, string[]> = {
  File: ['file.new', 'file.open', 'file.openSample', '-', 'file.save', 'file.saveAs', '-', 'file.importDXF', 'file.traceImage', '-', 'file.export', '-', 'project.settings'],
  Edit: ['edit.undo', 'edit.redo', '-', 'edit.cut', 'edit.copy', 'edit.paste', 'edit.duplicate', 'edit.delete', '-', 'edit.mirrorStair', 'edit.flipStairDirection', '-', 'edit.selectAll', 'edit.deselect', '-', 'snap.toggleGrid', 'snap.toggleObjects', 'snap.toggleAngle'],
  View: [
    'view.mode.plan',
    'view.mode.split',
    'view.mode.3d',
    'view.cycle',
    '-',
    'view.camera.fly',
    'view.camera.orbit',
    'view.toggleCamera',
    'view.resetCamera',
    'view.topView',
    '-',
    'view.frameAll',
    'view.zoomSelection',
    'view.frameSelection',
    'plan.zoomToFit',
    '-',
    'view.xray',
    'view.cutAway',
    'view.shadows',
    'view.showGrid',
    'view.levelBelow',
    '-',
    'level.up',
    'level.down',
    '-',
    'view.units',
    'view.leftPanel',
    'view.rightPanel',
  ],
  Build: [
    'inventory.toggle',
    '-',
    'build.generate3d',
    'build.addFloorAbove',
    'level.add',
    'level.addBelow',
    '-',
    'plan.calibrateUnderlay',
    'plan.toggleUnderlay',
    'plan.removeUnderlay',
    '-',
    ...QUICK_HOLD.map((id) => `build.hold.${id}`),
  ],
  Export: EXPORTERS.map((e) => `export.${e.format}`),
  Help: ['help', 'palette', '-', 'help.welcome', 'help.about'],
};

export const MENU_ORDER = ['File', 'Edit', 'View', 'Build', 'Export', 'Help'];

/** Commands never listed in menus (still in the palette unless also in PALETTE_HIDDEN). */
export const MENU_HIDDEN = new Set([...Array.from({ length: HOTBAR_SIZE }, (_, i) => `hotbar.${i + 1}`), 'plan.importUnderlay']);

/** Commands left out of the command palette (duplicates of friendlier entries). */
export const PALETTE_HIDDEN = new Set(['plan.importUnderlay', 'edit.deselect']);

/** Check-mark state for toggle commands. */
export function commandChecked(shell: Shell, id: string): boolean | undefined {
  const u = shell.ctx.ui.get();
  switch (id) {
    case 'snap.toggleGrid':
      return u.snapGrid;
    case 'snap.toggleObjects':
      return u.snapObjects;
    case 'snap.toggleAngle':
      return u.snapAngle;
    case 'view.mode.plan':
      return u.viewMode === 'plan';
    case 'view.mode.split':
      return u.viewMode === 'split';
    case 'view.mode.3d':
      return u.viewMode === '3d';
    case 'view.camera.fly':
      return u.cameraMode === 'fly';
    case 'view.camera.orbit':
      return u.cameraMode === 'orbit';
    case 'view.xray':
      return u.xray;
    case 'view.cutAway':
      return u.cutAboveActive;
    case 'view.shadows':
      return u.shadows;
    case 'view.showGrid':
      return u.showGrid;
    case 'view.levelBelow':
      return u.showLevelBelow;
    case 'view.leftPanel':
      return shell.isSidebarOpen('left');
    case 'view.rightPanel':
      return shell.isSidebarOpen('right');
    case 'inventory.toggle':
      return u.inventoryOpen;
    default:
      return undefined;
  }
}
