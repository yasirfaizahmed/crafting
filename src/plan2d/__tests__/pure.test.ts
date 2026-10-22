import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { createElement, createProject } from '../../core/defaults';
import type { Door, Element, Furniture, Room, Vec2, Wall } from '../../core/types';
import { computeWallFootprints } from '../../core/walls';
import { dragWallEndpoint, moveElements, rectCorners, rotated, subtractCovered, translated, wallSegmentsAlong, withInsertedVertex, withVertex } from '../edit-ops';
import { gridSteps, scaleBar, shortLength } from '../grid';
import { boundRooms, syncRooms } from '../roomsync';
import { elementBounds, elementsInBox, hitTest } from '../shapes';
import { BASE_SCALE, MAX_SCALE, MIN_SCALE, Viewport } from '../viewport';

const wall = (start: Vec2, end: Vec2, extra: Partial<Wall> = {}): Wall => createElement('wall', 'L', { start, end, thickness: 200, ...extra });
const toMap = (els: Element[]) => Object.fromEntries(els.map((e) => [e.id, e]));

describe('Viewport', () => {
  it('maps model ⇄ screen with y up and round-trips', () => {
    const v = new Viewport();
    v.setSize(800, 600);
    v.center = { x: 1000, y: 2000 };
    v.scale = 0.1;
    expect(v.toScreen({ x: 1000, y: 2000 })).toEqual({ x: 400, y: 300 });
    expect(v.toScreen({ x: 2000, y: 3000 })).toEqual({ x: 500, y: 200 });
    const w = v.toWorld({ x: 123, y: 456 });
    const s = v.toScreen(w);
    expect(s.x).toBeCloseTo(123);
    expect(s.y).toBeCloseTo(456);
    expect(v.pxToMm(10)).toBeCloseTo(100);
  });

  it('zooms about the cursor keeping the point under it fixed', () => {
    const v = new Viewport();
    v.setSize(800, 600);
    const cursor = { x: 650, y: 120 };
    const before = v.toWorld(cursor);
    v.zoomAt(cursor, 2.5);
    const after = v.toWorld(cursor);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(v.scale).toBeCloseTo(BASE_SCALE * 2.5);
    v.zoomAt(cursor, 1e9);
    expect(v.scale).toBe(MAX_SCALE);
    v.zoomAt(cursor, 1e-12);
    expect(v.scale).toBe(MIN_SCALE);
  });

  it('pans with the pointer and fits bounds', () => {
    const v = new Viewport();
    v.setSize(1000, 500);
    const p = v.toScreen({ x: 0, y: 0 });
    v.panBy(50, -20);
    const q = v.toScreen({ x: 0, y: 0 });
    expect(q.x - p.x).toBeCloseTo(50);
    expect(q.y - p.y).toBeCloseTo(-20);
    v.fit({ minX: 0, minY: 0, maxX: 12000, maxY: 8000 }, 50);
    expect(v.center).toEqual({ x: 6000, y: 4000 });
    expect(v.scale).toBeCloseTo(400 / 8000);
    const vb = v.visibleBounds();
    expect(vb.minY).toBeCloseTo(-1000);
    expect(vb.maxY).toBeCloseTo(9000);
    expect(v.zoomPercent).toBe(100);
  });
});

describe('grid', () => {
  it('uses the snap grid as minor step when it is visible', () => {
    expect(gridSteps(500, 0.05)).toEqual({ minor: 500, major: 1000 });
    expect(gridSteps(100, 0.1)).toEqual({ minor: 100, major: 1000 });
  });
  it('coarsens the grid when zoomed out', () => {
    const g = gridSteps(500, 0.002);
    expect(g.minor * 0.002).toBeGreaterThanOrEqual(8);
    expect(g.major).toBeGreaterThan(g.minor);
    expect(g.major % g.minor).toBe(0);
  });
  it('sizes a nice scale bar', () => {
    const s = scaleBar(0.05, 120);
    expect(s.length).toBe(2000);
    expect(scaleBar(1, 120).length).toBe(100);
    expect(shortLength(2000)).toBe('2 m');
    expect(shortLength(500)).toBe('500 mm');
  });
});

