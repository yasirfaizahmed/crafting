/**
 * Room detection: finds the enclosed areas formed by walls on a level.
 *
 * Builds a planar graph from wall location lines (split at every crossing / T junction), prunes
 * dangling edges, traces faces with a half-edge walk, keeps counter-clockwise (interior) faces and
 * insets each edge by the distance from the location line to the wall's inner face. The result is
 * the clear (finish-to-finish) room boundary.
 *
 * Robustness rules applied before building the graph (graph only — walls are not modified):
 *  - a free wall end that stops at another wall's FACE (or anywhere inside its thickness) is
 *    extended/trimmed onto that wall's location line (T junction drawn to the face);
 *  - a free wall end that stops inside the thickness of another wall's free end is snapped onto it
 *    (sloppy L corners);
 *  - collinear overlapping walls share edges (deduplicated);
 *  - wall groups enclosed by a room (a closet island, a stair core) become holes of that room.
 */
import { add, closestOnSegment, cross, distance, dot, EPS, lineIntersection, normalize, perp, pointInPolygon, scale, segmentIntersection, signedArea, sub } from './math2d';
import type { Project, Vec2, Wall } from './types';
import { JOIN_TOLERANCE, wallDirection, wallFaceOffsets, wallLength, wallNormal, wallsOnLevel } from './walls';

export interface DetectedRoom {
  /** Clear inner boundary (inside wall faces), counter-clockwise. */
  polygon: Vec2[];
  /** Boundary along wall location lines, counter-clockwise. */
  centerPolygon: Vec2[];
  /** Clear floor area, mm² (islands subtracted). */
  area: number;
  /** Walls bounding the room. */
  wallIds: string[];
  /** Outer faces of wall groups standing free inside the room (clockwise). */
  holes?: Vec2[][];
}

/** Outline of a connected group of walls, along the OUTER wall faces. */
export interface DetectedBoundary {
  /** Outer face outline, counter-clockwise. */
  polygon: Vec2[];
  /** Same boundary along the wall location lines, counter-clockwise. */
  centerPolygon: Vec2[];
  /** Area enclosed by the outer face outline, mm². */
  area: number;
  /** Walls on the outer boundary. */
  wallIds: string[];
}

/** Ignore enclosed areas smaller than this (mm²): 0.25 m². */
const MIN_ROOM_AREA = 250_000;

interface GEdge {
  a: number;
  b: number;
  wall: Wall;
}

interface Half {
  from: number;
  to: number;
  edge: GEdge;
  angle: number;
}

interface Face {
  loop: Half[];
  /** Signed area along location lines (CCW positive). */
  area: number;
  component: number;
}

interface FaceGraph {
  nodes: Vec2[];
  faces: Face[];
}

/** Graph segment for a wall: the location line, possibly with endpoints adjusted (see header). */
interface GSeg {
  start: Vec2;
  end: Vec2;
  wall: Wall;
}

function graphSegments(walls: Wall[]): GSeg[] {
  const segs: GSeg[] = walls.map((w) => ({ start: w.start, end: w.end, wall: w }));
  const isJoined = (p: Vec2, self: Wall) =>
    walls.some((o) => o.id !== self.id && (distance(o.start, p) <= JOIN_TOLERANCE || distance(o.end, p) <= JOIN_TOLERANCE));
  for (const s of segs) {
    const w = s.wall;
    for (const which of ['start', 'end'] as const) {
      const p = w[which];
      if (isJoined(p, w)) continue;
      const adjusted = attachFreeEnd(p, w, walls);
      if (adjusted) s[which] = adjusted;
    }
  }
  return segs.filter((s) => distance(s.start, s.end) > EPS);
}

