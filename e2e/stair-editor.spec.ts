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