describe('shapes / hit testing', () => {
  const sp = createSampleProject();
  const lvl = sp.levels[0].id;
  const els = Object.values(sp.elements).filter((e) => e.levelId === lvl);
  const ctx = { elements: sp.elements, footprints: computeWallFootprints(sp, lvl), level: sp.levels[0] };

  it('prefers openings over walls, furniture over rooms, rooms over slabs', () => {
    const southDoor = els.find((e) => e.type === 'door' && (e as Door).offset === 2500)!;
    expect(hitTest(els, ctx, { x: 2500, y: 0 }, 50)?.id).toBe(southDoor.id);
    expect(hitTest(els, ctx, { x: 6000, y: 0 }, 50)?.type).toBe('wall');
    expect(hitTest(els, ctx, { x: 8000, y: 1000 }, 50)?.type).toBe('furniture');
    expect(hitTest(els, ctx, { x: 6000, y: 3000 }, 50)?.type).toBe('room');
    expect(hitTest(els, ctx, { x: 12050, y: 3000 }, 1, { types: ['slab'] })?.type).toBe('slab');
    expect(hitTest(els, ctx, { x: 40000, y: 40000 }, 50)).toBeUndefined();
  });

  it('selects by window (inside) and crossing (touching)', () => {
    const box = { minX: 7000, minY: 500, maxX: 9200, maxY: 2600 };
    const win = elementsInBox(els, ctx, box, 'window').map((id) => sp.elements[id].type);
    expect(win).toContain('furniture');
    expect(win).not.toContain('room');
    const cross = elementsInBox(els, ctx, { minX: 4900, minY: 3000, maxX: 5100, maxY: 3100 }, 'crossing').map((id) => sp.elements[id].type);
    expect(cross).toContain('wall');
    expect(cross).toContain('room');
  });

  it('computes bounds for framing', () => {
    const b = elementBounds(els.filter((e) => e.type === 'wall'), ctx);
    expect(b.minX).toBeCloseTo(-125);
    expect(b.maxX).toBeCloseTo(12125);
  });
});

