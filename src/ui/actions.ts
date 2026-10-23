/**
 * User-level actions shared by commands, menus, dialogs and panels.
 */
import { createSampleProject } from '../app/sample';
import { getCatalogItem } from '../core/catalog';
import { createProject } from '../core/defaults';
import { mirrorStair, reverseStair } from '../core/stairs';
import type { Project, Stair } from '../core/types';
import { getLevel } from '../core/walls';
import { openProjectFile, saveProjectFile } from '../io';
import { copyElements, duplicateElements, pasteOffset, preparePaste } from './clipboard';
import { holdItem, setSlot } from './hotbar-model';
import { pluralize } from './format';
import type { Shell } from './types';

/** Ask before discarding unsaved edits. Resolves true when it is OK to continue. */
export async function confirmDiscard(shell: Shell, action = 'continue'): Promise<boolean> {
  if (!shell.ctx.store.isDirty) return true;
  return shell.confirm({
    title: 'Discard unsaved changes?',
    message: `“${shell.ctx.store.project.info.name}” has changes that are not saved to a file. Do you want to ${action} anyway? (The autosave keeps your latest session.)`,
    confirmLabel: 'Discard changes',
    danger: true,
  });
}

/** Replace the open project and reset view state. */
export function loadProject(shell: Shell, project: Project): void {
  const { ctx } = shell;
  ctx.selection.clear();
  ctx.store.load(project);
  const ground = project.levels.find((l) => l.elevation >= 0) ?? project.levels[0];
  ctx.ui.set({ activeLevelId: ground.id, displayUnits: project.settings.units, toolHint: '' });
  shell.clipboard.pastes = 0;
  // Let the views rebuild first, then frame everything.
  setTimeout(() => ctx.events.emit('zoom-to', { ids: [] }), 50);
}

export type StartMode = 'plan' | '3d';

/** New empty project, optionally prepared for blueprint drawing or 3D building. */
export async function newProject(shell: Shell, mode?: StartMode, skipConfirm = false): Promise<boolean> {
  if (!skipConfirm && !(await confirmDiscard(shell, 'start a new project'))) return false;
  const { ctx } = shell;
  loadProject(shell, createProject('Untitled Project'));
  if (mode === 'plan') {
    const ui = ctx.ui.get();
    const slot = ui.hotbar.findIndex((id) => getCatalogItem(id)?.tool === 'wall');
    const next = slot >= 0 ? { hotbar: ui.hotbar, hotbarIndex: slot } : { hotbar: setSlot(ui.hotbar, ui.hotbarIndex, 'wall-200'), hotbarIndex: ui.hotbarIndex };
    ctx.ui.set({ viewMode: 'plan', ...next, toolHint: 'Wall tool: click to start a wall, click again to chain · Esc to finish · type a length for exact walls' });
    shell.toast('Blank blueprint ready — draw walls on the plan, then use Build → Generate 3D.', 'info');
  } else if (mode === '3d') {
    const ui = ctx.ui.get();
    const slot = ui.hotbar.findIndex((id) => getCatalogItem(id)?.tool === 'block');
    ctx.ui.set({ viewMode: '3d', cameraMode: 'walk', hotbarIndex: slot >= 0 ? slot : ui.hotbarIndex, toolHint: 'Walk mode: click the 3D view · WASD walk · Space jump · double-tap Space to fly · F orbit' });
    shell.toast('Welcome to the 3D world! Click the view to walk — right-click places, left-click breaks, double-tap Space to fly. Press E for the inventory.', 'info');
  } else shell.toast('New project created', 'success');
  return true;
}

export async function openSample(shell: Shell): Promise<void> {
  if (!(await confirmDiscard(shell, 'open the sample house'))) return;
  loadProject(shell, createSampleProject());
  shell.toast('Opened the Sample House', 'success');
}

export async function openProject(shell: Shell): Promise<void> {
  if (!(await confirmDiscard(shell, 'open another project'))) return;
  try {
    const res = await openProjectFile();
    if (!res) return;
    loadProject(shell, res.project);
    shell.toast(`Opened ${res.fileName}`, 'success');
  } catch (err) {
    shell.toast(`Could not open the file: ${errorMessage(err)}`, 'error');
  }
}

export async function saveProject(shell: Shell, saveAs = false): Promise<boolean> {
  const { store } = shell.ctx;
  try {
    const ok = await saveProjectFile(store.snapshot(), { saveAs });
    if (ok) {
      store.markSaved();
      shell.toast(`Saved “${store.project.info.name}”`, 'success');
      shell.refresh();
    }
    return ok;
  } catch (err) {
    shell.toast(`Save failed: ${errorMessage(err)}`, 'error');
    return false;
  }
}

