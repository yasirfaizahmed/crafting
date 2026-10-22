/**
 * Application shell: layout, menus, hotbar, inventory, panels, dialogs and keyboard.
 *
 *   mountApp(root, ctx) → () => void (dispose)
 *
 * NOTE: phase-0 baseline (top bar + split views + plain hotbar). The ui owner replaces it.
 */
import { activeItem, type AppContext } from '../app/state';
import { getCatalogItem } from '../core/catalog';
import { mountPlanEditor } from '../plan2d';
import { mountViewport } from '../view3d';

export function mountApp(root: HTMLElement, ctx: AppContext): () => void {
  root.innerHTML = `
    <header class="topbar"><strong>Crafting</strong><span class="spacer"></span>
      <button data-act="undo">Undo</button><button data-act="redo">Redo</button></header>
    <main class="views"><section class="view plan"></section><section class="view v3d"></section></main>
    <footer class="hotbar"></footer>`;
  const plan = mountPlanEditor(root.querySelector('.plan')!, ctx);
  const viewport = mountViewport(root.querySelector('.v3d')!, ctx);
  const hotbar = root.querySelector<HTMLElement>('.hotbar')!;
  const renderHotbar = () => {
    const ui = ctx.ui.get();
    hotbar.innerHTML = ui.hotbar
      .map((id, i) => {
        const it = getCatalogItem(id);
        return `<button class="slot ${i === ui.hotbarIndex ? 'active' : ''}" data-i="${i}" title="${it?.name ?? ''}">${it?.icon ?? ''}<small>${i + 1}</small></button>`;
      })
      .join('');
    root.querySelector('.topbar strong')!.textContent = `Crafting — ${activeItem(ui).name}`;
  };
  hotbar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (b) ctx.ui.set({ hotbarIndex: Number(b.dataset.i) });
  });
  root.querySelector('[data-act=undo]')!.addEventListener('click', () => ctx.store.undo());
  root.querySelector('[data-act=redo]')!.addEventListener('click', () => ctx.store.redo());
  const unsub = ctx.ui.subscribe(renderHotbar);
  renderHotbar();
  return () => {
    unsub();
    plan.dispose();
    viewport.dispose();
  };
}
