// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createAppContext } from '../app/context';
import { createSampleProject } from '../app/sample';
import { registerViewCommands, VIEW_KEYS } from './commands';
import { Hud } from './hud';
import { mountViewport } from './index';
import { webglAvailable } from './renderer';

describe('mountViewport without WebGL', () => {
  it('shows a fallback message and returns a safe no-op handle', async () => {
    expect(webglAvailable()).toBe(false);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const ctx = createAppContext(createSampleProject());
    const handle = mountViewport(container, ctx);
    expect(container.querySelector('.v3d-fallback')?.textContent).toContain('WebGL');
    handle.resize();
    handle.setActive(false);
    handle.frame();
    await expect(handle.captureImage()).rejects.toThrow(/WebGL/);
    handle.dispose();
    expect(container.querySelector('.v3d-fallback')).toBeNull();
  });
});

describe('HUD', () => {
  it('renders mode, level, hover card, labels and the resume overlay', () => {
    const container = document.createElement('div');
    let resumed = 0;
    const hud = new Hud(container, () => resumed++);
    hud.setMode('fly');
    expect(container.querySelector('.v3d-mode')?.textContent).toBe('Flying');
    expect((container.querySelector('.v3d-crosshair') as HTMLElement).style.display).toBe('');
    hud.setMode('orbit');
    expect((container.querySelector('.v3d-crosshair') as HTMLElement).style.display).toBe('none');
    expect(container.querySelector('.v3d-keys')?.textContent).toContain('RMB place');
    hud.setLevel('First Floor', '+3.00 m');
    expect(container.querySelector('.v3d-level')?.textContent).toBe('First Floor+3.00 m');
    hud.setHover({ title: 'Wall', subtitle: 'Brick', details: ['12.00 m long', 'Ground Floor'] });
    expect(container.querySelector('.v3d-info')?.classList.contains('v3d-show')).toBe(true);
    expect(container.querySelectorAll('.v3d-info-details > div')).toHaveLength(2);
    hud.setHover(null);
    expect(container.querySelector('.v3d-info')?.classList.contains('v3d-show')).toBe(false);
    hud.setToolHint('RMB to start');
    expect(container.querySelector('.v3d-toolhint')?.textContent).toBe('RMB to start');
    hud.setLabel('3.00 m', 100, 50);
    expect(container.querySelector('.v3d-label')?.classList.contains('v3d-show')).toBe(true);
    hud.setHeading(90);
    expect(container.querySelector('.v3d-compass-dial')?.getAttribute('transform')).toBe('rotate(-90.0)');
    hud.showOverlay(true);
    expect(hud.overlayVisible).toBe(true);
    container.querySelector('.v3d-overlay')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(resumed).toBe(1);
    hud.showItem('Wall — 200 Plaster');
    expect(container.querySelector('.v3d-item')?.textContent).toBe('Wall — 200 Plaster');
    hud.dispose();
    expect(container.querySelector('.v3d-hud')).toBeNull();
  });
});

describe('view commands', () => {
  it('registers the View group commands with focus guards and unregisters them', () => {
    const ctx = createAppContext(createSampleProject());
    let focused = false;
    const calls: string[] = [];
    const off = registerViewCommands(ctx.commands, {
      toggleCamera: () => calls.push('cam'),
      toggleXray: () => calls.push('xray'),
      toggleCutAway: () => calls.push('cut'),
      resetCamera: () => calls.push('reset'),
      topView: () => calls.push('top'),
      frameSelection: () => calls.push('frame'),
      focused: () => focused,
    });
    const cmd = ctx.commands.get('view.toggleCamera')!;
    expect(cmd.group).toBe('View');
    expect(cmd.keys).toEqual(['f']);
    expect(cmd.when!()).toBe(false);
    focused = true;
    expect(cmd.when!()).toBe(true);
    expect(ctx.commands.get(VIEW_KEYS.x)!.id).toBe('view.xray');
    void ctx.commands.run('view.topView');
    expect(calls).toEqual(['top']);
    off();
    expect(ctx.commands.get('view.toggleCamera')).toBeUndefined();
  });
});
