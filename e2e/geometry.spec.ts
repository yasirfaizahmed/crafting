import { expect, test, type Page } from '@playwright/test';

test.use({ viewport: { width: 1600, height: 1000 } });
import { FURNITURE } from '../src/core/catalog';
import { createElement, createProject } from '../src/core/defaults';
import type { DoorStyle, Element, ElementOfType, ElementType, Project, RoofShape, StairShape, WindowStyle } from '../src/core/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Visual checks of the geometry module in the real 3D view: every furniture model, every door and
 * window style, every roof shape, stairs and structure. Each scene replaces the project, frames a
 * camera and saves a screenshot under test-results/ (look at them when changing geometry).
 */

interface Scene {
  project: Project;
  add<T extends ElementType>(type: T, props: Partial<Omit<ElementOfType<T>, 'type' | 'id'>>): ElementOfType<T>;
}

function scene(): Scene {
  const project = createProject('Geometry gallery');
  const levelId = project.levels[0].id;
  return {
    project,
    add(type, props) {
      const el = createElement(type, levelId, props);
      project.elements[el.id] = el as Element;
      return el;
    },
  };
}

function box(s: Scene, x0: number, y0: number, x1: number, y1: number, height?: number) {
  const pts = [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ];
  return pts.map((p, i) => s.add('wall', { start: p, end: pts[(i + 1) % 4], height }));
}

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).crafting);
  await page.waitForSelector('.v3d-container[data-view3d="ready"]', { timeout: 30_000 });
  await page.evaluate(() => (window as any).crafting.ui.set({ viewMode: '3d', cameraMode: 'orbit', showGrid: false }));
  return errors;
}

async function load(page: Page, project: Project): Promise<void> {
  await page.evaluate((p) => (window as any).crafting.store.load(p), JSON.parse(JSON.stringify(project)));
  await page.waitForTimeout(300);
}

async function view(page: Page, name: string, from: [number, number, number], to: [number, number, number], band = 1): Promise<void> {
  await page.evaluate(
    ([f, t]) => (document.querySelector('.v3d-container') as any).__view3d.lookFrom(f[0], f[1], f[2], t[0], t[1], t[2]),
    [from, to] as const,
  );
  await page.waitForTimeout(100);
  await page.waitForFunction(() => !(document.querySelector('.v3d-container') as any).__view3d.stats().animating, undefined, { timeout: 20_000 });
  await page.evaluate(() => (document.querySelector('.v3d-container') as any).__view3d.renderNow());
  await page.waitForTimeout(400);
  const b = await page.locator('.v3d-container').boundingBox();
  // Optionally keep only the central horizontal band (the subject) of a tall viewport.
  const clip = b ? { x: b.x, y: b.y + (b.height * (1 - band)) / 2, width: b.width, height: b.height * band } : undefined;
  await page.screenshot({ path: `test-results/geometry-${name}.png`, clip });
}

async function elementCount(page: Page): Promise<number> {
  return page.evaluate(() => (document.querySelector('.v3d-container') as any).__view3d.stats().elements as number);
}

test('furniture gallery: every catalog model', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await boot(page);
  const perRow = 5;
  const rows: (typeof FURNITURE)[] = [];
  for (let i = 0; i < FURNITURE.length; i += perRow) rows.push(FURNITURE.slice(i, i + perRow));
  for (let r = 0; r < rows.length; r++) {
    const s = scene();
    let x = 0;
    const gap = 500;
    for (const def of rows[r]) {
      s.add('furniture', { catalogId: def.id, position: { x: x + def.width / 2, y: 0 }, rotation: 0, elevation: 0 });
      x += def.width + gap;
    }
    await load(page, s.project);
    expect(await elementCount(page)).toBe(rows[r].length);
    const cx = (x - gap) / 2;
    const dist = Math.max(3500, x * 0.95);
    await view(page, `furniture-${r + 1}`, [cx - dist * 0.15, -dist, dist * 0.45], [cx, 0, 400], 0.5);
  }
  expect(errors).toEqual([]);
});

