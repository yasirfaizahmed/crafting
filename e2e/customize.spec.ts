import { expect, test } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

test.use({ viewport: { width: 1700, height: 1000 } });

test('customise parts: door open angle and leaf, window bars, part materials, furniture resize', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).crafting);
  await page.waitForSelector('.v3d-container[data-view3d="ready"]', { timeout: 30_000 });

  const ids = await page.evaluate(() => {
    const c = (window as any).crafting;
    const els = Object.values(c.store.project.elements) as any[];
    const front = els.find((e) => e.type === 'door' && e.width === 1000);
    const win = els.find((e) => e.type === 'window' && e.width === 2400);
    const sofa = els.find((e) => e.type === 'furniture' && e.catalogId === 'sofa-3');
    c.store.update(front.id, { openAngle: 75, leaf: 'half-glazed' });
    c.store.update(win.id, { glazingBars: { x: 3, y: 1 } });
    c.selection.set([front.id]);
    return { door: front.id, win: win.id, sofa: sofa.id };
  });

  // Parts & materials: the door shows frame / leaf / hardware rows; recolour the frame.
  const parts = page.locator('.cr-parts');
  await expect(parts).toBeVisible();
  await expect(parts.locator('.cr-prop-row')).toHaveCount(4); // frame, leaf, glass, hardware
  await parts.getByRole('button', { name: 'Frame material' }).click();
  await page.locator('.cr-material-popover input[type=search]').fill('charcoal');
  await page.locator('.cr-material-popover').getByRole('button', { name: 'Paint — Charcoal' }).click();
  await expect.poll(() => page.evaluate((id) => (window as any).crafting.store.getElement(id).partMaterials?.frame, ids.door)).toBe('paint-charcoal');

  // Look at the entrance in 3D.
  await page.evaluate(() => (window as any).crafting.ui.set({ viewMode: '3d' }));
  await page.evaluate(() => (document.querySelector('.v3d-container') as any).__view3d.lookFrom(6500, -5200, 2300, 3500, 0, 1300));
  await page.waitForFunction(() => !(document.querySelector('.v3d-container') as any).__view3d.stats().animating, undefined, { timeout: 20_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/customize-3d.png', clip: (await page.locator('.v3d-container').boundingBox()) ?? undefined });
  // From inside the entry, deselected: the half-glazed leaf stands open against the room.
  await page.evaluate(() => {
    (window as any).crafting.selection.clear();
    (window as any).crafting.ui.set({ cutAboveActive: true });
    (document.querySelector('.v3d-container') as any).__view3d.lookFrom(3600, 3600, 2600, 2400, 0, 900);
  });
  await page.waitForFunction(() => !(document.querySelector('.v3d-container') as any).__view3d.stats().animating, undefined, { timeout: 20_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'test-results/customize-3d-inside.png', clip: (await page.locator('.v3d-container').boundingBox()) ?? undefined });
  await page.evaluate(() => (window as any).crafting.ui.set({ cutAboveActive: false }));

  // Resize the sofa from its +x edge in the plan (sofa 2200 wide, centred at x = 8000).
  await page.evaluate((id) => {
    const c = (window as any).crafting;
    c.ui.set({ viewMode: 'plan', hotbar: ['tool-select', ...c.ui.get().hotbar.slice(1)], hotbarIndex: 0 });
    c.selection.set([id]);
    c.events.emit('zoom-to', { ids: [id] });
  }, ids.sofa);
  await page.waitForTimeout(700);
  const toClient = (x: number, y: number) => page.evaluate(([x, y]) => (document.querySelector('canvas.p2d-canvas') as any).__plan.worldToClient(x, y), [x, y] as const);
  const sofa = await page.evaluate((id) => (window as any).crafting.store.getElement(id), ids.sofa);
  // Rotation 180: local +x points to world −x, so the +x edge handle is at x = 8000 − 1100.
  const a = await toClient(sofa.position.x - 1100, sofa.position.y);
  const b = await toClient(sofa.position.x - 1100 - 400, sofa.position.y);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.screenshot({ path: 'test-results/customize-resize.png' });
  await page.mouse.up();
  await expect.poll(() => page.evaluate((id) => (window as any).crafting.store.getElement(id).width, ids.sofa)).toBe(2600);
  expect(errors).toEqual([]);
});
