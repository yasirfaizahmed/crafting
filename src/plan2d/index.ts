/**
 * 2D blueprint (floor plan) editor.
 *
 *   mountPlanEditor(container, ctx) → PlanHandle
 *
 * NOTE: phase-0 baseline: draws wall footprints of the active level. The plan2d owner replaces
 * this with the full editor keeping the exported signature.
 */
import type { AppContext } from '../app/state';
import { computeWallFootprints } from '../core/walls';
import type { PlanHandle } from './types';

export type { PlanHandle } from './types';

export function mountPlanEditor(container: HTMLElement, ctx: AppContext): PlanHandle {
  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.appendChild(canvas);
  const g = canvas.getContext('2d')!;
  let active = true;
  const draw = () => {
    if (!active) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, container.clientWidth, container.clientHeight);
    const s = 0.05; // px per mm
    g.translate(container.clientWidth / 2, container.clientHeight / 2);
    g.fillStyle = '#333';
    for (const fp of computeWallFootprints(ctx.store.project, ctx.ui.get().activeLevelId).values()) {
      g.beginPath();
      fp.polygon.forEach((p, i) => (i ? g.lineTo(p.x * s, -p.y * s) : g.moveTo(p.x * s, -p.y * s)));
      g.closePath();
      g.fill();
    }
  };
  const unsubs = [ctx.store.subscribe(draw), ctx.ui.subscribe(draw)];
  const ro = new ResizeObserver(draw);
  ro.observe(container);
  return {
    resize: draw,
    setActive(a) {
      active = a;
      draw();
    },
    frame: draw,
    dispose() {
      unsubs.forEach((u) => u());
      ro.disconnect();
      canvas.remove();
    },
  };
}