test('doors and windows of every style, cut into walls', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await boot(page);
  const s = scene();
  const doors: DoorStyle[] = ['single', 'double', 'sliding', 'pocket', 'garage', 'opening'];
  const windows: WindowStyle[] = ['casement', 'sliding', 'fixed', 'awning', 'double-hung'];
  const dw = s.add('wall', { start: { x: 0, y: 0 }, end: { x: 18000, y: 0 }, leftFinishId: 'plaster-white' });
  doors.forEach((style, i) => {
    const width = style === 'garage' ? 2400 : style === 'double' || style === 'sliding' ? 1600 : 900;
    s.add('door', { hostId: dw.id, offset: 1500 + i * 3000, width, height: style === 'garage' ? 2200 : 2100, sill: 0, style, hinge: i % 2 ? 'right' : 'left' });
  });
  const ww = s.add('wall', { start: { x: 0, y: -9000 }, end: { x: 18000, y: -9000 }, materialId: 'brick-red' });
  windows.forEach((style, i) => s.add('window', { hostId: ww.id, offset: 1800 + i * 3600, width: style === 'fixed' ? 2400 : 1400, height: 1400, sill: 900, style }));
  s.add('slab', {
    outline: [
      { x: -1000, y: -11000 },
      { x: 19000, y: -11000 },
      { x: 19000, y: 2000 },
      { x: -1000, y: 2000 },
    ],
    thickness: 200,
    topOffset: 0,
    kind: 'floor',
  });
  await load(page, s.project);
  await view(page, 'doors-right-1', [4500, -7500, 2200], [4500, 0, 1100], 0.6);
  await view(page, 'doors-right-2', [13500, -7500, 2200], [13500, 0, 1100], 0.6);
  await view(page, 'doors-left-1', [4500, 7500, 2200], [4500, 0, 1100], 0.6);
  await view(page, 'doors-left-2', [13500, 7500, 2200], [13500, 0, 1100], 0.6);
  await view(page, 'windows-out', [5000, -17500, 2500], [5000, -9000, 1500], 0.6);
  await view(page, 'windows-out-2', [13500, -17500, 2500], [13500, -9000, 1500], 0.6);
  await view(page, 'windows-in', [5000, -1500, 1700], [5000, -9000, 1500], 0.6);
  await view(page, 'windows-in-2', [13500, -1500, 1700], [13500, -9000, 1500], 0.6);
  expect(errors).toEqual([]);
});

test('roofs, stairs and structure', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = await boot(page);
  const s = scene();
  const shapes: RoofShape[] = ['flat', 'gable', 'hip', 'shed', 'pyramid'];
  shapes.forEach((shape, i) => {
    const x0 = i * 7000;
    const walls = box(s, x0, 0, x0 + 5000, 4000);
    walls.forEach((w, k) => k % 2 === 0 && s.add('window', { hostId: w.id, offset: 2500, width: 1200, height: 1200, sill: 900 }));
    s.add('roof', {
      outline: [
        { x: x0, y: 0 },
        { x: x0 + 5000, y: 0 },
        { x: x0 + 5000, y: 4000 },
        { x: x0, y: 4000 },
      ],
      shape,
      pitch: shape === 'shed' ? 15 : 30,
      overhang: shape === 'flat' ? 0 : 400,
      thickness: 250,
      ridgeAngle: 0,
    });
  });
  const stairs: StairShape[] = ['straight', 'l-shape', 'u-shape', 'spiral', 'open-well'];
  stairs.forEach((shape, i) =>
    s.add('stair', { position: { x: i * 6000 + 1000, y: -16000 }, rotation: 90, width: 1000, shape, materialId: i % 2 ? 'concrete' : 'wood-oak' }),
  );
  s.add('column', { position: { x: 26000, y: -16000 }, width: 300, depth: 300, shape: 'rect' });
  s.add('column', { position: { x: 27500, y: -16000 }, width: 350, depth: 350, shape: 'round' });
  s.add('column', { position: { x: 29000, y: -16000 }, width: 250, depth: 300, shape: 'rect', materialId: 'steel' });
  s.add('beam', { start: { x: 26000, y: -9000 }, end: { x: 29000, y: -16000 }, width: 250, depth: 400 });
  (['bars', 'glass', 'solid'] as const).forEach((style, i) =>
    s.add('railing', {
      path: [
        { x: 26000, y: -19000 - i * 1500 },
        { x: 29000, y: -19000 - i * 1500 },
        { x: 29000, y: -18000 - i * 1500 },
      ],
      height: 1000,
      baseOffset: 0,
      style,
    }),
  );
  (['box', 'cylinder', 'wedge', 'sphere'] as const).forEach((shape, i) =>
    s.add('block', { position: { x: 31000 + i * 1500, y: -16500, z: 0 }, size: { x: 1000, y: 1000, z: 1000 }, rotation: 0, shape, materialId: 'stone-sandstone' }),
  );
  await load(page, s.project);
  await view(page, 'roofs-1', [8500, -11000, 7000], [8500, 2000, 2500], 0.6);
  await view(page, 'roofs-2', [24500, -11000, 7000], [24500, 2000, 2500], 0.6);
  await view(page, 'roofs-back', [16000, 15000, 8000], [16000, 2000, 2500], 0.6);
  await view(page, 'roofs-under', [10500, -5000, 1400], [9500, 0, 3300], 0.7);
  await view(page, 'stairs-1', [4000, -24000, 6500], [4000, -15000, 1000], 0.7);
  await view(page, 'stairs-2', [16000, -24000, 6500], [16000, -15000, 1000], 0.7);
  await view(page, 'structure', [31000, -27000, 5000], [31000, -17500, 800], 0.7);
  expect(errors).toEqual([]);
});
