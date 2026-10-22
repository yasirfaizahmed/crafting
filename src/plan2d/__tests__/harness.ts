/**
 * jsdom harness: mounts the plan editor headless and drives it with synthetic DOM events.
 */
import { createAppContext } from '../../app/context';
import type { AppContext } from '../../app/state';
import { createElement, createProject } from '../../core/defaults';
import type { Project, Vec2, Wall } from '../../core/types';
import type { PlanEditor } from '../editor';
import { createPlanEditor, type MountedPlan } from '../index';

export interface Harness {
  ctx: AppContext;
  ed: PlanEditor;
  plan: MountedPlan;
  /** Keys that reached window (i.e. were NOT consumed by the plan). */
  leaked: string[];
  hold(itemId: string, slot?: number): void;
  move(x: number, y: number, opts?: MouseOpts): void;
  down(x: number, y: number, opts?: MouseOpts): void;
  up(x: number, y: number, opts?: MouseOpts): void;
  click(x: number, y: number, opts?: MouseOpts): void;
  dbl(x: number, y: number): void;
  drag(from: Vec2, to: Vec2, opts?: MouseOpts): void;
  key(key: string, opts?: KeyboardEventInit): void;
  type(text: string): void;
  dispose(): void;
}

interface MouseOpts {
  button?: number;
  shift?: boolean;
}

export function rectWalls(p: Project, x0: number, y0: number, x1: number, y1: number, thickness = 200): Wall[] {
  const pts: Vec2[] = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  const walls = pts.map((q, i) => createElement('wall', p.levels[0].id, { start: q, end: pts[(i + 1) % 4], thickness }));
  for (const w of walls) p.elements[w.id] = w;
  return walls;
}

export function mount(project: Project = createProject()): Harness {
  const ctx = createAppContext(project);
  const container = document.createElement('div');
  document.body.appendChild(container);
  const plan = createPlanEditor(container, ctx, { headless: true });
  const ed = plan.editor;
  ed.view.setSize(1200, 900);
  ed.view.scale = 0.1;
  ed.view.center = { x: 4000, y: 2000 };
  const canvas = ed.canvas;
  const leaked: string[] = [];
  const onWinKey = (e: KeyboardEvent) => leaked.push(e.key);
  window.addEventListener('keydown', onWinKey);

  const fire = (type: string, x: number, y: number, o: MouseOpts = {}) => {
    const s = ed.view.toScreen({ x, y });
    const button = o.button ?? 0;
    canvas.dispatchEvent(
      new MouseEvent(type, { clientX: s.x, clientY: s.y, button, buttons: type === 'pointerup' ? 0 : 1 << button, shiftKey: !!o.shift, bubbles: true, cancelable: true }),
    );
  };
  const h: Harness = {
    ctx,
    ed,
    plan,
    leaked,
    hold(itemId, slot = 2) {
      const hotbar = [...ctx.ui.get().hotbar];
      hotbar[slot] = itemId;
      ctx.ui.set({ hotbar, hotbarIndex: slot });
    },
    move: (x, y, o) => fire('pointermove', x, y, o),
    down: (x, y, o) => fire('pointerdown', x, y, o),
    up: (x, y, o) => fire('pointerup', x, y, o),
    click(x, y, o) {
      fire('pointermove', x, y, o);
      fire('pointerdown', x, y, o);
      fire('pointerup', x, y, o);
    },
    dbl(x, y) {
      h.click(x, y);
      h.click(x, y);
      fire('dblclick', x, y);
    },
    drag(from, to, o) {
      fire('pointermove', from.x, from.y, o);
      fire('pointerdown', from.x, from.y, o);
      for (let i = 1; i <= 5; i++) fire('pointermove', from.x + ((to.x - from.x) * i) / 5, from.y + ((to.y - from.y) * i) / 5, o);
      fire('pointerup', to.x, to.y, o);
    },
    key(key, opts = {}) {
      const target = (document.activeElement as HTMLElement | null) ?? ed.root;
      const t = ed.root.contains(target) ? target : ed.root;
      t.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts }));
      t.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true, ...opts }));
    },
    type(text) {
      for (const ch of text) h.key(ch);
    },
    dispose() {
      window.removeEventListener('keydown', onWinKey);
      plan.dispose();
      container.remove();
    },
  };
  ed.root.focus();
  return h;
}
