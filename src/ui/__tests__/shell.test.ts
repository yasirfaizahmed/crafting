// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../../app/context';
import { createSampleProject } from '../../app/sample';
import type { AppContext } from '../../app/state';
import type { Wall } from '../../core/types';
import type { PlanHandle } from '../../plan2d/types';
import type { ViewportHandle } from '../../view3d/types';
import { isModalOpen } from '../dialogs/modal';
import { mountApp } from '../shell';

interface StubView {
  resize: ReturnType<typeof vi.fn>;
  setActive: ReturnType<typeof vi.fn>;
  frame: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  container: HTMLElement | null;
}

function stubView(): StubView & PlanHandle {
  const v: StubView = { resize: vi.fn(), setActive: vi.fn(), frame: vi.fn(), dispose: vi.fn(), container: null };
  return v as StubView & PlanHandle;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function press(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

describe('mountApp', () => {
  let root: HTMLElement;
  let ctx: AppContext;
  let plan: ReturnType<typeof stubView>;
  let view: ReturnType<typeof stubView>;
  let dispose: () => void;

  beforeEach(() => {
    localStorage.clear();
    root = document.createElement('div');
    root.id = 'app';
    document.body.appendChild(root);
    ctx = createAppContext(createSampleProject());
    plan = stubView();
    view = stubView();
    const viewport = view as unknown as ViewportHandle & StubView;
    (viewport as unknown as { captureImage: () => Promise<Blob> }).captureImage = () => Promise.resolve(new Blob());
    dispose = mountApp(root, ctx, {
      showWelcome: false,
      autosave: false,
      mountPlan: (c) => {
        plan.container = c;
        return plan;
      },
      mountViewport: (c) => {
        view.container = c;
        return viewport;
      },
    });
  });

  afterEach(() => {
    dispose();
    root.remove();
    document.body.innerHTML = '';
  });

  it('builds the layout and gives each view its own container', () => {
    for (const sel of ['.cr-menubar', '.cr-toolbar', '.cr-sidebar.is-left', '.cr-sidebar.is-right', '.cr-views', '.cr-dock', '.cr-statusbar']) {
      expect(root.querySelector(sel), sel).not.toBeNull();
    }
    expect(plan.container?.classList.contains('cr-plan-host')).toBe(true);
    expect(view.container?.classList.contains('cr-v3d-host')).toBe(true);
    expect(root.querySelectorAll('.cr-dock .cr-slot')).toHaveLength(9);
    expect([...root.querySelectorAll('.cr-menu-title')].map((b) => b.textContent)).toEqual(['File', 'Edit', 'View', 'Build', 'Export', 'Help']);
    expect(document.title).toBe('Sample House — Crafting');
  });

  it('registers the global commands', () => {
    const ids = ctx.commands.all().map((c) => c.id);
    for (const id of ['file.new', 'file.open', 'file.save', 'file.saveAs', 'file.importDXF', 'file.export', 'edit.undo', 'edit.redo', 'edit.delete', 'edit.duplicate', 'edit.copy', 'edit.paste', 'edit.selectAll', 'view.mode.plan', 'view.mode.split', 'view.mode.3d', 'view.cycle', 'level.up', 'level.down', 'level.add', 'snap.toggleGrid', 'inventory.toggle', 'hotbar.1', 'hotbar.9', 'help', 'palette', 'project.settings']) {
      expect(ids, id).toContain(id);
    }
  });

  it('switching view modes hides the other view and pauses / resizes the handles', () => {
    ctx.ui.set({ viewMode: '3d' });
    expect(plan.container!.hidden).toBe(true);
    expect(view.container!.hidden).toBe(false);
    expect(plan.setActive).toHaveBeenLastCalledWith(false);
    expect(view.setActive).toHaveBeenLastCalledWith(true);
    expect(view.resize).toHaveBeenCalled();
    ctx.ui.set({ viewMode: 'plan' });
    expect(view.container!.hidden).toBe(true);
    expect(view.setActive).toHaveBeenLastCalledWith(false);
    expect(plan.setActive).toHaveBeenLastCalledWith(true);
    ctx.ui.set({ viewMode: 'split' });
    expect(plan.container!.hidden).toBe(false);
    expect(view.container!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.cr-divider')!.hidden).toBe(false);
  });

  it('dispatches global shortcuts: hotbar numbers, E inventory, Tab views, G snap, undo/redo', () => {
    press({ key: '5' });
    expect(ctx.ui.get().hotbarIndex).toBe(4);
    press({ key: 'e' });
    expect(ctx.ui.get().inventoryOpen).toBe(true);
    expect(root.querySelector<HTMLElement>('.cr-inv-layer')!.hidden).toBe(false);
    (document.activeElement as HTMLElement).blur();
    press({ key: 'e' });
    expect(ctx.ui.get().inventoryOpen).toBe(false);
    press({ key: 'Tab' });
    expect(ctx.ui.get().viewMode).toBe('3d');
    press({ key: 'g' });
    expect(ctx.ui.get().snapGrid).toBe(false);

    const wall = ctx.store.elements.find((e): e is Wall => e.type === 'wall')!;
    ctx.store.update(wall.id, { thickness: 333 });
    press({ key: 'z', ctrlKey: true });
    expect((ctx.store.getElement(wall.id) as Wall).thickness).toBe(wall.thickness);
    press({ key: 'y', ctrlKey: true });
    expect((ctx.store.getElement(wall.id) as Wall).thickness).toBe(333);
  });

  it('PageUp / PageDown switch levels; Delete removes the selection; Ctrl+D duplicates', () => {
    const [g, f] = ctx.store.project.levels;
    press({ key: 'PageUp' });
    expect(ctx.ui.get().activeLevelId).toBe(f.id);
    press({ key: 'PageDown' });
    expect(ctx.ui.get().activeLevelId).toBe(g.id);
    const furn = ctx.store.elementsOnLevel(g.id).find((e) => e.type === 'furniture')!;
    ctx.selection.set([furn.id]);
    const n = ctx.store.elements.length;
    press({ key: 'd', ctrlKey: true });
    expect(ctx.store.elements.length).toBe(n + 1);
    expect(ctx.selection.get()[0]).not.toBe(furn.id);
    press({ key: 'Delete' });
    expect(ctx.store.elements.length).toBe(n);
  });

  it('copy / paste offsets onto the active level in one undo step', () => {
    const wall = ctx.store.elementsOnLevel(ctx.ui.get().activeLevelId).find((e): e is Wall => e.type === 'wall')!;
    ctx.selection.set([wall.id]);
    press({ key: 'c', ctrlKey: true });
    const n = ctx.store.elements.length;
    press({ key: 'v', ctrlKey: true });
    expect(ctx.store.elements.length).toBeGreaterThan(n);
    const pasted = ctx.store.getElement(ctx.selection.get().find((id) => ctx.store.getElement(id)?.type === 'wall')!) as Wall;
    expect(pasted.start.x).toBe(wall.start.x + ctx.store.project.settings.gridSize);
    ctx.store.undo();
    expect(ctx.store.elements.length).toBe(n);
  });

  it('shows toasts from events, opens dialogs from open-dialog and blocks shortcuts behind modals', async () => {
    ctx.events.emit('toast', { message: 'Hello builder', kind: 'success' });
    expect(root.querySelector('.cr-toast.is-success')?.textContent).toContain('Hello builder');
    ctx.events.emit('open-dialog', { name: 'export' });
    expect(root.querySelector('.cr-export-modal')).not.toBeNull();
    expect(isModalOpen()).toBe(true);
    press({ key: '7' });
    expect(ctx.ui.get().hotbarIndex).not.toBe(6);
    press({ key: 'Escape' }, document.activeElement ?? document.body);
    expect(isModalOpen()).toBe(false);
    ctx.events.emit('open-dialog', { name: 'help' });
    expect(root.querySelector('.cr-help-modal')).not.toBeNull();
    press({ key: 'Escape' }, document.activeElement ?? document.body);
    ctx.events.emit('open-dialog', { name: 'project' });
    expect(root.querySelector('.cr-project-modal')).not.toBeNull();
    press({ key: 'Escape' }, document.activeElement ?? document.body);
    await flush();
  });

  it('marks the title dirty after edits and File → New asks for confirmation', async () => {
    const wall = ctx.store.elements.find((e) => e.type === 'wall')!;
    ctx.store.update(wall.id, { name: 'North wall' });
    expect(document.title).toBe('• Sample House — Crafting');
    expect(root.querySelector('.cr-doc-dirty')).not.toBeNull();
    void ctx.commands.run('file.new');
    await flush();
    const confirm = root.querySelector('.cr-confirm');
    expect(confirm).not.toBeNull();
    (confirm!.querySelector('.cr-btn.is-danger') as HTMLButtonElement).click();
    await flush();
    expect(ctx.store.project.info.name).toBe('Untitled Project');
    expect(Object.keys(ctx.store.project.elements)).toHaveLength(0);
    expect(document.title).toBe('Untitled Project — Crafting');
  });

  it('edits a selected wall through the properties panel (unit strings, one transaction)', async () => {
    const wall = ctx.store.elements.find((e): e is Wall => e.type === 'wall')!;
    ctx.selection.set([wall.id]);
    await flush();
    const input = root.querySelector<HTMLInputElement>('.cr-props [data-field="thickness"] input')!;
    expect(input.value).toBe(`${wall.thickness} mm`);
    input.focus();
    input.value = '0.32m';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect((ctx.store.getElement(wall.id) as Wall).thickness).toBe(320);
    expect(ctx.store.undoLabel).toBe('Edit wall thickness');
  });

  it('levels panel adds a level and the beforeunload guard follows the dirty flag', () => {
    const n = ctx.store.project.levels.length;
    root.querySelector<HTMLButtonElement>('.cr-levels-panel [aria-label="Add level above"]')!.click();
    expect(ctx.store.project.levels).toHaveLength(n + 1);
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
  });

  it('sidebars collapse and the right panel tabs switch', () => {
    const left = root.querySelector('.cr-toolbar [aria-label="Levels"]') as HTMLButtonElement;
    left.click();
    expect(root.classList.contains('has-left')).toBe(false);
    left.click();
    expect(root.classList.contains('has-left')).toBe(true);
    root.querySelector<HTMLButtonElement>('.cr-side-tab[data-tab="quantities"]')!.click();
    expect(root.querySelector<HTMLElement>('.cr-side-panel[data-tab="quantities"]')!.hidden).toBe(false);
    expect(root.querySelector<HTMLElement>('.cr-side-panel[data-tab="properties"]')!.hidden).toBe(true);
  });

  it('dispose removes the shell, unregisters commands and disposes the views', () => {
    dispose();
    expect(plan.dispose).toHaveBeenCalled();
    expect(view.dispose).toHaveBeenCalled();
    expect(root.querySelector('.cr-menubar')).toBeNull();
    expect(ctx.commands.get('file.new')).toBeUndefined();
    dispose = () => undefined;
  });
});
