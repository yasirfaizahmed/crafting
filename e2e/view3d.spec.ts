import { expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Pt = { x: number; y: number };

async function boot(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).crafting);
  await page.waitForSelector('.v3d-container[data-view3d="ready"]', { timeout: 30_000 });
  // Prefer a large 3D view when the shell supports it (the stub may ignore it).
  await page.evaluate(() => (window as any).crafting.ui.set({ viewMode: '3d' }));
  await waitIdle(page);
  return errors;
}

/** Plan point (mm) + elevation (mm) → page coordinates via the view's debug hook. */
async function toScreen(page: Page, x: number, y: number, elev = 0): Promise<Pt> {
  const p = await page.evaluate(
    ([x, y, e]) => (document.querySelector('.v3d-container') as any).__view3d.worldToClient(x, y, e),
    [x, y, elev] as const,
  );
  expect(p).not.toBeNull();
  return p as Pt;
}

async function stats(page: Page): Promise<Record<string, any>> {
  return page.evaluate(() => (document.querySelector('.v3d-container') as any).__view3d.stats());
}

async function elements(page: Page, type: string): Promise<any[]> {
  return page.evaluate((t) => Object.values((window as any).crafting.store.project.elements).filter((e: any) => e.type === t), type);
}

async function holdItem(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => {
    const ui = (window as any).crafting.ui;
    const hotbar = [...ui.get().hotbar];
    hotbar[0] = id;
    ui.set({ hotbar, hotbarIndex: 0, cameraMode: 'orbit' });
  }, id);
  await page.waitForTimeout(100);
}

async function rightClick(page: Page, p: Pt): Promise<void> {
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(80);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.waitForTimeout(120);
}

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  const box = await page.locator('.v3d-container').boundingBox();
  await page.screenshot({ path: `test-results/${name}.png`, clip: box ?? undefined });
}

/** Wait until camera transitions have finished (SwiftShader renders slowly). */
async function waitIdle(page: Page): Promise<void> {
  await page.waitForTimeout(100);
  await page.waitForFunction(() => !(document.querySelector('.v3d-container') as any).__view3d.stats().animating, undefined, { timeout: 20_000 });
  await page.waitForTimeout(150);
}

async function runCommand(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => (window as any).crafting.commands.run(id), id);
  await waitIdle(page);
}

test('3D view renders the sample house', async ({ page }) => {
  const errors = await boot(page);
  await page.waitForTimeout(600);
  const s = await stats(page);
  expect(s.elements).toBeGreaterThan(30);
  expect(s.renders).toBeGreaterThan(0);
  await shot(page, 'view3d-house');
  // Registered view commands.
  const ids = await page.evaluate(() => (window as any).crafting.commands.all().map((c: any) => c.id));
  expect(ids).toEqual(expect.arrayContaining(['view.toggleCamera', 'view.xray', 'view.cutAway', 'view.resetCamera', 'view.topView']));
  expect(errors).toEqual([]);
});

test('place a wall with two right clicks, break it with a left click', async ({ page }) => {
  const errors = await boot(page);
  await holdItem(page, 'wall-200');
  const before = (await elements(page, 'wall')).length;
  // Open ground south of the house.
  await rightClick(page, await toScreen(page, 1000, -4000));
  await page.mouse.move(...Object.values(await toScreen(page, 4000, -4000)) as [number, number]);
  await page.waitForTimeout(200);
  await shot(page, 'view3d-wall-ghost');
  await rightClick(page, await toScreen(page, 4000, -4000));
  await page.keyboard.press('Escape');
  const walls = await elements(page, 'wall');
  expect(walls.length).toBe(before + 1);
  const wall = walls.find((w: any) => w.start.y === -4000 && w.end.y === -4000);
  expect(wall).toBeTruthy();
  expect(wall.start.x).toBe(1000);
  expect(wall.end.x).toBe(4000);
  expect(wall.thickness).toBe(200);
  const undoLabel = await page.evaluate(() => (window as any).crafting.store.undoLabel);
  expect(undoLabel).toBe('Place wall');
  await shot(page, 'view3d-wall-placed');

  // LMB on the wall's face breaks it.
  const mid = await toScreen(page, 2500, -4100, 1500);
  await page.mouse.move(mid.x, mid.y);
  await page.waitForTimeout(100);
  await page.mouse.click(mid.x, mid.y, { button: 'left' });
  await page.waitForTimeout(150);
  expect((await elements(page, 'wall')).length).toBe(before);
  expect(await page.evaluate(() => (window as any).crafting.store.undoLabel)).toBe('Break wall');
  expect(errors).toEqual([]);
});

