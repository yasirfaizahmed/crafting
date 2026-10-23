/**
 * Schedules (door, window, room) and wall quantity take-off as table rows, plus a paper-space
 * table layout used by the PDF drawing set.
 */
import { polygonArea, polygonPerimeter } from '../core/math2d';
import type { Door, Element, Opening, Project, Room, UnitSystem, Wall, Window } from '../core/types';
import { formatArea, formatLength, formatVolume } from '../core/units';
import { wallHeight, wallLength } from '../core/walls';
import { floorMaterialForRoom } from '../core/autobuild';
import { getMaterial, materialFor } from '../core/materials';
import type { DrawingBuilder } from './builder';
import { PEN, TEXT } from './layers';
import { fitHeight } from './sheet';
import { textWidth } from './text';

export interface ScheduleColumn {
  key: string;
  label: string;
  align: 'left' | 'center' | 'right';
}

export interface ScheduleTable {
  id: 'doors' | 'windows' | 'rooms' | 'walls' | string;
  title: string;
  columns: ScheduleColumn[];
  rows: string[][];
  /** Optional totals row (same column count). */
  totals?: string[];
}

const col = (key: string, label: string, align: ScheduleColumn['align'] = 'left'): ScheduleColumn => ({ key, label, align });

const levelOrder = (p: Project) => new Map([...p.levels].sort((a, b) => a.elevation - b.elevation).map((l, i) => [l.id, i]));
const levelName = (p: Project, id: string) => p.levels.find((l) => l.id === id)?.name ?? '—';

const mmText = (v: number, units: UnitSystem) => (units === 'imperial' ? formatLength(v, 'imperial') : `${Math.round(v)}`);
const mText = (v: number, units: UnitSystem) => (units === 'imperial' ? formatLength(v, 'imperial') : (v / 1000).toFixed(2));
const areaText = (v: number, units: UnitSystem) => (units === 'imperial' ? formatArea(v, 'imperial') : (v / 1e6).toFixed(2));
const volText = (v: number, units: UnitSystem) => (units === 'imperial' ? formatVolume(v, 'imperial') : (v / 1e9).toFixed(3));

const STYLE_LABEL: Record<string, string> = {
  single: 'Single swing',
  double: 'Double swing',
  sliding: 'Sliding',
  pocket: 'Pocket',
  garage: 'Overhead (garage)',
  opening: 'Cased opening',
  casement: 'Casement',
  fixed: 'Fixed',
  awning: 'Awning',
  'double-hung': 'Double hung',
};

function sortedOpenings<T extends Opening>(p: Project, type: T['type']): T[] {
  const order = levelOrder(p);
  const list = Object.values(p.elements).filter((e): e is T => e.type === type && !e.hidden) as T[];
  const pos = (o: Opening) => {
    const host = p.elements[o.hostId];
    if (!host || host.type !== 'wall') return { x: 0, y: 0 };
    const t = wallLength(host) > 0 ? o.offset / wallLength(host) : 0;
    return { x: host.start.x + (host.end.x - host.start.x) * t, y: host.start.y + (host.end.y - host.start.y) * t };
  };
  return list.sort((a, b) => {
    const la = order.get(a.levelId) ?? 0;
    const lb = order.get(b.levelId) ?? 0;
    if (la !== lb) return la - lb;
    const pa = pos(a);
    const pb = pos(b);
    // Reading order on the plan: top (north) to bottom, then west to east.
    return Math.abs(pa.y - pb.y) > 1 ? pb.y - pa.y : pa.x - pb.x;
  });
}

/** Marks for doors (D01…) and windows (W01…), numbered per type in level / reading order. */
export function openingMarks(p: Project): Map<string, string> {
  const marks = new Map<string, string>();
  sortedOpenings<Door>(p, 'door').forEach((d, i) => marks.set(d.id, `D${String(i + 1).padStart(2, '0')}`));
  sortedOpenings<Window>(p, 'window').forEach((w, i) => marks.set(w.id, `W${String(i + 1).padStart(2, '0')}`));
  return marks;
}

function hostText(p: Project, o: Opening): string {
  const host = p.elements[o.hostId];
  if (!host || host.type !== 'wall') return '—';
  return `${Math.round(host.thickness)} ${materialFor(host).name.replace(/ — .*/, '')}`;
}

export function doorSchedule(p: Project): ScheduleTable {
  const u = p.settings.units;
  const marks = openingMarks(p);
  const rows = sortedOpenings<Door>(p, 'door').map((d) => [
    marks.get(d.id)!,
    levelName(p, d.levelId),
    STYLE_LABEL[d.style] ?? d.style,
    mmText(d.width, u),
    mmText(d.height, u),
    d.style === 'single' || d.style === 'double' || d.style === 'pocket' ? `${d.hinge === 'left' ? 'L' : 'R'}${d.flip ? ' (rev.)' : ''}` : '—',
    materialFor(d).name,
    hostText(p, d),
  ]);
  return {
    id: 'doors',
    title: 'Door Schedule',
    columns: [col('mark', 'MARK'), col('level', 'LEVEL'), col('type', 'TYPE'), col('w', 'WIDTH', 'right'), col('h', 'HEIGHT', 'right'), col('hand', 'HAND', 'center'), col('mat', 'MATERIAL'), col('wall', 'WALL')],
    rows,
    totals: rows.length ? [`${rows.length} doors`, '', '', '', '', '', '', ''] : undefined,
  };
}

