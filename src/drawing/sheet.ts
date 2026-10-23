/**
 * Drawing sheets: ISO 5457 frame (20 mm filing margin, 10 mm elsewhere, 0.7 mm frame line,
 * centring marks), ISO 7200-style title block, scale selection (requested scale, or the largest
 * standard scale that fits) and view placement. Paper-space content is a Drawing at scale 1 in
 * paper mm with y UP and the origin at the sheet's bottom-left corner.
 */
import type { Project } from '../core/types';
import { DrawingBuilder } from './builder';
import { PEN, SHEET_LAYERS, TEXT } from './layers';
import { paperExtent, renderDrawing, type Pen, type Placement, type RenderOptions } from './render';
import { textWidth } from './text';
import { PAPER_SIZES, type Drawing, type PaperSize } from './types';

/** ISO 5455 standard scales (denominators), largest scale first. */
export const STANDARD_SCALES = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SheetImage extends Rect {
  /** PNG or JPEG bytes. */
  data: Uint8Array;
  format: 'PNG' | 'JPEG';
}

export interface Sheet {
  title: string;
  number: string;
  paper: PaperSize;
  orientation: 'landscape' | 'portrait';
  /** Paper mm. */
  width: number;
  height: number;
  /** Border, title block and other paper-space content (scale 1, y up). */
  frame: Drawing;
  /** Model drawings placed on the sheet (paper y down). */
  views: { drawing: Drawing; place: Placement }[];
  /** Raster images (paper rect, y down from top). */
  images: SheetImage[];
  /** Paper rect (y down) available for views. */
  area: Rect;
  /** Scale denominator printed in the title block (0 = "AS SHOWN" / not applicable). */
  scale: number;
}

export interface SheetInfo {
  title: string;
  number: string;
  /** Scale text for the title block, e.g. "1:100" or "AS SHOWN". */
  scaleText: string;
  date?: string;
  revision?: string;
}

export function sheetSize(paper: PaperSize, orientation: 'landscape' | 'portrait'): [number, number] {
  const [w, h] = PAPER_SIZES[paper] ?? PAPER_SIZES.A3;
  return orientation === 'landscape' ? [Math.max(w, h), Math.min(w, h)] : [Math.min(w, h), Math.max(w, h)];
}

/** ISO 5457 drawing frame (y up). */
export function frameRect(width: number, height: number): Rect {
  const left = width >= 250 || height >= 250 ? 20 : 15;
  return { x: left, y: 10, w: width - left - 10, h: height - 20 };
}

export const TITLE_BLOCK_HEIGHT = 32;

/** Title block width: 180 mm, or the frame width on narrow sheets. */
export const titleBlockWidth = (frame: Rect): number => Math.min(180, frame.w);

/** Shrink a text height so the text fits `maxW`. */
export function fitHeight(text: string, h: number, maxW: number, bold = false): number {
  const w = textWidth(text, h, bold);
  return w > maxW ? Math.max(1.2, (h * maxW) / w) : h;
}

export const todayISO = (): string => new Date().toISOString().slice(0, 10);

