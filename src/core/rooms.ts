/**
 * Room detection: finds the enclosed areas formed by walls on a level.
 *
 * Builds a planar graph from wall location lines (split at every crossing / T junction), prunes
 * dangling edges, traces faces with a half-edge walk, keeps counter-clockwise (interior) faces and
 * insets each edge by the distance from the location line to the wall's inner face. The result is
 * the clear (finish-to-finish) room boundary.
 */
import { add, cross, distance, EPS, lineIntersection, normalize, perp, pointInPolygon, scale, segmentIntersection, signedArea, sub } from './math2d';
import type { Project, Vec2, Wall } from './types';
import { JOIN_TOLERANCE, wallFaceOffsets, wallLength, wallsOnLevel } from './walls';

export interface DetectedRoom {
  /** Clear inner boundary (inside wall faces), counter-clockwise. */
  polygon: Vec2[];
  /** Boundary along wall location lines, counter-clockwise. */
  centerPolygon: Vec2[];
  /** Clear floor area, mm². */
  area: number;
  /** Walls bounding the room. */
  wallIds: string[];
}

/** Ignore enclosed areas smaller than this (mm²): 0.25 m². */
const MIN_ROOM_AREA = 250_000;

interface GEdge {
  a: number;
  b: number;
  wall: Wall;
}

export function detectRooms(project: Pick<Project, 'elements'>, levelId: string): DetectedRoom[] {
  const walls = wallsOnLevel(project, levelId).filter((w) => wallLength(w) > EPS);
  if (walls.length < 2) return [];

  // 1. Nodes (merged within tolerance) and split points per wall.
  const nodes: Vec2[] = [];
  const nodeId = (p: Vec2): number => {
    for (let i = 0; i < nodes.length; i++) if (distance(nodes[i], p) <= JOIN_TOLERANCE) return i;
    nodes.push({ x: p.x, y: p.y });
    return nodes.length - 1;
  };
  const splits = new Map<string, { t: number; p: Vec2 }[]>();
  for (const w of walls) splits.set(w.id, [
    { t: 0, p: w.start },
    { t: 1, p: w.end },
  ]);
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i];
      const b = walls[j];
      const hit = segmentIntersection(a.start, a.end, b.start, b.end);
      if (hit) {
        splits.get(a.id)!.push({ t: hit.t, p: hit.point });
        splits.get(b.id)!.push({ t: hit.u, p: hit.point });
        continue;
      }
      // Near-miss T junctions: an endpoint within tolerance of the other segment.
      for (const [w, o] of [
        [a, b],
        [b, a],
      ] as const) {
        for (const p of [w.start, w.end]) {
          const t = projectT(p, o);
          if (t <= 0 || t >= 1) continue;
          const q = add(o.start, scale(sub(o.end, o.start), t));
          if (distance(p, q) <= Math.max(JOIN_TOLERANCE, 1)) splits.get(o.id)!.push({ t, p });
        }
      }
    }
  }

  // 2. Edges between consecutive split points.
  const edges: GEdge[] = [];
  const seen = new Set<string>();
  for (const w of walls) {
    const pts = splits.get(w.id)!.sort((x, y) => x.t - y.t);
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = nodeId(pts[k].p);
      const b = nodeId(pts[k + 1].p);
      if (a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b, wall: w });
    }
  }

  // 3. Prune dangling edges.
  let alive = edges.slice();
  for (;;) {
    const deg = new Map<number, number>();
    for (const e of alive) {
      deg.set(e.a, (deg.get(e.a) ?? 0) + 1);
      deg.set(e.b, (deg.get(e.b) ?? 0) + 1);
    }
    const next = alive.filter((e) => (deg.get(e.a) ?? 0) > 1 && (deg.get(e.b) ?? 0) > 1);
    if (next.length === alive.length) break;
    alive = next;
  }
  if (alive.length < 3) return [];

  // 4. Half-edge face tracing (faces on the left of directed edges).
  interface Half {
    from: number;
    to: number;
    edge: GEdge;
    angle: number;
  }
  const out = new Map<number, Half[]>();
  const halves: Half[] = [];
  for (const e of alive) {
    for (const [from, to] of [
      [e.a, e.b],
      [e.b, e.a],
    ]) {
      const d = sub(nodes[to], nodes[from]);
      const h = { from, to, edge: e, angle: Math.atan2(d.y, d.x) };
      halves.push(h);
      const list = out.get(from) ?? [];
      list.push(h);
      out.set(from, list);
    }
  }
  for (const list of out.values()) list.sort((x, y) => x.angle - y.angle);
  const visited = new Set<Half>();
  const rooms: DetectedRoom[] = [];
  for (const start of halves) {
    if (visited.has(start)) continue;
    const loop: Half[] = [];
    let h: Half | undefined = start;
    let guard = 0;
    while (h && !visited.has(h) && guard++ < 10_000) {
      visited.add(h);
      loop.push(h);
      const list: Half[] = out.get(h.to)!;
      const back = Math.atan2(nodes[h.from].y - nodes[h.to].y, nodes[h.from].x - nodes[h.to].x);
      // Next edge clockwise from the twin direction = largest angle strictly below `back`.
      let pick: Half | undefined;
      for (let i = list.length - 1; i >= 0; i--) {
        if (list[i].angle < back - 1e-9) {
          pick = list[i];
          break;
        }
      }
      h = pick ?? list[list.length - 1];
    }
    if (h !== start || loop.length < 3) continue;
    const center = loop.map((x) => nodes[x.from]);
    const a = signedArea(center);
    if (a <= MIN_ROOM_AREA) continue;
    const polygon = insetLoop(loop.map((x) => ({ from: nodes[x.from], to: nodes[x.to], wall: x.edge.wall })));
    if (!polygon) continue;
    const clear = signedArea(polygon);
    if (clear <= MIN_ROOM_AREA / 4) continue;
    rooms.push({
      polygon,
      centerPolygon: center,
      area: clear,
      wallIds: [...new Set(loop.map((x) => x.edge.wall.id))],
    });
  }
  return rooms;
}

