/**
 * "Generate 3D from blueprint": turns the walls drawn on each level into rooms, floor slabs,
 * ceilings, a foundation and a roof — and "Add floor above" for stacking storeys.
 *
 * Pure functions on a DocumentStore. Every call is ONE transaction (a single undo step).
 * Generated elements carry `props.autogen = true` (and `props.autogenKind`), so running the
 * generator again replaces them instead of duplicating. Elements the user created are never
 * modified: the generator only fills what is missing (e.g. it skips the roof when the top level
 * already has one, and lays a thin finish on top of an existing structural slab).
 */
import { CATALOG } from './catalog';
import { createElement, createLevel } from './defaults';
import { boundsOf, centroid, ensureCCW, pointInPolygon } from './math2d';
import { detectOuterBoundaries, detectRooms, pointInDetectedRoom } from './rooms';
import type { DocumentStore, Transaction } from './store';
import type { Element, Level, Project, RoofShape, Room, Slab, Vec2, Wall } from './types';
import { wallsOnLevel } from './walls';

export interface Generate3DOptions {
  /** Levels to process (default: all). */
  levelIds?: string[];
  /** Create Room elements for enclosed areas that have none. */
  rooms: boolean;
  /** Floor slab per room. */
  floors: boolean;
  /** Ceiling per room. */
  ceilings: boolean;
  /** Foundation under the lowest level's outer footprint. */
  foundation: boolean;
  /** Roof over the top level's outer footprint. */
  roof: RoofShape | 'none';
  /** Roof pitch in degrees (default: the catalog roof's pitch). */
  roofPitch?: number;
}

export interface Generate3DSummary {
  levels: number;
  rooms: number;
  floors: number;
  ceilings: number;
  foundations: number;
  roofs: number;
  /** Previously auto-generated elements that were replaced. */
  replaced: number;
  /** One-line human readable summary. */
  message: string;
}

export const DEFAULT_GENERATE_OPTIONS: Generate3DOptions = {
  rooms: true,
  floors: true,
  ceilings: false,
  foundation: true,
  roof: 'gable',
};

export type AutogenKind = 'room' | 'floor' | 'ceiling' | 'foundation' | 'roof';

/** Thickness of a finish layer laid over an existing slab, mm. */
export const FINISH_THICKNESS = 20;
/** Structural floor slab thickness for upper levels, mm. */
export const FLOOR_THICKNESS = 200;
/** Ground-bearing floor thickness when there is no foundation, mm. */
export const GROUND_FLOOR_THICKNESS = 150;
export const CEILING_THICKNESS = 20;
export const FOUNDATION_THICKNESS = 300;
/** Finishes over an existing slab sit this much proud of it (avoids coplanar faces), mm. */
const PROUD = 2;

export function isAutogen(el: Element): boolean {
  return el.props?.autogen === true;
}

function autogenProps(kind: AutogenKind): Record<string, string | boolean> {
  return { autogen: true, autogenKind: kind };
}

/** Sensible floor finish for a room name: wet rooms and kitchens get tiles, everything else wood. */
export function defaultFloorMaterial(name: string): string {
  const n = name.toLowerCase();
  if (/(bath|wc|toilet|shower|ensuite|en-suite|lavatory|powder|laundry|utility|wet)/.test(n)) return 'tile-white';
  if (/(kitchen|pantry|scullery|galley)/.test(n)) return 'tile-grey';
  if (/(garage|workshop|storage|store|plant|boiler|cellar|basement|carport)/.test(n)) return 'concrete-polished';
  if (/(terrace|patio|balcony|porch|veranda|deck|loggia)/.test(n)) return 'stone-sandstone';
  return 'wood-floor-oak';
}

/** Floor material for a room: explicit `floorMaterialId`, else derived from the name. */
export function floorMaterialForRoom(room: Pick<Room, 'name' | 'floorMaterialId'>): string {
  return room.floorMaterialId ?? defaultFloorMaterial(room.name ?? '');
}

/**
 * A point guaranteed to lie inside a simple polygon (the centroid when it is inside, else the middle
 * of the widest horizontal span through the polygon's mid-height).
 */
export function interiorPoint(poly: Vec2[]): Vec2 {
  if (poly.length < 3) return poly[0] ?? { x: 0, y: 0 };
  const c = centroid(poly);
  if (pointInPolygon(c, poly)) return c;
  const b = boundsOf(poly);
  let best: { p: Vec2; w: number } | null = null;
  for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
    const y = b.minY + (b.maxY - b.minY) * f;
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const q = poly[(i + 1) % poly.length];
      if (a.y > y !== q.y > y) xs.push(a.x + ((y - a.y) * (q.x - a.x)) / (q.y - a.y));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const w = xs[i + 1] - xs[i];
      if (!best || w > best.w) best = { p: { x: (xs[i] + xs[i + 1]) / 2, y }, w };
    }
    if (best) return best.p;
  }
  return c;
}

