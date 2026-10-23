/**
 * Tolerant ASCII DXF reader for plan linework.
 *
 * Supports HEADER ($INSUNITS, $MEASUREMENT), the LAYER table, BLOCKS and ENTITIES with LINE,
 * LWPOLYLINE (closed flag, bulges), POLYLINE/VERTEX/SEQEND, ARC and INSERT/MINSERT (nested blocks,
 * scale, rotation, OCS extrusion (0,0,−1) mirroring). Everything is flattened to 2D segments in
 * drawing units; curves are approximated by chords of at most ARC_STEP_DEG degrees.
 */
import type { Vec2 } from '../../core/types';

export const ARC_STEP_DEG = 10;
const MAX_BLOCK_DEPTH = 8;

export interface DxfSegment {
  a: Vec2;
  b: Vec2;
  layer: string;
}

interface Pair {
  code: number;
  value: string;
}

export interface DxfEntity {
  type: string;
  layer: string;
  pairs: Pair[];
  /** POLYLINE only: its VERTEX entities. */
  vertices?: DxfEntity[];
}

interface DxfBlock {
  name: string;
  base: Vec2;
  entities: DxfEntity[];
}

export interface DxfDocument {
  header: Map<string, Pair[]>;
  /** Layer names from the LAYER table, in table order. */
  tableLayers: string[];
  blocks: Map<string, DxfBlock>;
  entities: DxfEntity[];
}

/** Supported linework entity types (counted per layer for the import dialog). */
export const LINEWORK = new Set(['LINE', 'LWPOLYLINE', 'POLYLINE', 'ARC', 'INSERT']);

function tokenize(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (!Number.isFinite(code)) {
      // Resynchronise on malformed input: skip one line.
      i -= 1;
      continue;
    }
    pairs.push({ code, value: lines[i + 1].trim() });
  }
  return pairs;
}

/** Group pairs from one `0 TYPE` marker to the next into entities. */
function readEntities(pairs: Pair[], start: number, stop: (p: Pair) => boolean): { entities: DxfEntity[]; end: number } {
  const entities: DxfEntity[] = [];
  let i = start;
  let polyline: DxfEntity | null = null;
  while (i < pairs.length) {
    const p = pairs[i];
    if (p.code === 0 && stop(p)) break;
    if (p.code !== 0) {
      i++;
      continue;
    }
    const ent: DxfEntity = { type: p.value.toUpperCase(), layer: '0', pairs: [] };
    i++;
    while (i < pairs.length && pairs[i].code !== 0) {
      if (pairs[i].code === 8) ent.layer = pairs[i].value;
      ent.pairs.push(pairs[i]);
      i++;
    }
    if (ent.type === 'VERTEX' && polyline) {
      polyline.vertices!.push(ent);
      continue;
    }
    if (ent.type === 'SEQEND') {
      polyline = null;
      continue;
    }
    if (ent.type === 'POLYLINE') {
      ent.vertices = [];
      polyline = ent;
    } else polyline = null;
    entities.push(ent);
  }
  return { entities, end: i };
}

export function parseDxf(text: string): DxfDocument {
  const pairs = tokenize(text);
  const doc: DxfDocument = { header: new Map(), tableLayers: [], blocks: new Map(), entities: [] };
  let i = 0;
  while (i < pairs.length) {
    const p = pairs[i];
    if (!(p.code === 0 && p.value.toUpperCase() === 'SECTION')) {
      i++;
      continue;
    }
    const name = pairs[i + 1]?.code === 2 ? pairs[i + 1].value.toUpperCase() : '';
    i += 2;
    const isEnd = (q: Pair) => q.code === 0 && q.value.toUpperCase() === 'ENDSEC';
    if (name === 'HEADER') {
      let current: string | null = null;
      while (i < pairs.length && !isEnd(pairs[i])) {
        const q = pairs[i];
        if (q.code === 9) {
          current = q.value.toUpperCase();
          doc.header.set(current, []);
        } else if (current) doc.header.get(current)!.push(q);
        i++;
      }
    } else if (name === 'TABLES') {
      let inLayerTable = false;
      while (i < pairs.length && !isEnd(pairs[i])) {
        const q = pairs[i];
        if (q.code === 0 && q.value.toUpperCase() === 'TABLE') inLayerTable = pairs[i + 1]?.code === 2 && pairs[i + 1].value.toUpperCase() === 'LAYER';
        else if (q.code === 0 && q.value.toUpperCase() === 'ENDTAB') inLayerTable = false;
        else if (inLayerTable && q.code === 0 && q.value.toUpperCase() === 'LAYER') {
          for (let k = i + 1; k < pairs.length && pairs[k].code !== 0; k++) {
            if (pairs[k].code === 2) {
              if (!doc.tableLayers.includes(pairs[k].value)) doc.tableLayers.push(pairs[k].value);
              break;
            }
          }
        }
        i++;
      }
    } else if (name === 'BLOCKS') {
      while (i < pairs.length && !isEnd(pairs[i])) {
        const q = pairs[i];
        if (q.code === 0 && q.value.toUpperCase() === 'BLOCK') {
          const block: DxfBlock = { name: '', base: { x: 0, y: 0 }, entities: [] };
          i++;
          while (i < pairs.length && pairs[i].code !== 0) {
            const r = pairs[i];
            if (r.code === 2) block.name = r.value;
            else if (r.code === 10) block.base.x = Number(r.value) || 0;
            else if (r.code === 20) block.base.y = Number(r.value) || 0;
            i++;
          }
          const res = readEntities(pairs, i, (s) => s.value.toUpperCase() === 'ENDBLK' || s.value.toUpperCase() === 'ENDSEC');
          block.entities = res.entities;
          i = res.end;
          if (block.name) doc.blocks.set(block.name.toUpperCase(), block);
          if (pairs[i]?.value.toUpperCase() === 'ENDBLK') i++;
        } else i++;
      }
    } else if (name === 'ENTITIES') {
      const res = readEntities(pairs, i, isEnd);
      doc.entities.push(...res.entities);
      i = res.end;
    } else {
      while (i < pairs.length && !isEnd(pairs[i])) i++;
    }
    i++;
  }
  return doc;
}