function projectT(p: Vec2, w: Wall): number {
  const d = sub(w.end, w.start);
  const l2 = d.x * d.x + d.y * d.y;
  return l2 < EPS ? -1 : ((p.x - w.start.x) * d.x + (p.y - w.start.y) * d.y) / l2;
}

/** Offset every directed edge to its left by the wall's inner-face distance and re-intersect. */
function insetLoop(edges: { from: Vec2; to: Vec2; wall: Wall }[]): Vec2[] | null {
  // Merge consecutive collinear edges of the same wall.
  const merged: typeof edges = [];
  for (const e of edges) {
    const last = merged[merged.length - 1];
    if (last && last.wall.id === e.wall.id && Math.abs(cross(normalize(sub(last.to, last.from)), normalize(sub(e.to, e.from)))) < 1e-9) {
      last.to = e.to;
    } else merged.push({ ...e });
  }
  if (merged.length > 1) {
    const first = merged[0];
    const last = merged[merged.length - 1];
    if (last.wall.id === first.wall.id && Math.abs(cross(normalize(sub(last.to, last.from)), normalize(sub(first.to, first.from)))) < 1e-9) {
      first.from = last.from;
      merged.pop();
    }
  }
  const lines = merged.map((e) => {
    const dir = normalize(sub(e.to, e.from));
    const wd = normalize(sub(e.wall.end, e.wall.start));
    const faces = wallFaceOffsets(e.wall);
    // Distance from location line to the face on the LEFT of this directed edge.
    const d = dir.x * wd.x + dir.y * wd.y > 0 ? faces.left : -faces.right;
    const off = scale(perp(dir), d);
    return { p: add(e.from, off), q: add(e.to, off), dir };
  });
  const out: Vec2[] = [];
  for (let i = 0; i < lines.length; i++) {
    const prev = lines[(i + lines.length - 1) % lines.length];
    const cur = lines[i];
    const hit = lineIntersection(prev.p, prev.dir, cur.p, cur.dir);
    if (hit) out.push(hit.point);
    else {
      out.push(prev.q);
      if (distance(prev.q, cur.p) > EPS) out.push(cur.p);
    }
  }
  return out.length >= 3 ? out : null;
}

/** The smallest detected room containing `p`, if any. */
export function roomAtPoint(project: Pick<Project, 'elements'>, levelId: string, p: Vec2): DetectedRoom | undefined {
  return detectRooms(project, levelId)
    .filter((r) => pointInPolygon(p, r.polygon))
    .sort((a, b) => a.area - b.area)[0];
}
