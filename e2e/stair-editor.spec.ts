import { expect, test } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

test.use({ viewport: { width: 1700, height: 1000 } });

test('stair flights editor: steps per flight, widths, landings, split and reset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).crafting);
  const id = await page.evaluate(() => {
    const c = (window as any).crafting;
    const level = c.store.project.levels[0].id;
    const st = { id: 'str_editor', type: 'stair', levelId: level, position: { x: -9000, y: 0 }, rotation: 90, width: 1000, shape: 'open-well', tread: 280, maxRiser: 175, turn: 'right', materialId: 'wood-oak' };
    c.store.add(st);
    c.ui.set({ viewMode: 'plan', activeLevelId: level });
    c.selection.set([st.id]);
    c.events.emit('zoom-to', { ids: [st.id] });
    return st.id;
  });
  const stair = () => page.evaluate((id) => (window as any).crafting.store.getElement(id), id);
  const editor = page.locator('.cr-stair-runs');
  await expect(editor).toBeVisible();
  await expect(editor.locator('.cr-stair-flight')).toHaveCount(3);

  // Steps of flight 1: 5 → 7 makes the stair custom.
  const steps1 = editor.getByLabel('Flight 1 steps');
  await steps1.fill('7');
  await steps1.press('Enter');
  await steps1.blur();
  await expect.poll(async () => (await stair()).runs?.flights[0].treads).toBe(7);

  // Widen the middle flight and deepen the second landing.
  await editor.locator('.cr-stair-flight').nth(1).locator('input').nth(2).fill('1300');
  await editor.locator('.cr-stair-flight').nth(1).locator('input').nth(2).press('Enter');
  await expect.poll(async () => (await stair()).runs?.flights[1].width).toBe(1300);
  await editor.locator('.cr-stair-landing').nth(1).locator('input').first().fill('1600');
  await editor.locator('.cr-stair-landing').nth(1).locator('input').first().press('Enter');
  await expect.poll(async () => (await stair()).runs?.landings[1].depth).toBe(1600);

  // Split the first flight with a landing: four flights, same riser count.
  const risersBefore = await page.evaluate(() => document.body.innerText.match(/Risers\s+(\d+)/)?.[1]);
  await editor.locator('.cr-stair-flight').first().getByRole('button', { name: 'Split' }).click();
  await expect(editor.locator('.cr-stair-flight')).toHaveCount(4);
  await expect.poll(() => page.evaluate(() => document.body.innerText.match(/Risers\s+(\d+)/)?.[1])).toBe(risersBefore);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/stair-editor.png' });

  // Reset to the preset.
  await editor.getByRole('button', { name: 'Reset to preset' }).click();
  await expect.poll(async () => (await stair()).runs).toBeUndefined();
  await expect(editor.locator('.cr-stair-flight')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('stretch a stair in the plan by dragging its handles', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).crafting);
  const id = await page.evaluate(() => {
    const c = (window as any).crafting;
    const level = c.store.project.levels[0].id;
    const st = { id: 'str_stretch', type: 'stair', levelId: level, position: { x: -9000, y: 0 }, rotation: 90, width: 1000, shape: 'l-shape', tread: 280, maxRiser: 175, turn: 'right', materialId: 'wood-oak' };
    c.store.add(st);
    c.ui.set({ viewMode: 'plan', activeLevelId: level, hotbar: ['tool-select', ...c.ui.get().hotbar.slice(1)], hotbarIndex: 0 });
    c.selection.set([st.id]);
    c.events.emit('zoom-to', { ids: [st.id] });
    return st.id;
  });
  await page.waitForTimeout(700);
  const stair = () => page.evaluate((id) => (window as any).crafting.store.getElement(id), id);
  const toClient = (x: number, y: number) =>
    page.evaluate(([x, y]) => (document.querySelector('canvas.p2d-canvas') as any).__plan.worldToClient(x, y), [x, y] as const);
  await page.screenshot({ path: 'test-results/stair-stretch-0.png' });

  // First flight: 8 treads × 280 from y = 0 runs to y = 2240. Drag its end 3 treads further.
  const from = await toClient(-9000, 8 * 280);
  const to = await toClient(-9000, 11 * 280 + 40);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.screenshot({ path: 'test-results/stair-stretch-1-dragging.png' });
  await page.mouse.up();
  await expect.poll(async () => (await stair()).runs?.flights[0].treads).toBe(11);

  // Widen the first flight by dragging its left side 150 mm out (left of +y travel is −x).
  const w0 = await toClient(-9000 - 500, (11 * 280) / 2);
  const w1 = await toClient(-9000 - 650, (11 * 280) / 2);
  await page.mouse.move(w0.x, w0.y);
  await page.mouse.down();
  await page.mouse.move(w1.x, w1.y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await stair()).runs?.flights[0].width).toBe(1300);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/stair-stretch-2.png' });
  expect(errors).toEqual([]);
});

