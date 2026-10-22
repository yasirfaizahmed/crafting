/**
 * Thin wrapper over CanvasRenderingContext2D that switches between model space (mm, y up) and
 * screen space (CSS px), so geometry is drawn in mm while lineweights and text stay in px.
 */
import type { Vec2 } from '../../core/types';
import type { Viewport } from '../viewport';
import { FONT } from './style';

export class Painter {
  constructor(
    readonly g: CanvasRenderingContext2D,
    readonly view: Viewport,
    readonly dpr: number,
  ) {}

  /** Model-space transform (mm, y up). */
  world(): void {
    const v = this.view;
    const s = v.scale * this.dpr;
    this.g.setTransform(s, 0, 0, -s, this.dpr * (v.width / 2 - v.center.x * v.scale), this.dpr * (v.height / 2 + v.center.y * v.scale));
  }

  /** Screen-space transform (CSS px, y down). */
  screen(): void {
    this.g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Pixels → model mm (for lineweights / dashes while in world mode). */
  px(n: number): number {
    return n / this.view.scale;
  }

  lw(px: number): void {
    this.g.lineWidth = this.px(px);
  }

  dash(px: number[] | null): void {
    this.g.setLineDash(px ? px.map((d) => this.px(d)) : []);
  }

  path(pts: Vec2[], closed = true): void {
    const g = this.g;
    g.beginPath();
    this.addPath(pts, closed);
  }

  addPath(pts: Vec2[], closed = true): void {
    const g = this.g;
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    if (closed && pts.length > 2) g.closePath();
  }

  line(a: Vec2, b: Vec2): void {
    const g = this.g;
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }

  circle(c: Vec2, r: number): void {
    this.g.beginPath();
    this.g.arc(c.x, c.y, Math.max(0, r), 0, Math.PI * 2);
  }

  /** Text at a model point, drawn upright in screen space. Leaves the painter in screen mode. */
  text(
    p: Vec2,
    text: string,
    opts: { size?: number; weight?: number; color?: string; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; angle?: number; dx?: number; dy?: number; halo?: string } = {},
  ): void {
    const s = this.view.toScreen(p);
    this.textScreen({ x: s.x + (opts.dx ?? 0), y: s.y + (opts.dy ?? 0) }, text, opts);
  }

  textScreen(
    s: Vec2,
    text: string,
    opts: { size?: number; weight?: number; color?: string; align?: CanvasTextAlign; baseline?: CanvasTextBaseline; angle?: number; halo?: string } = {},
  ): void {
    const g = this.g;
    this.screen();
    g.save();
    g.translate(s.x, s.y);
    if (opts.angle) g.rotate(opts.angle);
    g.font = `${opts.weight ?? 500} ${opts.size ?? 12}px ${FONT}`;
    g.textAlign = opts.align ?? 'center';
    g.textBaseline = opts.baseline ?? 'middle';
    if (opts.halo) {
      g.strokeStyle = opts.halo;
      g.lineWidth = 3;
      g.lineJoin = 'round';
      g.strokeText(text, 0, 0);
    }
    g.fillStyle = opts.color ?? '#000';
    g.fillText(text, 0, 0);
    g.restore();
  }

  measure(text: string, size: number, weight = 500): number {
    const g = this.g;
    g.font = `${weight} ${size}px ${FONT}`;
    return g.measureText(text).width;
  }

  roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const g = this.g;
    g.beginPath();
    g.moveTo(x + r, y);
    g.lineTo(x + w - r, y);
    g.quadraticCurveTo(x + w, y, x + w, y + r);
    g.lineTo(x + w, y + h - r);
    g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    g.lineTo(x + r, y + h);
    g.quadraticCurveTo(x, y + h, x, y + h - r);
    g.lineTo(x, y + r);
    g.quadraticCurveTo(x, y, x + r, y);
    g.closePath();
  }
}
