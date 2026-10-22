/**
 * Blueprint image tracing: image cache, placement / calibration math (pure) and the import flow.
 */
import { distance, type Bounds2 } from '../core/math2d';
import type { LevelUnderlay, Vec2 } from '../core/types';

/** Decoded underlay images by data URL; calls `onLoad` when one becomes drawable. */
export class UnderlayImages {
  private map = new Map<string, HTMLImageElement>();

  constructor(private onLoad: () => void) {}

  get(src: string): HTMLImageElement | null {
    let img = this.map.get(src);
    if (!img) {
      if (typeof Image === 'undefined') return null;
      img = new Image();
      img.onload = () => this.onLoad();
      img.src = src;
      this.map.set(src, img);
      while (this.map.size > 8) this.map.delete(this.map.keys().next().value as string);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }

  size(src: string): { w: number; h: number } | null {
    const img = this.get(src);
    return img ? { w: img.naturalWidth, h: img.naturalHeight } : null;
  }
}

/** Place a freshly imported image centred in the visible area at ~80% of its width. */
export function initialUnderlay(img: { dataUrl: string; width: number; height: number }, view: Bounds2): LevelUnderlay {
  const vw = Math.max(1000, view.maxX - view.minX);
  const vh = Math.max(1000, view.maxY - view.minY);
  const fit = Math.min((vw * 0.8) / Math.max(1, img.width), (vh * 0.8) / Math.max(1, img.height));
  // Round to 2 significant digits so the initial scale is a tidy number.
  const pow = Math.pow(10, Math.floor(Math.log10(fit)) - 1);
  const mpp = Math.max(0.01, Math.round(fit / pow) * pow);
  const w = img.width * mpp;
  const h = img.height * mpp;
  const cx = (view.minX + view.maxX) / 2;
  const cy = (view.minY + view.maxY) / 2;
  return { src: img.dataUrl, x: Math.round(cx - w / 2), y: Math.round(cy + h / 2), mmPerPixel: mpp, rotation: 0, opacity: 0.5, visible: true };
}

/**
 * Two-point calibration: scale the underlay about `a` so that the model distance a→b becomes
 * `realDistance` mm.
 */
export function calibrateUnderlay(u: LevelUnderlay, a: Vec2, b: Vec2, realDistance: number): LevelUnderlay {
  const cur = distance(a, b);
  if (!(cur > 0) || !(realDistance > 0)) return u;
  const k = realDistance / cur;
  return { ...u, mmPerPixel: u.mmPerPixel * k, x: a.x + (u.x - a.x) * k, y: a.y + (u.y - a.y) * k };
}

/** Plan position of an image pixel (u, v), v growing downwards. */
export function underlayPoint(u: LevelUnderlay, px: number, py: number): Vec2 {
  const r = (u.rotation * Math.PI) / 180;
  const x = px * u.mmPerPixel;
  const y = -py * u.mmPerPixel;
  return { x: u.x + x * Math.cos(r) - y * Math.sin(r), y: u.y + x * Math.sin(r) + y * Math.cos(r) };
}

/** The image outline in plan (CCW from the bottom-left). */
export function underlayOutline(u: LevelUnderlay, w: number, h: number): Vec2[] {
  return [underlayPoint(u, 0, h), underlayPoint(u, w, h), underlayPoint(u, w, 0), underlayPoint(u, 0, 0)];
}

/** Rotate the underlay about its centre. */
export function rotateUnderlay(u: LevelUnderlay, deg: number, w: number, h: number): LevelUnderlay {
  const c = underlayPoint(u, w / 2, h / 2);
  const next = { ...u, rotation: (((u.rotation + deg) % 360) + 360) % 360 };
  const c2 = underlayPoint(next, w / 2, h / 2);
  return { ...next, x: next.x + c.x - c2.x, y: next.y + c.y - c2.y };
}
