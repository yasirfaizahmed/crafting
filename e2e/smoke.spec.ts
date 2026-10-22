import { expect, test } from '@playwright/test';

test('app boots with the sample project and renders both views', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as { crafting?: unknown }).crafting);
  await expect(page.locator('canvas').first()).toBeVisible();
  const count = await page.evaluate(() => Object.keys((window as any).crafting.store.project.elements).length);
  expect(count).toBeGreaterThan(20);
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'test-results/smoke.png' });
  expect(errors).toEqual([]);
});