/** Draw the frame, centring marks and title block into a paper-space builder. */
export function drawFrame(b: DrawingBuilder, project: Project, width: number, height: number, info: SheetInfo, paper: string): Rect {
  const f = frameRect(width, height);
  const L = 'G-ANNO-TTLB';
  const T = 'G-ANNO-TEXT';
  b.polyline(L, [{ x: f.x, y: f.y }, { x: f.x + f.w, y: f.y }, { x: f.x + f.w, y: f.y + f.h }, { x: f.x, y: f.y + f.h }], true, { lineweight: PEN.heavy, tag: 'frame' });
  // Centring marks.
  const cx = width / 2;
  const cy = height / 2;
  for (const [a, c] of [
    [{ x: cx, y: 0 }, { x: cx, y: f.y + 5 }],
    [{ x: cx, y: height }, { x: cx, y: f.y + f.h - 5 }],
    [{ x: 0, y: cy }, { x: f.x + 5, y: cy }],
    [{ x: width, y: cy }, { x: f.x + f.w - 5, y: cy }],
  ])
    b.line(L, a, c, { lineweight: PEN.heavy, tag: 'centring-mark' });

  const tw = titleBlockWidth(f);
  const x0 = f.x + f.w - tw;
  const y0 = f.y;
  const H = TITLE_BLOCK_HEIGHT;
  const rowB = 10;
  b.fill(L, [{ x: x0, y: y0 }, { x: x0 + tw, y: y0 }, { x: x0 + tw, y: y0 + H }, { x: x0, y: y0 + H }], '#ffffff', { stroke: true, lineweight: PEN.thick, tag: 'title-block' });
  b.line(L, { x: x0, y: y0 + rowB }, { x: x0 + tw, y: y0 + rowB }, { lineweight: PEN.thin });
  const k = tw / 180;
  // Top row: project | drawing title | sheet number.
  const cTop = [0, 66, 140, 180].map((v) => x0 + v * k);
  for (const x of cTop.slice(1, -1)) b.line(L, { x, y: y0 + rowB }, { x, y: y0 + H }, { lineweight: PEN.thin });
  // Bottom row: drawn by | date | scale | paper | revision | software.
  const cBot = [0, 44, 74, 104, 128, 144, 180].map((v) => x0 + v * k);
  for (const x of cBot.slice(1, -1)) b.line(L, { x, y: y0 }, { x, y: y0 + rowB }, { lineweight: PEN.thin });

  const label = (x: number, y: number, text: string) => b.text(T, { x: x + 1.5, y: y - 1.5 }, text, TEXT.tiny, { align: 'left', valign: 'top', tag: 'tb-label' });
  const value = (x: number, y: number, w: number, text: string, h: number, bold = false, tag = 'tb-value') =>
    b.text(T, { x: x + 1.5, y: y + 2 }, text, fitHeight(text, h, w - 3, bold), { align: 'left', valign: 'baseline', bold, tag });

  const top = y0 + H;
  label(cTop[0], top, 'PROJECT');
  value(cTop[0], y0 + rowB + 8, cTop[1] - cTop[0], project.info.name || 'Untitled Project', TEXT.normal, true, 'tb-project');
  if (project.info.address) value(cTop[0], y0 + rowB + 2.5, cTop[1] - cTop[0], project.info.address, TEXT.tiny, false, 'tb-address');
  label(cTop[1], top, 'DRAWING TITLE');
  value(cTop[1], y0 + rowB + 6, cTop[2] - cTop[1], info.title.toUpperCase(), TEXT.normal, true, 'tb-title');
  label(cTop[2], top, 'SHEET NO.');
  value(cTop[2], y0 + rowB + 4, cTop[3] - cTop[2], info.number, TEXT.title, true, 'tb-number');

  const cells: [string, string][] = [
    ['DRAWN BY', project.info.author || '—'],
    ['DATE', info.date ?? todayISO()],
    ['SCALE', info.scaleText],
    ['PAPER', paper],
    ['REV', info.revision ?? '0'],
  ];
  cells.forEach(([l, v], i) => {
    label(cBot[i], y0 + rowB, l);
    value(cBot[i], y0 + 0.5, cBot[i + 1] - cBot[i], v, TEXT.small, false, `tb-${l.toLowerCase().replace(/\W+/g, '-')}`);
  });
  b.text(T, { x: (cBot[5] + cBot[6]) / 2, y: y0 + rowB / 2 + 0.8 }, 'CRAFTING', fitHeight('CRAFTING', TEXT.small, cBot[6] - cBot[5] - 3, true), { bold: true, tag: 'tb-brand' });
  b.text(T, { x: (cBot[5] + cBot[6]) / 2, y: y0 + 1.6 }, 'free BIM design', TEXT.tiny * 0.8, { tag: 'tb-brand' });
  return f;
}

export interface SheetSpec {
  paper: PaperSize;
  orientation: 'landscape' | 'portrait';
  title: string;
  number: string;
  /** Title block scale text; defaults from the chosen scale. */
  scaleText?: string;
  date?: string;
}

/** Empty sheet: frame + title block; returns the sheet and its paper-space builder. */
export function blankSheet(project: Project, spec: SheetSpec, scale: number): { sheet: Sheet; builder: DrawingBuilder } {
  const [width, height] = sheetSize(spec.paper, spec.orientation);
  const b = new DrawingBuilder(1, 'metric');
  const scaleText = spec.scaleText ?? (scale > 0 ? `1:${scale}` : 'AS SHOWN');
  const f = drawFrame(b, project, width, height, { title: spec.title, number: spec.number, scaleText, date: spec.date }, `${spec.paper} ${spec.orientation === 'landscape' ? 'L' : 'P'}`);
  // Drawing area: inside the frame, above the title block (y down for placement).
  const pad = 6;
  const area: Rect = { x: f.x + pad, y: height - (f.y + f.h) + pad, w: f.w - 2 * pad, h: f.h - TITLE_BLOCK_HEIGHT - 2 * pad };
  const sheet: Sheet = {
    title: spec.title,
    number: spec.number,
    paper: spec.paper,
    orientation: spec.orientation,
    width,
    height,
    frame: b.build(spec.title, SHEET_LAYERS),
    views: [],
    images: [],
    area,
    scale,
  };
  return { sheet, builder: b };
}

