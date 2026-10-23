/** DXF import: layer listing and linework → walls. */
import { createElement } from '../../core/defaults';
import type { Element, Vec2 } from '../../core/types';
import { collectSegments, headerInt, INSUNITS_TO_MM, layerCounts, parseDxf, type DxfDocument } from './reader';
import { linesToWalls } from './walls';

export interface DXFUnitsInfo {
  /** $INSUNITS value (undefined when the header does not say). */
  insunits?: number;
  /** Millimetres per drawing unit that will be used. */
  unitScale: number;
  /** How the scale was determined. */
  source: 'header' | 'measurement' | 'guess';
}

export interface DXFInspection {
  layers: { name: string; entityCount: number }[];
  units: DXFUnitsInfo;
  /** Linework extents in drawing units. */
  extents: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

/** Drawing extents of a set of points (or null). */
function extentsOf(points: Vec2[]): DXFInspection['extents'] {
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Unit scale from $INSUNITS; for unitless drawings use $MEASUREMENT (0 = imperial → inches),
 * otherwise guess from the extents (a building plan smaller than 500 units is in metres).
 */
export function detectUnits(doc: DxfDocument): DXFUnitsInfo {
  const ins = headerInt(doc, '$INSUNITS');
  if (ins !== undefined && INSUNITS_TO_MM[ins]) return { insunits: ins, unitScale: INSUNITS_TO_MM[ins], source: 'header' };
  const measurement = headerInt(doc, '$MEASUREMENT');
  if (measurement === 0) return { insunits: ins, unitScale: 25.4, source: 'measurement' };
  const ext = extentsOf(collectSegments(doc).flatMap((s) => [s.a, s.b]));
  const size = ext ? Math.max(ext.maxX - ext.minX, ext.maxY - ext.minY) : 0;
  return { insunits: ins, unitScale: size > 0 && size < 500 ? 1000 : 1, source: 'guess' };
}

export function inspectDXF(text: string): DXFInspection {
  const doc = parseDxf(text);
  const counts = layerCounts(doc);
  const layers = [...counts.entries()].map(([name, entityCount]) => ({ name, entityCount }));
  layers.sort((a, b) => b.entityCount - a.entityCount || a.name.localeCompare(b.name));
  return { layers, units: detectUnits(doc), extents: extentsOf(collectSegments(doc).flatMap((s) => [s.a, s.b])) };
}

export interface DXFWallImportOptions {
  levelId: string;
  layers?: string[];
  unitScale?: number;
  wallThickness: number;
  detectDoubleLines: boolean;
  minLength?: number;
  /** Move far-away drawings (survey coordinates) next to the origin. Default: when > 100 m away. */
  recenter?: boolean;
}

/** DXF linework → Wall elements on `levelId` (not added to any store). */
export function dxfToWalls(text: string, options: DXFWallImportOptions): Element[] {
  const doc = parseDxf(text);
  const filter = options.layers?.length ? new Set(options.layers) : null;
  const scale = options.unitScale && options.unitScale > 0 ? options.unitScale : detectUnits(doc).unitScale;
  let segs = collectSegments(doc, filter ? (l) => filter.has(l) : undefined).map((s) => ({
    a: { x: s.a.x * scale, y: s.a.y * scale },
    b: { x: s.b.x * scale, y: s.b.y * scale },
    layer: s.layer,
  }));
  segs = segs.filter((s) => [s.a.x, s.a.y, s.b.x, s.b.y].every(Number.isFinite));
  const ext = extentsOf(segs.flatMap((s) => [s.a, s.b]));
  if (ext) {
    const far = Math.max(Math.abs(ext.minX), Math.abs(ext.maxX), Math.abs(ext.minY), Math.abs(ext.maxY)) > 100_000;
    if (options.recenter ?? far) {
      // Keep a round offset (whole metres) so imports of several floors from one CAD file stay aligned.
      const dx = Math.floor(ext.minX / 1000) * 1000;
      const dy = Math.floor(ext.minY / 1000) * 1000;
      segs = segs.map((s) => ({ a: { x: s.a.x - dx, y: s.a.y - dy }, b: { x: s.b.x - dx, y: s.b.y - dy }, layer: s.layer }));
    }
  }
  const walls = linesToWalls(segs, {
    wallThickness: options.wallThickness,
    detectDoubleLines: options.detectDoubleLines,
    minLength: options.minLength ?? 50,
  });
  const r = (v: number) => Math.round(v * 100) / 100;
  return walls.map((w) =>
    createElement('wall', options.levelId, {
      start: { x: r(w.start.x), y: r(w.start.y) },
      end: { x: r(w.end.x), y: r(w.end.y) },
      thickness: Math.round(w.thickness * 10) / 10,
      props: { source: 'DXF', ...(w.layer ? { dxfLayer: w.layer } : {}) },
    }),
  );
}
