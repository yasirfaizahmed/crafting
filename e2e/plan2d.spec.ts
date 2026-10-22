import { expect, test, type Page } from '@playwright/test';

type Pt = { x: number; y: number };

interface PlanHook {
  worldToClient(x: number, y: number): Pt;
  editor: { view: { scale: number; center: Pt }; invalidate(): void; notifyView(): void; render(): void };
}

interface Crafting {
  store: {
    elements: { id: string; type: string; levelId: string; hostId?: string; kind?: string; start?: Pt; end?: Pt }[];
    snapshot(): { elements: Record<string, unknown>; levels: unknown[] };
    load(p: unknown): void;
    project: { levels: { id: string }[] };
  };
  ui: { get(): { hotbar: string[]; hotbarIndex: number }; set(p: object): void };
  commands: { run(id: string): Promise<boolean> };
}

async function boot(page: Page, errors: string[]): Promise<void> {
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { crafting?: unknown }).crafting);
  await page.waitForSelector('canvas.p2d-canvas');
  await page.waitForTimeout(300);
}

async function toClient(page: Page, x: number, y: number): Promise<Pt> {
  return page.evaluate(([wx, wy]) => {
    const c = document.querySelector('canvas.p2d-canvas') as HTMLCanvasElement & { __plan: PlanHook };
    return c.__plan.worldToClient(wx, wy);
  }, [x, y] as const);
}

async function setView(page: Page, center: Pt, scale: number): Promise<void> {
  await page.evaluate(
    ([c, s]) => {
      const canvas = document.querySelector('canvas.p2d-canvas') as HTMLCanvasElement & { __plan: PlanHook };
      const ed = canvas.__plan.editor;
      ed.view.scale = s as number;
      ed.view.center = c as Pt;
      ed.invalidate();
      ed.notifyView();
    },
    [center, scale] as const,
  );
  await page.waitForTimeout(120);
}

/** Put a catalog item in hotbar slot `slot` and select it (the item in hand is the plan tool). */
async function hold(page: Page, itemId: string, slot = 2): Promise<void> {
  await page.evaluate(
    ([id, i]) => {
      const c = (window as unknown as { crafting: Crafting }).crafting;
      const hotbar = [...c.ui.get().hotbar];
      hotbar[i as number] = id as string;
      c.ui.set({ hotbar, hotbarIndex: i });
    },
    [itemId, slot] as const,
  );
}

const count = (page: Page, type: string) =>
  page.evaluate((t) => (window as unknown as { crafting: Crafting }).crafting.store.elements.filter((e) => e.type === t).length, type);

async function clickAt(page: Page, x: number, y: number): Promise<void> {
  const p = await toClient(page, x, y);
  await page.mouse.move(p.x, p.y, { steps: 2 });
  await page.mouse.click(p.x, p.y);
}

test('plan view renders the sample house', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  const plan = page.locator('.p2d');
  await expect(plan).toBeVisible();
  await expect(page.locator('.p2d-level-name')).toHaveText('Ground Floor');
  await page.waitForTimeout(300);
  await plan.screenshot({ path: 'test-results/plan2d-sample.png' });

  await setView(page, { x: 8000, y: 4000 }, 0.12);
  await plan.screenshot({ path: 'test-results/plan2d-detail.png' });

  await page.evaluate(() => {
    const c = (window as unknown as { crafting: Crafting }).crafting;
    c.ui.set({ activeLevelId: c.store.project.levels[1].id });
  });
  await expect(page.locator('.p2d-level-name')).toHaveText('First Floor');
  await setView(page, { x: 6000, y: 4000 }, 0.07);
  await plan.screenshot({ path: 'test-results/plan2d-first-floor.png' });
  expect(errors).toEqual([]);
});

