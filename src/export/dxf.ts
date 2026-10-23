/**
 * DXF output: AutoCAD R2000 (AC1015) ASCII, model space in millimetres.
 *
 * Sections: HEADER ($ACADVER, $HANDSEED, $INSUNITS=4 mm, $MEASUREMENT=1 metric, extents, $LTSCALE
 * = drawing scale so paper-mm linetype patterns plot correctly), CLASSES, TABLES (VPORT, LTYPE,
 * LAYER with ACI colour / lineweight / linetype, STYLE, VIEW, UCS, APPID, DIMSTYLE, BLOCK_RECORD),
 * BLOCKS (*Model_Space, *Paper_Space), ENTITIES (LINE, LWPOLYLINE, ARC, CIRCLE, TEXT, HATCH with
 * solid fills or pattern definition lines; dimensions exploded onto their layer) and OBJECTS (root
 * dictionary, ACAD_GROUP, ACAD_LAYOUT with Model/Layout1, ACAD_PLOTSTYLENAME). Every object has a
 * unique handle and its owner (330) pointer; element ids are attached as CRAFTING XDATA.
 */
import type { Project, Vec2 } from '../core/types';
import { explodeDimension } from '../drawing/dimension';
import { ellipsePoints } from '../drawing/geom';
import { hatchFamilies, HATCHES } from '../drawing/hatch';
import { LINETYPE_DESCRIPTIONS, LINETYPE_PATTERNS } from '../drawing/layers';
import { generatePlanDrawing } from '../drawing/plan';
import { isNoFill, isWhite } from '../drawing/render';
import type { Drawing, DrawingEntity, DrawingLayer, Linetype } from '../drawing/types';
import type { ExportEnv, ExportOptions } from './types';

const LTYPE_NAMES: Record<Linetype, string> = {
  continuous: 'Continuous',
  dashed: 'DASHED',
  hidden: 'HIDDEN',
  center: 'CENTER',
  phantom: 'PHANTOM',
  dot: 'DOT',
};

/** Valid DXF lineweights (1/100 mm). */
const LINEWEIGHTS = [0, 5, 9, 13, 15, 18, 20, 25, 30, 35, 40, 50, 53, 60, 70, 80, 90, 100, 106, 120, 140, 158, 200, 211];

export function dxfLineweight(mm: number): number {
  const v = mm * 100;
  return LINEWEIGHTS.reduce((best, w) => (Math.abs(w - v) < Math.abs(best - v) ? w : best), LINEWEIGHTS[0]);
}

const hexRGB = (c: string): [number, number, number] => {
  let h = c.replace('#', '');
  if (h.length === 3) h = [...h].map((x) => x + x).join('');
  const v = parseInt(h.slice(0, 6), 16);
  return Number.isFinite(v) ? [(v >> 16) & 255, (v >> 8) & 255, v & 255] : [0, 0, 0];
};

/** AutoCAD Colour Index palette (approximation of the standard 255-colour table). */
const ACI: [number, number, number][] = (() => {
  const t: [number, number, number][] = new Array(256).fill([0, 0, 0]);
  const base: Record<number, [number, number, number]> = {
    1: [255, 0, 0],
    2: [255, 255, 0],
    3: [0, 255, 0],
    4: [0, 255, 255],
    5: [0, 0, 255],
    6: [255, 0, 255],
    7: [255, 255, 255],
    8: [128, 128, 128],
    9: [192, 192, 192],
  };
  for (const [k, v] of Object.entries(base)) t[Number(k)] = v;
  const hsv = (h: number, s: number, v: number): [number, number, number] => {
    const f = (n: number) => {
      const k = (n + h / 60) % 6;
      return Math.round(255 * (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))));
    };
    return [f(5), f(3), f(1)];
  };
  const values = [1, 0.8, 0.6, 0.5, 0.3];
  for (let i = 10; i < 250; i++) {
    const hue = Math.floor((i - 10) / 10) * 15;
    const sub = (i - 10) % 10;
    t[i] = hsv(hue, sub % 2 === 0 ? 1 : 0.5, values[Math.floor(sub / 2)]);
  }
  [51, 80, 105, 130, 190, 255].forEach((g, k) => (t[250 + k] = [g, g, g]));
  return t;
})();