const num = (e: DxfEntity, code: number, fallback = 0): number => {
  const p = e.pairs.find((q) => q.code === code);
  const v = p ? Number(p.value) : NaN;
  return Number.isFinite(v) ? v : fallback;
};
const str = (e: DxfEntity, code: number): string | undefined => e.pairs.find((q) => q.code === code)?.value;

/** Header integer variable (e.g. $INSUNITS), or undefined. */
export function headerInt(doc: DxfDocument, name: string): number | undefined {
  const v = doc.header.get(name.toUpperCase())?.find((p) => p.code === 70 || p.code === 280 || p.code === 290);
  const n = v ? parseInt(v.value, 10) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Millimetres per drawing unit for $INSUNITS codes (AutoCAD units enumeration). */
export const INSUNITS_TO_MM: Record<number, number> = {
  1: 25.4, // inches
  2: 304.8, // feet
  3: 1_609_344, // miles
  4: 1, // millimetres
  5: 10, // centimetres
  6: 1000, // metres
  7: 1_000_000, // kilometres
  8: 0.0000254, // microinches
  9: 0.0254, // mils
  10: 914.4, // yards
  11: 1e-7, // angstroms
  12: 1e-6, // nanometres
  13: 0.001, // microns
  14: 100, // decimetres
  15: 10_000, // decametres
  16: 100_000, // hectometres
  18: 1.495978707e14, // astronomical units (for completeness)
  21: 304.8006096, // US survey feet
};

type Xform = (p: Vec2) => Vec2;
const IDENT: Xform = (p) => p;

/** Bulge (tan(θ/4)) arc between a and b → intermediate points (excluding a, including b). */
export function bulgePoints(a: Vec2, b: Vec2, bulge: number): Vec2[] {
  if (Math.abs(bulge) < 1e-9) return [b];
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (chord < 1e-12) return [b];
  const dir = { x: (b.x - a.x) / chord, y: (b.y - a.y) / chord };
  // Centre: left of a→b for positive (counter-clockwise) bulges, at the signed sagitta distance.
  const off = ((chord / 2) * (1 - bulge * bulge)) / (2 * bulge);
  const c = { x: (a.x + b.x) / 2 - dir.y * off, y: (a.y + b.y) / 2 + dir.x * off };
  const r = Math.hypot(a.x - c.x, a.y - c.y);
  const a0 = Math.atan2(a.y - c.y, a.x - c.x);
  const n = Math.max(1, Math.ceil(Math.abs(theta) / ((ARC_STEP_DEG * Math.PI) / 180)));
  const out: Vec2[] = [];
  for (let k = 1; k < n; k++) {
    const t = a0 + (theta * k) / n;
    out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
  }
  out.push(b);
  return out;
}

function arcPoints(c: Vec2, r: number, startDeg: number, endDeg: number): Vec2[] {
  let sweep = endDeg - startDeg;
  while (sweep <= 0) sweep += 360;
  while (sweep > 360) sweep -= 360;
  const n = Math.max(1, Math.ceil(sweep / ARC_STEP_DEG));
  const out: Vec2[] = [];
  for (let k = 0; k <= n; k++) {
    const t = ((startDeg + (sweep * k) / n) * Math.PI) / 180;
    out.push({ x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) });
  }
  return out;
}

/** OCS → WCS for planar entities: only the (0,0,−1) extrusion (mirrored drawings) matters in plan. */
function ocs(e: DxfEntity): Xform {
  return num(e, 230, 1) < 0 ? (p) => ({ x: -p.x, y: p.y }) : IDENT;
}

/**
 * Flatten entities (expanding block references) into segments in drawing units.
 * `layerFilter` is applied to the effective layer (entities on layer "0" inside a block inherit
 * the INSERT's layer, as in AutoCAD).
 */
