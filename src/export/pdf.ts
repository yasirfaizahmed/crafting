/**
 * PDF drawing set (jsPDF, vector): cover sheet with project information, a 3D view and the drawing
 * index; one floor plan sheet per level; an elevations sheet (four elevations); a sections sheet;
 * schedule sheets. Every sheet has an ISO 5457 frame and title block; plans carry a north arrow
 * and a scale bar. The requested scale is used when it fits the paper, else the largest standard
 * scale that does (noted on the sheet).
 */
import { jsPDF } from 'jspdf';
import type { Project, Vec2 } from '../core/types';
import { defaultSectionCut, generateAxonometricDrawing, generateElevationDrawing, generateSectionDrawing, type ElevationSide } from '../drawing/elevation';
import type { Segment } from '../drawing/geom';
import { TEXT } from '../drawing/layers';
import { generatePlanDrawing } from '../drawing/plan';
import { dashArray, paperArcPoints, type PaperText, type Pen, type StrokeStyle } from '../drawing/render';
import { allSchedules, drawTable, tableHeight, TABLE_STYLE, type ScheduleTable } from '../drawing/schedules';
import { blankSheet, centreIn, composeSheet, finishSheet, fitHeight, renderSheet, todayISO, type Rect, type Sheet, type SheetSpec } from '../drawing/sheet';
import { emForCapHeight, textWidth } from '../drawing/text';
import type { PaperSize } from '../drawing/types';
import type { ExportEnv, ExportOptions } from './types';

const PT_PER_MM = 72 / 25.4;

/** Map text to the WinAnsi repertoire of the PDF standard fonts. */
export function pdfSafeText(s: string): string {
  return s
    .replace(/[‒-―−]/g, '-')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/•/g, '·')
    .replace(/[^ -~ -ÿ]/g, '?');
}

/** jsPDF backend for the paper renderer (mm units, y down). */
export class PDFPen implements Pen {
  private stroke: string | null = null;
  private width = -1;
  private dash = '';

  constructor(readonly doc: jsPDF) {
    doc.setLineCap('round');
    doc.setLineJoin('round');
  }

  private applyStroke(s: StrokeStyle): void {
    if (s.color !== this.stroke) {
      this.doc.setDrawColor(s.color);
      this.stroke = s.color;
    }
    if (s.width !== this.width) {
      this.doc.setLineWidth(s.width);
      this.width = s.width;
    }
    const d = dashArray(s.dash);
    const key = d.join(',');
    if (key !== this.dash) {
      this.doc.setLineDashPattern(d, 0);
      this.dash = key;
    }
  }

  polyline(points: Vec2[], closed: boolean, style: StrokeStyle): void {
    if (points.length < 2) return;
    this.applyStroke(style);
    const d = this.doc;
    d.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) d.lineTo(points[i].x, points[i].y);
    if (closed) d.close();
    d.stroke();
  }

  segments(segs: Segment[], style: StrokeStyle): void {
    if (!segs.length) return;
    this.applyStroke(style);
    const d = this.doc;
    for (const [a, b] of segs) {
      d.moveTo(a.x, a.y);
      d.lineTo(b.x, b.y);
    }
    d.stroke();
  }

  fill(rings: Vec2[][], color: string, opacity: number): void {
    const d = this.doc;
    d.setFillColor(color);
    if (opacity < 1) d.setGState(new (d as unknown as { GState: new (o: object) => unknown }).GState({ opacity }));
    for (const r of rings) {
      if (r.length < 3) continue;
      d.moveTo(r[0].x, r[0].y);
      for (let i = 1; i < r.length; i++) d.lineTo(r[i].x, r[i].y);
      d.close();
    }
    d.fillEvenOdd();
    if (opacity < 1) d.setGState(new (d as unknown as { GState: new (o: object) => unknown }).GState({ opacity: 1 }));
  }

  circle(c: Vec2, r: number, stroke: StrokeStyle | null, fill: string | null): void {
    if (fill) this.doc.setFillColor(fill);
    if (stroke) this.applyStroke(stroke);
    this.doc.circle(c.x, c.y, r, fill && stroke ? 'FD' : fill ? 'F' : 'S');
  }

  arc(c: Vec2, r: number, startDeg: number, endDeg: number, style: StrokeStyle): void {
    this.polyline(paperArcPoints(c, r, startDeg, endDeg), false, style);
  }

  text(t: PaperText): void {
    const d = this.doc;
    const text = pdfSafeText(t.text);
    d.setFont('helvetica', t.bold ? 'bold' : 'normal');
    d.setFontSize(emForCapHeight(t.height) * PT_PER_MM);
    d.setTextColor(t.color);
    // Alignment along the (possibly rotated) baseline is applied here; jsPDF draws left-aligned.
    const w = d.getTextWidth(text);
    const shift = t.align === 'left' ? 0 : t.align === 'right' ? w : w / 2;
    const r = (t.rotation * Math.PI) / 180;
    const x = t.at.x - shift * Math.cos(r);
    const y = t.at.y + shift * Math.sin(r);
    d.text(text, x, y, Math.abs(t.rotation) > 1e-6 ? { angle: t.rotation, baseline: 'alphabetic' } : { baseline: 'alphabetic' });
  }
}

