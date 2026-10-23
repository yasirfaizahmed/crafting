import { expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

test.use({ viewport: { width: 1600, height: 1000 } });

const stats = (page: Page) => page.evaluate(() => (document.querySelector('.v3d-container') as any).__view3d.stats());
const lookFrom = (page: Page, ...a: number[]) => page.evaluate((a) => (document.querySelector('.v3d-container') as any).__view3d.lookFrom(...a), a);

async function shot(page: Page, name: string): Promise<void> {
  await page.waitForTimeout(250);
  const box = await page.locator('.v3d-container').boundingBox();
  await page.screenshot({ path: `test-results/${name}.png`, clip: box ?? undefined });
}

/** Hold W until the walker's plan y passes `untilY` or `ms` elapse; returns the final plan y. */
async function walkNorth(page: Page, ms: number, untilY = Infinity): Promise<number> {
  await page.locator('.v3d-container').focus();
  await page.keyboard.down('w');
  await page
    .waitForFunction((y) => (document.querySelector('.v3d-container') as any).__view3d.stats().camera.position.y > y, untilY, { timeout: ms })
    .catch(() => undefined);
  await page.keyboard.up('w');
  await page.waitForTimeout(300);
  return (await stats(page)).camera.position.y;
}

test('walk mode: closed doors block, right-click opens them, lights switch', async ({ page }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).crafting);
  await page.waitForSelector('.v3d-container[data-view3d="ready"]', { timeout: 30_000 });
  await page.evaluate(() => (window as any).crafting.ui.set({ viewMode: '3d' }));

  const door = await page.evaluate(() => {
    const els = Object.values((window as any).crafting.store.project.elements) as any[];
    return els.find((e) => e.type === 'door' && e.style === 'single' && e.width === 1000);
  });
  // The front door is centred at x = 2500 in the south wall (y = 0).

  // The toolbar's Walk button switches to walking.
  await page.locator('.cr-camera').getByRole('radio', { name: /^Walk/ }).click();
  await expect.poll(async () => (await stats(page)).mode).toBe('walk');
  await expect(page.locator('.v3d-container')).toHaveAttribute('data-camera', 'walk');
  await expect(page.locator('.v3d-mode')).toHaveText('Walking');

  // Stand outside facing the closed front door and walk at it: the door stops you.
  await lookFrom(page, 2500, -3000, 1620, 2500, 3000, 1620);
  await page.waitForTimeout(500);
  expect((await stats(page)).camera.elevation).toBeCloseTo(1620, -1);
  // (SwiftShader renders only a few frames per second: walk until near the door, then keep pushing.)
  expect(await walkNorth(page, 30_000, -800)).toBeGreaterThan(-800); // walked up to it…
  expect(await walkNorth(page, 6000, 0)).toBeLessThan(-200); // …but not through
  await shot(page, 'walk-closed-door');

  // Orbit in front of the door and right-click it: it swings open (one undo step).
  await page.evaluate(() => (window as any).crafting.ui.set({ cameraMode: 'orbit' }));
  await lookFrom(page, 2500, -5000, 1700, 2500, 0, 1100);
  await page.waitForTimeout(400);
  const p = await page.evaluate(() => (document.querySelector('.v3d-container') as any).__view3d.worldToClient(2500, 0, 1100));
  expect(await page.evaluate(([x, y]) => (document.querySelector('.v3d-container') as any).__view3d.pickAtClient(x, y)?.elementId, [p.x, p.y])).toBe(door.id);
  await page.mouse.move(p.x, p.y);
  await page.waitForTimeout(100);
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect.poll(() => page.evaluate((id) => (window as any).crafting.store.getElement(id).openAngle, door.id)).toBe(90);
  expect(await page.evaluate(() => (window as any).crafting.store.undoLabel)).toBe('Open door');
  await expect.poll(async () => (await stats(page)).swinging, { timeout: 10_000 }).toBe(0);
  await shot(page, 'walk-door-open');

  // Walk again: through the open door into the house.
  await page.evaluate(() => (window as any).crafting.ui.set({ cameraMode: 'walk' }));
  await lookFrom(page, 2500, -3000, 1620, 2500, 3000, 1620);
  await page.waitForTimeout(500);
  expect(await walkNorth(page, 40_000, 800)).toBeGreaterThan(800);
  await shot(page, 'walk-inside');

  // Switch the living-room ceiling light off from above (cut-away view) with a right click.
  const light = await page.evaluate(() => (Object.values((window as any).crafting.store.project.elements) as any[]).find((e) => e.catalogId === 'ceiling-light'));
  await page.evaluate(() => (window as any).crafting.ui.set({ cameraMode: 'orbit', cutAboveActive: true }));
  await lookFrom(page, light.position.x, light.position.y - 2500, 7000, light.position.x, light.position.y, 2850);
  await page.waitForTimeout(500);
  const lp = await page.evaluate(([x, y]) => (document.querySelector('.v3d-container') as any).__view3d.worldToClient(x, y, 2900), [light.position.x, light.position.y]);
  expect(await page.evaluate(([x, y]) => (document.querySelector('.v3d-container') as any).__view3d.pickAtClient(x, y)?.elementId, [lp.x, lp.y])).toBe(light.id);
  const lightsOn = (await stats(page)).lights as number;
  await page.mouse.move(lp.x, lp.y);
  await page.waitForTimeout(100);
  await page.mouse.click(lp.x, lp.y, { button: 'right' });
  await expect.poll(() => page.evaluate((id) => (window as any).crafting.store.getElement(id).lightOn, light.id)).toBe(false);
  expect(await page.evaluate(() => (window as any).crafting.store.undoLabel)).toBe('Switch light off');
  await expect.poll(async () => (await stats(page)).lights).toBeLessThan(lightsOn);
  await shot(page, 'walk-light-off');
  expect(errors).toEqual([]);
});