test('draw a floor plan with the room, wall and door tools, then Generate 3D', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  // Start from an empty single-level project.
  await page.evaluate(() => {
    const c = (window as unknown as { crafting: Crafting }).crafting;
    const p = c.store.snapshot();
    p.elements = {};
    p.levels = [p.levels[0]];
    c.store.load(p);
  });
  await setView(page, { x: 5000, y: 2500 }, 0.05);
  const plan = page.locator('.p2d');

  // Room tool: drag a 6 × 4 m rectangle → 4 walls + 1 room in one step.
  await hold(page, 'room');
  const a = await toClient(page, 0, 0);
  const b = await toClient(page, 6000, 4000);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await plan.screenshot({ path: 'test-results/plan2d-room-drag.png' });
  await page.mouse.up();
  expect(await count(page, 'wall')).toBe(4);
  expect(await count(page, 'room')).toBe(1);

  // Wall tool: chain three walls off the room's east side, closing on its corner.
  await hold(page, 'wall-200', 1);
  await clickAt(page, 6000, 0);
  await clickAt(page, 10000, 0);
  await clickAt(page, 10000, 4000);
  await page.mouse.move((await toClient(page, 8000, 4000)).x, (await toClient(page, 8000, 4000)).y, { steps: 3 });
  await plan.screenshot({ path: 'test-results/plan2d-wall-chain.png' });
  await clickAt(page, 6000, 4000);
  await page.keyboard.press('Escape');
  expect(await count(page, 'wall')).toBe(7);

  // Typed length: start a wall and type 3.6m + Enter.
  await clickAt(page, 0, 7000);
  const dir = await toClient(page, 2000, 7000);
  await page.mouse.move(dir.x, dir.y, { steps: 3 });
  await page.keyboard.type('3.6m');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const typed = await page.evaluate(() =>
    (window as unknown as { crafting: Crafting }).crafting.store.elements.filter((e) => e.type === 'wall').map((w) => Math.hypot(w.end!.x - w.start!.x, w.end!.y - w.start!.y)),
  );
  expect(typed.some((l) => Math.abs(l - 3600) < 0.5)).toBe(true);

  // Door tool: hover the room's south wall from inside and click.
  await hold(page, 'door-single', 3);
  const southWall = await page.evaluate(
    () => (window as unknown as { crafting: Crafting }).crafting.store.elements.find((e) => e.type === 'wall' && e.start!.y === 0 && e.end!.y === 0 && e.start!.x === 0)!.id,
  );
  await clickAt(page, 2500, 200);
  await page.waitForTimeout(100);
  const doors = await page.evaluate(() => (window as unknown as { crafting: Crafting }).crafting.store.elements.filter((e) => e.type === 'door'));
  expect(doors).toHaveLength(1);
  expect(doors[0].hostId).toBe(southWall);

  // Generate 3D from the blueprint.
  await page.evaluate(() => (window as unknown as { crafting: Crafting }).crafting.commands.run('build.generate3d'));
  const slabs = await page.evaluate(() => (window as unknown as { crafting: Crafting }).crafting.store.elements.filter((e) => e.type === 'slab').map((s) => s.kind));
  expect(slabs).toContain('floor');
  expect(slabs).toContain('foundation');
  expect(await count(page, 'roof')).toBe(1);
  expect(await count(page, 'room')).toBe(2);

  await hold(page, 'tool-select', 0);
  await setView(page, { x: 5000, y: 3000 }, 0.06);
  await page.waitForTimeout(250);
  await plan.screenshot({ path: 'test-results/plan2d-generated.png' });
  await page.screenshot({ path: 'test-results/plan2d-app.png' });
  expect(errors).toEqual([]);
});