/** Run the plan editor's underlay import (registered by plan2d as `plan.importUnderlay`). */
export async function traceImage(shell: Shell): Promise<void> {
  const { ctx } = shell;
  const cmd = ctx.commands.get('plan.importUnderlay');
  if (!cmd) {
    shell.toast('Blueprint image tracing is not available in this build.', 'warning');
    return;
  }
  if (ctx.ui.get().viewMode === '3d') ctx.ui.set({ viewMode: 'split' });
  try {
    await ctx.commands.run('plan.importUnderlay');
  } catch (err) {
    shell.toast(`Could not load the image: ${errorMessage(err)}`, 'error');
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// -----------------------------------------------------------------------------
// Selection actions
// -----------------------------------------------------------------------------

export function deleteSelection(shell: Shell): number {
  const { store, selection } = shell.ctx;
  const ids = selection.get().filter((id) => store.getElement(id));
  const locked = ids.filter((id) => store.getElement(id)?.locked);
  const removable = ids.filter((id) => !store.getElement(id)?.locked);
  if (locked.length) shell.toast(`${pluralize(locked.length, 'locked element')} kept — unlock to delete`, 'warning');
  if (!removable.length) return 0;
  store.remove(removable, removable.length === 1 ? `Delete ${store.getElement(removable[0])!.type}` : `Delete ${removable.length} elements`);
  selection.clear();
  return removable.length;
}

/** Selected, unlocked stairs. */
export function selectedStairs(shell: Shell): Stair[] {
  const { store, selection } = shell.ctx;
  return selection
    .get()
    .map((id) => store.getElement(id))
    .filter((e): e is Stair => e?.type === 'stair' && !e.locked);
}

/**
 * Flip the selected stairs in place: 'mirror' swaps left and right (the mirror image),
 * 'reverse' swaps which end goes up. One undo step. Returns how many stairs changed.
 */
export function flipSelectedStairs(shell: Shell, mode: 'mirror' | 'reverse'): number {
  const { store } = shell.ctx;
  const stairs = selectedStairs(shell);
  if (!stairs.length) {
    shell.toast('Select a stair first', 'info');
    return 0;
  }
  const label = `${mode === 'mirror' ? 'Mirror' : 'Flip direction of'} ${stairs.length === 1 ? 'stair' : `${stairs.length} stairs`}`;
  store.transact(label, (tx) => {
    for (const s of stairs) {
      const height = getLevel(store.project, s.levelId)?.height ?? store.project.settings.levelHeight;
      tx.replace(mode === 'mirror' ? mirrorStair(s, height) : reverseStair(s, height));
    }
  });
  return stairs.length;
}

export function selectAllOnLevel(shell: Shell): void {
  const { store, ui, selection } = shell.ctx;
  selection.set(store.elementsOnLevel(ui.get().activeLevelId).filter((e) => !e.hidden).map((e) => e.id));
}

export function copySelection(shell: Shell, cut = false): void {
  const { store, selection } = shell.ctx;
  const data = copyElements(store.project, selection.get());
  if (!data) {
    shell.toast('Nothing selected to copy', 'info');
    return;
  }
  shell.clipboard.data = data;
  shell.clipboard.pastes = 0;
  if (cut) {
    const removed = deleteSelection(shell);
    shell.toast(`Cut ${pluralize(removed, 'element')}`, 'info');
  } else shell.toast(`Copied ${pluralize(data.elements.length, 'element')}`, 'info');
}

export function pasteClipboard(shell: Shell): void {
  const { store, ui, selection } = shell.ctx;
  const data = shell.clipboard.data;
  if (!data) {
    shell.toast('Clipboard is empty — select something and press Ctrl+C', 'info');
    return;
  }
  const levelId = ui.get().activeLevelId;
  shell.clipboard.pastes += levelId === data.sourceLevelId ? 1 : 0;
  const els = preparePaste(store.project, data, { levelId, offset: pasteOffset(data, levelId, store.project.settings.gridSize, shell.clipboard.pastes) });
  if (!els.length) {
    shell.toast('Nothing could be pasted here', 'warning');
    return;
  }
  store.transact(`Paste ${pluralize(els.length, 'element')}`, (tx) => els.forEach((e) => tx.add(e)));
  selection.set(els.map((e) => e.id));
}

export function duplicateSelection(shell: Shell): void {
  const { store, selection } = shell.ctx;
  const els = duplicateElements(store.project, selection.get(), store.project.settings.gridSize);
  if (!els.length) {
    shell.toast('Select something to duplicate', 'info');
    return;
  }
  store.transact(`Duplicate ${pluralize(els.length, 'element')}`, (tx) => els.forEach((e) => tx.add(e)));
  selection.set(els.map((e) => e.id));
}

/** Put a catalog item in hand (select its slot or replace the current one). */
export function holdCatalogItem(shell: Shell, itemId: string): void {
  const ui = shell.ctx.ui.get();
  shell.ctx.ui.set({ ...holdItem(ui, itemId), toolHint: '' });
}
