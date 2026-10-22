/**
 * Paper renderer core shared by SVG, PDF and Canvas outputs: maps a model-space Drawing onto paper
 * (mm, y down), resolves layer styles (colour, ISO 128 lineweight, linetype dashes), explodes
 * dimensions, generates hatch lines and positions text, then calls a backend `Pen`.
 */
import type { Vec2 } from '../core/types';
import { DIM_STYLE, explodeDimension } from './dimension';
import { arcPoints, type Segment } from './geom';
import { defaultHatchSpacing, hatchLines } from './hatch';
import { LINETYPE_PATTERNS } from './layers';
import { baselineDrop } from './text';
import type { Drawing, DrawingEntity, DrawingLayer, Linetype } from './types';

export interface StrokeStyle {
  color: string;
  /** Paper mm. */
  width: number;
  /** Dash pattern, paper mm (positive dash, negative gap, 0 dot); empty = continuous. */
  dash: number[];
}

export interface PaperText {
  /** Baseline anchor, paper mm (y down). */
  at: Vec2;
  text: string;
  /** Cap height, paper mm. */
  height: number;
  /** Degrees CCW as seen on paper. */
  rotation: number;
  align: 'left' | 'center' | 'right';
  bold: boolean;
  color: string;
}

/** Output backend. All coordinates are paper mm with y pointing DOWN. */
export interface Pen {
  beginLayer?(layer: DrawingLayer): void;
  endLayer?(): void;
  polyline(points: Vec2[], closed: boolean, style: StrokeStyle): void;
  /** Many independent segments with one style (hatching). Zero-length segments are dots. */
  segments(segs: Segment[], style: StrokeStyle): void;
  /** Fill rings with the even-odd rule. */
  fill(rings: Vec2[][], color: string, opacity: number): void;
  circle(center: Vec2, r: number, stroke: StrokeStyle | null, fill: string | null): void;
  /** Arc CCW (as seen on paper) from startDeg to endDeg. */
  arc(center: Vec2, r: number, startDeg: number, endDeg: number, style: StrokeStyle): void;
  text(t: PaperText): void;
}

/** Where a drawing goes on paper: model point `origin` lands on paper point `at` (y down). */
export interface Placement {
  origin: Vec2;
  at: Vec2;
  /** Scale denominator used for geometry (default: the drawing's scale). */
  scale?: number;
}

export interface RenderOptions {
  /** Force every colour to black (plot style "monochrome"), keeping fills. */
  monochrome?: boolean;
  /** Skip layers by name. */
  hiddenLayers?: Set<string>;
}

export const isNoFill = (c: string | undefined): boolean => !c || c === 'none' || c === 'transparent';

/** Paper placement that puts the model bounds' top-left corner at paper (x, y). */
export function placeTopLeft(d: Pick<Drawing, 'bounds'>, x: number, y: number, scale?: number): Placement {
  return { origin: { x: d.bounds.minX, y: d.bounds.maxY }, at: { x, y }, scale };
}

/** Paper size (mm) of a drawing's bounds at its scale. */
export function paperExtent(d: Pick<Drawing, 'bounds' | 'scale'>, scale = d.scale): { w: number; h: number } {
  return { w: (d.bounds.maxX - d.bounds.minX) / scale, h: (d.bounds.maxY - d.bounds.minY) / scale };
}

export function renderDrawing(d: Drawing, pen: Pen, place: Placement, opts: RenderOptions = {}): void {
  const s = place.scale ?? d.scale;
  const P = (p: Vec2): Vec2 => ({ x: place.at.x + (p.x - place.origin.x) / s, y: place.at.y - (p.y - place.origin.y) / s });
  const layers = new Map(d.layers.map((l) => [l.name, l]));
  const fallback: DrawingLayer = { name: '0', color: '#000000', lineweight: 0.25, linetype: 'continuous', description: '' };
  const col = (c: string) => (opts.monochrome && !isWhite(c) ? '#000000' : c);
  let current: string | null = null;
  const close = () => {
    if (current !== null) pen.endLayer?.();
    current = null;
  };
  for (const e of d.entities) {
    if (opts.hiddenLayers?.has(e.layer)) continue;
    const layer = layers.get(e.layer) ?? { ...fallback, name: e.layer };
    if (current !== e.layer) {
      close();
      current = e.layer;
      pen.beginLayer?.(layer);
    }
    const style = (lt?: Linetype, lw?: number): StrokeStyle => ({
      color: col(e.color ?? layer.color),
      width: lw ?? e.lineweight ?? layer.lineweight,
      dash: LINETYPE_PATTERNS[lt ?? e.linetype ?? layer.linetype] ?? [],
    });
    drawEntity(e, pen, P, s, d, style, col);
  }
  close();
}