/** Nearest ACI colour (black and white both map to 7, which plots black). */
export function nearestACI(color: string): number {
  const [r, g, b] = hexRGB(color);
  if ((r < 20 && g < 20 && b < 20) || (r > 245 && g > 245 && b > 245)) return 7;
  let best = 7;
  let bd = Infinity;
  for (let i = 1; i < 256; i++) {
    if (i === 7) continue;
    const [R, G, B] = ACI[i];
    const d = (R - r) ** 2 * 0.3 + (G - g) ** 2 * 0.59 + (B - b) ** 2 * 0.11;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Number formatting: plain decimal, no exponent, trailing zeros trimmed. */
function num(v: number): string {
  if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return '0.0';
  const s = v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '.0');
  return s === '-0.0' ? '0.0' : s;
}

/** Windows-1252 code points 0x80–0x9F (Unicode → byte). */
const CP1252_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89,
  0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};

const cp1252Byte = (c: number): number | undefined => (c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : CP1252_EXTRA[c]);

/**
 * Text for an ANSI_1252 R2000 file: characters outside Windows-1252 become \U+XXXX escapes and
 * control characters are dropped. Encode the final document with `encodeCP1252`.
 */
export function dxfText(s: string): string {
  let out = '';
  for (const ch of s.replace(/[\r\n\t]+/g, ' ')) {
    const c = ch.codePointAt(0)!;
    if (c < 32 || c === 127) continue;
    out += cp1252Byte(c) === undefined ? `\\U+${c.toString(16).toUpperCase().padStart(4, '0')}` : ch;
  }
  return out;
}

/** Encode a DXF document string as Windows-1252 bytes ($DWGCODEPAGE = ANSI_1252). */
export function encodeCP1252(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  let n = 0;
  for (const ch of text) out[n++] = cp1252Byte(ch.codePointAt(0)!) ?? 0x3f;
  return out.subarray(0, n);
}

class Out {
  readonly lines: string[] = [];
  /** Floating-point value. */
  pair(code: number, value: number): void {
    this.lines.push(String(code).padStart(3, ' '), num(value));
  }
  int(code: number, v: number): void {
    this.lines.push(String(code).padStart(3, ' '), String(Math.round(v)));
  }
  str(code: number, v: string): void {
    this.lines.push(String(code).padStart(3, ' '), v);
  }
  pt(code: number, p: Vec2, z = true): void {
    this.pair(code, p.x);
    this.pair(code + 10, p.y);
    if (z) this.pair(code + 20, 0);
  }
}

interface Placed {
  drawing: Drawing;
  dx: number;
  dy: number;
}