test('voxel stacking places blocks on block faces', async ({ page }) => {
  const errors = await boot(page);
  await holdItem(page, 'block-brick');
  const before = (await elements(page, 'block')).length;
  // First block on the ground at the grid cell containing (-3250, -2750).
  await rightClick(page, await toScreen(page, -3250, -2750));
  let blocks = await elements(page, 'block');
  expect(blocks.length).toBe(before + 1);
  const first = blocks.find((b: any) => b.position.x === -3500 && b.position.y === -3000);
  expect(first).toBeTruthy();
  expect(first.position.z).toBe(0);
  expect(first.size).toEqual({ x: 500, y: 500, z: 500 });
  // Click the top face of that block: the next block stacks on top.
  await rightClick(page, await toScreen(page, -3250, -2750, 500));
  blocks = await elements(page, 'block');
  expect(blocks.length).toBe(before + 2);
  expect(blocks.some((b: any) => b.position.x === -3500 && b.position.y === -3000 && b.position.z === 500)).toBe(true);
  // Click the south face of the bottom block: the next block goes beside it.
  await rightClick(page, await toScreen(page, -3250, -3000, 250));
  blocks = await elements(page, 'block');
  expect(blocks.some((b: any) => b.position.x === -3500 && b.position.y === -3500 && b.position.z === 0)).toBe(true);
  await shot(page, 'view3d-blocks');
  expect(errors).toEqual([]);
});

test('middle click picks the block into the hotbar; select tool selects', async ({ page }) => {
  const errors = await boot(page);
  await holdItem(page, 'tool-select');
  const sofa = await page.evaluate(() =>
    Object.values((window as any).crafting.store.project.elements).find((e: any) => e.type === 'furniture' && e.catalogId === 'sofa-3'),
  );
  // Look at the ground floor from above with the upper floor cut away.
  await page.evaluate(() => (window as any).crafting.ui.set({ cutAboveActive: true }));
  await runCommand(page, 'view.topView');
  const p = await toScreen(page, (sofa as any).position.x, (sofa as any).position.y, 450);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(100);
  await page.mouse.click(p.x, p.y, { button: 'left' });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => (window as any).crafting.selection.get())).toEqual([(sofa as any).id]);
  await shot(page, 'view3d-select-top');
  await page.mouse.click(p.x, p.y, { button: 'middle' });
  await page.waitForTimeout(150);
  const ui = await page.evaluate(() => (window as any).crafting.ui.get());
  expect(ui.hotbar[ui.hotbarIndex]).toBe('furn-sofa-3');
  expect(errors).toEqual([]);
});