/** Where a free wall end should join the graph, or null to leave it where it is. */
function attachFreeEnd(p: Vec2, w: Wall, walls: Wall[]): Vec2 | null {
  const dir = wallDirection(w);
  // 1. Sloppy corner: inside the thickness of another wall's free end.
  let best: { q: Vec2; d: number } | null = null;
  for (const o of walls) {
    if (o.id === w.id) continue;
    for (const q of [o.start, o.end]) {
      const d = distance(p, q);
      const reach = Math.max(w.thickness, o.thickness) / 2 + JOIN_TOLERANCE;
      if (d > JOIN_TOLERANCE && d <= reach && (!best || d < best.d)) best = { q, d };
    }
  }
  if (best) return best.q;
  // 2. T junction drawn to (or into) another wall's face.
  for (const host of walls) {
    if (host.id === w.id) continue;
    const len = wallLength(host);
    if (len < EPS) continue;
    const hd = wallDirection(host);
    if (Math.abs(cross(dir, hd)) < 0.05) continue;
    const proj = closestOnSegment(p, host.start, host.end);
    const along = proj.t * len;
    if (along < JOIN_TOLERANCE || along > len - JOIN_TOLERANCE) continue;
    const faces = wallFaceOffsets(host);
    const lateral = dot(sub(p, host.start), wallNormal(host));
    if (Math.abs(lateral) <= JOIN_TOLERANCE) continue; // already on the line: handled by the graph
    if (lateral < faces.right - JOIN_TOLERANCE || lateral > faces.left + JOIN_TOLERANCE) continue;
    const hit = lineIntersection(p, dir, host.start, hd);
    if (!hit || distance(hit.point, p) > host.thickness * 2 + JOIN_TOLERANCE) continue;
    if (hit.u < -JOIN_TOLERANCE || hit.u > len + JOIN_TOLERANCE) continue;
    return hit.point;
  }
  return null;
}

function buildFaceGraph(walls: Wall[]): FaceGraph | null {
  const segs = graphSegments(walls);
  if (segs.length < 2) return null;

  // 1. Nodes (merged within tolerance) and split points per segment.
  const nodes: Vec2[] = [];
  const nodeId = (p: Vec2): number => {
    for (let i = 0; i < nodes.length; i++) if (distance(nodes[i], p) <= JOIN_TOLERANCE) return i;
    nodes.push({ x: p.x, y: p.y });
    return nodes.length - 1;
  };
  const splits = segs.map((s) => [
    { t: 0, p: s.start },
    { t: 1, p: s.end },
  ]);
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i];
      const b = segs[j];
      const hit = segmentIntersection(a.start, a.end, b.start, b.end);
      if (hit) {
        splits[i].push({ t: hit.t, p: hit.point });
        splits[j].push({ t: hit.u, p: hit.point });
        continue;
      }
      // Near-miss T junctions and collinear overlaps: an endpoint within tolerance of the other segment.
      for (const [w, o, oi] of [
        [a, b, j],
        [b, a, i],
      ] as const) {
        for (const p of [w.start, w.end]) {
          const t = projectT(p, o);
          if (t <= 0 || t >= 1) continue;
          const q = add(o.start, scale(sub(o.end, o.start), t));
          if (distance(p, q) <= Math.max(JOIN_TOLERANCE, 1)) splits[oi].push({ t, p });
        }
      }
    }
  }

  // 2. Edges between consecutive split points (collinear overlaps deduplicated).
  const edges: GEdge[] = [];
  const seen = new Set<string>();
  segs.forEach((s, i) => {
    const pts = splits[i].sort((x, y) => x.t - y.t);
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = nodeId(pts[k].p);
      const b = nodeId(pts[k + 1].p);
      if (a === b) continue;
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ a, b, wall: s.wall });
    }
  });

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
  if (alive.length < 3) return null;

  // Connected components (union-find over nodes).
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const e of alive) {
    if (!parent.has(e.a)) parent.set(e.a, e.a);
    if (!parent.has(e.b)) parent.set(e.b, e.b);
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) parent.set(ra, rb);
  }

  // 4. Half-edge face tracing (faces on the left of directed edges).
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
  const faces: Face[] = [];
  for (const start of halves) {
    if (visited.has(start)) continue;
    const loop: Half[] = [];
    let h: Half | undefined = start;
    let guard = 0;
    while (h && !visited.has(h) && guard++ < 100_000) {
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
    faces.push({ loop, area: signedArea(loop.map((x) => nodes[x.from])), component: find(loop[0].from) });
  }
  return { nodes, faces };
}

function faceEdges(g: FaceGraph, f: Face) {
  return f.loop.map((x) => ({ from: g.nodes[x.from], to: g.nodes[x.to], wall: x.edge.wall }));
}

/** The outer (clockwise) face of every component, with its outer-face outline. */
function outerFaces(g: FaceGraph): { face: Face; outline: Vec2[] }[] {
  const byComp = new Map<number, Face>();
  for (const f of g.faces) {
    if (f.area >= 0) continue;
    const cur = byComp.get(f.component);
    if (!cur || f.area < cur.area) byComp.set(f.component, f);
  }
  const res: { face: Face; outline: Vec2[] }[] = [];
  for (const face of byComp.values()) {
    if (-face.area <= MIN_ROOM_AREA) continue;
    const outline = insetLoop(faceEdges(g, face));
    if (outline) res.push({ face, outline });
  }
  return res;
}

