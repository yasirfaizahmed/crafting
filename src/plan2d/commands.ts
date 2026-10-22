/**
 * Commands the plan editor registers in the shared registry (menus, palette, toolbar).
 */
import { addFloorAbove, generate3D, type AddFloorOptions, type Generate3DSummary } from '../core/autobuild';
import type { LevelUnderlay } from '../core/types';
import { pickImageFile } from '../io';
import type { PlanEditor } from './editor';
import { initialUnderlay } from './underlay';

export function runGenerate3D(ed: PlanEditor): Generate3DSummary {
  const opts = { ...ed.generateOptions, levelIds: ed.generateScope === 'active' ? [ed.levelId] : undefined };
  const s = generate3D(ed.app.store, opts);
  const made = s.rooms + s.floors + s.ceilings + s.foundations + s.roofs;
  ed.toast(made ? `${s.message}${s.replaced ? ` (replaced ${s.replaced})` : ''}` : s.message, made ? 'success' : 'warning');
  return s;
}

export function runAddFloor(ed: PlanEditor, copy: AddFloorOptions['copy'] = 'exterior'): string {
  const res = addFloorAbove(ed.app.store, ed.levelId, { copy });
  ed.app.ui.set({ activeLevelId: res.levelId });
  const level = ed.app.store.getLevel(res.levelId);
  const what = copy === 'none' ? 'empty' : `${res.walls} wall${res.walls === 1 ? '' : 's'}${res.openings ? `, ${res.openings} opening${res.openings === 1 ? '' : 's'}` : ''}`;
  ed.toast(`Added ${level?.name ?? 'level'} (${what})`, 'success');
  return res.levelId;
}

export async function importUnderlay(ed: PlanEditor): Promise<boolean> {
  let img: Awaited<ReturnType<typeof pickImageFile>>;
  try {
    img = await pickImageFile();
  } catch {
    ed.toast('Could not read that image', 'error');
    return false;
  }
  if (!img) return false;
  placeUnderlay(ed, img);
  return true;
}

/** Put an image on the active level and start calibration. */
export function placeUnderlay(ed: PlanEditor, img: { dataUrl: string; width: number; height: number }): void {
  const u = initialUnderlay(img, ed.view.visibleBounds());
  ed.transact('Import blueprint image', (tx) => tx.updateLevel(ed.levelId, { underlay: u }));
  ed.toast('Blueprint placed — click two points of a known distance to set its scale', 'info');
  ed.startCalibration();
}

export function setUnderlay(ed: PlanEditor, patch: Partial<LevelUnderlay>, label: string): void {
  const u = ed.level.underlay;
  if (!u) return;
  ed.transact(label, (tx) => tx.updateLevel(ed.levelId, { underlay: { ...u, ...patch } }));
}

export function registerPlanCommands(ed: PlanEditor): () => void {
  const c = ed.app.commands;
  const planFocused = () => ed.hovered || document.activeElement === ed.root;
  const offs = [
    c.register({ id: 'build.generate3d', label: 'Generate 3D from Blueprint', group: 'Build', run: () => void runGenerate3D(ed) }),
    c.register({ id: 'build.addFloorAbove', label: 'Add Floor Above', group: 'Build', run: () => void runAddFloor(ed, 'exterior') }),
    c.register({ id: 'plan.importUnderlay', label: 'Trace Blueprint Image…', group: 'Build', run: () => importUnderlay(ed).then(() => undefined) }),
    c.register({
      id: 'plan.calibrateUnderlay',
      label: 'Calibrate Blueprint Image',
      group: 'Build',
      enabled: () => !!ed.level.underlay,
      run: () => ed.startCalibration(),
    }),
    c.register({
      id: 'plan.toggleUnderlay',
      label: 'Show / Hide Blueprint Image',
      group: 'Build',
      enabled: () => !!ed.level.underlay,
      run: () => setUnderlay(ed, { visible: !ed.level.underlay?.visible }, 'Toggle blueprint image'),
    }),
    c.register({
      id: 'plan.removeUnderlay',
      label: 'Remove Blueprint Image',
      group: 'Build',
      enabled: () => !!ed.level.underlay,
      run: () => ed.transact('Remove blueprint image', (tx) => tx.updateLevel(ed.levelId, { underlay: undefined })),
    }),
    c.register({ id: 'plan.zoomToFit', label: 'Zoom Plan to Fit', group: 'View', shortcut: 'Home', keys: ['home'], when: planFocused, run: () => ed.zoomToFit() }),
  ];
  return () => offs.forEach((off) => off());
}
