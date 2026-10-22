/**
 * SVG output: drawings rendered in PAPER millimetres (viewBox in mm, width/height in mm so the file
 * prints to scale), one Inkscape layer group per CAD layer, ISO 128 stroke widths, dash arrays,
 * hatching as path data and properly anchored text.
 */
import type { Project, Vec2 } from '../core/types';
import { generatePlanDrawing } from '../drawing/plan';
import { dashArray, paperArcPoints, renderDrawing, type PaperText, type Pen, type StrokeStyle } from '../drawing/render';
import { composeSheet, renderSheet, type Sheet } from '../drawing/sheet';
import { emForCapHeight } from '../drawing/text';
import type { Drawing, DrawingLayer, PaperSize } from '../drawing/types';
import type { Segment } from '../drawing/geom';
import type { ExportEnv, ExportOptions } from './types';

export interface SVGOptions {
  /** Margin around the drawing in paper mm (drawing-only output). Default 10. */
  margin?: number;
  /** Background colour; 'none' for transparent. Default white. */
  background?: string;
  /** Monochrome plot style. */
  monochrome?: boolean;
}

const FONT = "'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', sans-serif";

const n = (v: number): string => {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? '0' : `${r}`;
};

export function escapeXML(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

const idSafe = (s: string) => s.replace(/[^A-Za-z0-9_.-]/g, '_');

/** SVG backend for the paper renderer. */
export class SVGPen implements Pen {
  readonly parts: string[] = [];
  private layer: DrawingLayer | null = null;
  private readonly ids = new Map<string, number>();

  beginLayer(layer: DrawingLayer): void {
    this.layer = layer;
    const k = (this.ids.get(layer.name) ?? 0) + 1;
    this.ids.set(layer.name, k);
    const id = idSafe(k === 1 ? layer.name : `${layer.name}__${k}`);
    this.parts.push(
      `<g id="${id}" inkscape:groupmode="layer" inkscape:label="${escapeXML(layer.name)}" fill="none" stroke="${layer.color}" stroke-width="${n(layer.lineweight)}" stroke-linecap="round" stroke-linejoin="round">`,
    );
  }

  endLayer(): void {
    this.parts.push('</g>');
    this.layer = null;
  }

  private strokeAttrs(s: StrokeStyle): string {
    const l = this.layer;
    let a = '';
    if (!l || s.color !== l.color) a += ` stroke="${s.color}"`;
    if (!l || Math.abs(s.width - l.lineweight) > 1e-6) a += ` stroke-width="${n(s.width)}"`;
    if (s.dash.length) a += ` stroke-dasharray="${dashArray(s.dash).map(n).join(' ')}"`;
    return a;
  }

  polyline(points: Vec2[], closed: boolean, style: StrokeStyle): void {
    if (points.length === 2 && !closed) {
      const [a, b] = points;
      this.parts.push(`<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}"${this.strokeAttrs(style)}/>`);
      return;
    }
    const tag = closed ? 'polygon' : 'polyline';
    this.parts.push(`<${tag} points="${points.map((p) => `${n(p.x)},${n(p.y)}`).join(' ')}"${this.strokeAttrs(style)}/>`);
  }

  segments(segs: Segment[], style: StrokeStyle): void {
    if (!segs.length) return;
    const d = segs.map(([a, b]) => `M${n(a.x)} ${n(a.y)}L${n(b.x)} ${n(b.y)}`).join('');
    this.parts.push(`<path d="${d}"${this.strokeAttrs(style)}/>`);
  }

  fill(rings: Vec2[][], color: string, opacity: number): void {
    const d = rings.map((r) => `M${r.map((p) => `${n(p.x)} ${n(p.y)}`).join('L')}Z`).join('');
    this.parts.push(`<path d="${d}" fill="${color}" fill-rule="evenodd" stroke="none"${opacity < 1 ? ` fill-opacity="${n(opacity)}"` : ''}/>`);
  }

  circle(c: Vec2, r: number, stroke: StrokeStyle | null, fill: string | null): void {
    const f = fill ? ` fill="${fill}"` : '';
    const s = stroke ? this.strokeAttrs(stroke) : ' stroke="none"';
    this.parts.push(`<circle cx="${n(c.x)}" cy="${n(c.y)}" r="${n(r)}"${f}${s}/>`);
  }

  arc(c: Vec2, r: number, startDeg: number, endDeg: number, style: StrokeStyle): void {
    let sweep = endDeg - startDeg;
    while (sweep <= 0) sweep += 360;
    if (sweep >= 359.99) {
      this.circle(c, r, style, null);
      return;
    }
    const pts = paperArcPoints(c, r, startDeg, endDeg);
    const a = pts[0];
    const b = pts[pts.length - 1];
    // Visually CCW on a y-down canvas = SVG sweep-flag 0.
    this.parts.push(`<path d="M${n(a.x)} ${n(a.y)}A${n(r)} ${n(r)} 0 ${sweep > 180 ? 1 : 0} 0 ${n(b.x)} ${n(b.y)}"${this.strokeAttrs(style)}/>`);
  }

  text(t: PaperText): void {
    const anchor = t.align === 'left' ? 'start' : t.align === 'right' ? 'end' : 'middle';
    const rot = Math.abs(t.rotation) > 1e-6 ? ` transform="rotate(${n(-t.rotation)} ${n(t.at.x)} ${n(t.at.y)})"` : '';
    this.parts.push(
      `<text x="${n(t.at.x)}" y="${n(t.at.y)}" font-size="${n(emForCapHeight(t.height))}" text-anchor="${anchor}" fill="${t.color}" stroke="none"${t.bold ? ' font-weight="bold"' : ''}${rot}>${escapeXML(t.text)}</text>`,
    );
  }
}

function svgDocument(width: number, height: number, title: string, body: string[], background: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" version="1.1" width="${n(width)}mm" height="${n(height)}mm" viewBox="0 0 ${n(width)} ${n(height)}" font-family="${FONT}">`,
    `<title>${escapeXML(title)}</title>`,
    '<desc>Generated by Crafting. Units: paper millimetres.</desc>',
    background !== 'none' ? `<rect id="paper" x="0" y="0" width="${n(width)}" height="${n(height)}" fill="${background}" stroke="none"/>` : '',
    ...body,
    '</svg>',
    '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Render a Drawing to a standalone SVG document string (paper-space mm units). */
export function drawingToSVG(drawing: Drawing, options: SVGOptions = {}): string {
  const margin = options.margin ?? 10;
  const b = drawing.bounds;
  const empty = !(b.minX <= b.maxX && b.minY <= b.maxY);
  const w = empty ? 2 * margin : (b.maxX - b.minX) / drawing.scale + 2 * margin;
  const h = empty ? 2 * margin : (b.maxY - b.minY) / drawing.scale + 2 * margin;
  const pen = new SVGPen();
  if (!empty) renderDrawing(drawing, pen, { origin: { x: b.minX, y: b.maxY }, at: { x: margin, y: margin } }, { monochrome: options.monochrome });
  return svgDocument(w, h, drawing.title, pen.parts, options.background ?? '#ffffff');
}

/** Render a composed sheet (border, title block, views) to SVG. */
export function sheetToSVG(sheet: Sheet, options: SVGOptions = {}): string {
  const pen = new SVGPen();
  renderSheet(sheet, pen, { monochrome: options.monochrome });
  return svgDocument(sheet.width, sheet.height, sheet.title, pen.parts, options.background ?? '#ffffff');
}

export async function exportSVG(project: Project, options: ExportOptions, env: ExportEnv): Promise<Blob> {
  const levelId = options.levelIds?.[0] ?? env.activeLevelId ?? project.levels[0]?.id;
  const scale = options.scale ?? 100;
  const plan = generatePlanDrawing(project, levelId, {
    scale,
    includeFurniture: options.includeFurniture ?? true,
    includeDimensions: options.includeAnnotations ?? true,
    includeRoomTags: options.includeAnnotations ?? true,
  });
  let svg: string;
  if (options.paper) {
    const level = project.levels.find((l) => l.id === levelId);
    const sheet = composeSheet(project, {
      paper: options.paper as PaperSize,
      orientation: options.orientation ?? 'landscape',
      title: plan.title,
      number: `A-${101 + Math.max(0, project.levels.findIndex((l) => l.id === levelId))}`,
      views: [{ drawing: plan, regenerate: (s) => generatePlanDrawing(project, levelId, { scale: s }) }],
      requestedScale: scale,
      levelName: level?.name,
    });
    svg = sheetToSVG(sheet);
  } else svg = drawingToSVG(plan);
  return new Blob([svg], { type: 'image/svg+xml' });
}
