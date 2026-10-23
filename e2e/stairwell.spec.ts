import { expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

const view = (page: Page) => page.locator('.v3d-container');

async function waitIdle(page: Page): Promise<void> {
  await page.waitForTimeout(100);
  await page.waitForFunction(() => !(document.querySelector('.v3d-container') as any).__view3d.stats().animating, undefined, { timeout: 20_000 });
  await page.waitForTimeout(250);
}

/** Element id the 3D view picks at a plan point (mm) + elevation, as seen by the current camera. */
async function pickAt(page: Page, x: number, y: number, elev: number): Promise<string | null> {
  return page.evaluate(
    ([x, y, e]) => {
      const v = (document.querySelector('.v3d-container') as any).__view3d;
      const p = v.worldToClient(x, y, e);
      return p ? (v.pickAtClient(p.x, p.y)?.elementId ?? null) : null;
    },
    [x, y, elev] as const,
  );
}

test('stairs cut an opening in the floor above automatically', async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(() => !!(window as any).crafting);
  await page.waitForSelector('.v3d-container[data-view3d="ready"]', { timeout: 30_000 });

  // The sample's first floor has a hand-drawn stair hole: remove it, as if the floor was just applied
  // with the floor tool or Generate 3D. The stair's automatic opening must take over.
  const ids = await page.evaluate(() => {
    const c = (window as any).crafting;
    const first = c.store.project.levels[1];
    const slab = Object.values(c.store.project.elements).find((e: any) => e.type === 'slab' && e.levelId === first.id) as any;
    const stair = Object.values(c.store.project.elements).find((e: any) => e.type === 'stair') as any;
    c.store.update(slab.id, { holes: undefined });
    c.ui.set({ viewMode: '3d', activeLevelId: first.id, cutAboveActive: true });
    return { slab: slab.id, stair: stair.id, level: first.id };
  });
  await page.evaluate(() => (document.querySelector('.v3d-container') as any).__view3d.lookFrom(1600, 4200, 11000, 1200, 5800, 3000));
  await waitIdle(page);
  await page.screenshot({ path: 'test-results/stairwell-3d.png', clip: (await view(page).boundingBox()) ?? undefined });

  // Looking down into the stairwell we see the stair below, not the first-floor slab.
  expect(await pickAt(page, 1200, 6000, 3000)).toBe(ids.stair);
  // Beside the stairwell the floor is still solid.
  expect(await pickAt(page, 3500, 6000, 3000)).toBe(ids.slab);

  // Opting the slab out closes the opening again.
  await page.evaluate((id) => (window as any).crafting.store.update(id, { stairOpenings: false }), ids.slab);
  await waitIdle(page);
  expect(await pickAt(page, 1200, 6000, 3000)).toBe(ids.slab);
  await page.evaluate(() => (window as any).crafting.store.undo());
  await waitIdle(page);
  expect(await pickAt(page, 1200, 6000, 3000)).toBe(ids.stair);

  // The plan of the first floor shows the opening (with its "open to below" cross).
  await page.evaluate(() => (window as any).crafting.ui.set({ viewMode: 'plan' }));
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/stairwell-plan.png' });
  expect(errors).toEqual([]);
});
