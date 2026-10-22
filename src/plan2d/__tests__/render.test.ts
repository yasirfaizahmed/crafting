import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../../app/sample';
import { CATALOG, FURNITURE } from '../../core/catalog';
import { createElement, createFromCatalog, createProject } from '../../core/defaults';
import type { Element, Project } from '../../core/types';
import { computeWallFootprints } from '../../core/walls';
import type { OverlayItem } from '../editor-types';
import { renderPlan, type RenderScene } from '../render/renderer';
import { Viewport } from '../viewport';
import { rectWalls } from './harness';

/** A CanvasRenderingContext2D stand-in that records method calls and accepts any property. */
function mockContext(): { g: CanvasRenderingContext2D; calls: Map<string, number>; texts: string[] } {
  const calls = new Map<string, number>();
  const texts: string[] = [];
  const state: Record<string, unknown> = {};
  const g = new Proxy(state, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') return (t: string) => ({ width: t.length * 6 });
      return (...args: unknown[]) => {
        calls.set(prop, (calls.get(prop) ?? 0) + 1);
        if (prop === 'fillText') texts.push(String(args[0]));
        for (const a of args) if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`${prop} got non-finite argument`);
      };
    },
    set(target, prop: string, value) {
      target[prop] = value;
      return true;
    },
  });
  return { g: g as unknown as CanvasRenderingContext2D, calls, texts };
}

function scene(project: Project, levelIndex = 0, extra: Partial<RenderScene> = {}): RenderScene {
  const level = project.levels[levelIndex];
  const below = project.levels[levelIndex - 1];
  return {
    elements: project.elements,
    level,
    footprints: computeWallFootprints(project, level.id),
    below: below ? { level: below, elements: Object.values(project.elements).filter((e) => e.levelId === below.id), footprints: computeWallFootprints(project, below.id) } : null,
    selection: new Set(),
    hoverId: null,
    hoverTone: 'normal',
    externalHoverId: null,
    ghosts: [],
    ghostState: 'neutral',
    overlay: [],
    handles: [],
    hotHandleId: null,
    units: 'metric',
    showGrid: true,
    gridSize: project.settings.gridSize,
    cursor: { x: 1000, y: 2000 },
    northAngle: 0,
    ...extra,
  };
}

function view(): Viewport {
  const v = new Viewport();
  v.setSize(1000, 700);
  v.center = { x: 6000, y: 4000 };
  v.scale = 0.08;
  return v;
}

