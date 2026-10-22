// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry, type Command } from '../../app/state';
import { commandShortcut, createKeyboardDispatcher, eventCombos, findCommandForEvent, formatBinding, normalizeBinding } from '../keyboard';

const cmd = (id: string, keys: string[], extra: Partial<Command> = {}): Command => ({ id, label: id, group: 'Edit', keys, run: vi.fn(), ...extra });

function press(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

describe('binding normalisation', () => {
  it('orders modifiers and resolves aliases', () => {
    expect(normalizeBinding('Shift+Ctrl+Z')).toBe('ctrl+shift+z');
    expect(normalizeBinding('cmd+k')).toBe('ctrl+k');
    expect(normalizeBinding('meta+alt+s')).toBe('ctrl+alt+s');
    expect(normalizeBinding('Esc')).toBe('escape');
    expect(normalizeBinding('del')).toBe('delete');
    expect(normalizeBinding('PgUp')).toBe('pageup');
    expect(normalizeBinding('ctrl++')).toBe('ctrl++');
    expect(normalizeBinding('?')).toBe('?');
  });

  it('turns events into combos (ctrl and meta are the same, shifted punctuation also matches bare)', () => {
    expect(eventCombos({ key: 'Z', ctrlKey: true, shiftKey: true })).toEqual(['ctrl+shift+z']);
    expect(eventCombos({ key: 'z', metaKey: true })).toEqual(['ctrl+z']);
    expect(eventCombos({ key: '?', shiftKey: true })).toEqual(['shift+?', '?']);
    expect(eventCombos({ key: 'Control', ctrlKey: true })).toEqual([]);
    expect(eventCombos({ key: 'Dead' })).toEqual([]);
    // Alt on macOS produces exotic characters: fall back to the physical key.
    expect(eventCombos({ key: 'ß', altKey: true, code: 'KeyS' })).toEqual(['alt+s']);
  });

  it('formats shortcuts for display', () => {
    expect(formatBinding('ctrl+shift+z', false)).toBe('Ctrl+Shift+Z');
    expect(formatBinding('ctrl+shift+z', true)).toBe('⇧⌘Z');
    expect(formatBinding('pagedown', false)).toBe('PgDn');
    expect(formatBinding('f1', false)).toBe('F1');
    expect(commandShortcut({ keys: ['delete', 'backspace'] }, false)).toBe('Del');
    expect(commandShortcut({ shortcut: 'Tab', keys: ['tab'] }, false)).toBe('Tab');
  });
});

describe('findCommandForEvent', () => {
  it('prefers guarded (context) commands whose `when` passes over global ones', () => {
    let planFocused = false;
    const global = cmd('global.home', ['home']);
    const plan = cmd('plan.zoomToFit', ['home'], { when: () => planFocused });
    expect(findCommandForEvent([global, plan], { key: 'Home' })?.id).toBe('global.home');
    planFocused = true;
    expect(findCommandForEvent([global, plan], { key: 'Home' })?.id).toBe('plan.zoomToFit');
  });

  it('skips commands whose guard throws and matches secondary bindings', () => {
    const bad = cmd('bad', ['y'], { when: () => { throw new Error('x'); } });
    const redo = cmd('edit.redo', ['ctrl+shift+z', 'ctrl+y']);
    expect(findCommandForEvent([bad, redo], { key: 'y', ctrlKey: true })?.id).toBe('edit.redo');
    expect(findCommandForEvent([bad], { key: 'y' })).toBeUndefined();
  });
});

describe('keyboard dispatcher', () => {
  let dispose: (() => void) | null = null;
  afterEach(() => {
    dispose?.();
    dispose = null;
    document.body.innerHTML = '';
  });

  const setup = (cmds: Command[], opts: Parameters<typeof createKeyboardDispatcher>[1] = {}) => {
    const reg = new CommandRegistry();
    cmds.forEach((c) => reg.register(c));
    const d = createKeyboardDispatcher(reg, { target: window, ...opts });
    dispose = d.dispose;
    return reg;
  };

  it('runs the bound command and prevents the browser default', () => {
    const save = cmd('file.save', ['ctrl+s']);
    setup([save]);
    const e = press(document.body, { key: 's', ctrlKey: true });
    expect(save.run).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
  });

  it('ignores typing in inputs, textareas, selects and contenteditable', () => {
    const inv = cmd('inventory.toggle', ['e']);
    setup([inv]);
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    document.body.append(input, area, editable, checkbox);
    press(input, { key: 'e' });
    press(area, { key: 'e' });
    press(editable, { key: 'e' });
    expect(inv.run).not.toHaveBeenCalled();
    // Checkboxes are not text entry: shortcuts still work.
    press(checkbox, { key: 'e' });
    expect(inv.run).toHaveBeenCalledTimes(1);
  });

  it('honours enabled(): the key is consumed but the command does not run', () => {
    const undo = cmd('edit.undo', ['ctrl+z'], { enabled: () => false });
    setup([undo]);
    const e = press(document.body, { key: 'z', ctrlKey: true });
    expect(undo.run).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(true);
  });

  it('honours when(): unmatched guards let the key through untouched', () => {
    const x = cmd('view.xray', ['x'], { when: () => false });
    setup([x]);
    const e = press(document.body, { key: 'x' });
    expect(x.run).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });

  it('suppresses auto-repeat of plain keys but lets Ctrl combos repeat', () => {
    const inv = cmd('inventory.toggle', ['e']);
    const undo = cmd('edit.undo', ['ctrl+z']);
    setup([inv, undo]);
    press(document.body, { key: 'e', repeat: true });
    press(document.body, { key: 'z', ctrlKey: true, repeat: true });
    expect(inv.run).not.toHaveBeenCalled();
    expect(undo.run).toHaveBeenCalledTimes(1);
  });

  it('does nothing while blocked (modal open) or when a view already handled the key', () => {
    let blocked = true;
    const help = cmd('help', ['f1', '?']);
    setup([help], { isBlocked: () => blocked });
    press(document.body, { key: 'F1' });
    expect(help.run).not.toHaveBeenCalled();
    blocked = false;
    const view = document.createElement('div');
    document.body.appendChild(view);
    view.addEventListener('keydown', (e) => e.preventDefault());
    press(view, { key: '?', shiftKey: true });
    expect(help.run).not.toHaveBeenCalled();
    press(document.body, { key: '?', shiftKey: true });
    expect(help.run).toHaveBeenCalledTimes(1);
  });

  it('reports async command failures', async () => {
    const onError = vi.fn();
    const failing = cmd('file.open', ['ctrl+o'], { run: () => Promise.reject(new Error('boom')) });
    setup([failing], { onError });
    press(document.body, { key: 'o', ctrlKey: true });
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), failing);
  });
});