export function windowSchedule(p: Project): ScheduleTable {
  const u = p.settings.units;
  const marks = openingMarks(p);
  let glazed = 0;
  const rows = sortedOpenings<Window>(p, 'window').map((w) => {
    glazed += w.width * w.height;
    return [
      marks.get(w.id)!,
      levelName(p, w.levelId),
      STYLE_LABEL[w.style] ?? w.style,
      mmText(w.width, u),
      mmText(w.height, u),
      mmText(w.sill, u),
      mmText(w.sill + w.height, u),
      areaText(w.width * w.height, u),
      hostText(p, w),
    ];
  });
  return {
    id: 'windows',
    title: 'Window Schedule',
    columns: [
      col('mark', 'MARK'),
      col('level', 'LEVEL'),
      col('type', 'TYPE'),
      col('w', 'WIDTH', 'right'),
      col('h', 'HEIGHT', 'right'),
      col('sill', 'SILL', 'right'),
      col('head', 'HEAD', 'right'),
      col('area', u === 'imperial' ? 'AREA' : 'AREA m²', 'right'),
      col('wall', 'WALL'),
    ],
    rows,
    totals: rows.length ? [`${rows.length} windows`, '', '', '', '', '', '', areaText(glazed, u), ''] : undefined,
  };
}

export function roomSchedule(p: Project): ScheduleTable {
  const u = p.settings.units;
  const order = levelOrder(p);
  const rooms = Object.values(p.elements)
    .filter((e): e is Room => e.type === 'room' && !e.hidden && e.outline.length >= 3)
    .sort((a, b) => (order.get(a.levelId) ?? 0) - (order.get(b.levelId) ?? 0) || (a.number ?? '').localeCompare(b.number ?? '', undefined, { numeric: true }) || a.name.localeCompare(b.name));
  let total = 0;
  const rows = rooms.map((r) => {
    const area = polygonArea(r.outline);
    total += area;
    return [r.number ?? '—', r.name || 'Room', levelName(p, r.levelId), areaText(area, u), mText(polygonPerimeter(r.outline), u), getMaterial(floorMaterialForRoom(r)).name];
  });
  return {
    id: 'rooms',
    title: 'Room Schedule',
    columns: [col('no', 'NO.'), col('name', 'NAME'), col('level', 'LEVEL'), col('area', u === 'imperial' ? 'AREA' : 'AREA m²', 'right'), col('perim', u === 'imperial' ? 'PERIMETER' : 'PERIMETER m', 'right'), col('floor', 'FLOOR FINISH')],
    rows,
    totals: rows.length ? [`${rows.length} rooms`, '', 'Total', areaText(total, u), '', ''] : undefined,
  };
}

/** Wall quantity take-off grouped by type (material, thickness, structural). */
export function wallQuantities(p: Project): ScheduleTable {
  const u = p.settings.units;
  const groups = new Map<string, { label: string; structural: boolean; count: number; length: number; gross: number; openings: number; volume: number }>();
  const openings = Object.values(p.elements).filter((e): e is Opening => (e.type === 'door' || e.type === 'window') && !e.hidden);
  for (const w of Object.values(p.elements) as Element[]) {
    if (w.type !== 'wall' || w.hidden) continue;
    const wall = w as Wall;
    const mat = materialFor(wall);
    const key = `${mat.id}|${Math.round(wall.thickness)}|${wall.structural}`;
    const g = groups.get(key) ?? { label: `${Math.round(wall.thickness)} mm ${mat.name}`, structural: wall.structural, count: 0, length: 0, gross: 0, openings: 0, volume: 0 };
    const len = wallLength(wall);
    const h = wallHeight(p, wall);
    const op = openings.filter((o) => o.hostId === wall.id).reduce((s, o) => s + o.width * Math.min(o.height, Math.max(0, h - o.sill)), 0);
    g.count++;
    g.length += len;
    g.gross += len * h;
    g.openings += op;
    g.volume += (len * h - op) * wall.thickness;
    groups.set(key, g);
  }
  const list = [...groups.values()].sort((a, b) => Number(b.structural) - Number(a.structural) || b.length - a.length);
  const sum = (k: 'length' | 'gross' | 'openings' | 'volume') => list.reduce((s, g) => s + g[k], 0);
  return {
    id: 'walls',
    title: 'Wall Quantities',
    columns: [
      col('type', 'WALL TYPE'),
      col('str', 'STRUCT.', 'center'),
      col('n', 'COUNT', 'right'),
      col('len', u === 'imperial' ? 'LENGTH' : 'LENGTH m', 'right'),
      col('gross', u === 'imperial' ? 'GROSS AREA' : 'GROSS m²', 'right'),
      col('open', u === 'imperial' ? 'OPENINGS' : 'OPENINGS m²', 'right'),
      col('net', u === 'imperial' ? 'NET AREA' : 'NET m²', 'right'),
      col('vol', u === 'imperial' ? 'VOLUME' : 'VOLUME m³', 'right'),
    ],
    rows: list.map((g) => [g.label, g.structural ? 'Yes' : 'No', `${g.count}`, mText(g.length, u), areaText(g.gross, u), areaText(g.openings, u), areaText(g.gross - g.openings, u), volText(g.volume, u)]),
    totals: list.length
      ? ['Total', '', `${list.reduce((s, g) => s + g.count, 0)}`, mText(sum('length'), u), areaText(sum('gross'), u), areaText(sum('openings'), u), areaText(sum('gross') - sum('openings'), u), volText(sum('volume'), u)]
      : undefined,
  };
}

