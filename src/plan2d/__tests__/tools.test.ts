// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { createElement, createProject } from '../../core/defaults';
import { polygonArea } from '../../core/math2d';
import { detectRooms } from '../../core/rooms';
import type { Block, Dimension, Door, Element, Furniture, Label, Railing, Room, Slab, Stair, Wall } from '../../core/types';
import { wallLength } from '../../core/walls';
import { type Harness, mount, rectWalls } from './harness';

let h: Harness | null = null;
afterEach(() => {
  h?.dispose();
  h = null;
});

const of = <T extends Element>(hh: Harness, type: T['type']) => hh.ctx.store.elements.filter((e) => e.type === type) as T[];

describe('wall tool', () => {
  it('chains walls by clicking and closes the loop on the chain start', () => {
    h = mount();
    h.hold('wall-200', 1);
    h.click(0, 0);
    h.click(4000, 0);
    h.click(4000, 3000);
    h.click(0, 3000);
    expect(of<Wall>(h, 'wall')).toHaveLength(3);
    h.click(0, 0); // closes
    const walls = of<Wall>(h, 'wall');
    expect(walls).toHaveLength(4);
    expect(walls.every((w) => w.thickness === 200 && w.materialId === 'plaster-white')).toBe(true);
    expect(h.ed.activeTool.busy?.()).toBe(false);
    expect(detectRooms(h.ctx.store.project, h.ed.levelId)).toHaveLength(1);
    // Each segment is its own undo step.
    expect(h.ctx.store.undoLabel).toBe('Draw wall');
    h.ctx.store.undo();
    expect(of(h, 'wall')).toHaveLength(3);
  });

  it('sets the exact length from typed input and keeps digits away from the hotbar', () => {
    h = mount();
    h.hold('wall-brick', 1);
    h.type('5'); // not drawing: the digit goes to the global shortcuts (hotbar)
    expect(h.leaked).toContain('5');
    h.leaked.length = 0;
    h.click(0, 0);
    h.move(1200, 30); // direction east (angle snap)
    h.type('3.6m');
    expect(h.leaked).toEqual([]);
    h.key('Enter');
    let walls = of<Wall>(h, 'wall');
    expect(walls).toHaveLength(1);
    expect(walls[0].start).toEqual({ x: 0, y: 0 });
    expect(walls[0].end.x).toBeCloseTo(3600);
    expect(walls[0].end.y).toBeCloseTo(0);
    expect(walls[0].thickness).toBe(230);
    // Imperial feet-inches, then an explicit angle.
    h.move(3600, 2000);
    h.type(`12'6"`);
    h.key('Enter');
    walls = of<Wall>(h, 'wall');
    expect(wallLength(walls[1])).toBeCloseTo(3810, 0);
    h.type('2000<180');
    h.key('Enter');
    walls = of<Wall>(h, 'wall');
    expect(walls[2].end.x).toBeCloseTo(walls[2].start.x - 2000);
    // Backspace edits the buffer and never deletes the selection; Enter on an empty buffer finishes.
    h.type('9');
    h.key('Backspace');
    expect(h.leaked).toEqual([]);
    h.key('Enter');
    expect(h.ed.activeTool.busy?.()).toBe(false);
    expect(of(h, 'wall')).toHaveLength(3);
  });

  it('Backspace with an empty length buffer steps back one segment', () => {
    h = mount();
    h.hold('wall-200', 1);
    h.click(0, 0);
    h.click(3000, 0);
    h.click(3000, 3000);
    expect(of(h, 'wall')).toHaveLength(2);
    h.key('Backspace');
    expect(of(h, 'wall')).toHaveLength(1);
    expect((h.ed.activeTool as unknown as { chain: unknown[] }).chain).toHaveLength(2);
    h.click(3000, -2000);
    expect(of<Wall>(h, 'wall')[1].end).toEqual({ x: 3000, y: -2000 });
  });

  it('finishes on double-click, right-click and Esc', () => {
    h = mount();
    h.hold('wall-200', 1);
    h.click(0, 0);
    h.click(3000, 0);
    h.dbl(3000, 2000);
    expect(of(h, 'wall')).toHaveLength(2);
    expect(h.ed.activeTool.busy?.()).toBe(false);
    h.click(6000, 0);
    h.click(9000, 0);
    h.down(9000, 2000, { button: 2 });
    h.up(9000, 2000, { button: 2 });
    expect(h.ed.activeTool.busy?.()).toBe(false);
    h.click(0, 6000);
    h.key('Escape');
    expect(h.leaked).not.toContain('Escape');
    expect(h.ed.activeTool.busy?.()).toBe(false);
    // Nothing to cancel → Esc reaches the global handler.
    h.key('Escape');
    expect(h.leaked).toContain('Escape');
    expect(of(h, 'wall')).toHaveLength(3);
  });
});

