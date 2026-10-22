/**
 * Placement frames and world-mesh conversion for the IFC exporter.
 *
 * Every IFC element placement used here is a Z-up frame: a translation plus a rotation about Z
 * (plan rotation). Frames are expressed relative to their parent placement; `compose` gives the
 * storey-relative frame used to convert world meshes into element-local coordinates.
 */
import { M_TO_MM } from '../../core/coords';
import type { Vec2 } from '../../core/types';
import type { MeshData } from '../../geometry';

/** Translation (mm) + rotation about +Z (degrees, CCW). */
export interface Frame {
  x: number;
  y: number;
  z: number;
  angle: number;
}

export const IDENTITY: Frame = { x: 0, y: 0, z: 0, angle: 0 };

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Absolute frame of `child` given in the coordinates of `parent`. */
export function compose(parent: Frame, child: Frame): Frame {
  const c = Math.cos(rad(parent.angle));
  const s = Math.sin(rad(parent.angle));
  return {
    x: parent.x + c * child.x - s * child.y,
    y: parent.y + s * child.x + c * child.y,
    z: parent.z + child.z,
    angle: parent.angle + child.angle,
  };
}

/** Plan point → frame-local 2D coordinates. */
export function toLocal2(f: Frame, p: Vec2): Vec2 {
  const c = Math.cos(rad(f.angle));
  const s = Math.sin(rad(f.angle));
  const dx = p.x - f.x;
  const dy = p.y - f.y;
  return { x: c * dx + s * dy, y: -s * dx + c * dy };
}

/** Storey-local point (mm, Z up) → frame-local. */
export function toLocal3(f: Frame, p: [number, number, number]): [number, number, number] {
  const q = toLocal2(f, { x: p[0], y: p[1] });
  return [q.x, q.y, p[2] - f.z];
}

export interface LocalMesh {
  /** Unique vertex coordinates (mm, element-local, Z up). */
  coords: [number, number, number][];
  /** 1-based triangle indices into coords (IFC convention). */
  triangles: [number, number, number][];
  /** True if every edge is shared by exactly two triangles with opposite orientation. */
  closed: boolean;
}

/**
 * Convert a world mesh (metres, Y up — see core/coords.ts) to element-local millimetres, Z up.
 * Vertices are welded (0.01 mm) so the face set is compact and closedness can be detected;
 * degenerate triangles are dropped.
 */
export function meshToLocal(mesh: MeshData, levelElevation: number, frame: Frame): LocalMesh {
  const coords: [number, number, number][] = [];
  const index = new Map<string, number>();
  const remap = new Int32Array(mesh.positions.length / 3);
  for (let i = 0; i < remap.length; i++) {
    const wx = mesh.positions[i * 3];
    const wy = mesh.positions[i * 3 + 1];
    const wz = mesh.positions[i * 3 + 2];
    const local = toLocal3(frame, [wx * M_TO_MM, -wz * M_TO_MM, wy * M_TO_MM - levelElevation]);
    const r = local.map((v) => Math.round(v * 100) / 100) as [number, number, number];
    const key = `${r[0]},${r[1]},${r[2]}`;
    let k = index.get(key);
    if (k === undefined) {
      k = coords.length;
      coords.push(r);
      index.set(key, k);
    }
    remap[i] = k;
  }
  const triangles: [number, number, number][] = [];
  const edges = new Map<string, number>();
  for (let t = 0; t + 2 < mesh.indices.length; t += 3) {
    const a = remap[mesh.indices[t]];
    const b = remap[mesh.indices[t + 1]];
    const c = remap[mesh.indices[t + 2]];
    if (a === b || b === c || a === c) continue;
    if (triangleArea(coords[a], coords[b], coords[c]) < 1e-6) continue;
    triangles.push([a + 1, b + 1, c + 1]);
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const key = `${u},${v}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  let closed = triangles.length >= 4;
  if (closed) {
    for (const [key, n] of edges) {
      const [u, v] = key.split(',');
      if (n !== 1 || edges.get(`${v},${u}`) !== 1) {
        closed = false;
        break;
      }
    }
  }
  return { coords, triangles, closed };
}

function triangleArea(a: number[], b: number[], c: number[]): number {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  return 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
}
