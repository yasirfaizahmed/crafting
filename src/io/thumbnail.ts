/** Tiny plan thumbnail (PNG data URL) for the recent-projects list. Browser only. */
import { getMaterial } from '../core/materials';
import type { Project, Vec2 } from '../core/types';
import { computeWallFootprints } from '../core/walls';

/** Draws the level with the most walls; returns undefined where no 2D canvas is available. */
export function planThumbnail(project: Project, width = 240, height = 160): string | undefined {
  if (typeof document === 'undefined' || /jsdom/i.test(globalThis.navigator?.userAgent ?? '')) return undefined;
  const els = Object.values(project.elements);
  const level = [...project.levels].sort((a, b) => els.filter((e) => e.type === 'wall' && e.levelId === b.id).length - els.filter((e) => e.type === 'wall' && e.levelId === a.id).length)[0];
  if (!level) return undefined;
  const fps = [...computeWallFootprints(project, level.id).values()].map((f) => f.polygon);
  const slabs = els.flatMap((e) => (e.levelId === level.id && e.type === 'slab' && e.kind !== 'ceiling' ? [e.outline] : []));
  const rooms = els.flatMap((e) => (e.levelId === level.id && e.type === 'room' ? [{ outline: e.outline, color: getMaterial(e.floorMaterialId ?? 'wood-floor-oak').color }] : []));
  const pts = [...fps.flat(), ...slabs.flat()];
  if (!pts.length) return undefined;
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const pad = 10;
  const s = Math.min((width - 2 * pad) / Math.max(maxX - minX, 1), (height - 2 * pad) / Math.max(maxY - minY, 1));
  const ox = (width - (maxX - minX) * s) / 2;
  const oy = (height - (maxY - minY) * s) / 2;
  let canvas: HTMLCanvasElement;
  let g: CanvasRenderingContext2D | null;
  try {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    g = canvas.getContext('2d');
  } catch {
    return undefined;
  }
  if (!g) return undefined;
  const ctx = g;
  const path = (poly: Vec2[]) => {
    ctx.beginPath();
    poly.forEach((p, i) => {
      const x = ox + (p.x - minX) * s;
      const y = height - (oy + (p.y - minY) * s);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
  };
  ctx.fillStyle = '#f6f4ef';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#e4e1da';
  for (const sl of slabs) {
    path(sl);
    ctx.fill();
  }
  ctx.globalAlpha = 0.45;
  for (const r of rooms) {
    ctx.fillStyle = r.color;
    path(r.outline);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#2b2d31';
  for (const f of fps) {
    path(f);
    ctx.fill();
  }
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return undefined;
  }
}
