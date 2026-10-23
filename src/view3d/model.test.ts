import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createAppContext } from '../app/context';
import { createSampleProject } from '../app/sample';
import { createElement } from '../core/defaults';
import type { ChangeSet } from '../core/store';
import type { Door, Project, Wall } from '../core/types';
import { MaterialLibrary } from './materials';
import { doorBlocks, ModelSync, type ViewFilter } from './model';
import { Picker } from './picking';

function setup() {
  const ctx = createAppContext(createSampleProject());
  const project = ctx.store.project as Project;
  const filter: ViewFilter = { activeLevelId: project.levels[0].id, activeElevation: 0, cutAboveActive: false, xray: false };
  const materials = new MaterialLibrary({ textures: false });
  const model = new ModelSync(materials, filter);
  model.rebuildAll(project);
  const changes: ChangeSet[] = [];
  ctx.store.subscribe((c) => {
    changes.push(c);
    model.apply(ctx.store.project as Project, c);
  });
  return { ctx, project, model, materials, filter, changes };
}

describe('model sync', () => {
  it('builds one group per element with geometry, tagged with its element id', () => {
    const { project, model } = setup();
    const withGeometry = Object.values(project.elements).filter((e) => !['room', 'dimension', 'label'].includes(e.type));
    expect(model.size).toBe(withGeometry.length);
    for (const id of model.ids()) {
      const e = model.entry(id)!;
      expect(e.group.userData.elementId).toBe(id);
      for (const m of e.meshes) expect(m.userData.elementId).toBe(id);
    }
    expect(model.bounds().isEmpty()).toBe(false);
  });

  it('rebuilds only affected elements incrementally', () => {
    const { ctx, project, model } = setup();
    const base = model.buildCount;
    const sofa = Object.values(project.elements).find((e) => e.type === 'furniture')!;
    ctx.store.update(sofa.id, { position: { x: 1000, y: 1000 } });
    expect(model.buildCount - base).toBe(1);
    // Moving a wall rebuilds the wall, its joined neighbours and its openings — not the whole model.
    const wall = Object.values(project.elements).find((e) => e.type === 'wall' && e.thickness === 250) as Wall;
    const before = model.buildCount;
    ctx.store.update<Wall>(wall.id, { thickness: 300 });
    const rebuilt = model.buildCount - before;
    expect(rebuilt).toBeGreaterThan(2);
    expect(rebuilt).toBeLessThan(model.size / 2);
  });

  it('adds, removes and fully rebuilds on level changes', () => {
    const { ctx, project, model } = setup();
    const n = model.size;
    const b = createElement('block', project.levels[0].id, {});
    ctx.store.add(b);
    expect(model.size).toBe(n + 1);
    expect(model.entry(b.id)).toBeDefined();
    ctx.store.remove(b.id);
    expect(model.entry(b.id)).toBeUndefined();
    const before = model.buildCount;
    ctx.store.transact('Raise level', (tx) => tx.updateLevel(project.levels[1].id, { elevation: 3200 }));
    expect(model.buildCount - before).toBe(n);
  });

  it('hides levels above the active one and the active roof in cut-away mode', () => {
    const { project, model, filter } = setup();
    const first = project.levels[1];
    const firstIds = Object.values(project.elements).filter((e) => e.levelId === first.id && model.entry(e.id)).map((e) => e.id);
    model.setFilter({ ...filter, cutAboveActive: true });
    for (const id of firstIds) expect(model.isVisible(id)).toBe(false);
    model.setFilter({ ...filter, activeLevelId: first.id, activeElevation: first.elevation, cutAboveActive: true });
    const roof = Object.values(project.elements).find((e) => e.type === 'roof')!;
    expect(model.isVisible(roof.id)).toBe(false);
    const fWall = Object.values(project.elements).find((e) => e.type === 'wall' && e.levelId === first.id)!;
    expect(model.isVisible(fWall.id)).toBe(true);
    expect(model.pickables().some((m) => m.userData.elementId === roof.id)).toBe(false);
  });

  it('x-ray makes walls and roofs transparent; selection and hover tint materials and add edges', () => {
    const { project, model, filter } = setup();
    const wall = Object.values(project.elements).find((e) => e.type === 'wall')!;
    const sofa = Object.values(project.elements).find((e) => e.type === 'furniture')!;
    model.setFilter({ ...filter, xray: true });
    const wm = model.entry(wall.id)!.meshes[0].material as THREE.MeshStandardMaterial;
    expect(wm.transparent).toBe(true);
    expect(wm.depthWrite).toBe(false);
    expect((model.entry(sofa.id)!.meshes[0].material as THREE.MeshStandardMaterial).transparent).toBe(false);
    model.setHighlight(sofa.id, [wall.id]);
    const sel = model.entry(wall.id)!;
    expect((sel.meshes[0].material as THREE.MeshStandardMaterial).emissiveIntensity).toBeGreaterThan(0.3);
    expect(sel.edges?.length).toBeGreaterThan(0);
    expect(model.entry(sofa.id)!.edgeKind).toBe('hover');
    model.setHighlight(sofa.id, [], 'none');
    expect(model.entry(sofa.id)!.edgeKind).toBeNull();
    expect(model.entry(wall.id)!.edges).toBeNull();
  });

  it('preview-hidden elements stay pickable while invisible', () => {
    const { project, model } = setup();
    const wall = Object.values(project.elements).find((e) => e.type === 'wall')!;
    model.setPreviewHidden([wall.id]);
    expect(model.entry(wall.id)!.group.visible).toBe(false);
    expect(model.pickables().some((m) => m.userData.elementId === wall.id)).toBe(true);
    model.setPreviewHidden([]);
    expect(model.entry(wall.id)!.group.visible).toBe(true);
  });

  it('collects fixture lights; closed swing doors and windows block the walker, open and sliding doors do not', () => {
    const { ctx, project, model } = setup();
    expect(model.lights().length).toBeGreaterThan(0);
    const doors = Object.values(project.elements).filter((e): e is Door => e.type === 'door');
    const single = doors.find((d) => d.style === 'single')!;
    const sliding = doors.find((d) => d.style === 'sliding')!;
    const collides = (id: string) => model.colliders().some((m) => m.userData.elementId === id);
    expect(collides(single.id)).toBe(true);
    expect(collides(sliding.id)).toBe(false);
    expect(model.colliders().some((m) => String(m.parent?.name).startsWith('window'))).toBe(true);
    ctx.store.update<Door>(single.id, { openAngle: 90 });
    expect(collides(single.id)).toBe(false);
    model.dispose();
    expect(model.size).toBe(0);
  });

  it('doorBlocks: only swing doors opened less than 30° block', () => {
    const d = (style: Door['style'], openAngle?: number) => ({ style, openAngle }) as Door;
    expect(doorBlocks(d('single'))).toBe(true);
    expect(doorBlocks(d('double', 20))).toBe(true);
    expect(doorBlocks(d('single', 45))).toBe(false);
    for (const s of ['sliding', 'pocket', 'garage', 'opening'] as const) expect(doorBlocks(d(s))).toBe(false);
  });

  it('showVariant swaps one element\'s meshes without touching the store', () => {
    const { project, model } = setup();
    const door = Object.values(project.elements).find((e): e is Door => e.type === 'door' && e.style === 'single')!;
    const bounds = () => model.entry(door.id)!.bounds.clone();
    const closed = bounds();
    model.showVariant(project, { ...door, openAngle: 90 });
    expect(bounds().equals(closed)).toBe(false);
    expect((project.elements[door.id] as Door).openAngle ?? 0).toBe(0);
    model.showVariant(project, door);
    expect(bounds().equals(closed)).toBe(true);
  });
});