describe('room tool', () => {
  it('drags a rectangle into 4 walls with shared corners plus a room in ONE undo step', () => {
    h = mount();
    h.hold('room');
    h.drag({ x: 0, y: 0 }, { x: 6000, y: 4000 });
    const walls = of<Wall>(h, 'wall');
    const rooms = of<Room>(h, 'room');
    expect(walls).toHaveLength(4);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].name).toBe('Room 1');
    expect(polygonArea(rooms[0].outline)).toBeCloseTo(5800 * 3800, -3);
    // Shared corners: every wall end coincides with another wall end.
    for (const w of walls) for (const p of [w.start, w.end]) expect(walls.filter((o) => o !== w && (o.start.x === p.x && o.start.y === p.y || o.end.x === p.x && o.end.y === p.y))).toHaveLength(1);
    expect(h.ctx.store.undoLabel).toBe('Draw room');
    h.ctx.store.undo();
    expect(h.ctx.store.elements).toHaveLength(0);
  });

  it('reuses existing walls for adjacent rooms', () => {
    h = mount();
    h.hold('room');
    h.drag({ x: 0, y: 0 }, { x: 6000, y: 4000 });
    h.drag({ x: 6000, y: 0 }, { x: 10000, y: 4000 });
    expect(of(h, 'wall')).toHaveLength(7);
    const rooms = of<Room>(h, 'room');
    expect(rooms.map((r) => r.name)).toEqual(['Room 1', 'Room 2']);
    expect(detectRooms(h.ctx.store.project, h.ed.levelId)).toHaveLength(2);
  });

  it('clicking inside an enclosed area just adds the Room (once)', () => {
    const p = createProject();
    rectWalls(p, 0, 0, 5000, 4000);
    h = mount(p);
    h.hold('room');
    h.click(2500, 2000);
    expect(of(h, 'wall')).toHaveLength(4);
    expect(of(h, 'room')).toHaveLength(1);
    h.click(2600, 2100);
    expect(of(h, 'room')).toHaveLength(1);
    expect(h.ctx.selection.get()).toEqual([of(h, 'room')[0].id]);
  });

  it('draws polygon rooms by clicking points outside enclosed areas', () => {
    h = mount();
    h.hold('room');
    h.click(0, 0);
    expect(h.ed.activeTool.busy?.()).toBe(true);
    h.click(6000, 0);
    h.click(6000, 3000);
    h.click(3000, 3000);
    h.click(3000, 6000);
    h.click(0, 6000);
    h.click(0, 0); // close on the first point
    expect(of(h, 'wall')).toHaveLength(6);
    expect(of(h, 'room')).toHaveLength(1);
    // Esc in polygon mode cancels.
    h.click(20000, 0);
    h.click(25000, 0);
    h.key('Escape');
    expect(h.ed.activeTool.busy?.()).toBe(false);
    expect(of(h, 'wall')).toHaveLength(6);
  });

  it('subdividing a room keeps the existing room bound to its walls', () => {
    h = mount();
    h.hold('room');
    h.drag({ x: 0, y: 0 }, { x: 8000, y: 4000 });
    h.hold('wall-partition', 1);
    h.click(5000, 0);
    h.click(5000, 4000);
    h.key('Escape');
    const room = of<Room>(h, 'room')[0];
    // The room shrank to the part containing its anchor (the left, larger side).
    expect(Math.max(...room.outline.map((q) => q.x))).toBeCloseTo(4950);
  });
});

