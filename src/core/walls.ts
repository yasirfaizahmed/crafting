/**
 * Wall analytics shared by every view and exporter:
 *  - location-line helpers (length, direction, offsets ⇄ points)
 *  - join-aware plan footprints (L/T/X/multi-way miters, T-junction trimming)
 *  - opening intervals along walls
 *
 * Footprints are computed per level from ALL walls on that level, because a wall's corners depend
 * on its neighbours. Use `computeWallFootprints(project, levelId)` once per rebuild and look up
 * walls by id instead of recomputing per wall.
 */
import {
  add,
  closestOnSegment,
  cross,
  distance,
  dot,
  EPS,
  length,
  lineIntersection,
  normalize,
  perp,
  scale,
  sub,
} from './math2d';
import type { Element, Level, Opening, Project, Vec2, Wall } from './types';

/** Endpoints closer than this (mm) are considered joined. */
export const JOIN_TOLERANCE = 2;
/** Miter corners farther than this multiple of the max thickness from the joint fall back to square caps. */
const MITER_LIMIT = 6;

export function wallLength(w: Pick<Wall, 'start' | 'end'>): number {
  return distance(w.start, w.end);
}

export function wallDirection(w: Pick<Wall, 'start' | 'end'>): Vec2 {
  return normalize(sub(w.end, w.start));
}

/** Unit normal pointing to the wall's LEFT side (looking start → end). */
export function wallNormal(w: Pick<Wall, 'start' | 'end'>): Vec2 {
  return perp(wallDirection(w));
}

/** Signed offsets of the left and right faces from the location line along wallNormal. */
export function wallFaceOffsets(w: Pick<Wall, 'thickness' | 'justification'>): { left: number; right: number } {
  switch (w.justification) {
    case 'left':
      return { left: 0, right: -w.thickness };
    case 'right':
      return { left: w.thickness, right: 0 };
    default:
      return { left: w.thickness / 2, right: -w.thickness / 2 };
  }
}

/** Signed offset of the wall body's centreline from the location line. */
export function wallCenterOffset(w: Pick<Wall, 'thickness' | 'justification'>): number {
  const o = wallFaceOffsets(w);
  return (o.left + o.right) / 2;
}

export function pointAtOffset(w: Pick<Wall, 'start' | 'end'>, offset: number, lateral = 0): Vec2 {
  const d = wallDirection(w);
  return add(add(w.start, scale(d, offset)), scale(perp(d), lateral));
}

/** Project a plan point onto the wall location line. `offset` is unclamped distance from start. */
export function projectOntoWall(w: Pick<Wall, 'start' | 'end'>, p: Vec2): { offset: number; lateral: number; point: Vec2 } {
  const d = wallDirection(w);
  const rel = sub(p, w.start);
  const offset = dot(rel, d);
  const lateral = dot(rel, perp(d));
  return { offset, lateral, point: add(w.start, scale(d, offset)) };
}

export function getLevel(project: Pick<Project, 'levels'>, id: string): Level | undefined {
  return project.levels.find((l) => l.id === id);
}

/** Effective wall height (explicit or the level's floor-to-floor height). */
export function wallHeight(project: Pick<Project, 'levels'>, w: Wall): number {
  return w.height ?? getLevel(project, w.levelId)?.height ?? 3000;
}

/** Absolute elevation of the wall base, mm. */
export function wallBaseElevation(project: Pick<Project, 'levels'>, w: Wall): number {
  return (getLevel(project, w.levelId)?.elevation ?? 0) + w.baseOffset;
}

export function wallsOnLevel(project: Pick<Project, 'elements'>, levelId: string): Wall[] {
  return Object.values(project.elements).filter((e): e is Wall => e.type === 'wall' && e.levelId === levelId);
}

export function openingsOfWall(project: Pick<Project, 'elements'>, wallId: string): Opening[] {
  return Object.values(project.elements).filter(
    (e): e is Opening => (e.type === 'door' || e.type === 'window') && e.hostId === wallId,
  );
}

/** [start, end] distance along the host location line occupied by an opening. */
export function openingInterval(op: Pick<Opening, 'offset' | 'width'>): [number, number] {
  return [op.offset - op.width / 2, op.offset + op.width / 2];
}

/** True if the opening fits inside its host (with `margin` mm to each wall end) and below the wall top. */
export function openingFits(project: Pick<Project, 'levels'>, wall: Wall, op: Pick<Opening, 'offset' | 'width' | 'height' | 'sill'>, margin = 0): boolean {
  const [a, b] = openingInterval(op);
  return a >= margin - EPS && b <= wallLength(wall) - margin + EPS && op.sill >= 0 && op.sill + op.height <= wallHeight(project, wall) + EPS;
}

/** True if the opening interval overlaps another opening on the same wall. */
export function openingOverlaps(project: Pick<Project, 'elements'>, op: Opening, ignoreId?: string): boolean {
  const [a, b] = openingInterval(op);
  return openingsOfWall(project, op.hostId).some((o) => {
    if (o.id === op.id || o.id === ignoreId) return false;
    const [c, d] = openingInterval(o);
    return a < d - EPS && c < b - EPS;
  });
}

