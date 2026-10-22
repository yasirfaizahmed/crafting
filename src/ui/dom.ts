/**
 * Tiny DOM helpers used by every UI component (no framework).
 */

export type Child = Node | string | number | null | undefined | false | Child[];
export type Attrs = Record<string, unknown>;

const PROP_KEYS = new Set(['value', 'checked', 'selected', 'indeterminate', 'disabled']);

/** Create an element: `h('button', { class: 'x', onClick: fn, 'aria-label': 'Close' }, 'Text')`. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) setAttrs(el, attrs);
  append(el, children);
  return el;
}

export function setAttrs(el: HTMLElement, attrs: Attrs): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      continue;
    }
    if (PROP_KEYS.has(k)) {
      Reflect.set(el, k, k === 'value' ? String(v ?? '') : !!v);
      continue;
    }
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
}

export function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(parent, c);
    else parent.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
}

/** Replace all children of `el`. */
export function replaceChildren(el: Element, ...children: Child[]): void {
  el.textContent = '';
  append(el, children);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * Coalesce many calls into one run in a microtask (store changes often arrive in bursts).
 * Returns a scheduler function plus `flush` for tests and `cancel` for disposal.
 */
export function batched(fn: () => void): { schedule: () => void; flush: () => void; cancel: () => void } {
  let pending = false;
  let cancelled = false;
  const run = () => {
    if (!pending || cancelled) return;
    pending = false;
    fn();
  };
  return {
    schedule() {
      if (pending || cancelled) return;
      pending = true;
      queueMicrotask(run);
    },
    flush() {
      pending = true;
      run();
    },
    cancel() {
      cancelled = true;
    },
  };
}

/** True when the event target is a text-entry control where shortcuts must not fire. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target as Element).tagName) return false;
  const el = target as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(type);
  }
  if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true' || el.getAttribute?.('contenteditable') === '') return true;
  return false;
}

/** Elements that can receive keyboard focus inside `root`, in DOM order. */
export function focusableWithin(root: Element): HTMLElement[] {
  const sel = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return [...root.querySelectorAll<HTMLElement>(sel)].filter((el) => !el.closest('[hidden]') && !el.closest('[inert]'));
}

/** localStorage wrapper that never throws (private mode, quota, jsdom). */
export const prefs = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = globalThis.localStorage?.getItem(`crafting.ui.${key}`);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown): void {
    try {
      globalThis.localStorage?.setItem(`crafting.ui.${key}`, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

export const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');

let uid = 0;
/** Unique DOM id for aria wiring. */
export function domId(prefix = 'cr'): string {
  uid += 1;
  return `${prefix}-${uid}`;
}