test('doors on walls, one-click room floors, auto roofs and drag-moving', async ({ page }) => {
  const errors = await boot(page);
  // Door on the south facade (seen from the default south-east view).
  await holdItem(page, 'door-double');
  const doorsBefore = (await elements(page, 'door')).length;
  // Whole pixels: the browser truncates fractional mouse coordinates, and 100 mm is only ~2 px here.
  const rawDoorPt = await toScreen(page, 6000, -125, 1200);
  const doorPt = { x: Math.round(rawDoorPt.x), y: Math.round(rawDoorPt.y) };
  await page.mouse.move(doorPt.x, doorPt.y);
  await waitIdle(page);
  await shot(page, 'view3d-door-ghost');
  await rightClick(page, doorPt);
  const doors = await elements(page, 'door');
  expect(doors.length).toBe(doorsBefore + 1);
  const d = doors.find((x: any) => x.style === 'double');
  expect(d.offset).toBe(6000);
  expect(d.flip).toBe(true); // swings toward the viewer (outside)

  // Slab: one click inside the kitchen (seen from above with the upper floor cut away).
  await page.evaluate(() => (window as any).crafting.ui.set({ cutAboveActive: true }));
  await runCommand(page, 'view.topView');
  await holdItem(page, 'slab-tile');
  const slabsBefore = (await elements(page, 'slab')).length;
  await rightClick(page, await toScreen(page, 7000, 6000, 0));
  const slabs = await elements(page, 'slab');
  expect(slabs.length).toBe(slabsBefore + 1);
  expect(slabs.some((s: any) => s.materialId === 'tile-grey' && s.kind === 'floor')).toBe(true);
  expect(await page.evaluate(() => (window as any).crafting.store.undoLabel)).toBe('Fill room floor');

  // Select + drag the sofa 1 m east.
  await holdItem(page, 'tool-select');
  const sofa = (await elements(page, 'furniture')).find((f: any) => f.catalogId === 'sofa-3');
  const a = await toScreen(page, sofa.position.x, sofa.position.y, 850);
  const b = await toScreen(page, sofa.position.x + 1000, sofa.position.y, 850);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / 6, a.y + ((b.y - a.y) * i) / 6);
  await page.waitForTimeout(150);
  await shot(page, 'view3d-drag');
  await page.mouse.up();
  await page.waitForTimeout(150);
  const moved = (await elements(page, 'furniture')).find((f: any) => f.id === sofa.id);
  expect(moved.position.x).toBe(sofa.position.x + 1000);
  expect(moved.position.y).toBe(sofa.position.y);
  expect(await page.evaluate(() => (window as any).crafting.store.undoLabel)).toBe('Move furniture');

  // Roof tool on the house restyles the existing roof.
  await page.evaluate(() => (window as any).crafting.ui.set({ cutAboveActive: false }));
  await runCommand(page, 'view.resetCamera');
  await holdItem(page, 'roof-hip');
  await rightClick(page, await toScreen(page, 6000, 4000, 6200));
  const roofs = await elements(page, 'roof');
  expect(roofs).toHaveLength(1);
  expect(roofs[0].shape).toBe('hip');
  await shot(page, 'view3d-roof-hip');
  expect(errors).toEqual([]);
});

