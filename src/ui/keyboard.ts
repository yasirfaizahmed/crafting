/**
 * Global keyboard dispatcher: maps KeyboardEvents to registered commands (`command.keys`).
 *
 * - 'ctrl' in a binding matches Ctrl or ⌘ (meta).
 * - Shortcuts never fire while typing in inputs / textareas / selects / contenteditable.
 * - `command.when()` gates keyboard activation; `command.enabled()` gates running (the key is still
 *   consumed so e.g. Ctrl+S never opens the browser's "save page" dialog).
 * - Commands with a `when` guard take precedence over unguarded ones bound to the same key, so
 *   context-specific bindings registered by views win over global fallbacks.
 */
import type { Command, CommandRegistry } from '../app/state';
import { isMac, isTypingTarget } from './dom';

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  del: 'delete',
  space: ' ',
  spacebar: ' ',
  return: 'enter',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  pgup: 'pageup',
  pgdn: 'pagedown',
  plus: '+',
  cmd: 'ctrl',
  meta: 'ctrl',
  command: 'ctrl',
  control: 'ctrl',
  mod: 'ctrl',
  option: 'alt',
};

const MODIFIER_KEYS = new Set(['control', 'meta', 'alt', 'shift', 'altgraph', 'capslock', 'os', 'fn']);

function combo(ctrl: boolean, alt: boolean, shift: boolean, key: string): string {
  return [ctrl ? 'ctrl' : '', alt ? 'alt' : '', shift ? 'shift' : '', key].filter((s) => s !== '').join('+');
}

/** Canonical binding: modifiers in fixed order (ctrl, alt, shift) followed by the lowercase key. */
export function normalizeBinding(binding: string): string {
  const raw = binding.trim().toLowerCase();
  if (!raw) return '';
  // Allow '+' itself as the key ("ctrl++", "+").
  const parts = raw.endsWith('++') ? [...raw.slice(0, -2).split('+'), '+'] : raw === '+' ? ['+'] : raw.split('+');
  let ctrl = false;
  let alt = false;
  let shift = false;
  let key = '';
  for (const part of parts) {
    const p = part.trim() === '' && part.length > 0 ? ' ' : part.trim();
    const a = KEY_ALIASES[p] ?? p;
    if (a === 'ctrl') ctrl = true;
    else if (a === 'alt') alt = true;
    else if (a === 'shift') shift = true;
    else key = a;
  }
  return combo(ctrl, alt, shift, key);
}

/** Minimal KeyboardEvent shape (lets tests pass plain objects). */
export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}

/** Binding strings an event can match, most specific first. */
export function eventCombos(e: KeyLike): string[] {
  if (!e.key || e.key === 'Unidentified' || e.key === 'Dead') return [];
  let key = e.key === ' ' ? ' ' : e.key.toLowerCase();
  if (MODIFIER_KEYS.has(key)) return [];
  const ctrl = !!(e.ctrlKey || e.metaKey);
  const alt = !!e.altKey;
  const shift = !!e.shiftKey;
  // With Alt (macOS) or on odd layouts the produced character may be exotic: fall back to the physical key.
  if ((alt || ctrl) && !/^[a-z0-9]$/.test(key) && key.length === 1 && e.code) {
    const m = /^Key([A-Z])$/.exec(e.code) ?? /^Digit(\d)$/.exec(e.code);
    if (m) key = m[1].toLowerCase();
  }
  const out = [combo(ctrl, alt, shift, key)];
  // Shifted punctuation ('?', '!', '+') can be bound by its character alone.
  if (shift && key.length === 1 && !/[a-z0-9 ]/.test(key)) out.push(combo(ctrl, alt, false, key));
  return out;
}

const KEY_LABELS: Record<string, string> = {
  ' ': 'Space',
  escape: 'Esc',
  delete: 'Del',
  backspace: '⌫',
  enter: 'Enter',
  tab: 'Tab',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  home: 'Home',
  end: 'End',
  insert: 'Ins',
};

