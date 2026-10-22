/**
 * Rooms follow their walls: a Room whose outline matches a detected enclosed area is "bound" to it;
 * after walls change, bound rooms get the new outline of the area containing their anchor point.
 */
import { interiorPoint } from '../core/autobuild';
import { distance, ensureCCW, polygonArea } from '../core/math2d';
import { detectRooms, pointInDetectedRoom } from '../core/rooms';
import type { Element, Room, Vec2 } from '../core/types';
import type { Patch } from './edit-ops';

type Elements = Record<string, Element>;

export interface RoomBinding {
  room: Room;
  anchor: Vec2;
}

function samePolygon(a: Vec2[], b: Vec2[], tol = 1): boolean {
  if (a.length !== b.length) return false;
  return a.every((p) => b.some((q) => distance(p, q) <= tol));
}

/** Rooms on the level whose outline coincides with a detected enclosed area. */
export function boundRooms(elements: Elements, levelId: string): RoomBinding[] {
  const rooms = Object.values(elements).filter((e): e is Room => e.type === 'room' && e.levelId === levelId && !e.locked && e.outline.length >= 3);
  if (!rooms.length) return [];
  const detected = detectRooms({ elements }, levelId);
  const out: RoomBinding[] = [];
  for (const room of rooms) {
    const anchor = interiorPoint(room.outline);
    const det = detected.find((d) => pointInDetectedRoom(anchor, d) || pointInDetectedRoom(interiorPoint(d.polygon), { ...d, polygon: room.outline, holes: [] }));
    if (!det) continue;
    const a = polygonArea(room.outline);
    const b = polygonArea(det.polygon);
    if (Math.abs(a - b) <= Math.max(1e4, b * 0.01) || samePolygon(room.outline, det.polygon, 5)) out.push({ room, anchor });
  }
  return out;
}

/** New outlines for the rooms bound in `before`, recomputed against the walls in `after`. */
export function syncRooms(bindings: RoomBinding[], after: Elements, levelId: string): Patch {
  const patch: Patch = new Map();
  if (!bindings.length) return patch;
  const detected = detectRooms({ elements: after }, levelId);
  const target = bindings.map(({ anchor }) => detected.filter((d) => pointInDetectedRoom(anchor, d)).sort((x, y) => x.area - y.area)[0]);
  const bound = new Set(bindings.map((b) => b.room.id));
  const others = Object.values(after).filter((e): e is Room => e.type === 'room' && e.levelId === levelId && !bound.has(e.id) && e.outline.length >= 3);
  bindings.forEach(({ room }, i) => {
    const cur = after[room.id];
    const det = target[i];
    if (!cur || cur.type !== 'room' || !det) return;
    // Two rooms now share one area (a wall between them was removed): leave both for the user.
    if (target.some((t, j) => j !== i && t === det)) return;
    // The area already has its own (new) room, e.g. a room drawn inside this one.
    if (others.some((o) => pointInDetectedRoom(interiorPoint(o.outline), det))) return;
    const outline = ensureCCW(det.polygon).map((p) => ({ x: Math.round(p.x * 1000) / 1000, y: Math.round(p.y * 1000) / 1000 }));
    if (samePolygon(outline, cur.outline, 0.01)) return;
    patch.set(room.id, { ...cur, outline });
  });
  return patch;
}