test('fly mode: keyboard movement, hotbar wheel, walking toggle', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => (window as any).crafting.ui.set({ cameraMode: 'fly' }));
  await page.locator('.v3d-container').focus();
  await page.waitForTimeout(200);
  const before = (await stats(page)).camera;
  await page.keyboard.down('w');
  // SwiftShader renders only a few frames per second; hold the key long enough.
  await page.waitForFunction(
    (b) => {
      const c = (document.querySelector('.v3d-container') as any).__view3d.stats().camera;
      return Math.hypot(c.position.x - b.position.x, c.position.y - b.position.y) > 1500;
    },
    before,
    { timeout: 20_000 },
  );
  await page.keyboard.up('w');
  const after = (await stats(page)).camera;
  // Moved forward along the view direction (yaw), not sideways.
  const dir = Math.atan2(after.position.y - before.position.y, after.position.x - before.position.x) * (180 / Math.PI);
  expect(Math.abs(((dir - before.yaw + 540) % 360) - 180)).toBeLessThan(5);
  // Wheel cycles the hotbar in fly mode.
  const idx = await page.evaluate(() => (window as any).crafting.ui.get().hotbarIndex);
  const box = (await page.locator('.v3d-container canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 120);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => (window as any).crafting.ui.get().hotbarIndex)).toBe((idx + 1) % 9);
  // Double-tap Space toggles walking (gravity brings the camera to eye height on the ground).
  // (Dispatched in one task: SwiftShader frames are too slow for real key timing.)
  await page.evaluate(() => {
    const c = document.querySelector('.v3d-container')!;
    for (const type of ['keydown', 'keyup', 'keydown', 'keyup']) c.dispatchEvent(new KeyboardEvent(type, { key: ' ', code: 'Space', bubbles: true }));
  });
  await page.waitForTimeout(200);
  expect((await stats(page)).flying).toBe(false);
  await page.waitForFunction(() => {
    const s = (document.querySelector('.v3d-container') as any).__view3d.stats();
    return Math.abs(s.camera.elevation - 1620) < 30;
  }, undefined, { timeout: 20_000 });
  // F toggles back to orbit (key handled while the 3D view is focused).
  await page.keyboard.press('f');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => (window as any).crafting.ui.get().cameraMode)).toBe('orbit');
  await page.keyboard.press('x');
  expect(await page.evaluate(() => (window as any).crafting.ui.get().xray)).toBe(true);
  expect(errors).toEqual([]);
});

test('visual tour: x-ray, cut-away, fly mode and image capture', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => (window as any).crafting.ui.set({ xray: true }));
  await shot(page, 'view3d-xray');
  await page.evaluate(() => (window as any).crafting.ui.set({ xray: false, cutAboveActive: true }));
  await runCommand(page, 'view.resetCamera');
  await shot(page, 'view3d-cutaway');
  await page.evaluate(() => (window as any).crafting.ui.set({ cutAboveActive: false, sunAzimuth: 220, sunAltitude: 25 }));
  await page.waitForTimeout(500);
  await shot(page, 'view3d-evening');
  // Fly mode at eye height inside the house: crosshair targeting + hover card.
  await page.evaluate(() => (window as any).crafting.ui.set({ cameraMode: 'fly', sunAzimuth: 135, sunAltitude: 45 }));
  await page.waitForTimeout(300);
  expect((await stats(page)).mode).toBe('fly');
  await page.evaluate(() => (document.querySelector('.v3d-container') as any).__view3d.lookFrom(7000, 600, 1620, 7000, 4500, 1000));
  await waitIdle(page);
  await shot(page, 'view3d-fly');
  // Releasing the pointer lock (Esc) shows the resume overlay.
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForTimeout(300);
  await expect(page.locator('.v3d-overlay')).toBeVisible();
  await shot(page, 'view3d-fly-paused');
  await page.evaluate(() => (window as any).crafting.ui.set({ cameraMode: 'orbit' }));
  await expect(page.locator('.v3d-overlay')).toBeHidden();
  // Close-up of the entrance and an interior view at eye height.
  await page.evaluate(() => (document.querySelector('.v3d-container') as any).__view3d.lookFrom(9000, -7000, 2200, 4500, 0, 1600));
  await waitIdle(page);
  await shot(page, 'view3d-closeup');
  await page.evaluate(() => (document.querySelector('.v3d-container') as any).__view3d.lookFrom(11500, 500, 1620, 6000, 4000, 1200));
  await waitIdle(page);
  await shot(page, 'view3d-interior');
  // Image capture at an explicit size through the viewport handle.
  const cap = await page.evaluate(() => (document.querySelector('.v3d-container') as any).__view3d.capture({ width: 640, height: 360 }));
  expect(cap.type).toBe('image/png');
  expect(cap.size).toBeGreaterThan(10_000);
  const jpg = await page.evaluate(() => (document.querySelector('.v3d-container') as any).__view3d.capture({ width: 320, height: 200, mime: 'image/jpeg' }));
  expect(jpg.type).toBe('image/jpeg');
  expect(errors).toEqual([]);
});