interface SetOptions {
  paper: PaperSize;
  orientation: 'landscape' | 'portrait';
  scale: number;
  date: string;
}

const ELEVATION_SIDES: ElevationSide[] = ['south', 'east', 'north', 'west'];

/** Assemble every sheet of the drawing set (without numbering the cover's index yet). */
export async function drawingSet(project: Project, options: ExportOptions, env: ExportEnv): Promise<Sheet[]> {
  const o: SetOptions = {
    paper: options.paper ?? 'A3',
    orientation: options.orientation ?? 'landscape',
    scale: options.scale ?? 100,
    date: todayISO(),
  };
  const spec = (title: string, number: string): SheetSpec => ({ paper: o.paper, orientation: o.orientation, title, number, date: o.date });
  const sheets: Sheet[] = [];
  const levels = [...project.levels].sort((a, b) => a.elevation - b.elevation).filter((l) => !options.levelIds?.length || options.levelIds.includes(l.id));
  const planOpts = (s: number) => ({
    scale: s,
    includeFurniture: options.includeFurniture ?? true,
    includeDimensions: options.includeAnnotations ?? true,
    includeRoomTags: options.includeAnnotations ?? true,
    includeOpeningTags: options.includeAnnotations ?? true,
  });
  levels.forEach((l, i) => {
    sheets.push(
      composeSheet(project, {
        ...spec(`${l.name} — Floor Plan`, `A-${101 + i}`),
        requestedScale: o.scale,
        views: [{ drawing: generatePlanDrawing(project, l.id, planOpts(o.scale)), regenerate: (s) => generatePlanDrawing(project, l.id, planOpts(s)) }],
      }),
    );
  });
  sheets.push(
    composeSheet(project, {
      ...spec('Elevations', 'A-201'),
      requestedScale: o.scale,
      columns: 2,
      views: ELEVATION_SIDES.map((side) => ({ drawing: generateElevationDrawing(project, side, { scale: o.scale }), regenerate: (s: number) => generateElevationDrawing(project, side, { scale: s }) })),
    }),
  );
  const cutA = defaultSectionCut(project);
  const midX = (cutA.a.x + cutA.b.x) / 2;
  const ys = Object.values(project.elements).flatMap((e) => (e.type === 'wall' ? [e.start.y, e.end.y] : []));
  const cutB = ys.length ? { a: { x: midX, y: Math.min(...ys) - 2000 }, b: { x: midX, y: Math.max(...ys) + 2000 }, name: 'B' } : { ...cutA, name: 'B' };
  sheets.push(
    composeSheet(project, {
      ...spec('Sections', 'A-301'),
      requestedScale: o.scale,
      columns: 2,
      views: [cutA, cutB].map((c) => ({ drawing: generateSectionDrawing(project, c, { scale: o.scale }), regenerate: (s: number) => generateSectionDrawing(project, c, { scale: s }) })),
    }),
  );
  sheets.push(...scheduleSheets(project, allSchedules(project).filter((t) => t.rows.length), (k) => spec(k ? `Schedules (${k + 1})` : 'Schedules', `A-${601 + k}`)));
  sheets.unshift(await coverSheet(project, spec('Cover Sheet', 'A-000'), sheets, env));
  return sheets;
}

/** Flow schedule tables into two columns per sheet, splitting long tables across sheets. */
function scheduleSheets(project: Project, tables: ScheduleTable[], spec: (k: number) => SheetSpec): Sheet[] {
  const out: Sheet[] = [];
  if (!tables.length) return out;
  let k = 0;
  let cur = blankSheet(project, spec(k), 0);
  const gap = 10;
  const colW = (cur.sheet.area.w - gap) / 2;
  let column = 0;
  // Paper space is y up: convert the area's top edge.
  const topY = () => cur.sheet.height - cur.sheet.area.y;
  let y = topY();
  const bottom = () => cur.sheet.height - (cur.sheet.area.y + cur.sheet.area.h);
  const nextColumn = () => {
    column++;
    if (column > 1) {
      out.push(finishSheet(cur.sheet, cur.builder));
      k++;
      cur = blankSheet(project, spec(k), 0);
      column = 0;
    }
    y = topY();
  };
  for (const t of tables) {
    let rows = t.rows;
    let first = true;
    while (first || rows.length) {
      const fresh = y === topY();
      const fit = Math.floor((y - bottom() - tableHeight(0, true)) / TABLE_STYLE.rowHeight);
      if (fit < Math.min(3, rows.length) && !fresh) {
        nextColumn();
        continue;
      }
      const chunk = rows.slice(0, Math.max(1, fit));
      const last = chunk.length === rows.length;
      const x = cur.sheet.area.x + column * (colW + gap);
      y -= drawTable(cur.builder, t, x, y, colW, chunk, last, !first) + 8;
      rows = rows.slice(chunk.length);
      first = false;
      if (rows.length) nextColumn();
    }
  }
  out.push(finishSheet(cur.sheet, cur.builder));
  return out;
}

