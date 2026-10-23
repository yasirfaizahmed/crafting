import { expect, test } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

test.use({ viewport: { width: 1700, height: 950 } });

test('mirror (M) and flip direction (Shift+M) a selected L stair in place', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).crafting);

  // An L stair on open ground west of the sample house, selected, plan view framed on it.
  const id = await page.evaluate(() => {
    const c = (window as any).crafting;
    const level = c.store.project.levels[0].id;
    const st = {
      id: 'str_flip_test',
      type: 'stair',
      levelId: level,
      position: { x: -9000, y: 1000 },
      rotation: 90,
      width: 1000,
      shape: 'l-shape',
      tread: 280,
      maxRiser: 175,
      turn: 'left',
      props: { handrail: 'left' },
    };
    c.store.add(st);
    c.ui.set({ viewMode: 'plan', activeLevelId: level });
    c.selection.set([st.id]);
    c.events.emit('zoom-to', { ids: [st.id] });
    return st.id;
  });
  const stair = () => page.evaluate((id) => (window as any).crafting.store.getElement(id), id);
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/stair-flip-0-original.png' });
  const original = await stair();

  // M: mirror image, same footprint.
  await page.keyboard.press('m');
  await page.waitForTimeout(400);
  const mirrored = await stair();
  expect(mirrored.turn).toBe('right');
  expect(mirrored.props.handrail).toBe('right');
  await page.screenshot({ path: 'test-results/stair-flip-1-mirrored.png' });

  // Shift+M: walk it the other way, same footprint.
  await page.keyboard.press('Shift+M');
  await page.waitForTimeout(400);
  const flipped = await stair();
  expect(flipped.position).not.toEqual(mirrored.position);
  expect(flipped.firstFlightTreads).toBeDefined();
  await page.screenshot({ path: 'test-results/stair-flip-2-flipped.png' });

  // The Properties panel offers the same two actions.
  await expect(page.getByRole('button', { name: /Mirror stair/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Flip stair direction/ })).toBeVisible();
  await page.getByRole('button', { name: /Mirror stair/ }).click();
  expect((await stair()).turn).not.toBe(flipped.turn);

  // Undo all three steps.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+Z');
  expect(await stair()).toEqual(original);
  expect(errors).toEqual([]);
});

test('three-flight open-well U stair renders in plan and 3D', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).crafting);
  await page.waitForSelector('.v3d-container[data-view3d="ready"]', { timeout: 30_000 });
  // Like the sketch: up one side, across the head of the well, down the other side (turns right).
  const id = await page.evaluate(() => {
    const c = (window as any).crafting;
    const level = c.store.project.levels[0].id;
    const item = c.store.project.elements;
    void item;
    const st = { id: 'str_open_well', type: 'stair', levelId: level, position: { x: -9000, y: 0 }, rotation: 90, width: 1000, shape: 'open-well', tread: 280, maxRiser: 175, turn: 'right', materialId: 'wood-oak' };
    c.store.add(st);
    c.ui.set({ viewMode: 'plan', activeLevelId: level });
    c.selection.set([st.id]);
    c.events.emit('zoom-to', { ids: [st.id] });
    return st.id;
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/stair-open-well-plan.png' });

  await page.evaluate(() => (window as any).crafting.ui.set({ viewMode: '3d' }));
  await page.evaluate(() => (document.querySelector('.v3d-container') as any).__view3d.lookFrom(-4500, -5500, 6500, -7600, 2200, 800));
  await page.waitForFunction(() => !(document.querySelector('.v3d-container') as any).__view3d.stats().animating, undefined, { timeout: 20_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/stair-open-well-3d.png', clip: (await page.locator('.v3d-container').boundingBox()) ?? undefined });
  const hit = await page.evaluate(() => {
    const v = (document.querySelector('.v3d-container') as any).__view3d;
    const p = v.worldToClient(-9000, 500, 200);
    return p ? (v.pickAtClient(p.x, p.y)?.elementId ?? null) : null;
  });
  expect(hit).toBe(id);
  expect(errors).toEqual([]);
});