export function collectSegments(doc: DxfDocument, layerFilter?: (layer: string) => boolean): DxfSegment[] {
  const out: DxfSegment[] = [];
  const push = (pts: Vec2[], layer: string, xf: Xform, closed = false) => {
    const w = pts.map(xf);
    for (let k = 0; k + 1 < w.length; k++) out.push({ a: w[k], b: w[k + 1], layer });
    if (closed && w.length > 2) out.push({ a: w[w.length - 1], b: w[0], layer });
  };

  const walk = (entities: DxfEntity[], xf: Xform, inheritLayer: string | null, depth: number) => {
    for (const e of entities) {
      const layer = inheritLayer && e.layer === '0' ? inheritLayer : e.layer;
      if (e.type !== 'INSERT' && layerFilter && !layerFilter(layer)) continue;
      switch (e.type) {
        case 'LINE':
          push([{ x: num(e, 10), y: num(e, 20) }, { x: num(e, 11), y: num(e, 21) }], layer, xf);
          break;
        case 'LWPOLYLINE': {
          const verts: { p: Vec2; bulge: number }[] = [];
          for (const q of e.pairs) {
            if (q.code === 10) verts.push({ p: { x: Number(q.value) || 0, y: 0 }, bulge: 0 });
            else if (q.code === 20 && verts.length) verts[verts.length - 1].p.y = Number(q.value) || 0;
            else if (q.code === 42 && verts.length) verts[verts.length - 1].bulge = Number(q.value) || 0;
          }
          const closed = (num(e, 70) & 1) === 1;
          pushPoly(verts, closed, layer, compose(xf, ocs(e)));
          break;
        }
        case 'POLYLINE': {
          const flags = num(e, 70);
          if (flags & (16 | 64)) break; // polygon / polyface meshes are not linework
          const verts = (e.vertices ?? [])
            .filter((v) => !(num(v, 70) & 16))
            .map((v) => ({ p: { x: num(v, 10), y: num(v, 20) }, bulge: num(v, 42) }));
          pushPoly(verts, (flags & 1) === 1, layer, flags & 8 ? xf : compose(xf, ocs(e)));
          break;
        }
        case 'ARC': {
          const r = num(e, 40);
          if (r <= 0) break;
          push(arcPoints({ x: num(e, 10), y: num(e, 20) }, r, num(e, 50), num(e, 51)), layer, compose(xf, ocs(e)));
          break;
        }
        case 'INSERT': {
          if (depth >= MAX_BLOCK_DEPTH) break;
          const block = doc.blocks.get((str(e, 2) ?? '').toUpperCase());
          if (!block) break;
          const ins = { x: num(e, 10), y: num(e, 20) };
          const sx = num(e, 41, 1);
          const sy = num(e, 42, 1);
          const rot = (num(e, 50) * Math.PI) / 180;
          const cols = Math.max(1, Math.round(num(e, 70, 1)));
          const rows = Math.max(1, Math.round(num(e, 71, 1)));
          const dc = num(e, 44);
          const dr = num(e, 45);
          const extr = ocs(e);
          const cos = Math.cos(rot);
          const sin = Math.sin(rot);
          for (let ci = 0; ci < cols; ci++)
            for (let ri = 0; ri < rows; ri++) {
              const local: Xform = (p) => {
                const x = (p.x - block.base.x) * sx + ci * dc;
                const y = (p.y - block.base.y) * sy + ri * dr;
                return extr({ x: ins.x + cos * x - sin * y, y: ins.y + sin * x + cos * y });
              };
              walk(block.entities, compose(xf, local), layer, depth + 1);
            }
          break;
        }
        default:
          break;
      }
    }
  };

  function pushPoly(verts: { p: Vec2; bulge: number }[], closed: boolean, layer: string, xf: Xform) {
    if (verts.length < 2) return;
    const pts: Vec2[] = [verts[0].p];
    const n = closed ? verts.length : verts.length - 1;
    for (let k = 0; k < n; k++) {
      const a = verts[k];
      const b = verts[(k + 1) % verts.length];
      pts.push(...bulgePoints(a.p, b.p, a.bulge));
    }
    push(pts, layer, xf);
  }

  walk(doc.entities, IDENT, null, 0);
  return out;
}

/** outer(inner(p)). */
function compose(outer: Xform, inner: Xform): Xform {
  if (outer === IDENT) return inner;
  if (inner === IDENT) return outer;
  return (p) => outer(inner(p));
}

/** Linework entity count per effective layer (INSERTs count once on their own layer). */
export function layerCounts(doc: DxfDocument): Map<string, number> {
  const counts = new Map<string, number>();
  for (const l of doc.tableLayers) counts.set(l, 0);
  for (const e of doc.entities) {
    if (!counts.has(e.layer)) counts.set(e.layer, 0);
    if (LINEWORK.has(e.type)) counts.set(e.layer, counts.get(e.layer)! + 1);
  }
  return counts;
}