describe('door / window tool', () => {
  const setup = () => {
    const p = createProject();
    const walls = rectWalls(p, 0, 0, 6000, 4000);
    const short = createElement('wall', p.levels[0].id, { start: { x: 8000, y: 0 }, end: { x: 8600, y: 0 }, thickness: 200 });
    p.elements[short.id] = short;
    return { p, walls, short };
  };

  it('places a door on the hovered wall, swing towards the cursor side', () => {
    const { p, walls } = setup();
    h = mount(p);
    h.hold('door-single', 3);
    h.move(3020, 60);
    expect(h.ed.ghosts).toHaveLength(1);
    expect(h.ed.ghostState).toBe('valid');
    h.click(3020, 60);
    const [d] = of<Door>(h, 'door');
    expect(d.hostId).toBe(walls[0].id);
    expect(d.offset).toBe(3000); // snapped to the wall's clear midpoint
    expect(d.flip).toBe(false); // cursor inside (left of the CCW wall)
    h.click(1500, -60);
    const doors = of<Door>(h, 'door');
    expect(doors).toHaveLength(2);
    expect(doors[1].flip).toBe(true);
    expect(doors[1].offset).toBe(1500);
  });

  it('rejects overlapping and too-short placements, clamps near corners and flips the hinge with R', () => {
    const { p, short } = setup();
    h = mount(p);
    h.hold('door-single', 3);
    h.click(3000, 50);
    h.move(3300, 50);
    expect(h.ed.ghostState).toBe('invalid');
    h.click(3300, 50);
    expect(of(h, 'door')).toHaveLength(1);
    // Too short a wall.
    h.move(8300, 20);
    expect(h.ed.ghostState).toBe('invalid');
    expect((h.ed.ghosts[0] as Door).hostId).toBe(short.id);
    // Near the corner the door slides to the first position that fits.
    h.click(150, 40);
    const corner = of<Door>(h, 'door')[1];
    expect(corner.offset - corner.width / 2).toBeGreaterThanOrEqual(100 - 1e-6);
    h.key('r');
    h.click(4500, 40);
    expect(of<Door>(h, 'door')[2].hinge).toBe('right');
  });

  it('places windows with their catalog sill', () => {
    const { p, walls } = setup();
    h = mount(p);
    h.hold('window-casement', 4);
    h.click(6000, 2000);
    const win = of<Element & { sill: number; hostId: string }>(h, 'window')[0];
    expect(win.hostId).toBe(walls[1].id);
    expect(win.sill).toBe(900);
  });
});