/** Outer footprints (outer wall faces, CCW) of every wall group on a level, largest first. */
export function outerFootprints(project: Pick<Project, 'elements'>, levelId: string): Vec2[][] {
  return detectOuterBoundaries(project, levelId).map((b) => b.polygon);
}

/** Ids of the walls on the outer boundary of the level's enclosed areas. */
export function exteriorWallIds(project: Pick<Project, 'elements'>, levelId: string): string[] {
  return [...new Set(detectOuterBoundaries(project, levelId).flatMap((b) => b.wallIds))];
}

/**
 * Minimum-area oriented bounding rectangle of a polygon. `angle` (degrees, [0, 180)) is the
 * direction of the LONGER side — the natural ridge direction of a pitched roof.
 */
export function orientedBounds(poly: Vec2[]): { angle: number; length: number; width: number; center: Vec2 } {
  const hull = convexHull(poly);
  let best = { area: Infinity, angle: 0, length: 0, width: 0, center: { x: 0, y: 0 } };
  const n = hull.length;
  for (let i = 0; i < Math.max(1, n); i++) {
    const a = hull[i];
    const b = hull[(i + 1) % n];
    const theta = n > 1 ? Math.atan2(b.y - a.y, b.x - a.x) : 0;
    const ux = Math.cos(theta);
    const uy = Math.sin(theta);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy;
      const v = -p.x * uy + p.y * ux;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area - 1e-6) {
      const cu = (minU + maxU) / 2;
      const cv = (minV + maxV) / 2;
      const center = { x: cu * ux - cv * uy, y: cu * uy + cv * ux };
      const du = maxU - minU;
      const dv = maxV - minV;
      let angle = (theta * 180) / Math.PI + (du >= dv - 1e-6 ? 0 : 90);
      angle = ((angle % 180) + 180) % 180;
      if (Math.abs(angle - 180) < 1e-6) angle = 0;
      best = { area, angle: Math.round(angle * 1e6) / 1e6, length: Math.max(du, dv), width: Math.min(du, dv), center };
    }
  }
  return { angle: best.angle, length: best.length, width: best.width, center: best.center };
}

