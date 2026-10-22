/**
 * Accessible modal dialogs: focus trap, Esc to close, focus restore, stacked modals,
 * plus a promise-based confirm() helper.
 */
import { append, domId, focusableWithin, h, type Child } from '../dom';
import { icon } from '../icons';

export interface ModalOptions {
  title: string;
  /** Optional line under the title. */
  subtitle?: string;
  body: Child;
  footer?: Child;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Esc / backdrop / close button allowed (default true). */
  dismissible?: boolean;
  /** Hide the header (palette-like overlays). */
  bare?: boolean;
  /** Element (or selector inside the dialog) to focus first. */
  initialFocus?: HTMLElement | string;
  onClose?: () => void;
}

export interface ModalHandle {
  el: HTMLElement;
  dialog: HTMLElement;
  body: HTMLElement;
  footer: HTMLElement;
  close(): void;
  /** Show a busy overlay and block closing. */
  setBusy(busy: boolean, label?: string): void;
  readonly closed: boolean;
}

let host: HTMLElement | null = null;
const stack: ModalHandle[] = [];

/** Where modals are mounted (the app root); defaults to document.body. */
export function setModalHost(el: HTMLElement | null): void {
  host = el;
}

export function isModalOpen(): boolean {
  return stack.length > 0;
}

export function closeAllModals(): void {
  for (const m of [...stack].reverse()) m.close();
}

export function openModal(opts: ModalOptions): ModalHandle {
  const titleId = domId('dlg-title');
  const previous = document.activeElement as HTMLElement | null;
  const dismissible = opts.dismissible !== false;
  const body = h('div', { class: 'cr-modal-body' });
  const footer = h('div', { class: 'cr-modal-footer' });
  const busy = h('div', { class: 'cr-modal-busy', hidden: true }, h('span', { class: 'cr-spinner', 'aria-hidden': 'true' }), h('span', { class: 'cr-modal-busy-label' }, 'Working…'));
  const closeBtn = dismissible
    ? h('button', { class: 'cr-icon-btn cr-modal-close', type: 'button', 'aria-label': 'Close dialog', title: 'Close (Esc)' }, icon('x'))
    : null;
  const header = opts.bare
    ? null
    : h(
        'header',
        { class: 'cr-modal-header' },
        h('div', { class: 'cr-modal-titles' }, h('h2', { id: titleId, class: 'cr-modal-title' }, opts.title), opts.subtitle ? h('p', { class: 'cr-modal-subtitle' }, opts.subtitle) : null),
        closeBtn,
      );
  const dialog = h(
    'div',
    {
      class: `cr-modal is-${opts.size ?? 'md'} ${opts.className ?? ''}`.trim(),
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': opts.bare ? undefined : titleId,
      'aria-label': opts.bare ? opts.title : undefined,
      tabindex: '-1',
    },
    header,
    body,
    footer,
    busy,
  );
  const el = h('div', { class: 'cr-modal-backdrop' }, dialog);
  append(body, [opts.body]);
  if (opts.footer) append(footer, [opts.footer]);
  else footer.hidden = true;

  let closed = false;
  let isBusy = false;
  const handle: ModalHandle = {
    el,
    dialog,
    body,
    footer,
    get closed() {
      return closed;
    },
    close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey, true);
      const i = stack.indexOf(handle);
      if (i >= 0) stack.splice(i, 1);
      el.classList.add('is-leaving');
      setTimeout(() => el.remove(), 120);
      opts.onClose?.();
      if (previous && previous.isConnected && typeof previous.focus === 'function') previous.focus();
    },
    setBusy(b, label) {
      isBusy = b;
      busy.hidden = !b;
      if (label) busy.querySelector('.cr-modal-busy-label')!.textContent = label;
      dialog.setAttribute('aria-busy', String(b));
    },
  };

  const onKey = (e: KeyboardEvent) => {
    if (stack[stack.length - 1] !== handle) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (dismissible && !isBusy) handle.close();
      return;
    }
    if (e.key === 'Tab') {
      const f = focusableWithin(dialog);
      if (!f.length) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = f[0];
      const last = f[f.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !dialog.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !dialog.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
  };
  document.addEventListener('keydown', onKey, true);
  closeBtn?.addEventListener('click', () => !isBusy && handle.close());
  el.addEventListener('pointerdown', (e) => {
    if (e.target === el && dismissible && !isBusy) handle.close();
  });

  (host && host.isConnected ? host : document.body).appendChild(el);
  stack.push(handle);
  const focusTarget = typeof opts.initialFocus === 'string' ? dialog.querySelector<HTMLElement>(opts.initialFocus) : opts.initialFocus;
  (focusTarget ?? focusableWithin(body)[0] ?? dialog).focus();
  return handle;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** Ask a yes/no question. Resolves false on cancel / Esc. */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    let result = false;
    const ok = h('button', { class: `cr-btn ${opts.danger ? 'is-danger' : 'is-primary'}`, type: 'button' }, opts.confirmLabel ?? 'OK');
    const cancel = h('button', { class: 'cr-btn', type: 'button' }, opts.cancelLabel ?? 'Cancel');
    const m = openModal({
      title: opts.title,
      size: 'sm',
      className: 'cr-confirm',
      body: h('p', { class: 'cr-confirm-msg' }, opts.message),
      footer: [cancel, ok],
      initialFocus: opts.danger ? cancel : ok,
      onClose: () => resolve(result),
    });
    ok.addEventListener('click', () => {
      result = true;
      m.close();
    });
    cancel.addEventListener('click', () => m.close());
  });
}