// -----------------------------------------------------------------------------
// Footprints
// -----------------------------------------------------------------------------

export interface WallFootprint {
  wallId: string;
  startLeft: Vec2;
  startRight: Vec2;
  endLeft: Vec2;
  endRight: Vec2;
  /** Extra hub point added at 3+-way junctions so the junction centre is filled. */
  startHub?: Vec2;
  endHub?: Vec2;
  /**
   * Counter-clockwise outline: startRight → endRight → [endHub] → endLeft → startLeft → [startHub].
   * (For a wall along +x with centre justification this is CCW.)
   */
  polygon: Vec2[];
}

interface Arm {
  wall: Wall;
  /** Which end of the wall touches the junction. */
  end: 'start' | 'end';
  /** Unit direction pointing AWAY from the junction along the wall. */
  dir: Vec2;
  angle: number;
  /** Offsets (along perp(dir)) of the arm's CCW and CW faces. */
  ccwOffset: number;
  cwOffset: number;
}

function makeArm(wall: Wall, end: 'start' | 'end'): Arm {
  const d = wallDirection(wall);
  const faces = wallFaceOffsets(wall);
  if (end === 'start') {
    // Outgoing direction equals wall direction: left side is CCW.
    return { wall, end, dir: d, angle: Math.atan2(d.y, d.x), ccwOffset: faces.left, cwOffset: faces.right };
  }
  const dir = scale(d, -1);
  // Reversed: wall's right becomes the CCW side; offsets flip sign because perp(dir) = -perp(d).
  return { wall, end, dir, angle: Math.atan2(dir.y, dir.x), ccwOffset: -faces.right, cwOffset: -faces.left };
}

function endpoint(w: Wall, end: 'start' | 'end'): Vec2 {
  return end === 'start' ? w.start : w.end;
}

type CornerSet = { ccw: Vec2; cw: Vec2; hub?: Vec2 };

/**
 * Compute join-aware footprints for every wall on a level.
 * Zero-length walls are skipped (they have no footprint).
 */
export function computeWallFootprints(project: Pick<Project, 'elements'>, levelId: string): Map<string, WallFootprint> {
  const walls = wallsOnLevel(project, levelId).filter((w) => wallLength(w) > EPS);
  return computeFootprintsForWalls(walls);
}

export function computeFootprintsForWalls(walls: Wall[]): Map<string, WallFootprint> {
  // Cluster endpoints into junctions.
  const junctions: { p: Vec2; arms: Arm[] }[] = [];
  for (const w of walls) {
    for (const end of ['start', 'end'] as const) {
      const p = endpoint(w, end);
      let j = junctions.find((x) => distance(x.p, p) <= JOIN_TOLERANCE);
      if (!j) {
        j = { p, arms: [] };
        junctions.push(j);
      }
      j.arms.push(makeArm(w, end));
    }
  }

  const corners = new Map<string, { start?: CornerSet; end?: CornerSet }>();
  const setCorner = (arm: Arm, c: CornerSet) => {
    const rec = corners.get(arm.wall.id) ?? {};
    rec[arm.end] = c;
    corners.set(arm.wall.id, rec);
  };

  for (const j of junctions) {
    const arms = j.arms;
    if (arms.length === 1) {
      const arm = arms[0];
      // Free end — maybe it butts into the middle of another wall (T junction).
      const t = trimToHostFace(arm, j.p, walls);
      setCorner(arm, t ?? squareCap(arm, j.p));
      continue;
    }
    arms.sort((a, b) => a.angle - b.angle);
    const n = arms.length;
    const ccwCorner: (Vec2 | null)[] = new Array(n).fill(null);
    const cwCorner: (Vec2 | null)[] = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      const a = arms[i];
      const b = arms[(i + 1) % n];
      // Face between a (its CCW side) and b (its CW side).
      const pa = add(j.p, scale(perp(a.dir), a.ccwOffset));
      const pb = add(j.p, scale(perp(b.dir), b.cwOffset));
      const hit = lineIntersection(pa, a.dir, pb, b.dir);
      const limit = MITER_LIMIT * Math.max(a.wall.thickness, b.wall.thickness);
      if (hit && distance(hit.point, j.p) <= limit && hit.t > -limit && hit.u > -limit) {
        ccwCorner[i] = hit.point;
        cwCorner[(i + 1) % n] = hit.point;
      }
    }
    for (let i = 0; i < n; i++) {
      const arm = arms[i];
      const cap = squareCap(arm, j.p);
      const c: CornerSet = { ccw: ccwCorner[i] ?? cap.ccw, cw: cwCorner[i] ?? cap.cw };
      if (n >= 3) {
        // Include the hub when it lies behind the cap chord (fills the junction centre).
        const mid = scale(add(c.ccw, c.cw), 0.5);
        if (dot(sub(j.p, mid), arm.dir) < -EPS) c.hub = j.p;
      }
      setCorner(arm, c);
    }
  }

  const out = new Map<string, WallFootprint>();
  for (const w of walls) {
    const rec = corners.get(w.id) ?? {};
    const s = rec.start ?? squareCap(makeArm(w, 'start'), w.start);
    const e = rec.end ?? squareCap(makeArm(w, 'end'), w.end);
    // At the start, the arm's CCW side is the wall's left. At the end, the arm's CCW side is the wall's right.
    const fp: WallFootprint = {
      wallId: w.id,
      startLeft: s.ccw,
      startRight: s.cw,
      endRight: e.ccw,
      endLeft: e.cw,
      startHub: s.hub,
      endHub: e.hub,
      polygon: [],
    };
    fp.polygon = [fp.startRight, fp.endRight, ...(fp.endHub ? [fp.endHub] : []), fp.endLeft, fp.startLeft, ...(fp.startHub ? [fp.startHub] : [])];
    out.set(w.id, fp);
  }
  return out;
}