/** Serialise drawings to an ASCII DXF document (model space, mm). */
export function drawingsToDXF(drawings: Drawing[]): string {
  let next = 0x20;
  const H = () => (next++).toString(16).toUpperCase();
  // Layout drawings side by side: the first keeps model coordinates, the others follow to the right.
  const placed: Placed[] = [];
  let cursor = 0;
  for (const d of drawings) {
    const b = d.bounds;
    if (!(b.minX <= b.maxX)) {
      placed.push({ drawing: d, dx: 0, dy: 0 });
      continue;
    }
    const gap = Math.max(5000, (b.maxX - b.minX) * 0.1);
    const dx = placed.length === 0 ? 0 : cursor - b.minX;
    placed.push({ drawing: d, dx, dy: 0 });
    cursor = b.maxX + dx + gap;
  }
  const scale = drawings[0]?.scale ?? 100;

  // Layers: union of all drawings' layer lists (first definition wins) + layers used without definition.
  const layers = new Map<string, DrawingLayer>();
  for (const d of drawings) for (const l of d.layers) if (!layers.has(l.name)) layers.set(l.name, l);
  for (const d of drawings)
    for (const e of d.entities)
      if (!layers.has(e.layer)) layers.set(e.layer, { name: e.layer, color: '#000000', lineweight: 0.25, linetype: 'continuous', description: '' });

  // Fixed handles.
  const h = {
    rootDict: H(),
    tVport: H(),
    tLtype: H(),
    tLayer: H(),
    tStyle: H(),
    tView: H(),
    tUcs: H(),
    tAppid: H(),
    tDimstyle: H(),
    tBlockRec: H(),
    vport: H(),
    ltByBlock: H(),
    ltByLayer: H(),
    styleStd: H(),
    styleBold: H(),
    appAcad: H(),
    appCraft: H(),
    dimStd: H(),
    brModel: H(),
    brPaper: H(),
    blkModel: H(),
    endModel: H(),
    blkPaper: H(),
    endPaper: H(),
    dictGroup: H(),
    dictLayout: H(),
    dictPlot: H(),
    placeholder: H(),
    layoutModel: H(),
    layoutPaper: H(),
  };
  const ltypes = (Object.keys(LTYPE_NAMES) as Linetype[]).map((lt) => ({ lt, handle: H() }));
  const layerRecs = [
    { layer: { name: '0', color: '#000000', lineweight: 0.25, linetype: 'continuous' as Linetype, description: '' }, handle: H(), plot: true },
    { layer: { name: 'Defpoints', color: '#000000', lineweight: 0.25, linetype: 'continuous' as Linetype, description: '' }, handle: H(), plot: false },
    ...[...layers.values()].map((layer) => ({ layer, handle: H(), plot: true })),
  ];

  // ---- ENTITIES -----------------------------------------------------------
  const ent = new Out();
  const ext = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  const grow = (p: Vec2) => {
    ext.minX = Math.min(ext.minX, p.x);
    ext.minY = Math.min(ext.minY, p.y);
    ext.maxX = Math.max(ext.maxX, p.x);
    ext.maxY = Math.max(ext.maxY, p.y);
  };
  for (const { drawing, dx, dy } of placed) {
    const T = (p: Vec2): Vec2 => {
      const q = { x: p.x + dx, y: p.y + dy };
      grow(q);
      return q;
    };
    for (const e of drawing.entities) writeEntity(ent, e, drawing, layers.get(e.layer)!, T, H, h.brModel);
  }
  if (!(ext.minX <= ext.maxX)) {
    ext.minX = ext.minY = 0;
    ext.maxX = ext.maxY = 1000;
  }

  // ---- HEADER -------------------------------------------------------------
  const hd = new Out();
  hd.str(0, 'SECTION');
  hd.str(2, 'HEADER');
  const v = (name: string, fn: () => void) => {
    hd.str(9, name);
    fn();
  };
  v('$ACADVER', () => hd.str(1, 'AC1015'));
  v('$ACADMAINTVER', () => hd.int(70, 6));
  v('$DWGCODEPAGE', () => hd.str(3, 'ANSI_1252'));
  v('$INSBASE', () => hd.pt(10, { x: 0, y: 0 }));
  v('$EXTMIN', () => hd.pt(10, { x: ext.minX, y: ext.minY }));
  v('$EXTMAX', () => hd.pt(10, { x: ext.maxX, y: ext.maxY }));
  v('$LIMMIN', () => hd.pt(10, { x: ext.minX, y: ext.minY }, false));
  v('$LIMMAX', () => hd.pt(10, { x: ext.maxX, y: ext.maxY }, false));
  v('$LTSCALE', () => hd.pair(40, scale));
  v('$PSLTSCALE', () => hd.int(70, 1));
  v('$CELTSCALE', () => hd.pair(40, 1));
  v('$TEXTSIZE', () => hd.pair(40, 2.5 * scale));
  v('$TEXTSTYLE', () => hd.str(7, 'Standard'));
  v('$CLAYER', () => hd.str(8, '0'));
  v('$CELTYPE', () => hd.str(6, 'ByLayer'));
  v('$CECOLOR', () => hd.int(62, 256));
  v('$DIMSTYLE', () => hd.str(2, 'Standard'));
  v('$DIMSCALE', () => hd.pair(40, scale));
  v('$LUNITS', () => hd.int(70, 2));
  v('$LUPREC', () => hd.int(70, 0));
  v('$INSUNITS', () => hd.int(70, 4));
  v('$MEASUREMENT', () => hd.int(70, 1));
  v('$LWDISPLAY', () => hd.int(290, 1));
  v('$HANDSEED', () => hd.str(5, (next + 16).toString(16).toUpperCase()));
  hd.str(0, 'ENDSEC');

  // ---- CLASSES ------------------------------------------------------------
  const cl = new Out();
  cl.str(0, 'SECTION');
  cl.str(2, 'CLASSES');
  for (const [name, cpp] of [
    ['ACDBDICTIONARYWDFLT', 'AcDbDictionaryWithDefault'],
    ['ACDBPLACEHOLDER', 'AcDbPlaceHolder'],
    ['LAYOUT', 'AcDbLayout'],
  ]) {
    cl.str(0, 'CLASS');
    cl.str(1, name);
    cl.str(2, cpp);
    cl.str(3, 'ObjectDBX Classes');
    cl.int(90, 0);
    cl.int(280, 0);
    cl.int(281, 0);
  }
  cl.str(0, 'ENDSEC');

  // ---- TABLES -------------------------------------------------------------
  const tb = new Out();
  tb.str(0, 'SECTION');
  tb.str(2, 'TABLES');
  const table = (name: string, handle: string, count: number, body: () => void, dim = false) => {
    tb.str(0, 'TABLE');
    tb.str(2, name);
    tb.str(5, handle);
    tb.str(330, '0');
    tb.str(100, 'AcDbSymbolTable');
    tb.int(70, count);
    if (dim) tb.str(100, 'AcDbDimStyleTable');
    body();
    tb.str(0, 'ENDTAB');
  };
  const record = (type: string, handle: string, owner: string, sub: string, dimstyle = false) => {
    tb.str(0, type);
    tb.str(dimstyle ? 105 : 5, handle);
    tb.str(330, owner);
    tb.str(100, 'AcDbSymbolTableRecord');
    tb.str(100, sub);
  };
  const cx = (ext.minX + ext.maxX) / 2;
  const cy = (ext.minY + ext.maxY) / 2;
  table('VPORT', h.tVport, 1, () => {
    record('VPORT', h.vport, h.tVport, 'AcDbViewportTableRecord');
    tb.str(2, '*Active');
    tb.int(70, 0);
    tb.pt(10, { x: 0, y: 0 }, false);
    tb.pt(11, { x: 1, y: 1 }, false);
    tb.pt(12, { x: cx, y: cy }, false);
    tb.pt(13, { x: 0, y: 0 }, false);
    tb.pt(14, { x: 10, y: 10 }, false);
    tb.pt(15, { x: 10, y: 10 }, false);
    tb.pair(16, 0);
    tb.pair(26, 0);
    tb.pair(36, 1);
    tb.pt(17, { x: 0, y: 0 }, false);
    tb.pair(37, 0);
    tb.pair(40, Math.max(1, (ext.maxY - ext.minY) * 1.1));
    tb.pair(41, Math.max(0.2, Math.min(5, (ext.maxX - ext.minX) / Math.max(1, ext.maxY - ext.minY))));
    tb.pair(42, 50);
    tb.pair(43, 0);
    tb.pair(44, 0);
    tb.pair(50, 0);
    tb.pair(51, 0);
    for (const [c, val] of [
      [71, 0],
      [72, 1000],
      [73, 1],
      [74, 3],
      [75, 0],
      [76, 0],
      [77, 0],
      [78, 0],
      [281, 0],
      [65, 0],
    ])
      tb.int(c, val);
    tb.pair(146, 0);
  });
  table('LTYPE', h.tLtype, ltypes.length + 2, () => {
    for (const [name, handle] of [
      ['ByBlock', h.ltByBlock],
      ['ByLayer', h.ltByLayer],
    ]) {
      record('LTYPE', handle, h.tLtype, 'AcDbLinetypeTableRecord');
      tb.str(2, name);
      tb.int(70, 0);
      tb.str(3, '');
      tb.int(72, 65);
      tb.int(73, 0);
      tb.pair(40, 0);
    }
    for (const { lt, handle } of ltypes) {
      const pat = LINETYPE_PATTERNS[lt];
      record('LTYPE', handle, h.tLtype, 'AcDbLinetypeTableRecord');
      tb.str(2, LTYPE_NAMES[lt]);
      tb.int(70, 0);
      tb.str(3, LINETYPE_DESCRIPTIONS[lt]);
      tb.int(72, 65);
      tb.int(73, pat.length);
      tb.pair(40, pat.reduce((s, x) => s + Math.abs(x), 0));
      for (const d of pat) {
        tb.pair(49, d);
        tb.int(74, 0);
      }
    }
  });
  table('LAYER', h.tLayer, layerRecs.length, () => {
    for (const { layer, handle, plot } of layerRecs) {
      record('LAYER', handle, h.tLayer, 'AcDbLayerTableRecord');
      tb.str(2, layer.name);
      tb.int(70, 0);
      tb.int(62, layer.aci ?? nearestACI(layer.color));
      tb.str(6, LTYPE_NAMES[layer.linetype] ?? 'Continuous');
      if (!plot) tb.int(290, 0);
      tb.int(370, layer.name === '0' || layer.name === 'Defpoints' ? -3 : dxfLineweight(layer.lineweight));
      tb.str(390, h.placeholder);
    }
  });
  table('STYLE', h.tStyle, 2, () => {
    for (const [name, handle, font] of [
      ['Standard', h.styleStd, 'arial.ttf'],
      ['CRAFT_BOLD', h.styleBold, 'arialbd.ttf'],
    ]) {
      record('STYLE', handle, h.tStyle, 'AcDbTextStyleTableRecord');
      tb.str(2, name);
      tb.int(70, 0);
      tb.pair(40, 0);
      tb.pair(41, 1);
      tb.pair(50, 0);
      tb.int(71, 0);
      tb.pair(42, 2.5);
      tb.str(3, font);
      tb.str(4, '');
    }
  });
  table('VIEW', h.tView, 0, () => undefined);
  table('UCS', h.tUcs, 0, () => undefined);
  table('APPID', h.tAppid, 2, () => {
    for (const [name, handle] of [
      ['ACAD', h.appAcad],
      ['CRAFTING', h.appCraft],
    ]) {
      record('APPID', handle, h.tAppid, 'AcDbRegAppTableRecord');
      tb.str(2, name);
      tb.int(70, 0);
    }
  });
  table(
    'DIMSTYLE',
    h.tDimstyle,
    1,
    () => {
      record('DIMSTYLE', h.dimStd, h.tDimstyle, 'AcDbDimStyleTableRecord', true);
      tb.str(2, 'Standard');
      tb.int(70, 0);
      tb.str(3, '');
      tb.str(4, '');
      for (const [c, val] of [
        [40, scale],
        [41, 2.5],
        [42, 1.5],
        [43, 7],
        [44, 1.5],
        [140, 2.5],
        [141, 2.5],
        [142, 2.6],
        [147, 0.9],
      ])
        tb.pair(c, val);
      for (const [c, val] of [
        [71, 0],
        [72, 0],
        [73, 0],
        [74, 0],
        [77, 1],
        [78, 8],
        [271, 0],
        [272, 0],
        [277, 2],
      ])
        tb.int(c, val);
    },
    true,
  );
  table('BLOCK_RECORD', h.tBlockRec, 2, () => {
    for (const [name, handle, layout] of [
      ['*Model_Space', h.brModel, h.layoutModel],
      ['*Paper_Space', h.brPaper, h.layoutPaper],
    ]) {
      record('BLOCK_RECORD', handle, h.tBlockRec, 'AcDbBlockTableRecord');
      tb.str(2, name);
      tb.str(340, layout);
    }
  });
  tb.str(0, 'ENDSEC');

  // ---- BLOCKS -------------------------------------------------------------
  const bl = new Out();
  bl.str(0, 'SECTION');
  bl.str(2, 'BLOCKS');
  for (const [name, br, begin, end, paper] of [
    ['*Model_Space', h.brModel, h.blkModel, h.endModel, false],
    ['*Paper_Space', h.brPaper, h.blkPaper, h.endPaper, true],
  ] as const) {
    bl.str(0, 'BLOCK');
    bl.str(5, begin);
    bl.str(330, br);
    bl.str(100, 'AcDbEntity');
    if (paper) bl.int(67, 1);
    bl.str(8, '0');
    bl.str(100, 'AcDbBlockBegin');
    bl.str(2, name);
    bl.int(70, 0);
    bl.pt(10, { x: 0, y: 0 });
    bl.str(3, name);
    bl.str(1, '');
    bl.str(0, 'ENDBLK');
    bl.str(5, end);
    bl.str(330, br);
    bl.str(100, 'AcDbEntity');
    if (paper) bl.int(67, 1);
    bl.str(8, '0');
    bl.str(100, 'AcDbBlockEnd');
  }
  bl.str(0, 'ENDSEC');

  // ---- OBJECTS ------------------------------------------------------------
  const ob = new Out();
  ob.str(0, 'SECTION');
  ob.str(2, 'OBJECTS');
  const dict = (handle: string, owner: string, entries: [string, string][]) => {
    ob.str(0, 'DICTIONARY');
    ob.str(5, handle);
    ob.str(330, owner);
    ob.str(100, 'AcDbDictionary');
    ob.int(281, 1);
    for (const [k, val] of entries) {
      ob.str(3, k);
      ob.str(350, val);
    }
  };
  dict(h.rootDict, '0', [
    ['ACAD_GROUP', h.dictGroup],
    ['ACAD_LAYOUT', h.dictLayout],
    ['ACAD_PLOTSTYLENAME', h.dictPlot],
  ]);
  dict(h.dictGroup, h.rootDict, []);
  dict(h.dictLayout, h.rootDict, [
    ['Layout1', h.layoutPaper],
    ['Model', h.layoutModel],
  ]);
  ob.str(0, 'ACDBDICTIONARYWDFLT');
  ob.str(5, h.dictPlot);
  ob.str(330, h.rootDict);
  ob.str(100, 'AcDbDictionary');
  ob.int(281, 1);
  ob.str(3, 'Normal');
  ob.str(350, h.placeholder);
  ob.str(100, 'AcDbDictionaryWithDefault');
  ob.str(340, h.placeholder);
  ob.str(0, 'ACDBPLACEHOLDER');
  ob.str(5, h.placeholder);
  ob.str(330, h.dictPlot);
  for (const [name, handle, br, flag, tab] of [
    ['Model', h.layoutModel, h.brModel, 1024, 0],
    ['Layout1', h.layoutPaper, h.brPaper, 0, 1],
  ] as const) {
    ob.str(0, 'LAYOUT');
    ob.str(5, handle);
    ob.str(330, h.dictLayout);
    ob.str(100, 'AcDbPlotSettings');
    ob.str(1, '');
    ob.str(4, 'A3');
    ob.str(6, '');
    for (const [c, val] of [
      [40, 7.5],
      [41, 20],
      [42, 7.5],
      [43, 20],
      [44, 420],
      [45, 297],
      [46, 0],
      [47, 0],
      [48, 0],
      [49, 0],
      [140, 0],
      [141, 0],
      [142, 1],
      [143, 1],
    ])
      ob.pair(c, val);
    ob.int(70, flag);
    ob.int(72, 1);
    ob.int(73, 0);
    ob.int(74, 5);
    ob.str(7, '');
    ob.int(75, 16);
    ob.int(76, 0);
    ob.int(77, 2);
    ob.int(78, 300);
    ob.pair(147, 1);
    ob.pair(148, 0);
    ob.pair(149, 0);
    ob.str(100, 'AcDbLayout');
    ob.str(1, name);
    ob.int(70, 1);
    ob.int(71, tab);
    ob.pt(10, { x: 0, y: 0 }, false);
    ob.pt(11, { x: 420, y: 297 }, false);
    ob.pt(12, { x: 0, y: 0 });
    ob.pt(14, { x: ext.minX, y: ext.minY });
    ob.pt(15, { x: ext.maxX, y: ext.maxY });
    ob.pair(146, 0);
    ob.pt(13, { x: 0, y: 0 });
    ob.pt(16, { x: 1, y: 0 });
    ob.pt(17, { x: 0, y: 1 });
    ob.int(76, 1);
    ob.str(330, br);
  }
  ob.str(0, 'ENDSEC');

  const en = new Out();
  en.str(0, 'SECTION');
  en.str(2, 'ENTITIES');
  en.lines.push(...ent.lines);
  en.str(0, 'ENDSEC');

  return [...hd.lines, ...cl.lines, ...tb.lines, ...bl.lines, ...en.lines, ...ob.lines, '  0', 'EOF', ''].join('\r\n');
}