describe('edit operations', () => {
  it('moves a wall and stretches joined neighbours (shared ends and T joins)', () => {
    const a = wall({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const b = wall({ x: 4000, y: 0 }, { x: 4000, y: 3000 });
    const c = wall({ x: 4000, y: 3000 }, { x: 0, y: 3000 });
    const t = wall({ x: 2000, y: 3000 }, { x: 2000, y: 6000 });
    const els = toMap([a, b, c, t]);
    const patch = moveElements(els, [b.id], { x: 500, y: 0 });
    expect((patch.get(b.id) as Wall).start).toEqual({ x: 4500, y: 0 });
    expect((patch.get(a.id) as Wall).end).toEqual({ x: 4500, y: 0 });
    expect((patch.get(c.id) as Wall).start).toEqual({ x: 4500, y: 3000 });
    expect(patch.has(t.id)).toBe(false);
    // Moving c north drags the T-joined wall's end along.
    const p2 = moveElements(els, [c.id], { x: 0, y: 400 });
    expect((p2.get(t.id) as Wall).start).toEqual({ x: 2000, y: 3400 });
    expect((p2.get(b.id) as Wall).end).toEqual({ x: 4000, y: 3400 });
  });

  it('keeps openings in place when a neighbour start is stretched and slides lone openings', () => {
    const a = wall({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const b = wall({ x: 4000, y: 0 }, { x: 8000, y: 0 }, {});
    const left = wall({ x: 4000, y: 0 }, { x: 4000, y: 3000 });
    const d = createElement('door', 'L', { hostId: b.id, offset: 2000, width: 900 });
    const els = toMap([a, b, left, d]);
    const patch = moveElements(els, [left.id], { x: -1000, y: 0 });
    expect((patch.get(b.id) as Wall).start).toEqual({ x: 3000, y: 0 });
    expect((patch.get(d.id) as Door).offset).toBeCloseTo(3000);
    const slide = moveElements(els, [d.id], { x: 300, y: 999 });
    expect((slide.get(d.id) as Door).offset).toBe(2300);
    const clamp = moveElements(els, [d.id], { x: 99999, y: 0 });
    expect((clamp.get(d.id) as Door).offset).toBe(4000 - 450);
  });

  it('drags a wall endpoint together with the joined neighbour', () => {
    const a = wall({ x: 0, y: 0 }, { x: 4000, y: 0 });
    const b = wall({ x: 4000, y: 0 }, { x: 4000, y: 3000 });
    const t = wall({ x: 2000, y: 0 }, { x: 2000, y: -2000 });
    const els = toMap([a, b, t]);
    const patch = dragWallEndpoint(els, a.id, 'end', { x: 5000, y: 1000 });
    expect((patch.get(a.id) as Wall).end).toEqual({ x: 5000, y: 1000 });
    expect((patch.get(b.id) as Wall).start).toEqual({ x: 5000, y: 1000 });
    // T wall reattached to the rotated wall along its own direction.
    const tn = patch.get(t.id) as Wall;
    expect(tn.start.x).toBeCloseTo(2000);
    expect(tn.start.y).toBeCloseTo(400);
  });

  it('translates and rotates every element type', () => {
    const sp = createSampleProject();
    for (const el of Object.values(sp.elements)) {
      const m = translated(el, { x: 100, y: -50 });
      expect(m.id).toBe(el.id);
      const r = rotated(el, 90, { x: 0, y: 0 });
      expect(r.type).toBe(el.type);
    }
    const f = createElement('furniture', 'L', { position: { x: 1000, y: 0 }, rotation: 350 });
    const r = rotated(f, 20) as Furniture;
    expect(r.rotation).toBe(10);
    expect(r.position).toEqual({ x: 1000, y: 0 });
  });

  it('subtracts parts already covered by collinear walls', () => {
    const existing = [wall({ x: 0, y: 0 }, { x: 3000, y: 0 }), wall({ x: 5000, y: 0 }, { x: 4000, y: 0 })];
    const pieces = subtractCovered({ x: -1000, y: 0 }, { x: 6000, y: 0 }, existing);
    expect(pieces).toEqual([
      [{ x: -1000, y: 0 }, { x: 0, y: 0 }],
      [{ x: 3000, y: 0 }, { x: 4000, y: 0 }],
      [{ x: 5000, y: 0 }, { x: 6000, y: 0 }],
    ]);
    expect(subtractCovered({ x: 0, y: 0 }, { x: 3000, y: 0 }, existing)).toEqual([]);
    expect(subtractCovered({ x: 0, y: 10 }, { x: 3000, y: 10 }, existing)).toHaveLength(1);
    const corners = rectCorners({ x: 5000, y: 9000 }, { x: 1000, y: 1000 });
    expect(corners[0]).toEqual({ x: 1000, y: 1000 });
    expect(wallSegmentsAlong(corners, true, [])).toHaveLength(4);
  });

  it('edits polygon vertices', () => {
    const r = createElement('room', 'L', { outline: rectCorners({ x: 0, y: 0 }, { x: 10, y: 10 }) });
    expect(withVertex(r, 2, { x: 20, y: 20 }).outline[2]).toEqual({ x: 20, y: 20 });
    expect(withInsertedVertex(r, 0, { x: 5, y: -1 }).outline).toHaveLength(5);
  });
});

describe('room sync', () => {
  it('bound rooms follow their walls', () => {
    const p = createProject();
    const L = p.levels[0].id;
    const pts = rectCorners({ x: 0, y: 0 }, { x: 5000, y: 4000 });
    const walls = pts.map((q, i) => createElement('wall', L, { start: q, end: pts[(i + 1) % 4], thickness: 200 }));
    const room = createElement('room', L, { outline: rectCorners({ x: 100, y: 100 }, { x: 4900, y: 3900 }), name: 'Living' });
    const free = createElement('room', L, { outline: rectCorners({ x: 9000, y: 9000 }, { x: 9500, y: 9500 }), name: 'Free' });
    const before = toMap([...walls, room, free]);
    const bindings = boundRooms(before, L);
    expect(bindings.map((b) => b.room.id)).toEqual([room.id]);
    const after = { ...before, ...Object.fromEntries(moveElements(before, [walls[1].id], { x: 1000, y: 0 })) };
    const patch = syncRooms(bindings, after, L);
    const outline = (patch.get(room.id) as Room).outline;
    expect(Math.max(...outline.map((q) => q.x))).toBeCloseTo(5900);
  });
});