export function allSchedules(p: Project): ScheduleTable[] {
  return [doorSchedule(p), windowSchedule(p), roomSchedule(p), wallQuantities(p)];
}

// ---------------------------------------------------------------------------
// Paper layout
// ---------------------------------------------------------------------------

export const TABLE_STYLE = { rowHeight: 6, headerHeight: 7, titleGap: 3, pad: 1.6, text: TEXT.small, title: TEXT.normal };

/** Natural column widths (paper mm) fitted to `maxWidth`. */
export function columnWidths(t: ScheduleTable, maxWidth: number): number[] {
  const S = TABLE_STYLE;
  const w = t.columns.map((c, i) => {
    let m = textWidth(c.label, S.text, true);
    for (const r of [...t.rows, ...(t.totals ? [t.totals] : [])]) m = Math.max(m, textWidth(r[i] ?? '', S.text));
    return m + 2 * S.pad;
  });
  const total = w.reduce((s, x) => s + x, 0);
  return total > maxWidth ? w.map((x) => (x * maxWidth) / total) : w;
}

/** Height of a table chunk with `rows` body rows (paper mm). */
export function tableHeight(rows: number, withTotals: boolean): number {
  const S = TABLE_STYLE;
  return S.title + S.titleGap + S.headerHeight + (rows + (withTotals ? 1 : 0)) * S.rowHeight;
}

/**
 * Draw a table into a paper-space builder (y up) with its top-left at (x, top). Returns the
 * height used. `rows` defaults to all rows; `continued` adds "(cont.)" to the title.
 */
export function drawTable(b: DrawingBuilder, t: ScheduleTable, x: number, top: number, maxWidth: number, rows = t.rows, withTotals = true, continued = false): number {
  const S = TABLE_STYLE;
  const L = 'G-ANNO-TABL';
  const widths = columnWidths(t, maxWidth);
  const width = widths.reduce((s, v) => s + v, 0);
  b.text(L, { x, y: top - S.title }, `${t.title.toUpperCase()}${continued ? ' (CONT.)' : ''}`, S.title, { align: 'left', valign: 'baseline', bold: true, tag: 'table-title' });
  let y = top - S.title - S.titleGap;
  const y0 = y;
  const body = [...rows.map((r) => ({ r, total: false })), ...(withTotals && t.totals ? [{ r: t.totals, total: true }] : [])];
  // Header.
  b.fill(L, [{ x, y }, { x: x + width, y }, { x: x + width, y: y - S.headerHeight }, { x, y: y - S.headerHeight }], '#e6e6e6', { tag: 'table-header' });
  let cx = x;
  t.columns.forEach((c, i) => {
    cellText(b, c.label, cx, y - S.headerHeight / 2, widths[i], c.align, true);
    cx += widths[i];
  });
  y -= S.headerHeight;
  b.line(L, { x, y }, { x: x + width, y }, { lineweight: PEN.medium });
  for (const { r, total } of body) {
    cx = x;
    if (total) b.line(L, { x, y }, { x: x + width, y }, { lineweight: PEN.thin });
    t.columns.forEach((c, i) => {
      cellText(b, r[i] ?? '', cx, y - S.rowHeight / 2, widths[i], c.align, total);
      cx += widths[i];
    });
    y -= S.rowHeight;
    if (!total) b.line(L, { x, y }, { x: x + width, y }, { lineweight: PEN.extraFine, tag: 'row-line' });
  }
  // Frame and column rules.
  b.polyline(L, [{ x, y: y0 }, { x: x + width, y: y0 }, { x: x + width, y }, { x, y }], true, { lineweight: PEN.medium, tag: 'table-frame' });
  cx = x;
  for (let i = 0; i < widths.length - 1; i++) {
    cx += widths[i];
    b.line(L, { x: cx, y: y0 }, { x: cx, y }, { lineweight: PEN.extraFine });
  }
  return top - y;
}

function cellText(b: DrawingBuilder, text: string, x: number, midY: number, w: number, align: ScheduleColumn['align'], bold: boolean): void {
  if (!text) return;
  const S = TABLE_STYLE;
  const h = fitHeight(text, S.text, w - 2 * S.pad, bold);
  const px = align === 'left' ? x + S.pad : align === 'right' ? x + w - S.pad : x + w / 2;
  b.text('G-ANNO-TABL', { x: px, y: midY }, text, h, { align, valign: 'middle', bold, tag: 'cell' });
}