describe('select tool', () => {
  it('selects, toggles with Shift, box-selects and moves with stretching', () => {
    const p = createProject();
    const walls = rectWalls(p, 0, 0, 6000, 4000);
    h = mount(p);
    h.hold('tool-select', 0);
    h.click(3000, 0);
    expect(h.ctx.selection.get()).toEqual([walls[0].id]);
    h.click(6000, 2000, { shift: true });
    expect(h.ctx.selection.get()).toEqual([walls[0].id, walls[1].id]);
    h.click(30000, 30000);
    expect(h.ctx.selection.get()).toEqual([]);
    // Window selection (left → right) picks the fully enclosed south wall only.
    h.drag({ x: -500, y: -500 }, { x: 6500, y: 500 });
    expect(h.ctx.selection.get()).toEqual([walls[0].id]);
    // Crossing selection (right → left) also picks the walls it touches.
    h.drag({ x: 6500, y: 500 }, { x: -500, y: -500 });
    expect(new Set(h.ctx.selection.get())).toEqual(new Set([walls[0].id, walls[1].id, walls[3].id]));
    // Drag the east wall 1 m east: joined neighbours stretch, one undo step.
    h.click(30000, 30000);
    h.drag({ x: 6000, y: 2000 }, { x: 7000, y: 2000 });
    const east = h.ctx.store.getElement(walls[1].id) as Wall;
    expect(east.start.x).toBe(7000);
    expect((h.ctx.store.getElement(walls[0].id) as Wall).end.x).toBe(7000);
    expect((h.ctx.store.getElement(walls[2].id) as Wall).start.x).toBe(7000);
    expect(h.ctx.store.undoLabel).toBe('Move wall');
  });

  it('drags wall end handles with joined neighbours attached, nudges with arrows', () => {
    const p = createProject();
    const walls = rectWalls(p, 0, 0, 6000, 4000);
    h = mount(p);
    h.hold('tool-select', 0);
    h.click(3000, 0);
    // Shift: free angle (grid only); without it the end would lock to a 15° ray from the other end.
    h.drag({ x: 6000, y: 0 }, { x: 7000, y: -1000 }, { shift: true });
    expect((h.ctx.store.getElement(walls[0].id) as Wall).end).toEqual({ x: 7000, y: -1000 });
    expect((h.ctx.store.getElement(walls[1].id) as Wall).start).toEqual({ x: 7000, y: -1000 });
    h.key('ArrowUp');
    expect((h.ctx.store.getElement(walls[0].id) as Wall).start).toEqual({ x: 0, y: 10 });
    h.key('ArrowRight', { shiftKey: true });
    expect((h.ctx.store.getElement(walls[0].id) as Wall).start).toEqual({ x: 100, y: 10 });
    expect(h.leaked).not.toContain('ArrowUp');
  });

  it('renames rooms and edits labels on double-click', async () => {
    const p = createProject();
    rectWalls(p, 0, 0, 5000, 4000);
    const room = createElement('room', p.levels[0].id, { name: 'Room 1', outline: [{ x: 100, y: 100 }, { x: 4900, y: 100 }, { x: 4900, y: 3900 }, { x: 100, y: 3900 }] });
    p.elements[room.id] = room;
    h = mount(p);
    h.hold('tool-select', 0);
    h.dbl(2500, 2000);
    const input = h.ed.root.querySelector<HTMLInputElement>('.p2d-prompt input')!;
    expect(input.value).toBe('Room 1');
    input.value = 'Living Room';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect((h.ctx.store.getElement(room.id) as Room).name).toBe('Living Room');
    expect(h.ctx.store.undoLabel).toBe('Rename room');
  });

  it('moves furniture and rotates it with R and the rotate handle', () => {
    const p = createProject();
    const f = createElement('furniture', p.levels[0].id, { catalogId: 'armchair', position: { x: 2000, y: 2000 }, rotation: 0 });
    p.elements[f.id] = f;
    h = mount(p);
    h.hold('tool-select', 0);
    h.click(2000, 2000);
    h.key('r');
    expect((h.ctx.store.getElement(f.id) as Furniture).rotation).toBe(90);
    h.key('R', { shiftKey: true });
    expect((h.ctx.store.getElement(f.id) as Furniture).rotation).toBe(105);
    // Rotate handle sits beyond the back edge; drag it to point the back east (rotation 270 = -90).
    const handle = h.ed.activeTool.handles!().find((x) => x.kind === 'rotate')!;
    h.drag(handle.p, { x: 5000, y: 2000 });
    expect((h.ctx.store.getElement(f.id) as Furniture).rotation).toBe(270);
    h.drag({ x: 2000, y: 2000 }, { x: 2600, y: 2400 });
    const moved = h.ctx.store.getElement(f.id) as Furniture;
    expect(moved.position.x).not.toBe(2000);
  });
});

