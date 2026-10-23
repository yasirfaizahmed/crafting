/**
 * Shell layout: menubar, toolbar, collapsible sidebars, the centre views (plan | divider | 3D) with
 * a draggable split, the hotbar dock and the status bar. Pure DOM; components mount into the hosts.
 */
import type { ViewMode } from '../app/state';
import { h, prefs } from './dom';
import type { SidebarSide } from './types';

export interface LayoutHosts {
  menubar: HTMLElement;
  toolbar: HTMLElement;
  left: HTMLElement;
  right: HTMLElement;
  center: HTMLElement;
  views: HTMLElement;
  plan: HTMLElement;
  view3d: HTMLElement;
  divider: HTMLElement;
  dock: HTMLElement;
  status: HTMLElement;
}

export interface Layout extends LayoutHosts {
  setViewMode(mode: ViewMode): void;
  /** Plan share of the split view (0..1). */
  splitRatio(): number;
  setSplitRatio(ratio: number, persist?: boolean): void;
  toggleSidebar(side: SidebarSide, open?: boolean): boolean;
  isSidebarOpen(side: SidebarSide): boolean;
  /** Called (once per frame at most) whenever the view area changes size. */
  onViewsResize(fn: () => void): () => void;
  dispose(): void;
}

export const MIN_SPLIT = 0.2;
export const MAX_SPLIT = 0.8;

export function clampSplit(r: number): number {
  return Number.isFinite(r) ? Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, r)) : 0.5;
}

/**
 * Sidebars start closed on narrow screens unless the user opened them before. The inspector
 * (right) docks by default only on wide screens so the split plan + 3D views keep room to work.
 */
function initialSidebar(side: SidebarSide): boolean {
  const saved = prefs.get<boolean | null>(`sidebar.${side}`, null);
  if (saved !== null) return saved;
  const w = typeof window !== 'undefined' ? window.innerWidth || 1440 : 1440;
  return side === 'left' ? w >= 900 : w >= 1600;
}

export function createLayout(root: HTMLElement): Layout {
  const menubar = h('header', { class: 'cr-menubar' });
  const toolbar = h('div', { class: 'cr-toolbar' });
  const left = h('aside', { class: 'cr-sidebar is-left', 'aria-label': 'Levels and outliner' });
  const right = h('aside', { class: 'cr-sidebar is-right', 'aria-label': 'Properties and quantities' });
  const plan = h('section', { class: 'cr-view-host cr-plan-host', 'aria-label': '2D plan view', 'data-view': 'plan' });
  const view3d = h('section', { class: 'cr-view-host cr-v3d-host', 'aria-label': '3D view', 'data-view': '3d' });
  const divider = h('div', {
    class: 'cr-divider',
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': 'Resize plan and 3D views',
    'aria-valuemin': String(MIN_SPLIT * 100),
    'aria-valuemax': String(MAX_SPLIT * 100),
    tabindex: '0',
    title: 'Drag to resize · double-click to reset',
  });
  const views = h('div', { class: 'cr-views' }, plan, divider, view3d);
  const dock = h('div', { class: 'cr-dock' });
  const center = h('main', { class: 'cr-center' }, views, dock);
  const scrim = h('div', { class: 'cr-scrim', 'aria-hidden': 'true' });
  const workspace = h('div', { class: 'cr-workspace' }, left, center, right, scrim);
  const status = h('footer', { class: 'cr-statusbar' });
  root.append(menubar, toolbar, workspace, status);

  const open: Record<SidebarSide, boolean> = { left: initialSidebar('left'), right: initialSidebar('right') };
  let ratio = clampSplit(prefs.get('splitRatio', 0.5));
  const resizeListeners = new Set<() => void>();
  let frame = 0;
  const notify = () => {
    if (frame) return;
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb: FrameRequestCallback) => setTimeout(() => cb(0), 16) as unknown as number;
    frame = raf(() => {
      frame = 0;
      resizeListeners.forEach((fn) => fn());
    });
  };

  const applySidebars = () => {
    root.classList.toggle('has-left', open.left);
    root.classList.toggle('has-right', open.right);
    left.toggleAttribute('inert', !open.left);
    right.toggleAttribute('inert', !open.right);
    left.setAttribute('aria-hidden', String(!open.left));
    right.setAttribute('aria-hidden', String(!open.right));
  };
  const applyRatio = () => {
    views.style.setProperty('--cr-split-plan', String(ratio));
    views.style.setProperty('--cr-split-3d', String(1 - ratio));
    divider.setAttribute('aria-valuenow', String(Math.round(ratio * 100)));
  };
  applySidebars();
  applyRatio();

  // Narrow screens: sidebars float over the views; tapping the scrim closes them.
  scrim.addEventListener('pointerdown', () => {
    if (open.left) layout.toggleSidebar('left', false);
    if (open.right) layout.toggleSidebar('right', false);
  });

  // --- split divider -----------------------------------------------------------
  let drag: { id: number } | null = null;
  divider.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    drag = { id: e.pointerId };
    divider.setPointerCapture?.(e.pointerId);
    root.classList.add('is-resizing');
  });
  divider.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const r = views.getBoundingClientRect();
    if (r.width <= 0) return;
    layout.setSplitRatio((e.clientX - r.left) / r.width, false);
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag) return;
    divider.releasePointerCapture?.(e.pointerId);
    drag = null;
    root.classList.remove('is-resizing');
    prefs.set('splitRatio', ratio);
  };
  divider.addEventListener('pointerup', endDrag);
  divider.addEventListener('pointercancel', endDrag);
  divider.addEventListener('dblclick', () => layout.setSplitRatio(0.5));
  divider.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = ratio - step;
    else if (e.key === 'ArrowRight') next = ratio + step;
    else if (e.key === 'Home') next = MIN_SPLIT;
    else if (e.key === 'End') next = MAX_SPLIT;
    else if (e.key === 'Enter') next = 0.5;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    layout.setSplitRatio(next);
  });

  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(notify);
    ro.observe(views);
  }
  const onWinResize = () => notify();
  window.addEventListener('resize', onWinResize);

  const layout: Layout = {
    menubar,
    toolbar,
    left,
    right,
    center,
    views,
    plan,
    view3d,
    divider,
    dock,
    status,
    setViewMode(mode) {
      views.dataset.view = mode;
      root.dataset.view = mode;
      plan.hidden = mode === '3d';
      view3d.hidden = mode === 'plan';
      divider.hidden = mode !== 'split';
      notify();
    },
    splitRatio: () => ratio,
    setSplitRatio(r, persist = true) {
      const next = clampSplit(r);
      if (Math.abs(next - ratio) < 1e-4) return;
      ratio = next;
      applyRatio();
      if (persist) prefs.set('splitRatio', ratio);
      notify();
    },
    toggleSidebar(side, value) {
      const next = value ?? !open[side];
      if (next === open[side]) return next;
      open[side] = next;
      prefs.set(`sidebar.${side}`, next);
      applySidebars();
      notify();
      return next;
    },
    isSidebarOpen: (side) => open[side],
    onViewsResize(fn) {
      resizeListeners.add(fn);
      return () => resizeListeners.delete(fn);
    },
    dispose() {
      ro?.disconnect();
      window.removeEventListener('resize', onWinResize);
      if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
      resizeListeners.clear();
      menubar.remove();
      toolbar.remove();
      workspace.remove();
      status.remove();
    },
  };
  return layout;
}