function squareCap(arm: Arm, p: Vec2): CornerSet {
  const n = perp(arm.dir);
  return { ccw: add(p, scale(n, arm.ccwOffset)), cw: add(p, scale(n, arm.cwOffset)) };
}

/**
 * If the arm's free endpoint lies on (or inside the thickness of) another wall's body, extend/trim
 * the arm's faces to that wall's near face so the plan shows a clean T junction.
 */
function trimToHostFace(arm: Arm, p: Vec2, walls: Wall[]): CornerSet | null {
  for (const host of walls) {
    if (host.id === arm.wall.id) continue;
    const proj = closestOnSegment(p, host.start, host.end);
    // Must hit the interior of the host, not its ends (ends are handled by junction clustering).
    const hostLen = wallLength(host);
    const along = proj.t * hostLen;
    if (along < JOIN_TOLERANCE || along > hostLen - JOIN_TOLERANCE) continue;
    const faces = wallFaceOffsets(host);
    const hn = wallNormal(host);
    const lateral = dot(sub(p, host.start), hn);
    if (lateral < faces.right - JOIN_TOLERANCE || lateral > faces.left + JOIN_TOLERANCE) continue;
    // Skip near-parallel arms (overlapping collinear walls).
    if (Math.abs(cross(arm.dir, wallDirection(host))) < 0.05) continue;
    // Which host face does the arm come from? The arm extends away from the junction along arm.dir.
    const side = dot(arm.dir, hn) > 0 ? faces.left : faces.right;
    const faceP = add(host.start, scale(hn, side));
    const hd = wallDirection(host);
    const n = perp(arm.dir);
    const ccwLine = add(p, scale(n, arm.ccwOffset));
    const cwLine = add(p, scale(n, arm.cwOffset));
    const a = lineIntersection(ccwLine, arm.dir, faceP, hd);
    const b = lineIntersection(cwLine, arm.dir, faceP, hd);
    if (!a || !b) continue;
    const limit = MITER_LIMIT * Math.max(arm.wall.thickness, host.thickness);
    if (Math.abs(a.t) > limit || Math.abs(b.t) > limit) continue;
    return { ccw: a.point, cw: b.point };
  }
  return null;
}

/**
 * Ids of elements whose geometry depends on the given wall: the wall itself, hosted openings and
 * walls sharing a junction or T-junction with it.
 */
export function wallDependents(project: Pick<Project, 'elements'>, wall: Wall): string[] {
  const ids = new Set<string>([wall.id]);
  for (const e of Object.values(project.elements) as Element[]) {
    if ((e.type === 'door' || e.type === 'window') && e.hostId === wall.id) ids.add(e.id);
    if (e.type !== 'wall' || e.id === wall.id || e.levelId !== wall.levelId) continue;
    if (wallsTouch(wall, e)) ids.add(e.id);
  }
  return [...ids];
}

/** True if the walls share a junction or one's endpoint touches the other's body. */
export function wallsTouch(a: Wall, b: Wall): boolean {
  const ends = [a.start, a.end];
  const other = [b.start, b.end];
  for (const p of ends) for (const q of other) if (distance(p, q) <= JOIN_TOLERANCE) return true;
  const reach = (w: Wall) => Math.max(Math.abs(wallFaceOffsets(w).left), Math.abs(wallFaceOffsets(w).right)) + JOIN_TOLERANCE;
  for (const p of ends) if (closestOnSegment(p, b.start, b.end).distance <= reach(b)) return true;
  for (const q of other) if (closestOnSegment(q, a.start, a.end).distance <= reach(a)) return true;
  return false;
}

/** Total wall length (location lines) of a list of walls, mm. */
export function totalWallLength(walls: Wall[]): number {
  return walls.reduce((s, w) => s + wallLength(w), 0);
}

export { length as vecLength };