/** Human-readable shortcut for a binding ('ctrl+shift+z' → 'Ctrl+Shift+Z' or '⇧⌘Z' on macOS). */
export function formatBinding(binding: string, mac = isMac()): string {
  const n = normalizeBinding(binding);
  if (!n) return '';
  const parts = n === '+' ? ['+'] : n.endsWith('++') ? [...n.slice(0, -2).split('+'), '+'] : n.split('+');
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  const keyLabel = KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key.replace(/^f(\d+)$/, 'F$1').replace(/^\w/, (c) => c.toUpperCase()));
  if (mac) {
    const sym: Record<string, string> = { ctrl: '⌘', alt: '⌥', shift: '⇧' };
    const order = ['alt', 'shift', 'ctrl'];
    return order.filter((m) => mods.includes(m)).map((m) => sym[m]).join('') + keyLabel;
  }
  const names: Record<string, string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift' };
  return [...mods.map((m) => names[m]), keyLabel].join('+');
}

/** Display string for a command (its explicit `shortcut`, else its first key binding). */
export function commandShortcut(cmd: Pick<Command, 'shortcut' | 'keys'>, mac = isMac()): string {
  if (cmd.shortcut) return cmd.shortcut;
  return cmd.keys?.length ? formatBinding(cmd.keys[0], mac) : '';
}

/** Find the command bound to an event, honouring `when` and guard precedence. */
export function findCommandForEvent(commands: readonly Command[], e: KeyLike): Command | undefined {
  const combos = eventCombos(e);
  if (!combos.length) return undefined;
  const ordered = [...commands.filter((c) => c.when), ...commands.filter((c) => !c.when)];
  for (const c of combos) {
    for (const cmd of ordered) {
      if (!cmd.keys?.some((k) => normalizeBinding(k) === c)) continue;
      if (cmd.when && !safeBool(cmd.when)) continue;
      return cmd;
    }
  }
  return undefined;
}

function safeBool(fn: () => boolean): boolean {
  try {
    return !!fn();
  } catch {
    return false;
  }
}

export interface KeyboardDispatcherOptions {
  /** Where to listen (default window). */
  target?: EventTarget;
  /** Suppress every shortcut, e.g. while a modal dialog is open. */
  isBlocked?: () => boolean;
  onError?: (err: unknown, cmd: Command) => void;
  /** Called after a command was dispatched (for tests / telemetry). */
  onDispatch?: (cmd: Command) => void;
}

export interface KeyboardDispatcher {
  /** Handle one event; returns true when it was consumed. */
  handle(e: KeyboardEvent): boolean;
  dispose(): void;
}

/** Listen for keydown on `target` and run matching commands from the registry. */
export function createKeyboardDispatcher(registry: CommandRegistry, opts: KeyboardDispatcherOptions = {}): KeyboardDispatcher {
  const target = opts.target ?? window;
  const handle = (e: KeyboardEvent): boolean => {
    if (e.defaultPrevented || e.isComposing) return false;
    if (opts.isBlocked?.()) return false;
    if (isTypingTarget(e.target)) return false;
    const cmd = findCommandForEvent(registry.all(), e);
    if (!cmd) return false;
    e.preventDefault();
    // Holding a plain key must not toggle things on and off; Ctrl+Z / Ctrl+Y may repeat.
    if (e.repeat && !(e.ctrlKey || e.metaKey)) return true;
    if (cmd.enabled && !safeBool(cmd.enabled)) return true;
    try {
      const r = cmd.run();
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch((err) => report(err, cmd));
    } catch (err) {
      report(err, cmd);
    }
    opts.onDispatch?.(cmd);
    return true;
  };
  const report = (err: unknown, cmd: Command) => {
    if (opts.onError) opts.onError(err, cmd);
    else console.error(`Command ${cmd.id} failed`, err);
  };
  const listener = (e: Event) => void handle(e as KeyboardEvent);
  target.addEventListener('keydown', listener);
  return {
    handle,
    dispose: () => target.removeEventListener('keydown', listener),
  };
}
