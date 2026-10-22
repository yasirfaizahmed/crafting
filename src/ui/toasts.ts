/**
 * Transient notifications (ctx.events 'toast'). Stacked top-right, auto-dismissed.
 */
import { h } from './dom';
import { icon, type IconName } from './icons';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

const ICONS: Record<ToastKind, IconName> = { info: 'info', success: 'checkCircle', warning: 'alert', error: 'alertCircle' };
const DURATION: Record<ToastKind, number> = { info: 3500, success: 3000, warning: 5000, error: 7000 };
const MAX_TOASTS = 5;

export interface ToastHost {
  el: HTMLElement;
  show(message: string, kind?: ToastKind, opts?: { duration?: number; action?: { label: string; run: () => void } }): HTMLElement;
  clear(): void;
  dispose(): void;
}

export function createToastHost(parent: HTMLElement): ToastHost {
  const el = h('div', { class: 'cr-toasts', role: 'region', 'aria-label': 'Notifications' });
  parent.appendChild(el);
  const timers = new Set<ReturnType<typeof setTimeout>>();

  const dismiss = (t: HTMLElement) => {
    if (t.classList.contains('is-leaving')) return;
    t.classList.add('is-leaving');
    const done = () => t.remove();
    t.addEventListener('animationend', done, { once: true });
    const timer = setTimeout(done, 300);
    timers.add(timer);
  };

  const show: ToastHost['show'] = (message, kind = 'info', opts = {}) => {
    const close = h('button', { class: 'cr-toast-close', type: 'button', 'aria-label': 'Dismiss notification' }, icon('x'));
    const t = h(
      'div',
      { class: `cr-toast is-${kind}`, role: kind === 'error' || kind === 'warning' ? 'alert' : 'status', 'aria-live': kind === 'error' ? 'assertive' : 'polite' },
      h('span', { class: 'cr-toast-ic' }, icon(ICONS[kind])),
      h('span', { class: 'cr-toast-msg' }, message),
      opts.action
        ? h(
            'button',
            {
              class: 'cr-toast-action',
              type: 'button',
              onClick: () => {
                opts.action!.run();
                dismiss(t);
              },
            },
            opts.action.label,
          )
        : null,
      close,
    );
    close.addEventListener('click', () => dismiss(t));
    el.appendChild(t);
    while (el.children.length > MAX_TOASTS) el.firstElementChild?.remove();
    let timer = setTimeout(() => dismiss(t), opts.duration ?? DURATION[kind]);
    timers.add(timer);
    // Pause while hovered so long messages can be read.
    t.addEventListener('pointerenter', () => clearTimeout(timer));
    t.addEventListener('pointerleave', () => {
      timer = setTimeout(() => dismiss(t), 1500);
      timers.add(timer);
    });
    return t;
  };

  return {
    el,
    show,
    clear: () => {
      el.textContent = '';
    },
    dispose: () => {
      timers.forEach((t) => clearTimeout(t));
      el.remove();
    },
  };
}
