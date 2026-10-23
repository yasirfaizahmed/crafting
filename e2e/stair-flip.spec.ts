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