test('stretch open-well landings on every side: plan handles and the editor fields', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).crafting);
  // Like the sketch: up north, across to the west, back down south (turning left).
  const id = await page.evaluate(() => {
    const c = (window as any).crafting;
    const level = c.store.project.levels[0].id;
    const st = { id: 'str_landings', type: 'stair', levelId: level, position: { x: -9000, y: 0 }, rotation: 90, width: 1000, shape: 'open-well', tread: 280, maxRiser: 175, turn: 'left', materialId: 'wood-oak' };
    c.store.add(st);
    c.ui.set({ viewMode: 'plan', activeLevelId: level, hotbar: ['tool-select', ...c.ui.get().hotbar.slice(1)], hotbarIndex: 0 });
    c.selection.set([st.id]);
    c.events.emit('zoom-to', { ids: [st.id] });
    return st.id;
  });
  await page.waitForTimeout(700);
  const stair = () => page.evaluate((id) => (window as any).crafting.store.getElement(id), id);
  const toClient = (x: number, y: number) =>
    page.evaluate(([x, y]) => (document.querySelector('canvas.p2d-canvas') as any).__plan.worldToClient(x, y), [x, y] as const);
  const drag = async (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const p = await toClient(a.x, a.y);
    const q = await toClient(b.x, b.y);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.move((p.x + q.x) / 2, (p.y + q.y) / 2, { steps: 4 });
    await page.mouse.move(q.x, q.y, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(200);
  };
  // Flight 1: 5 treads up +y to y = 1400. Landing 1: y ∈ [1400, 2400], x ∈ [−9500, −8500]; its outer side is east.
  await drag({ x: -8500, y: 1900 }, { x: -8100, y: 1900 });
  await expect.poll(async () => (await stair()).runs?.landings[0].extendRight).toBe(400);
  // Its far (north) edge, now centred at x = −8800: the next flight moves north with it.
  await drag({ x: -8800, y: 2400 }, { x: -8800, y: 2800 });
  await expect.poll(async () => (await stair()).runs?.landings[0].depth).toBe(1400);
  expect(await page.evaluate(() => (window as any).crafting.store.undoLabel)).toBe('Stretch landing');

  // The second landing's outer (north) side from the editor fields.
  const editor = page.locator('.cr-stair-runs');
  const extra = editor.getByLabel('Landing 2 extra right');
  await extra.fill('300');
  await extra.press('Enter');
  await expect.poll(async () => (await stair()).runs?.landings[1].extendRight).toBe(300);
  // And let landing 2 continue 200 past the last flight, which stays put.
  const past = editor.getByLabel('Landing 2 past next flight');
  await past.fill('200');
  await past.press('Enter');
  await expect.poll(async () => (await stair()).runs?.landings[1].beyond).toBe(200);
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'test-results/stair-landings-plan.png' });

  // 3D: the stretched platforms with guard rails round their open edges.
  await page.evaluate((id) => {
    const c = (window as any).crafting;
    c.ui.set({ viewMode: '3d', cutAboveActive: true });
    c.selection.set([]);
    c.events.emit('zoom-to', { ids: [id] });
  }, id);
  await page.waitForSelector('.v3d-container[data-view3d="ready"]', { timeout: 30_000 });
  await page.waitForFunction(() => !(document.querySelector('.v3d-container') as any).__view3d.stats().animating, undefined, { timeout: 20_000 });
  await page.waitForTimeout(800);
  const box = await page.locator('.v3d-container').boundingBox();
  await page.screenshot({ path: 'test-results/stair-landings-3d.png', clip: box ?? undefined });
  expect(errors).toEqual([]);
});