function convexHull(points: Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const crossO = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && crossO(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && crossO(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function sortedLevels(project: Pick<Project, 'levels'>): Level[] {
  return [...project.levels].sort((a, b) => a.elevation - b.elevation);
}

function slabCovers(s: Slab, p: Vec2): boolean {
  return s.outline.length >= 3 && pointInPolygon(p, s.outline) && !(s.holes ?? []).some((h) => pointInPolygon(p, h));
}

const roomNumberRe = /^Room (\d+)$/;

/** Next free "Room N" name across the project. */
export function nextRoomName(project: Pick<Project, 'elements'>): string {
  let max = 0;
  for (const el of Object.values(project.elements)) {
    if (el.type !== 'room') continue;
    const m = roomNumberRe.exec(el.name ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Room ${max + 1}`;
}

/** Next room number on a level, e.g. "003" on the ground floor, "102" on the first floor. */
export function nextRoomNumber(project: Pick<Project, 'elements' | 'levels'>, levelId: string): string {
  const idx = Math.max(0, sortedLevels(project).findIndex((l) => l.id === levelId));
  let max = 0;
  for (const el of Object.values(project.elements)) {
    if (el.type !== 'room' || el.levelId !== levelId || !el.number) continue;
    const n = Number(el.number);
    if (Number.isFinite(n)) max = Math.max(max, n - idx * 100);
  }
  return String(idx * 100 + max + 1).padStart(3, '0');
}

function roofTemplate(shape: RoofShape): { materialId?: string; pitch?: number; overhang?: number } {
  const item = CATALOG.find((c) => c.tool === 'roof' && c.template?.shape === shape);
  const t = (item?.template ?? {}) as { materialId?: string; pitch?: number; overhang?: number };
  return { materialId: t.materialId, pitch: t.pitch, overhang: t.overhang };
}

/**
 * Generate rooms, floors, ceilings, foundation and roof from the walls of each level.
 * Replaces previously generated elements on the processed levels. One undo step.
 */
export function generate3D(store: DocumentStore, opts: Generate3DOptions): Generate3DSummary {
  const all = sortedLevels(store.project);
  const processed = all.filter((l) => !opts.levelIds || opts.levelIds.includes(l.id));
  const processedIds = new Set(processed.map((l) => l.id));
  const summary: Generate3DSummary = { levels: processed.length, rooms: 0, floors: 0, ceilings: 0, foundations: 0, roofs: 0, replaced: 0, message: '' };

  store.transact('Generate 3D from blueprint', (tx) => {
    const project = store.project;
    // 1. Remove previously generated elements; remember generated rooms to carry over user edits.
    const oldRooms: Room[] = [];
    for (const el of Object.values(project.elements)) {
      if (!isAutogen(el) || !processedIds.has(el.levelId)) continue;
      if (el.type === 'room') oldRooms.push(el);
      tx.remove(el.id);
      summary.replaced++;
    }

    const roomsOn = (levelId: string) => Object.values(project.elements).filter((e): e is Room => e.type === 'room' && e.levelId === levelId && e.outline.length >= 3);
    const slabsOn = (levelId: string) => Object.values(project.elements).filter((e): e is Slab => e.type === 'slab' && e.levelId === levelId);

    // 2. Rooms for enclosed areas without one.
    if (opts.rooms) {
      for (const level of processed) {
        const existing = roomsOn(level.id);
        for (const det of detectRooms(project, level.id)) {
          const probe = interiorPoint(det.polygon);
          const covered = existing.some((r) => pointInPolygon(probe, r.outline) || pointInDetectedRoom(interiorPoint(r.outline), det));
          if (covered) continue;
          const prev = oldRooms.find((r) => r.levelId === level.id && pointInDetectedRoom(interiorPoint(r.outline), det));
          const room = createElement('room', level.id, {
            outline: ensureCCW(det.polygon),
            name: prev?.name ?? nextRoomName(project),
            number: prev?.number ?? nextRoomNumber(project, level.id),
            floorMaterialId: prev?.floorMaterialId,
            materialId: prev?.materialId,
            props: { ...(prev?.props ?? {}), ...autogenProps('room') },
          });
          tx.add(room);
          existing.push(room);
          summary.rooms++;
        }
      }
    }

    // 3. Foundation under the lowest level that has walls.
    const lowest = all.find((l) => wallsOnLevel(project, l.id).length > 0);
    if (opts.foundation && lowest && processedIds.has(lowest.id)) {
      const userFoundations = slabsOn(lowest.id).filter((s) => s.kind === 'foundation');
      for (const outline of outerFootprints(project, lowest.id)) {
        const probe = interiorPoint(outline);
        if (userFoundations.some((s) => slabCovers(s, probe))) continue;
        tx.add(
          createElement('slab', lowest.id, {
            outline,
            thickness: FOUNDATION_THICKNESS,
            topOffset: 0,
            kind: 'foundation',
            materialId: 'concrete',
            name: 'Foundation',
            props: autogenProps('foundation'),
          }),
        );
        summary.foundations++;
      }
    }

    // 4. Floors per room.
    if (opts.floors) {
      for (const level of processed) {
        const isLowest = level.id === (lowest ?? all[0])?.id;
        for (const room of roomsOn(level.id)) {
          const probe = interiorPoint(room.outline);
          const under = slabsOn(level.id).filter((s) => s.kind !== 'ceiling' && slabCovers(s, probe));
          const top = under.length ? Math.max(...under.map((s) => s.topOffset)) : null;
          const finish = top !== null;
          tx.add(
            createElement('slab', level.id, {
              outline: ensureCCW(room.outline),
              thickness: finish ? FINISH_THICKNESS : isLowest ? GROUND_FLOOR_THICKNESS : FLOOR_THICKNESS,
              topOffset: finish ? top + PROUD : 0,
              kind: 'floor',
              materialId: floorMaterialForRoom(room),
              name: `Floor — ${room.name}`,
              props: { ...autogenProps('floor'), roomId: room.id },
            }),
          );
          summary.floors++;
        }
      }
    }

    // 5. Ceilings per room, just under whatever floor structure the level above has there.
    if (opts.ceilings) {
      for (const level of processed) {
        const above = all[all.findIndex((l) => l.id === level.id) + 1];
        for (const room of roomsOn(level.id)) {
          const probe = interiorPoint(room.outline);
          if (slabsOn(level.id).some((s) => s.kind === 'ceiling' && !isAutogen(s) && slabCovers(s, probe))) continue;
          let top = level.height;
          if (above) {
            const rel = above.elevation - level.elevation;
            for (const s of slabsOn(above.id)) {
              if (s.kind === 'ceiling' || !slabCovers(s, probe)) continue;
              top = Math.min(top, rel + s.topOffset - s.thickness);
            }
          }
          tx.add(
            createElement('slab', level.id, {
              outline: ensureCCW(room.outline),
              thickness: CEILING_THICKNESS,
              topOffset: top,
              kind: 'ceiling',
              materialId: 'plaster-white',
              name: `Ceiling — ${room.name}`,
              props: { ...autogenProps('ceiling'), roomId: room.id },
            }),
          );
          summary.ceilings++;
        }
      }
    }

    // 6. Roof over the top level that has walls.
    const top = [...all].reverse().find((l) => outerFootprints(project, l.id).length > 0);
    if (opts.roof !== 'none' && top && processedIds.has(top.id)) {
      const t = roofTemplate(opts.roof);
      const userRoofs = Object.values(project.elements).filter((e) => e.type === 'roof' && e.levelId === top.id && !isAutogen(e));
      for (const outline of outerFootprints(project, top.id)) {
        const probe = interiorPoint(outline);
        if (userRoofs.some((r) => r.type === 'roof' && r.outline.length >= 3 && pointInPolygon(probe, r.outline))) continue;
        const ob = orientedBounds(outline);
        tx.add(
          createElement('roof', top.id, {
            outline,
            shape: opts.roof,
            pitch: opts.roof === 'flat' ? 0 : (opts.roofPitch ?? t.pitch ?? 30),
            overhang: t.overhang ?? (opts.roof === 'flat' ? 0 : 500),
            ridgeAngle: ob.angle,
            materialId: t.materialId,
            name: 'Roof',
            props: autogenProps('roof'),
          }),
        );
        summary.roofs++;
      }
    }
  });

  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => n && parts.push(`${n} ${n === 1 ? one : many}`);
  add(summary.rooms, 'room', 'rooms');
  add(summary.floors, 'floor', 'floors');
  add(summary.ceilings, 'ceiling', 'ceilings');
  add(summary.foundations, 'foundation', 'foundations');
  add(summary.roofs, 'roof', 'roofs');
  summary.message = parts.length ? `Generated ${parts.join(', ')}` : 'Nothing to generate — draw closed rooms with walls first';
  return summary;
}

export interface AddFloorOptions {
  /** Which walls to copy from the level below. */
  copy: 'exterior' | 'all' | 'none';
  name?: string;
  /** Floor-to-floor height (default: the base level's height). */
  height?: number;
}

export interface AddFloorResult {
  levelId: string;
  walls: number;
  openings: number;
}

const ORDINALS = ['Ground', 'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

function levelName(project: Pick<Project, 'levels'>, index: number): string {
  const taken = new Set(project.levels.map((l) => l.name));
  const candidates = [index < ORDINALS.length ? `${ORDINALS[index]} Floor` : '', `Level ${index + 1}`];
  for (const c of candidates) if (c && !taken.has(c)) return c;
  let k = 2;
  while (taken.has(`Level ${index + 1} (${k})`)) k++;
  return `Level ${index + 1} (${k})`;
}

/**
 * Insert a new level directly above `levelId` (levels further up move up to make room) and copy
 * walls into it: 'exterior' copies the outer walls and their windows, 'all' every wall with all of
 * its doors and windows. One undo step.
 */
export function addFloorAbove(store: DocumentStore, levelId: string, opts: AddFloorOptions): AddFloorResult {
  const base = store.getLevel(levelId);
  if (!base) throw new Error(`Unknown level ${levelId}`);
  const levels = sortedLevels(store.project);
  const height = opts.height ?? base.height;
  const elevation = base.elevation + base.height;
  const index = levels.findIndex((l) => l.id === base.id) + 1;
  const result: AddFloorResult = { levelId: '', walls: 0, openings: 0 };

  store.transact('Add floor above', (tx: Transaction) => {
    const project = store.project;
    for (const l of levels) if (l.id !== base.id && l.elevation >= elevation - 1) tx.updateLevel(l.id, { elevation: l.elevation + height });
    const level: Level = createLevel({ name: opts.name ?? levelName(project, index), elevation, height });
    tx.addLevel(level);
    result.levelId = level.id;

    const walls = wallsOnLevel(project, base.id);
    const ids = opts.copy === 'all' ? walls.map((w) => w.id) : opts.copy === 'exterior' ? exteriorWallIds(project, base.id) : [];
    const map = new Map<string, string>();
    for (const id of ids) {
      const w = project.elements[id] as Wall;
      const { id: _id, levelId: _lvl, type: _t, ...rest } = w;
      const copy = createElement('wall', level.id, JSON.parse(JSON.stringify(rest)) as Partial<Wall>);
      tx.add(copy);
      map.set(w.id, copy.id);
      result.walls++;
    }
    for (const el of Object.values(project.elements)) {
      if ((el.type !== 'door' && el.type !== 'window') || !map.has(el.hostId)) continue;
      if (opts.copy === 'exterior' && el.type !== 'window') continue;
      const { id: _id, levelId: _lvl, type, hostId, ...rest } = el;
      const copy = createElement(type, level.id, { ...(JSON.parse(JSON.stringify(rest)) as object), hostId: map.get(hostId)! });
      tx.add(copy);
      result.openings++;
    }
  });
  return result;
}