/** Cover sheet: project title block, 3D view (viewport capture or axonometric) and drawing index. */
async function coverSheet(project: Project, spec: SheetSpec, sheets: Sheet[], env: ExportEnv): Promise<Sheet> {
  const { sheet, builder: b } = blankSheet(project, { ...spec, scaleText: 'NTS' }, 0);
  const A = sheet.area;
  const H = sheet.height;
  const T = 'G-ANNO-TEXT';
  const leftW = Math.min(150, A.w * 0.4);
  // Project identity (paper space is y up).
  let y = H - A.y - 4;
  const name = (project.info.name || 'Untitled Project').toUpperCase();
  const h1 = fitHeight(name, 10, leftW, true);
  b.text(T, { x: A.x, y: y - h1 }, name, h1, { align: 'left', valign: 'baseline', bold: true, tag: 'cover-title' });
  y -= h1 + 6;
  for (const [label, value] of [
    ['ADDRESS', project.info.address],
    ['AUTHOR', project.info.author],
    ['ISSUED', todayISO()],
  ] as const) {
    if (!value) continue;
    b.text(T, { x: A.x, y }, label, TEXT.tiny, { align: 'left', valign: 'top' });
    b.text(T, { x: A.x, y: y - 3 }, value, fitHeight(value, TEXT.normal, leftW), { align: 'left', valign: 'top' });
    y -= 10;
  }
  if (project.info.description) {
    for (const line of wrap(project.info.description, TEXT.small, leftW).slice(0, 6)) {
      b.text(T, { x: A.x, y }, line, TEXT.small, { align: 'left', valign: 'top' });
      y -= 4.5;
    }
  }
  // Drawing index.
  const index: ScheduleTable = {
    id: 'index',
    title: 'Drawing Index',
    columns: [
      { key: 'no', label: 'SHEET', align: 'left' },
      { key: 'title', label: 'TITLE', align: 'left' },
      { key: 'scale', label: 'SCALE', align: 'left' },
    ],
    rows: [[spec.number, 'Cover Sheet', 'NTS'], ...sheets.map((s) => [s.number, s.title, s.scale > 0 ? `1:${s.scale}` : 'NTS'])],
  };
  const idxTop = Math.min(y - 6, H - A.y - A.h + tableHeight(index.rows.length, false));
  drawTable(b, index, A.x, idxTop, leftW, index.rows, false);
  // 3D view.
  const img: Rect = { x: A.x + leftW + 10, y: A.y, w: A.w - leftW - 10, h: A.h };
  let placed = false;
  if (env.viewport) {
    try {
      const ratio = img.w / img.h;
      const pxW = 1600;
      const blob = await env.viewport.captureImage({ width: pxW, height: Math.round(pxW / ratio) });
      const data = new Uint8Array(await blob.arrayBuffer());
      const jpeg = blob.type === 'image/jpeg';
      sheet.images.push({ ...img, data, format: jpeg ? 'JPEG' : 'PNG' });
      placed = true;
    } catch {
      placed = false;
    }
  }
  if (!placed) {
    const axo = generateAxonometricDrawing(project, { scale: 100 });
    if (axo.bounds.minX <= axo.bounds.maxX) {
      const e = { w: (axo.bounds.maxX - axo.bounds.minX) / 100, h: (axo.bounds.maxY - axo.bounds.minY) / 100 };
      const k = Math.min((img.w - 10) / e.w, (img.h - 10) / e.h);
      // Scale chosen to fill the image area (not to a standard scale: the cover view is NTS).
      const s = 100 / k;
      sheet.views.push({ drawing: { ...axo, scale: s }, place: centreIn({ ...axo, scale: s }, img, s) });
    }
  }
  return finishSheet(sheet, b);
}

function wrap(text: string, h: number, maxW: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (textWidth(next, h) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Render sheets into a jsPDF document. */
export function sheetsToPDF(project: Project, sheets: Sheet[]): jsPDF {
  const first = sheets[0];
  const doc = new jsPDF({ unit: 'mm', format: [first?.width ?? 420, first?.height ?? 297], orientation: !first || first.width >= first.height ? 'landscape' : 'portrait', compress: true });
  doc.setProperties({ title: `${project.info.name || 'Project'} — Drawing Set`, subject: 'Construction drawings', author: project.info.author || '', creator: 'Crafting', keywords: 'BIM, drawings' });
  sheets.forEach((s, i) => {
    if (i > 0) doc.addPage([s.width, s.height], s.width >= s.height ? 'landscape' : 'portrait');
    const pen = new PDFPen(doc);
    for (const im of s.images) doc.addImage(im.data, im.format, im.x, im.y, im.w, im.h, undefined, 'FAST');
    renderSheet(s, pen);
  });
  return doc;
}

export async function exportPDF(project: Project, options: ExportOptions, env: ExportEnv): Promise<Blob> {
  const sheets = await drawingSet(project, options, env);
  const doc = sheetsToPDF(project, sheets);
  return new Blob([doc.output('arraybuffer')], { type: 'application/pdf' });
}