test('interaction feedback: door preview, selection handles, furniture auto-back, guides', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  const plan = page.locator('.p2d');
  await setView(page, { x: 9000, y: 4000 }, 0.06);

  await hold(page, 'door-double', 3);
  let p = await toClient(page, 11750, 6100);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.waitForTimeout(120);
  await plan.screenshot({ path: 'test-results/plan2d-door-preview.png' });

  await hold(page, 'tool-select', 0);
  await clickAt(page, 7000, 4500);
  await page.waitForTimeout(120);
  await plan.screenshot({ path: 'test-results/plan2d-selected-wall.png' });
  await page.keyboard.press('Escape');

  await hold(page, 'furn-bed-double', 7);
  p = await toClient(page, 10500, 7300);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.waitForTimeout(120);
  await plan.screenshot({ path: 'test-results/plan2d-furniture-autoback.png' });

  await hold(page, 'wall-200', 1);
  await clickAt(page, 14000, 0);
  p = await toClient(page, 14050, 7950);
  await page.mouse.move(p.x, p.y, { steps: 3 });
  await page.waitForTimeout(120);
  await plan.screenshot({ path: 'test-results/plan2d-wall-guides.png' });
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('symbol gallery: furniture, doors and windows', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await page.evaluate(() => {
    const c = (window as unknown as { crafting: Crafting }).crafting;
    const p = c.store.snapshot() as { elements: Record<string, unknown>; levels: { id: string }[] };
    p.elements = {};
    p.levels = [p.levels[0]];
    const L = p.levels[0].id;
    let n = 0;
    const add = (el: Record<string, unknown>) => {
      const id = `g${n++}`;
      p.elements[id] = { id, levelId: L, ...el };
      return id;
    };
    const furniture = ['bed-double', 'sofa-3', 'armchair', 'dining-chair', 'dining-table-6', 'dining-table-round', 'toilet', 'washbasin', 'vanity', 'kitchen-sink', 'bathtub', 'shower', 'stove', 'fridge', 'tree', 'car', 'floor-lamp', 'kitchen-base-1200', 'wardrobe', 'rug', 'plant-pot', 'desk', 'office-chair', 'tv-unit'];
    furniture.forEach((catalogId, i) => add({ type: 'furniture', catalogId, position: { x: (i % 8) * 3200, y: -Math.floor(i / 8) * 3600 }, rotation: 0, elevation: 0 }));
    const wall = (x0: number, x1: number, y: number) => add({ type: 'wall', start: { x: x0, y }, end: { x: x1, y }, thickness: 200, baseOffset: 0, justification: 'center', structural: true });
    const doorWall = wall(-1000, 24000, 4000);
    ['single', 'double', 'sliding', 'pocket', 'garage', 'opening'].forEach((style, i) =>
      add({ type: 'door', hostId: doorWall, offset: 1800 + i * 4000, width: style === 'garage' ? 2700 : style === 'double' ? 1500 : 900, height: 2100, sill: 0, style, hinge: i % 2 ? 'right' : 'left', flip: false }),
    );
    const winWall = wall(-1000, 24000, 7000);
    ['casement', 'sliding', 'fixed', 'awning', 'double-hung'].forEach((style, i) => add({ type: 'window', hostId: winWall, offset: 2000 + i * 4500, width: 1800, height: 1200, sill: 900, style }));
    c.store.load(p);
  });
  await setView(page, { x: 11000, y: -1500 }, 0.026);
  await page.locator('.p2d').screenshot({ path: 'test-results/plan2d-gallery.png' });
  await setView(page, { x: 4500, y: -500 }, 0.075);
  await page.locator('.p2d').screenshot({ path: 'test-results/plan2d-gallery-zoom.png' });
  await setView(page, { x: 8000, y: 5500 }, 0.06);
  await page.locator('.p2d').screenshot({ path: 'test-results/plan2d-gallery-openings.png' });
  expect(errors).toEqual([]);
});

test('trace a blueprint image: import, calibrate, trace', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  await page.evaluate(() => {
    const c = (window as unknown as { crafting: Crafting }).crafting;
    const p = c.store.snapshot();
    p.elements = {};
    p.levels = [p.levels[0]];
    c.store.load(p);
  });
  // A synthetic scanned plan: 800 × 500 px, outer walls 40..760 × 40..460 (= 12 m wide once calibrated).
  const dataUrl = await page.evaluate(() => {
    const cv = document.createElement('canvas');
    cv.width = 800;
    cv.height = 500;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#f7f3e8';
    g.fillRect(0, 0, 800, 500);
    g.strokeStyle = '#1b2a4a';
    g.lineWidth = 8;
    g.strokeRect(40, 40, 720, 420);
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(340, 40);
    g.lineTo(340, 460);
    g.moveTo(340, 260);
    g.lineTo(760, 260);
    g.stroke();
    g.fillStyle = '#1b2a4a';
    g.font = 'bold 22px sans-serif';
    g.fillText('LIVING', 480, 160);
    g.fillText('BED', 160, 250);
    g.fillText('KITCHEN', 500, 370);
    return cv.toDataURL('image/png');
  });
  const chooser = page.waitForEvent('filechooser');
  await page.locator('[data-act=trace]').click();
  const fc = await chooser;
  await fc.setFiles({ name: 'scan.png', mimeType: 'image/png', buffer: Buffer.from(dataUrl.split(',')[1], 'base64') });
  await expect(page.locator('.p2d-banner')).toBeVisible();
  await expect(page.locator('.p2d-underlay-bar')).toBeVisible();
  // Calibrate on the outer wall line: image px (40, 40) → (760, 40) is 12 m.
  const u0 = await page.evaluate(() => (window as unknown as { crafting: { store: { project: { levels: { underlay?: { x: number; y: number; mmPerPixel: number } }[] } } } }).crafting.store.project.levels[0].underlay!);
  const px = (ix: number, iy: number) => ({ x: u0.x + ix * u0.mmPerPixel, y: u0.y - iy * u0.mmPerPixel });
  const a = px(40, 40);
  const b = px(760, 40);
  await clickAt(page, a.x, a.y);
  await clickAt(page, b.x, b.y);
  await page.locator('.p2d-prompt input').fill('12m');
  await page.locator('.p2d-prompt input').press('Enter');
  const u1 = await page.evaluate(() => (window as unknown as { crafting: { store: { project: { levels: { underlay?: { mmPerPixel: number } }[] } } } }).crafting.store.project.levels[0].underlay!);
  expect(u1.mmPerPixel).toBeCloseTo(12000 / 720, 1);
  await expect(page.locator('.p2d-banner')).toBeHidden();

  // Trace the outline with the room tool on top of the image.
  await page.evaluate(() => (document.querySelector('canvas.p2d-canvas') as HTMLCanvasElement & { __plan: { editor: { zoomToFit(): void } } }).__plan.editor.zoomToFit());
  const u = await page.evaluate(() => (window as unknown as { crafting: { store: { project: { levels: { underlay?: { x: number; y: number; mmPerPixel: number } }[] } } } }).crafting.store.project.levels[0].underlay!);
  const ip = (ix: number, iy: number) => ({ x: u.x + ix * u.mmPerPixel, y: u.y - iy * u.mmPerPixel });
  await page.evaluate(() => (window as unknown as { crafting: Crafting }).crafting.ui.set({ snapGrid: false }));
  await hold(page, 'room');
  const s = await toClient(page, ip(40, 40).x, ip(40, 40).y);
  const e = await toClient(page, ip(760, 460).x, ip(760, 460).y);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  await page.mouse.move(e.x, e.y, { steps: 6 });
  await page.mouse.up();
  expect(await count(page, 'wall')).toBe(4);
  await hold(page, 'wall-partition', 1);
  await clickAt(page, ip(340, 40).x, ip(340, 40).y);
  await clickAt(page, ip(340, 460).x, ip(340, 460).y);
  await page.keyboard.press('Escape');
  await hold(page, 'tool-select', 0);
  await page.mouse.move(e.x + 40, e.y + 40);
  await page.waitForTimeout(200);
  await page.locator('.p2d').screenshot({ path: 'test-results/plan2d-underlay.png' });
  expect(errors).toEqual([]);
});