export function detectRooms(project: Pick<Project, 'elements'>, levelId: string): DetectedRoom[] {
  const walls = wallsOnLevel(project, levelId).filter((w) => wallLength(w) > EPS);
  if (walls.length < 2) return [];
  const g = buildFaceGraph(walls);
  if (!g) return [];
  const rooms: (DetectedRoom & { component: number })[] = [];
  for (const f of g.faces) {
    if (f.area <= MIN_ROOM_AREA) continue;
    const polygon = insetLoop(faceEdges(g, f));
    if (!polygon) continue;
    const clear = signedArea(polygon);
    if (clear <= MIN_ROOM_AREA / 4) continue;
    rooms.push({
      polygon,
      centerPolygon: f.loop.map((x) => g.nodes[x.from]),
      area: clear,
      wallIds: [...new Set(f.loop.map((x) => x.edge.wall.id))],
      component: f.component,
    });
  }
  // Islands: the outer face of a component lying inside a room of another component.
  for (const { face, outline } of outerFaces(g)) {
    const probe = g.nodes[face.loop[0].from];
    const host = rooms
      .filter((r) => r.component !== face.component && pointInPolygon(probe, r.polygon))
      .sort((a, b) => a.area - b.area)[0];
    if (!host) continue;
    (host.holes ??= []).push(outline);
    host.area -= Math.abs(signedArea(outline));
  }
  return rooms.map(({ component: _c, ...r }) => r);
}

/**
 * Outer outlines (along outer wall faces) of each connected group of enclosing walls, excluding
 * groups that stand inside a room of another group. Used for foundations, roofs and "exterior wall"
 * selection.
 */
export function detectOuterBoundaries(project: Pick<Project, 'elements'>, levelId: string): DetectedBoundary[] {
  const walls = wallsOnLevel(project, levelId).filter((w) => wallLength(w) > EPS);
  if (walls.length < 2) return [];
  const g = buildFaceGraph(walls);
  if (!g) return [];
  const rooms = g.faces.filter((f) => f.area > MIN_ROOM_AREA);
  const res: DetectedBoundary[] = [];
  for (const { face, outline } of outerFaces(g)) {
    const probe = g.nodes[face.loop[0].from];
    const nested = rooms.some((r) => r.component !== face.component && pointInPolygon(probe, r.loop.map((x) => g.nodes[x.from])));
    if (nested) continue;
    const polygon = [...outline].reverse();
    res.push({
      polygon,
      centerPolygon: face.loop.map((x) => g.nodes[x.from]).reverse(),
      area: signedArea(polygon),
      wallIds: [...new Set(face.loop.map((x) => x.edge.wall.id))],
    });
  }
  return res.sort((a, b) => b.area - a.area);
}

function projectT(p: Vec2, w: { start: Vec2; end: Vec2 }): number {
  const d = sub(w.end, w.start);
  const l2 = d.x * d.x + d.y * d.y;
  return l2 < EPS ? -1 : ((p.x - w.start.x) * d.x + (p.y - w.start.y) * d.y) / l2;
}

/** Offset every directed edge to its left by the wall's face distance on that side and re-intersect. */
function insetLoop(edges: { from: Vec2; to: Vec2; wall: Wall }[]): Vec2[] | null {
  const collinear = (a: { from: Vec2; to: Vec2 }, b: { from: Vec2; to: Vec2 }) =>
    Math.abs(cross(normalize(sub(a.to, a.from)), normalize(sub(b.to, b.from)))) < 1e-9 && dot(sub(a.to, a.from), sub(b.to, b.from)) > 0;
  // Merge consecutive collinear edges of the same wall.
  const merged: typeof edges = [];
  for (const e of edges) {
    const last = merged[merged.length - 1];
    if (last && last.wall.id === e.wall.id && collinear(last, e)) last.to = e.to;
    else merged.push({ ...e });
  }
  if (merged.length > 1) {
    const first = merged[0];
    const last = merged[merged.length - 1];
    if (last.wall.id === first.wall.id && collinear(last, first)) {
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

/** True if `p` lies on the floor of the detected room (inside its outline and outside its islands). */
export function pointInDetectedRoom(p: Vec2, room: DetectedRoom): boolean {
  return pointInPolygon(p, room.polygon) && !(room.holes ?? []).some((h) => pointInPolygon(p, h));
}

/** The smallest detected room containing `p`, if any. */
export function roomAtPoint(project: Pick<Project, 'elements'>, levelId: string, p: Vec2): DetectedRoom | undefined {
  return detectRooms(project, levelId)
    .filter((r) => pointInDetectedRoom(p, r))
    .sort((a, b) => a.area - b.area)[0];
}