/** Rebuild the sheet's frame drawing after adding paper-space content to its builder. */
export function finishSheet(sheet: Sheet, b: DrawingBuilder): Sheet {
  sheet.frame = b.build(sheet.title, SHEET_LAYERS);
  return sheet;
}

export interface ViewSpec {
  drawing: Drawing;
  /** Regenerate the drawing at another scale (annotation sizes depend on scale). */
  regenerate?: (scale: number) => Drawing;
}

/**
 * Pick the requested scale if every view fits its cell, else the largest standard scale that does.
 * Returns the (possibly regenerated) drawings.
 */
export function fitScale(views: ViewSpec[], cell: { w: number; h: number }, requested: number): { scale: number; drawings: Drawing[] } {
  const candidates = [requested, ...STANDARD_SCALES.filter((s) => s > requested)];
  let last: { scale: number; drawings: Drawing[] } | null = null;
  for (const s of candidates) {
    const drawings = views.map((v) => (v.drawing.scale === s || !v.regenerate ? v.drawing : v.regenerate(s)));
    last = { scale: s, drawings };
    if (drawings.every((d) => fits(d, s, cell))) return last;
  }
  return last ?? { scale: requested, drawings: views.map((v) => v.drawing) };
}

function fits(d: Drawing, scale: number, cell: { w: number; h: number }): boolean {
  const e = paperExtent(d, scale);
  return !(d.bounds.minX <= d.bounds.maxX) || (e.w <= cell.w + 1e-6 && e.h <= cell.h + 1e-6);
}

/** Placement centring a drawing in a paper rect (y down). */
export function centreIn(d: Drawing, r: Rect, scale = d.scale): Placement {
  const e = paperExtent(d, scale);
  return { origin: { x: d.bounds.minX, y: d.bounds.maxY }, at: { x: r.x + (r.w - e.w) / 2, y: r.y + (r.h - e.h) / 2 }, scale };
}

export interface ComposeOptions extends SheetSpec {
  views: ViewSpec[];
  requestedScale: number;
  /** Grid layout for multiple views (default 1×N). */
  columns?: number;
  levelName?: string;
}

/** Compose a sheet with one or more views at a common scale (fitted to the drawing area). */
export function composeSheet(project: Project, o: ComposeOptions): Sheet {
  const [width, height] = sheetSize(o.paper, o.orientation);
  const probe = blankSheet(project, o, o.requestedScale).sheet.area;
  const cols = Math.max(1, Math.min(o.columns ?? o.views.length, o.views.length));
  const rows = Math.ceil(o.views.length / cols);
  const gap = 8;
  const cell = { w: (probe.w - gap * (cols - 1)) / cols, h: (probe.h - gap * (rows - 1)) / rows };
  const { scale, drawings } = fitScale(o.views, cell, o.requestedScale);
  const note = scale !== o.requestedScale;
  const { sheet, builder } = blankSheet(project, { ...o, scaleText: o.scaleText ?? `1:${scale}${note ? ' *' : ''}` }, scale);
  void width;
  drawings.forEach((d, i) => {
    const r: Rect = { x: sheet.area.x + (i % cols) * (cell.w + gap), y: sheet.area.y + Math.floor(i / cols) * (cell.h + gap), w: cell.w, h: cell.h };
    sheet.views.push({ drawing: d, place: centreIn(d, r, scale) });
  });
  if (note) {
    const f = frameRect(width, height);
    builder.text('G-ANNO-TEXT', { x: f.x + 4, y: f.y + 4 }, `* Requested scale 1:${o.requestedScale} does not fit ${o.paper}; drawn at 1:${scale}.`, TEXT.tiny, {
      align: 'left',
      valign: 'bottom',
      tag: 'scale-note',
    });
  }
  return finishSheet(sheet, builder);
}

/** Render a sheet (frame, views) through a pen. Images are backend specific and skipped here. */
export function renderSheet(sheet: Sheet, pen: Pen, opts: RenderOptions = {}): void {
  for (const v of sheet.views) renderDrawing(v.drawing, pen, v.place, opts);
  renderDrawing(sheet.frame, pen, { origin: { x: 0, y: sheet.height }, at: { x: 0, y: 0 }, scale: 1 }, opts);
}