describe('other tools', () => {
  it('slab tool fills an enclosed room on click', () => {
    const p = createProject();
    rectWalls(p, 0, 0, 5000, 4000);
    h = mount(p);
    h.hold('slab-tile');
    h.click(2500, 2000);
    const [s] = of<Slab>(h, 'slab');
    expect(s.materialId).toBe('tile-grey');
    expect(polygonArea(s.outline)).toBeCloseTo(4800 * 3800, -3);
  });

  it('roof tool roofs the outer footprint on click', () => {
    const p = createProject();
    rectWalls(p, 0, 0, 8000, 5000);
    h = mount(p);
    h.hold('roof-hip');
    h.click(4000, 2500);
    const [r] = of<Element & { shape: string; outline: { x: number }[] }>(h, 'roof');
    expect(r.shape).toBe('hip');
    expect(polygonArea(r.outline as never)).toBeCloseTo(8200 * 5200, -3);
  });

  it('furniture backs against nearby walls', () => {
    const p = createProject();
    rectWalls(p, 0, 0, 6000, 4000);
    h = mount(p);
    h.hold('furn-bed-double');
    h.move(3000, 3200);
    h.click(3000, 3200);
    const [bed] = of<Furniture>(h, 'furniture');
    expect(bed.rotation).toBe(0); // back (+y) against the north wall
    expect(bed.position.y).toBeCloseTo(3900 - 2050 / 2 - 1, 0);
    h.key('r');
    h.click(5600, 2000);
    expect(of<Furniture>(h, 'furniture')[1].rotation).toBeDefined();
  });

  it('stair, column, beam, railing, block, dimension and label tools create elements', () => {
    h = mount();
    h.hold('stair-straight');
    h.drag({ x: 0, y: 0 }, { x: 0, y: 2000 });
    expect(of(h, 'stair')).toHaveLength(1);
    // M mirrors the stair in hand before it is placed.
    h.hold('stair-l');
    h.key('m');
    h.drag({ x: 8000, y: 0 }, { x: 8000, y: 2000 });
    expect(of<Stair>(h, 'stair').find((s) => s.shape === 'l-shape')?.turn).toBe('right');
    h.hold('column-rect');
    h.click(1010, 990);
    expect((of(h, 'column')[0] as Element & { position: { x: number } }).position.x).toBe(1000);
    h.hold('beam-steel');
    h.click(0, 5000);
    h.click(4000, 5000);
    expect(of(h, 'beam')).toHaveLength(1);
    h.hold('railing-glass');
    h.click(0, 7000);
    h.click(2000, 7000);
    h.click(2000, 8000);
    h.key('Enter');
    expect((of<Railing>(h, 'railing')[0]).path).toHaveLength(3);
    h.hold('block-stone');
    h.click(9100, 100);
    h.click(9100, 100);
    const blocks = of<Block>(h, 'block');
    expect(blocks).toHaveLength(2);
    expect(blocks[1].position.z).toBe(500); // stacked
    h.hold('dimension');
    h.click(0, -2000);
    h.click(4000, -2000);
    h.click(2000, -2500);
    const [dim] = of<Dimension>(h, 'dimension');
    expect(dim.b.x - dim.a.x).toBe(4000);
    expect(dim.offset).toBe(-500);
    h.hold('label');
    h.click(5000, -3000);
    const input = h.ed.root.querySelector<HTMLInputElement>('.p2d-prompt input')!;
    expect(input).toBeTruthy();
    input.value = 'Garden';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(of<Label>(h, 'label')[0].text).toBe('Garden');
  });

  it('dimension tool dimensions a clicked wall', () => {
    const p = createProject();
    rectWalls(p, 0, 0, 5000, 3000);
    h = mount(p);
    h.ctx.ui.set({ snapGrid: false });
    h.hold('dimension');
    h.click(2400, 30);
    h.click(2400, -800);
    const [d] = of<Dimension>(h, 'dimension');
    expect(Math.abs(d.b.x - d.a.x)).toBe(5000);
  });

  it('eraser, eyedropper and paint act on the hovered element', () => {
    const p = createProject();
    const walls = rectWalls(p, 0, 0, 5000, 4000);
    h = mount(p);
    h.hold('tool-eyedropper');
    h.click(2500, 0);
    expect(h.ctx.ui.get().hotbar[2]).toBe('wall-200');
    h.hold('paint-brick-white');
    h.click(2500, 50); // inside → left face of the CCW south wall
    expect((h.ctx.store.getElement(walls[0].id) as Wall).leftFinishId).toBe('brick-white');
    h.click(2500, -50);
    expect((h.ctx.store.getElement(walls[0].id) as Wall).rightFinishId).toBe('brick-white');
    h.hold('tool-eraser');
    h.click(2500, 0);
    expect(h.ctx.store.getElement(walls[0].id)).toBeUndefined();
    expect(h.ctx.store.undoLabel).toBe('Erase wall');
  });

  it('measure tool reports the distance without changing the model', async () => {
    h = mount();
    h.hold('tool-measure');
    h.click(0, 0);
    h.click(3000, 4000);
    await Promise.resolve();
    expect(h.ctx.ui.get().toolHint).toMatch(/5\.00 m/);
    expect(h.ctx.store.canUndo).toBe(false);
  });
});