describe('renderPlan', () => {
  it('draws both sample levels with room tags, dimensions and labels', () => {
    const sp = createSampleProject();
    const { g, calls, texts } = mockContext();
    renderPlan(g, view(), 2, scene(sp, 0));
    expect(calls.get('fill')).toBeGreaterThan(20);
    expect(calls.get('clip')).toBeGreaterThan(0); // openings cut out of walls
    expect(texts).toContain('Living / Dining');
    expect(texts.some((t) => t.includes('m²'))).toBe(true);
    expect(texts).toContain('12.00 m');
    expect(texts).toContain('SAMPLE HOUSE — GROUND FLOOR');
    expect(texts).toContain('UP');
    renderPlan(g, view(), 1, scene(sp, 1));
    expect(texts).toContain('Master Bedroom');
  });

  it('draws every furniture symbol, door and window style, block shape and slab kind', () => {
    const p = createProject();
    const L = p.levels[0].id;
    const add = (el: Element | undefined) => {
      if (el) p.elements[el.id] = el;
    };
    FURNITURE.forEach((f, i) => add(createElement('furniture', L, { catalogId: f.id, position: { x: (i % 10) * 3000, y: -5000 - Math.floor(i / 10) * 3000 }, rotation: i * 15, mirrored: i % 2 === 0 })));
    const walls = rectWalls(p, 0, 0, 30000, 4000);
    let off = 1500;
    for (const it of CATALOG.filter((c) => c.tool === 'door' || c.tool === 'window')) {
      const el = createFromCatalog(it, L, { hostId: walls[0].id, offset: off });
      add(el);
      off += 2800;
    }
    for (const shape of ['box', 'cylinder', 'wedge', 'sphere'] as const) add(createElement('block', L, { shape, position: { x: 1000 * ['box', 'cylinder', 'wedge', 'sphere'].indexOf(shape), y: 8000, z: 0 } }));
    for (const kind of ['floor', 'ceiling', 'foundation', 'terrace'] as const)
      add(createElement('slab', L, { kind, outline: [{ x: 0, y: 10000 }, { x: 2000, y: 10000 }, { x: 2000, y: 12000 }, { x: 0, y: 12000 }], holes: [[{ x: 500, y: 10500 }, { x: 1000, y: 10500 }, { x: 1000, y: 11000 }, { x: 500, y: 11000 }]] }));
    for (const shape of ['gable', 'hip', 'shed', 'pyramid', 'flat'] as const) add(createElement('roof', L, { shape, outline: [{ x: 0, y: 0 }, { x: 8000, y: 0 }, { x: 8000, y: 5000 }, { x: 0, y: 5000 }] }));
    for (const shape of ['straight', 'l-shape', 'u-shape', 'spiral'] as const) add(createElement('stair', L, { shape, position: { x: 5000 * ['straight', 'l-shape', 'u-shape', 'spiral'].indexOf(shape), y: 15000 } }));
    add(createElement('column', L, { shape: 'round', position: { x: 0, y: 20000 } }));
    add(createElement('beam', L, { start: { x: 0, y: 21000 }, end: { x: 5000, y: 21000 } }));
    add(createElement('railing', L, { path: [{ x: 0, y: 22000 }, { x: 3000, y: 22000 }, { x: 3000, y: 23000 }] }));
    const glass = createFromCatalog('wall-glass', L, { start: { x: 0, y: 25000 }, end: { x: 4000, y: 25000 } });
    add(glass);
    const { g, calls } = mockContext();
    const all = Object.values(p.elements);
    const overlay: OverlayItem[] = [
      { t: 'snap', p: { x: 0, y: 0 }, kind: 'endpoint' },
      { t: 'snap', p: { x: 10, y: 0 }, kind: 'perpendicular' },
      { t: 'guide', a: { x: 0, y: 0 }, b: { x: 0, y: 3000 } },
      { t: 'dim', a: { x: 0, y: 0 }, b: { x: 3000, y: 0 }, offset: 20, text: '3.00 m' },
      { t: 'tag', p: { x: 0, y: 0 }, text: 'Hello', sub: 'world', tone: 'error' },
      { t: 'box', a: { x: 10, y: 10 }, b: { x: 200, y: 100 }, mode: 'crossing' },
      { t: 'arc', c: { x: 0, y: 0 }, r: 20, a0: 0, a1: 90 },
      { t: 'poly', pts: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 0 }], fill: 'red' },
      { t: 'line', a: { x: 0, y: 0 }, b: { x: 1, y: 1 }, dash: [2, 2] },
      { t: 'point', p: { x: 0, y: 0 } },
    ];
    const ghosts: Element[] = [all[0], all[all.length - 1], createElement('room', L, { outline: [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 0, y: 1000 }], name: '' })];
    expect(() =>
      renderPlan(g, view(), 1, scene(p, 0, { selection: new Set(all.map((e) => e.id)), hoverId: walls[0].id, hoverTone: 'erase', externalHoverId: walls[1].id, overlay, ghosts, ghostState: 'invalid', handles: [{ id: 'h', elementId: walls[0].id, kind: 'wall-start', p: { x: 0, y: 0 }, shape: 'square' }], hotHandleId: 'h' })),
    ).not.toThrow();
    expect(calls.get('ellipse')).toBeGreaterThan(5);
    expect(calls.get('arc')).toBeGreaterThan(10);
  });
});
