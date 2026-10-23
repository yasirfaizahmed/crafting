import { expect, test, type Page } from '@playwright/test';

/* eslint-disable @typescript-eslint/no-explicit-any */

async function boot(page: Page, url = '/'): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.goto(url);
  await page.waitForFunction(() => !!(window as any).crafting);
  await page.waitForSelector('.cr-app .cr-hotbar');
  return errors;
}

/** Close the welcome screen if it is showing. */
async function dismissWelcome(page: Page): Promise<void> {
  const welcome = page.locator('.cr-welcome-modal');
  if (await welcome.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
    await expect(welcome).toHaveCount(0);
  }
}

/** Move focus to the page body so global shortcuts apply. */
async function focusBody(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
}

const uiState = (page: Page) => page.evaluate(() => (window as any).crafting.ui.get());

test('shell layout: menus, toolbar, sidebars, both views, hotbar and status bar', async ({ page }) => {
  const errors = await boot(page);
  await dismissWelcome(page);
  for (const m of ['File', 'Edit', 'View', 'Build', 'Export', 'Help']) await expect(page.locator(`.cr-menu-title[data-group="${m}"]`)).toBeVisible();
  await expect(page.locator('.cr-plan-host .p2d')).toBeVisible();
  await expect(page.locator('.cr-v3d-host')).toBeVisible();
  await expect(page.locator('.cr-levels-panel')).toBeVisible();
  await expect(page.locator('.cr-outliner-panel')).toBeVisible();
  // At 1440 px the inspector starts collapsed so the split views keep their room.
  await expect(page.locator('.cr-props')).toBeHidden();
  await page.locator('.cr-toolbar [aria-label="Properties"]').click();
  await expect(page.locator('.cr-props')).toBeVisible();
  await expect(page.locator('.cr-dock .cr-slot')).toHaveCount(9);
  await expect(page.locator('.cr-statusbar')).toContainText('Ground Floor');
  await expect(page).toHaveTitle(/Sample House — Crafting/);
  // Views get real, non-overlapping space.
  const plan = (await page.locator('.cr-plan-host').boundingBox())!;
  const v3d = (await page.locator('.cr-v3d-host').boundingBox())!;
  expect(plan.width).toBeGreaterThan(300);
  expect(v3d.width).toBeGreaterThan(300);
  expect(plan.x + plan.width).toBeLessThanOrEqual(v3d.x + 1);
  await page.waitForSelector('.v3d-container[data-view3d="ready"]', { timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'test-results/ui-main.png', animations: 'disabled' });

  // Menus are generated from the registry and show shortcuts.
  await page.locator('.cr-menu-title[data-group="Edit"]').click();
  await expect(page.locator('.cr-menu [data-command="edit.undo"] .cr-menu-kbd')).toHaveText(/Ctrl\+Z|⌘Z/);
  await page.screenshot({ path: 'test-results/ui-menu-edit.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.locator('.cr-menu')).toHaveCount(0);
  await page.locator('.cr-menu-title[data-group="Build"]').click();
  await expect(page.locator('.cr-menu [data-command="build.generate3d"]')).toBeVisible();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('creative inventory: E opens, search, click puts the item in the current slot', async ({ page }) => {
  const errors = await boot(page);
  await dismissWelcome(page);
  await focusBody(page);
  await page.keyboard.press('e');
  const inv = page.locator('.cr-inv');
  await expect(inv).toBeVisible();
  await expect(page.locator('.cr-inv-search-input')).toBeFocused();
  await page.waitForTimeout(250);
  await page.screenshot({ path: 'test-results/ui-inventory.png', animations: 'disabled' });

  await page.locator('.cr-inv-search-input').fill('sofa');
  const items = page.locator('.cr-inv-grid .cr-inv-item');
  await expect(items.first()).toBeVisible();
  const before = await uiState(page);
  const id = await items.first().getAttribute('data-id');
  expect(id).toMatch(/sofa/);
  await items.first().hover();
  await expect(page.locator('.cr-mctip')).toBeVisible();
  await page.screenshot({ path: 'test-results/ui-inventory-search.png', animations: 'disabled' });
  await items.first().click();
  let s = await uiState(page);
  expect(s.hotbar[before.hotbarIndex]).toBe(id);
  await expect(inv).toBeVisible();

  // Shift-click fills the next empty slot (clear one first with a right-click on the hotbar).
  await page.locator('.cr-inv-hotbar .cr-slot[data-index="6"]').click({ button: 'right' });
  s = await uiState(page);
  expect(s.hotbar[6]).toBe('');
  const second = await items.nth(1).getAttribute('data-id');
  await items.nth(1).click({ modifiers: ['Shift'] });
  s = await uiState(page);
  expect(s.hotbar[6]).toBe(second);

  // Paint category shows material swatches.
  await page.locator('.cr-inv-tab[data-tab="paint"]').click();
  await expect(page.locator('.cr-inv-grid.is-paint .cr-inv-item').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/ui-inventory-paint.png', animations: 'disabled' });

  await page.keyboard.press('Escape');
  await expect(inv).toBeHidden();
  expect((await uiState(page)).inventoryOpen).toBe(false);
  expect(errors).toEqual([]);
});

test('hotbar: number keys, wheel, right-click clears, drag to reorder', async ({ page }) => {
  const errors = await boot(page);
  await dismissWelcome(page);
  await focusBody(page);
  await page.keyboard.press('4');
  expect((await uiState(page)).hotbarIndex).toBe(3);
  await expect(page.locator('.cr-dock .cr-slot[data-index="3"]')).toHaveClass(/is-selected/);
  await expect(page.locator('.cr-hotbar-name')).toHaveClass(/is-visible/);
  await page.locator('.cr-dock .cr-hotbar').hover();
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await uiState(page)).hotbarIndex).toBe(4);
  await page.locator('.cr-dock .cr-slot[data-index="0"]').click();
  expect((await uiState(page)).hotbarIndex).toBe(0);

  const hb = (await uiState(page)).hotbar as string[];
  await page.locator('.cr-dock .cr-slot[data-index="1"]').dragTo(page.locator('.cr-dock .cr-slot[data-index="2"]'));
  const moved = (await uiState(page)).hotbar as string[];
  expect(moved[1]).toBe(hb[2]);
  expect(moved[2]).toBe(hb[1]);

  await page.locator('.cr-dock .cr-slot[data-index="8"]').click({ button: 'right' });
  expect(((await uiState(page)).hotbar as string[])[8]).toBe('');
  await expect(page.locator('.cr-dock .cr-slot[data-index="8"]')).toHaveClass(/is-empty/);
  expect(errors).toEqual([]);
});

test('view modes: toolbar, Tab cycle and correctly sized views', async ({ page }) => {
  const errors = await boot(page);
  await dismissWelcome(page);
  const plan = page.locator('.cr-plan-host');
  const v3d = page.locator('.cr-v3d-host');
  await page.locator('.cr-viewmode [data-value="plan"]').click();
  await expect(v3d).toBeHidden();
  await expect(plan).toBeVisible();
  const full = (await page.locator('.cr-views').boundingBox())!;
  expect((await plan.boundingBox())!.width).toBeGreaterThan(full.width - 2);
  await page.locator('.cr-viewmode [data-value="3d"]').click();
  await expect(plan).toBeHidden();
  await expect(v3d).toBeVisible();
  expect((await v3d.boundingBox())!.width).toBeGreaterThan(full.width - 2);
  await page.waitForTimeout(500);
  const canvas = (await page.locator('.cr-v3d-host canvas').first().boundingBox())!;
  expect(canvas.width).toBeGreaterThan(full.width - 4);
  await page.screenshot({ path: 'test-results/ui-3d-mode.png', animations: 'disabled' });

  await focusBody(page);
  await page.keyboard.press('Tab');
  expect((await uiState(page)).viewMode).toBe('plan');
  await page.keyboard.press('Tab');
  expect((await uiState(page)).viewMode).toBe('split');
  await expect(plan).toBeVisible();
  await expect(v3d).toBeVisible();

  // Drag the divider: the plan gets wider.
  const d = (await page.locator('.cr-divider').boundingBox())!;
  const w0 = (await plan.boundingBox())!.width;
  await page.mouse.move(d.x + d.width / 2, d.y + d.height / 2);
  await page.mouse.down();
  await page.mouse.move(d.x + 140, d.y + d.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await plan.boundingBox())!.width).toBeGreaterThan(w0 + 100);
  expect(errors).toEqual([]);
});

test('properties: edit a wall thickness with unit strings, then undo with Ctrl+Z', async ({ page }) => {
  const errors = await boot(page);
  await dismissWelcome(page);
  const wallId = await page.evaluate(() => {
    const c = (window as any).crafting;
    const w = c.store.elements.find((e: any) => e.type === 'wall' && e.levelId === c.ui.get().activeLevelId);
    c.selection.set([w.id]);
    return w.id as string;
  });
  const thickness = () => page.evaluate((id) => (window as any).crafting.store.getElement(id).thickness, wallId);
  const t0 = await thickness();
  // The collapsed inspector shows a selection badge; the status bar opens it.
  await expect(page.locator('.cr-toolbar .cr-panel-toggle.has-badge')).toBeVisible();
  await page.locator('.cr-statusbar button', { hasText: '1 selected' }).click();
  await expect(page.locator('.cr-props-title')).toBeVisible();
  await expect(page.locator('.cr-props-sub')).toContainText('Wall');
  const input = page.locator('.cr-props [data-field="thickness"] input');
  await input.fill('250');
  await input.press('Enter');
  expect(await thickness()).toBe(250);
  await input.fill('30cm');
  await input.press('Enter');
  expect(await thickness()).toBe(300);
  await input.fill('nonsense');
  await input.press('Enter');
  await expect(page.locator('.cr-props [data-field="thickness"] .cr-field-error')).toBeVisible();
  expect(await thickness()).toBe(300);
  await input.press('Escape');
  await expect(page.locator('.cr-props .cr-info')).toContainText('Volume');
  await page.screenshot({ path: 'test-results/ui-properties.png', animations: 'disabled' });

  await focusBody(page);
  await page.keyboard.press('Control+z');
  expect(await thickness()).toBe(250);
  await expect(page.locator('.cr-redo')).toBeEnabled();
  await page.keyboard.press('Control+z');
  expect(await thickness()).toBe(t0);
  await page.keyboard.press('Control+Shift+z');
  expect(await thickness()).toBe(250);

  // The outliner shows the selection; quantities update live.
  await expect(page.locator(`.cr-ol-row[data-id="${wallId}"]`)).toHaveClass(/is-selected/);
  await page.locator('.cr-side-tab[data-tab="quantities"]').click();
  await expect(page.locator('.cr-qty')).toContainText('Total length');
  await page.screenshot({ path: 'test-results/ui-quantities.png', animations: 'disabled' });
  expect(errors).toEqual([]);
});

test('levels panel: add a level above, switch with PageUp / PageDown', async ({ page }) => {
  const errors = await boot(page);
  await dismissWelcome(page);
  const levels = () => page.evaluate(() => (window as any).crafting.store.project.levels.length);
  const n = await levels();
  await expect(page.locator('.cr-level-row')).toHaveCount(n);
  await page.locator('.cr-levels-panel [aria-label="Add level above"]').click();
  expect(await levels()).toBe(n + 1);
  await expect(page.locator('.cr-level-row')).toHaveCount(n + 1);
  const s = await uiState(page);
  await focusBody(page);
  await page.keyboard.press('PageDown');
  expect((await uiState(page)).activeLevelId).not.toBe(s.activeLevelId);
  await page.keyboard.press('PageUp');
  expect((await uiState(page)).activeLevelId).toBe(s.activeLevelId);
  expect(errors).toEqual([]);
});

test('export dialog: formats grouped by kind, options, download and friendly errors', async ({ page }) => {
  const errors = await boot(page);
  await dismissWelcome(page);
  await focusBody(page);
  await page.keyboard.press('Control+Shift+E');
  const dlg = page.locator('.cr-export-modal');
  await expect(dlg).toBeVisible();
  await expect(dlg.locator('.cr-export-kind')).toHaveCount(5);
  await dlg.locator('[data-format="pdf"]').click();
  await expect(dlg.locator('.cr-export-options')).toContainText('Scale');
  await expect(dlg.locator('.cr-export-options')).toContainText('Paper size');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'test-results/ui-export.png', animations: 'disabled' });

  await dlg.locator('[data-format="craft"]').click();
  const download = page.waitForEvent('download');
  await dlg.locator('.cr-modal-footer .cr-btn.is-primary').click();
  expect((await download).suggestedFilename()).toBe('Sample-House.craft');
  await expect(dlg).toHaveCount(0);
  await expect(page.locator('.cr-toast.is-success')).toBeVisible();
  expect(errors).toEqual([]);
});