describe('commands, underlay and handle', () => {
  it('registers the build / plan commands and generates 3D', async () => {
    const p = createProject();
    rectWalls(p, 0, 0, 6000, 4000);
    h = mount(p);
    for (const id of ['build.generate3d', 'build.addFloorAbove', 'plan.importUnderlay', 'plan.calibrateUnderlay', 'plan.zoomToFit']) expect(h.ctx.commands.get(id)).toBeDefined();
    expect(h.ctx.commands.get('build.generate3d')!.group).toBe('Build');
    await h.ctx.commands.run('build.generate3d');
    expect(of(h, 'roof')).toHaveLength(1);
    expect(of<Slab>(h, 'slab').map((s) => s.kind).sort()).toEqual(['floor', 'foundation']);
    await h.ctx.commands.run('build.addFloorAbove');
    expect(h.ctx.store.project.levels).toHaveLength(2);
    expect(h.ctx.ui.get().activeLevelId).toBe(h.ctx.store.project.levels[1].id);
    expect(h.ctx.store.elementsOnLevel(h.ctx.store.project.levels[1].id).filter((e) => e.type === 'wall')).toHaveLength(4);
    h.dispose();
    expect(h.ctx.commands.get('build.generate3d')).toBeUndefined();
    h = null;
  });

  it('calibrates a blueprint image from two clicks and a typed distance', () => {
    const p = createProject();
    p.levels[0].underlay = { src: 'data:image/png;base64,AAAA', x: 0, y: 1000, mmPerPixel: 10, rotation: 0, opacity: 0.5, visible: true };
    h = mount(p);
    expect(h.ctx.commands.get('plan.calibrateUnderlay')!.enabled!()).toBe(true);
    void h.ctx.commands.run('plan.calibrateUnderlay');
    expect(h.ed.overrideActive).toBe('calibrate');
    h.click(0, 0);
    h.click(2000, 0);
    const input = h.ed.root.querySelector<HTMLInputElement>('.p2d-prompt input')!;
    input.value = 'nonsense';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(h.ed.root.querySelector('.p2d-prompt.invalid')).toBeTruthy();
    input.value = '4m';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const u = h.ctx.store.project.levels[0].underlay!;
    expect(u.mmPerPixel).toBeCloseTo(20);
    expect(u.y).toBeCloseTo(2000); // scaled about the first point (0, 0)
    expect(h.ed.overrideActive).toBeNull();
    expect(h.ctx.store.undoLabel).toBe('Calibrate underlay');
  });

  it('PlanHandle frames elements and survives resize / setActive', () => {
    const sp = createSampleProject();
    h = mount(sp);
    const sofa = Object.values(sp.elements).find((e) => e.type === 'furniture')!;
    h.plan.frame([sofa.id]);
    expect(Math.abs(h.ed.view.center.x - (sofa as Furniture).position.x)).toBeLessThan(10);
    h.plan.resize();
    h.plan.setActive(false);
    h.plan.setActive(true);
    h.plan.frame();
    expect(h.ed.view.scale).toBeGreaterThan(0);
  });
});
