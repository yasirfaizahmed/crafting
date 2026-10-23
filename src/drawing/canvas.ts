/**
 * Canvas 2D backend for the paper renderer: draws Drawings / sheets onto a canvas at a given
 * resolution (used by the plan PNG export; reusable for on-screen sheet previews).
 */
import type { Vec2 } from '../core/types';
import type { Segment } from './geom';
import { dashArray, renderDrawing, type PaperText, type Pen, type Placement, type RenderOptions, type StrokeStyle } from './render';
import { emForCapHeight } from './text';
import type { Drawing } from './types';

type Ctx2D = Pick<
  CanvasRenderingContext2D,
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'closePath'
  | 'stroke'
  | 'fill'
  | 'arc'
  | 'save'
  | 'restore'
  | 'translate'
  | 'rotate'
  | 'fillText'
  | 'setLineDash'
  | 'strokeStyle'
  | 'fillStyle'
  | 'lineWidth'
  | 'lineCap'
  | 'lineJoin'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'globalAlpha'
>;

export const CANVAS_FONT = 'Helvetica, Arial, "Liberation Sans", sans-serif';

/** Canvas pen; coordinates are paper mm — install a mm → px transform on the context first. */
export class CanvasPen implements Pen {
  /** Minimum stroke width in mm so hairlines stay visible at low resolutions. */
  constructor(
    readonly g: Ctx2D,
    readonly minWidth = 0,
  ) {
    g.lineCap = 'round';
    g.lineJoin = 'round';
  }

  private apply(s: StrokeStyle): void {
    const g = this.g;
    g.strokeStyle = s.color;
    g.lineWidth = Math.max(this.minWidth, s.width);
    g.setLineDash(dashArray(s.dash));
  }

  polyline(points: Vec2[], closed: boolean, style: StrokeStyle): void {
    if (points.length < 2) return;
    const g = this.g;
    this.apply(style);
    g.beginPath();
    g.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) g.lineTo(points[i].x, points[i].y);
    if (closed) g.closePath();
    g.stroke();
  }

  segments(segs: Segment[], style: StrokeStyle): void {
    if (!segs.length) return;
    const g = this.g;
    this.apply(style);
    g.beginPath();
    for (const [a, b] of segs) {
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
    }
    g.stroke();
  }

  fill(rings: Vec2[][], color: string, opacity: number): void {
    const g = this.g;
    g.beginPath();
    for (const r of rings) {
      if (r.length < 3) continue;
      g.moveTo(r[0].x, r[0].y);
      for (let i = 1; i < r.length; i++) g.lineTo(r[i].x, r[i].y);
      g.closePath();
    }
    g.fillStyle = color;
    g.globalAlpha = opacity;
    g.fill('evenodd');
    g.globalAlpha = 1;
  }

  circle(c: Vec2, r: number, stroke: StrokeStyle | null, fill: string | null): void {
    const g = this.g;
    g.beginPath();
    g.arc(c.x, c.y, r, 0, Math.PI * 2);
    if (fill) {
      g.fillStyle = fill;
      g.fill();
    }
    if (stroke) {
      this.apply(stroke);
      g.stroke();
    }
  }

  arc(c: Vec2, r: number, startDeg: number, endDeg: number, style: StrokeStyle): void {
    const g = this.g;
    this.apply(style);
    g.beginPath();
    // Visually CCW on a y-down canvas: negate the angles and sweep anticlockwise.
    g.arc(c.x, c.y, r, (-startDeg * Math.PI) / 180, (-endDeg * Math.PI) / 180, true);
    g.stroke();
  }

  text(t: PaperText): void {
    const g = this.g;
    g.save();
    g.translate(t.at.x, t.at.y);
    if (t.rotation) g.rotate((-t.rotation * Math.PI) / 180);
    g.font = `${t.bold ? 'bold ' : ''}${emForCapHeight(t.height).toFixed(3)}px ${CANVAS_FONT}`;
    g.textAlign = t.align;
    g.textBaseline = 'alphabetic';
    g.fillStyle = t.color;
    g.fillText(t.text, 0, 0);
    g.restore();
  }
}

export interface RasterOptions {
  /** Dots per inch on paper (default 150). */
  dpi?: number;
  /** Margin around the drawing, paper mm (default 10). */
  margin?: number;
  /** Fit within this many pixels (overrides dpi when smaller). */
  maxWidth?: number;
  maxHeight?: number;
  background?: string;
}

/** Hard limits for raster output. */
export const MAX_CANVAS_SIDE = 16384;
export const MAX_CANVAS_PIXELS = 64e6;

/** Pixel size and resolution for rasterising a drawing (paper mm × dpi, clamped). */
export function rasterSize(d: Drawing, o: RasterOptions = {}): { width: number; height: number; pxPerMm: number; paperW: number; paperH: number } {
  const margin = o.margin ?? 10;
  const b = d.bounds;
  const ok = b.minX <= b.maxX;
  const paperW = (ok ? (b.maxX - b.minX) / d.scale : 0) + 2 * margin;
  const paperH = (ok ? (b.maxY - b.minY) / d.scale : 0) + 2 * margin;
  let pxPerMm = (o.dpi ?? 150) / 25.4;
  if (o.maxWidth) pxPerMm = Math.min(pxPerMm, o.maxWidth / paperW);
  if (o.maxHeight) pxPerMm = Math.min(pxPerMm, o.maxHeight / paperH);
  pxPerMm = Math.min(pxPerMm, MAX_CANVAS_SIDE / paperW, MAX_CANVAS_SIDE / paperH, Math.sqrt(MAX_CANVAS_PIXELS / (paperW * paperH)));
  return { width: Math.max(1, Math.round(paperW * pxPerMm)), height: Math.max(1, Math.round(paperH * pxPerMm)), pxPerMm, paperW, paperH };
}

/** Draw a Drawing onto a 2D context sized per `rasterSize`, white background, mm → px transform. */
export function renderDrawingToContext(
  g: Ctx2D & Pick<CanvasRenderingContext2D, 'setTransform' | 'fillRect'>,
  d: Drawing,
  o: RasterOptions = {},
  ro: RenderOptions = {},
): { width: number; height: number; pxPerMm: number } {
  const size = rasterSize(d, o);
  const margin = o.margin ?? 10;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = o.background ?? '#ffffff';
  g.fillRect(0, 0, size.width, size.height);
  g.setTransform(size.pxPerMm, 0, 0, size.pxPerMm, 0, 0);
  const place: Placement = { origin: { x: d.bounds.minX, y: d.bounds.maxY }, at: { x: margin, y: margin } };
  // Keep hairlines at least ~0.75 px wide.
  if (d.bounds.minX <= d.bounds.maxX) renderDrawing(d, new CanvasPen(g, 0.75 / size.pxPerMm), place, ro);
  return size;
}