test('welcome screen: start a 2D blueprint', async ({ page }) => {
  const errors = await boot(page, '/?welcome=1');
  const welcome = page.locator('.cr-welcome-modal');
  await expect(welcome).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'test-results/ui-welcome.png', animations: 'disabled' });
  await welcome.locator('[data-start="blueprint"]').click();
  await expect(welcome).toHaveCount(0);
  const s = await page.evaluate(() => {
    const c = (window as any).crafting;
    return { n: Object.keys(c.store.project.elements).length, mode: c.ui.get().viewMode, name: c.store.project.info.name };
  });
  expect(s).toEqual({ n: 0, mode: 'plan', name: 'Untitled Project' });
  await expect(page).toHaveTitle(/Untitled Project — Crafting/);
  expect(errors).toEqual([]);
});

test('help, command palette and project settings dialogs', async ({ page }) => {
  const errors = await boot(page);
  await dismissWelcome(page);
  await focusBody(page);
  await page.keyboard.press('F1');
  const help = page.locator('.cr-help-modal');
  await expect(help).toBeVisible();
  await help.locator('.cr-tab[data-tab="controls"]').click();
  await expect(help).toContainText('3D world');
  await page.screenshot({ path: 'test-results/ui-help.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(help).toHaveCount(0);

  await focusBody(page);
  await page.keyboard.press('Control+k');
  const pal = page.locator('.cr-palette-modal');
  await expect(pal).toBeVisible();
  await page.keyboard.type('generate 3d');
  await expect(pal.locator('.cr-palette-row').first()).toHaveAttribute('data-command', 'build.generate3d');
  await page.locator('.cr-palette-input').fill('bed');
  await expect(pal.locator('.cr-palette-row.is-item').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/ui-palette.png', animations: 'disabled' });
  const item = await pal.locator('.cr-palette-row.is-item').first().getAttribute('data-item');
  await pal.locator('.cr-palette-row.is-item').first().click();
  await expect(pal).toHaveCount(0);
  const s = await uiState(page);
  expect(s.hotbar[s.hotbarIndex]).toBe(item);

  await page.locator('.cr-doc-title').click();
  const proj = page.locator('.cr-project-modal');
  await expect(proj).toBeVisible();
  await proj.locator('input').first().fill('My Villa');
  await proj.locator('.cr-modal-footer .cr-btn.is-primary').click();
  await expect(proj).toHaveCount(0);
  await expect(page).toHaveTitle(/• My Villa — Crafting/);
  expect(errors).toEqual([]);
});