test('toolbar: snap toggles, generate options and add floor above', async ({ page }) => {
  const errors: string[] = [];
  await boot(page, errors);
  for (const [act, text] of [
    ['generate', 'Generate 3D'],
    ['add-floor', 'Add floor above'],
    ['trace', 'Trace image'],
  ]) {
    await expect(page.locator(`[data-act=${act}] span`)).toBeVisible();
    await expect(page.locator(`[data-act=${act}]`)).toHaveText(text);
  }
  await expect(page.locator('.p2d-zoom')).toHaveText(/\d+%/);
  await expect(page.locator('.p2d-level-elev')).toHaveText('±0.000');
  const grid = page.locator('.p2d-toolbar [data-toggle=snapGrid]');
  await expect(grid).toHaveAttribute('aria-pressed', 'true');
  await grid.click();
  await expect(grid).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => (window as unknown as { crafting: { ui: { get(): { snapGrid: boolean } } } }).crafting.ui.get().snapGrid)).toBe(false);

  await page.locator('[data-pop=generate]').click();
  await expect(page.locator('.p2d-popover')).toBeVisible();
  await page.locator('.p2d').screenshot({ path: 'test-results/plan2d-generate-options.png' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.p2d-popover')).toHaveCount(0);
  await page.locator('[data-pop=levels]').click();
  await expect(page.locator('.p2d-popover .p2d-menu-item')).toHaveCount(2);
  await page.locator('.p2d-popover .p2d-menu-item').first().click();
  await expect(page.locator('.p2d-level-name')).toHaveText('First Floor');
  await expect(page.locator('.p2d-popover')).toHaveCount(0);

  const levelsBefore = await page.evaluate(() => (window as unknown as { crafting: Crafting }).crafting.store.project.levels.length);
  await page.locator('[data-act=add-floor]').click();
  const levelsAfter = await page.evaluate(() => (window as unknown as { crafting: Crafting }).crafting.store.project.levels.length);
  expect(levelsAfter).toBe(levelsBefore + 1);
  await expect(page.locator('.p2d-level-name')).toHaveText('Second Floor');
  await page.waitForTimeout(200);
  await page.locator('.p2d').screenshot({ path: 'test-results/plan2d-added-floor.png' });
  expect(errors).toEqual([]);
});

test.describe('HiDPI', () => {
  test.use({ deviceScaleFactor: 2, viewport: { width: 1200, height: 800 } });
  test('renders crisply at 2x device pixel ratio', async ({ page }) => {
    const errors: string[] = [];
    await boot(page, errors);
    const size = await page.evaluate(() => {
      const c = document.querySelector('canvas.p2d-canvas') as HTMLCanvasElement;
      return { w: c.width, cw: c.clientWidth };
    });
    expect(size.w).toBe(size.cw * 2);
    await setView(page, { x: 3000, y: 5000 }, 0.11);
    await page.locator('.p2d').screenshot({ path: 'test-results/plan2d-hidpi.png' });
    expect(errors).toEqual([]);
  });
});