function writeEntity(o: Out, e: DrawingEntity, d: Drawing, layer: DrawingLayer, T: (p: Vec2) => Vec2, H: () => string, owner: string): void {
  const s = d.scale;
  const head = (type: string, overrides: { color?: string; linetype?: Linetype; lineweight?: number; aci?: number } = e) => {
    o.str(0, type);
    o.str(5, H());
    o.str(330, owner);
    o.str(100, 'AcDbEntity');
    o.str(8, e.layer);
    if (overrides.linetype && overrides.linetype !== layer.linetype) o.str(6, LTYPE_NAMES[overrides.linetype]);
    if (overrides.aci !== undefined) o.int(62, overrides.aci);
    else if (overrides.color) o.int(62, nearestACI(overrides.color));
    if (overrides.lineweight !== undefined && Math.abs(overrides.lineweight - layer.lineweight) > 1e-6) o.int(370, dxfLineweight(overrides.lineweight));
  };
  const xdata = () => {
    if (!e.elementId) return;
    o.str(1001, 'CRAFTING');
    o.str(1000, dxfText(e.elementId));
  };
  const lwpoly = (pts: Vec2[], closed: boolean, ov?: Parameters<typeof head>[1]) => {
    if (pts.length < 2) return;
    head('LWPOLYLINE', ov);
    o.str(100, 'AcDbPolyline');
    o.int(90, pts.length);
    o.int(70, closed ? 1 : 0);
    o.pair(43, 0);
    for (const p of pts) o.pt(10, T(p), false);
    xdata();
  };
  const line = (a: Vec2, b: Vec2, ov?: Parameters<typeof head>[1]) => {
    head('LINE', ov);
    o.str(100, 'AcDbLine');
    o.pt(10, T(a));
    o.pt(11, T(b));
    xdata();
  };
  const text = (p: Vec2, str: string, height: number, rotation: number, align: 'left' | 'center' | 'right', valign: string, bold?: boolean) => {
    const t = dxfText(str);
    if (!t) return;
    head('TEXT', { color: e.color });
    o.str(100, 'AcDbText');
    const q = T(p);
    o.pt(10, q);
    o.pair(40, height * s);
    o.str(1, t);
    if (Math.abs(rotation) > 1e-9) o.pair(50, ((rotation % 360) + 360) % 360);
    o.str(7, bold ? 'CRAFT_BOLD' : 'Standard');
    const h72 = align === 'left' ? 0 : align === 'center' ? 1 : 2;
    const v73 = valign === 'baseline' ? 0 : valign === 'bottom' ? 1 : valign === 'middle' ? 2 : 3;
    if (h72 || v73) {
      o.int(72, h72);
      o.pt(11, q);
    }
    o.str(100, 'AcDbText');
    if (v73) o.int(73, v73);
    xdata();
  };
  const hatch = (rings: Vec2[][], solid: boolean, aci: number | undefined, pattern?: Exclude<NonNullable<Extract<DrawingEntity, { kind: 'fill' }>['hatch']>, 'none' | 'solid'>, spacing = 1, angle = 0) => {
    const rs = rings.filter((r) => r.length >= 3);
    if (!rs.length) return;
    head('HATCH', { aci, lineweight: undefined, linetype: undefined });
    o.str(100, 'AcDbHatch');
    o.pt(10, { x: 0, y: 0 });
    o.pair(210, 0);
    o.pair(220, 0);
    o.pair(230, 1);
    o.str(2, solid ? 'SOLID' : HATCHES[pattern!].dxfName);
    o.int(70, solid ? 1 : 0);
    o.int(71, 0);
    o.int(91, rs.length);
    rs.forEach((r, i) => {
      o.int(92, i === 0 ? 3 : 2);
      o.int(72, 0);
      o.int(73, 1);
      o.int(93, r.length);
      for (const p of r) o.pt(10, T(p), false);
      o.int(97, 0);
    });
    o.int(75, 0);
    o.int(76, solid ? 1 : HATCHES[pattern!].dxfType);
    if (!solid) {
      const fams = hatchFamilies(pattern!, spacing, angle);
      o.pair(52, angle);
      o.pair(41, spacing / 3.175);
      o.int(77, 0);
      o.int(78, fams.length);
      for (const f of fams) {
        const base = T(f.origin);
        o.pair(53, f.angle);
        o.pair(43, base.x);
        o.pair(44, base.y);
        o.pair(45, f.offset.x);
        o.pair(46, f.offset.y);
        o.int(79, f.dashes.length);
        for (const dash of f.dashes) o.pair(49, dash);
      }
    }
    o.int(98, 0);
    xdata();
  };

  switch (e.kind) {
    case 'line':
      line(e.a, e.b);
      break;
    case 'polyline':
      lwpoly(e.points, e.closed);
      break;
    case 'fill': {
      const rings = [e.outline, ...(e.holes ?? [])];
      // White fills only mask on screen; in CAD they would plot as solid black (ACI 7).
      if (!isNoFill(e.fill) && !isWhite(e.fill)) hatch(rings, true, nearestACI(e.fill));
      if (e.hatch === 'solid') hatch(rings, true, e.color ? nearestACI(e.color) : undefined);
      else if (e.hatch && e.hatch !== 'none') {
        const spacing = (e.hatchSpacing ?? HATCHES[e.hatch].paperSpacing) * s;
        hatch(rings, false, e.color ? nearestACI(e.color) : undefined, e.hatch, spacing, e.hatchAngle ?? 0);
      }
      if (e.stroke) for (const r of rings) if (r.length >= 2) lwpoly(r, true);
      break;
    }
    case 'arc':
      head('ARC');
      o.str(100, 'AcDbCircle');
      o.pt(10, T(e.center));
      o.pair(40, e.radius);
      o.str(100, 'AcDbArc');
      o.pair(50, ((e.startAngle % 360) + 360) % 360);
      o.pair(51, ((e.endAngle % 360) + 360) % 360);
      xdata();
      break;
    case 'circle':
      if (e.fill && !isNoFill(e.fill) && !isWhite(e.fill)) hatch([ellipsePoints(e.center, e.radius, e.radius, 48)], true, nearestACI(e.fill));
      head('CIRCLE');
      o.str(100, 'AcDbCircle');
      o.pt(10, T(e.center));
      o.pair(40, e.radius);
      xdata();
      break;
    case 'text':
      text(e.position, e.text, e.height, e.rotation, e.align, e.valign, e.bold);
      break;
    case 'dimension': {
      const x = explodeDimension(e, s, d.units);
      for (const seg of [...x.extensions, x.line]) line(seg[0], seg[1]);
      for (const t of x.ticks) line(t[0], t[1], { ...e, lineweight: 0.35 });
      if (x.text) text(x.text.position, x.text.text, x.text.height, x.text.rotation, 'center', x.text.valign);
      break;
    }
  }
}

export async function exportDXF(project: Project, options: ExportOptions, _env: ExportEnv): Promise<Blob> {
  const ids = options.levelIds?.length ? options.levelIds : project.levels.map((l) => l.id);
  const drawings = ids.map((id) =>
    generatePlanDrawing(project, id, {
      scale: options.scale ?? 100,
      includeFurniture: options.includeFurniture ?? true,
      includeDimensions: options.includeAnnotations ?? true,
      includeRoomTags: options.includeAnnotations ?? true,
    }),
  );
  return new Blob([encodeCP1252(drawingsToDXF(drawings)) as BlobPart], { type: 'image/vnd.dxf' });
}
