/**
 * Plan viewport transform: model millimetres (x east, y north) ⇄ CSS pixels (y down).
 * `scale` is pixels per millimetre; `center` is the model point at the middle of the canvas.
 */
import { type Bounds2, isEmptyBounds } from '../core/math2d';
import type { Vec2 } from '../core/types';

/** 100% zoom: 1 m = 50 px. */
export const BASE_SCALE = 0.05;
export const MIN_SCALE = 0.0015;
export const MAX_SCALE = 3;

export class Viewport {
  width = 800;
  height = 600;
  scale = BASE_SCALE;
  center: Vec2 = { x: 0, y: 0 };

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
  }

  toScreen(p: Vec2): Vec2 {
    return { x: (p.x - this.center.x) * this.scale + this.width / 2, y: this.height / 2 - (p.y - this.center.y) * this.scale };
  }

  toWorld(s: Vec2): Vec2 {
    return { x: (s.x - this.width / 2) / this.scale + this.center.x, y: (this.height / 2 - s.y) / this.scale + this.center.y };
  }

  /** Screen pixels → model millimetres. */
  pxToMm(px: number): number {
    return px / this.scale;
  }

  /** Zoom by `factor`, keeping the model point under `screen` fixed. */
  zoomAt(screen: Vec2, factor: number): void {
    const before = this.toWorld(screen);
    this.scale = clamp(this.scale * factor, MIN_SCALE, MAX_SCALE);
    const after = this.toWorld(screen);
    this.center = { x: this.center.x + before.x - after.x, y: this.center.y + before.y - after.y };
  }

  /** Pan by a screen-pixel delta (content follows the pointer). */
  panBy(dx: number, dy: number): void {
    this.center = { x: this.center.x - dx / this.scale, y: this.center.y + dy / this.scale };
  }

  /** Fit model bounds into the view with a pixel margin. */
  fit(b: Bounds2, padding = 48, maxScale = 0.25): void {
    if (isEmptyBounds(b)) return;
    const w = Math.max(b.maxX - b.minX, 1000);
    const h = Math.max(b.maxY - b.minY, 1000);
    const sx = (this.width - padding * 2) / w;
    const sy = (this.height - padding * 2) / h;
    this.scale = clamp(Math.min(sx, sy), MIN_SCALE, maxScale);
    this.center = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  }

  /** Model-space rectangle currently visible. */
  visibleBounds(): Bounds2 {
    const a = this.toWorld({ x: 0, y: this.height });
    const b = this.toWorld({ x: this.width, y: 0 });
    return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
  }

  /** Zoom as a percentage of BASE_SCALE. */
  get zoomPercent(): number {
    return Math.round((this.scale / BASE_SCALE) * 100);
  }

  /**
   * Equivalent drawing scale denominator at 96 dpi (1:N), e.g. 100 for 1:100.
   * One paper millimetre is 96 / 25.4 CSS px.
   */
  get drawingScale(): number {
    return 96 / 25.4 / this.scale;
  }
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