describe('picking', () => {
  it('hits element meshes, then the floor plane, then the ground', () => {
    const { project, model } = setup();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    // Look straight at the south facade from 10 m away, 1.5 m high (clear of the front door and its casing).
    camera.position.set(3.5, 1.5, 10);
    camera.lookAt(3.5, 1.5, 0);
    camera.updateMatrixWorld();
    const picker = new Picker();
    picker.aim(camera, 0, 0);
    const hit = picker.pick(model.pickables(), project, project.levels[0].id)!;
    expect(hit.kind).toBe('element');
    const el = project.elements[hit.elementId!];
    expect(el.type).toBe('wall');
    expect(hit.point.y).toBeCloseTo(-125, 3);
    expect(hit.elevation).toBeCloseTo(1500, 3);
    expect(hit.normal.y).toBeCloseTo(-1, 6);
    expect(hit.distance).toBeCloseTo(10 - 0.125, 3);

    // Looking down at open ground south of the house.
    camera.position.set(3, 10, 20);
    camera.lookAt(3, 0, 15);
    camera.updateMatrixWorld();
    picker.aim(camera, 0, 0);
    const g = picker.pick(model.pickables(), project, project.levels[0].id)!;
    expect(g.kind).toBe('ground');
    expect(g.point.x).toBeCloseTo(3000, 3);
    expect(g.point.y).toBeCloseTo(-15000, 3);
    // With the first floor active the floor plane at +3 m is hit first.
    const f = picker.pick(model.pickables(), project, project.levels[1].id)!;
    expect(f.kind).toBe('floor');
    expect(f.elevation).toBe(3000);
    // Looking at the sky: nothing.
    camera.lookAt(3, 20, -50);
    camera.updateMatrixWorld();
    picker.aim(camera, 0, 0);
    expect(picker.pick(model.pickables(), project, project.levels[0].id)).toBeNull();
    expect(picker.planePoint(0)).toBeNull();
  });
});