function drawEntity(
  e: DrawingEntity,
  pen: Pen,
  P: (p: Vec2) => Vec2,
  s: number,
  d: Drawing,
  style: (lt?: Linetype, lw?: number) => StrokeStyle,
  col: (c: string) => string,
): void {
  switch (e.kind) {
    case 'line':
      pen.polyline([P(e.a), P(e.b)], false, style());
      break;
    case 'polyline':
      if (e.points.length >= 2) pen.polyline(e.points.map(P), e.closed, style());
      break;
    case 'fill': {
      const rings = [e.outline, ...(e.holes ?? [])].filter((r) => r.length >= 3);
      if (!rings.length) break;
      const paperRings = rings.map((r) => r.map(P));
      if (!isNoFill(e.fill)) pen.fill(paperRings, e.fill.startsWith('#') ? (isWhite(e.fill) ? e.fill : col(e.fill)) : e.fill, e.opacity ?? 1);
      if (e.hatch === 'solid') pen.fill(paperRings, style().color, e.opacity ?? 1);
      else if (e.hatch && e.hatch !== 'none') {
        const spacing = (e.hatchSpacing ?? defaultHatchSpacing(e.hatch)) * d.scale;
        const segs = hatchLines(e.outline, e.holes ?? [], e.hatch, spacing, e.hatchAngle ?? 0).map(([a, b]) => {
          const pa = P(a);
          const pb = P(b);
          // Dots become tiny dashes so every backend renders them.
          return (pa.x === pb.x && pa.y === pb.y ? [pa, { x: pa.x + 0.08, y: pa.y }] : [pa, pb]) as Segment;
        });
        if (segs.length) pen.segments(segs, { ...style('continuous'), width: e.lineweight ?? Math.min(style().width, 0.18) });
      }
      if (e.stroke) for (const r of paperRings) pen.polyline(r, true, style());
      break;
    }
    case 'arc':
      pen.arc(P(e.center), e.radius / s, e.startAngle, e.endAngle, style());
      break;
    case 'circle':
      pen.circle(P(e.center), e.radius / s, style(), e.fill && !isNoFill(e.fill) ? col(e.fill) : null);
      break;
    case 'text':
      emitText(pen, P(e.position), e.text, e.height, e.rotation, e.align, e.valign, !!e.bold, style().color);
      break;
    case 'dimension': {
      const x = explodeDimension(e, d.scale, d.units);
      const st = style();
      for (const seg of [...x.extensions, x.line]) pen.polyline(seg.map(P), false, st);
      pen.segments(
        x.ticks.map((t) => t.map(P) as Segment),
        { ...st, width: Math.max(DIM_STYLE.tickWeight, st.width), dash: [] },
      );
      if (x.text) emitText(pen, P(x.text.position), x.text.text, x.text.height, x.text.rotation, 'center', x.text.valign, false, st.color);
      break;
    }
  }
}

function emitText(
  pen: Pen,
  at: Vec2,
  text: string,
  height: number,
  rotation: number,
  align: PaperText['align'],
  valign: 'top' | 'middle' | 'baseline' | 'bottom',
  bold: boolean,
  color: string,
): void {
  if (!text) return;
  const drop = baselineDrop(valign, height);
  const r = ((rotation + 90) * Math.PI) / 180;
  // "Up" on paper (y down).
  const up = { x: Math.cos(r), y: -Math.sin(r) };
  pen.text({ at: { x: at.x - up.x * drop, y: at.y - up.y * drop }, text, height, rotation, align, bold, color });
}

export function isWhite(c: string): boolean {
  const v = c.toLowerCase();
  return v === '#fff' || v === '#ffffff' || v === 'white';
}

/** Flattened arc for backends without native arcs (paper coordinates, y down). */
export function paperArcPoints(c: Vec2, r: number, startDeg: number, endDeg: number): Vec2[] {
  return arcPoints({ x: 0, y: 0 }, r, startDeg, endDeg, 4).map((p) => ({ x: c.x + p.x, y: c.y - p.y }));
}

/** SVG/Canvas/PDF on-off dash array from a CAD pattern (all values non-negative). */
export function dashArray(dash: number[]): number[] {
  return dash.map((v) => Math.abs(v));
}
