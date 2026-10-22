/**
 * Minecraft-style item tooltip that follows the pointer (one shared element).
 */
import { h } from './dom';

export interface TooltipLine {
  text: string;
  cls?: string;
}

let tipEl: HTMLElement | null = null;

function ensure(): HTMLElement {
  if (tipEl && tipEl.isConnected) return tipEl;
  tipEl = h('div', { class: 'cr-mctip', role: 'tooltip', 'aria-hidden': 'true' });
  document.body.appendChild(tipEl);
  return tipEl;
}

export function showTooltip(lines: TooltipLine[], x: number, y: number): void {
  const el = ensure();
  el.textContent = '';
  for (const l of lines) el.appendChild(h('div', { class: `cr-mctip-line ${l.cls ?? ''}` }, l.text));
  el.classList.add('is-visible');
  moveTooltip(x, y);
}

export function moveTooltip(x: number, y: number): void {
  if (!tipEl) return;
  const pad = 14;
  const w = tipEl.offsetWidth || 160;
  const ht = tipEl.offsetHeight || 40;
  const vw = window.innerWidth || 1024;
  const vh = window.innerHeight || 768;
  let left = x + pad;
  let top = y - ht - 6;
  if (left + w > vw - 4) left = x - w - pad;
  if (top < 4) top = y + pad + 6;
  if (top + ht > vh - 4) top = vh - ht - 4;
  tipEl.style.transform = `translate(${Math.max(4, left)}px, ${Math.max(4, top)}px)`;
}

export function hideTooltip(): void {
  tipEl?.classList.remove('is-visible');
}

/** Attach pointer-following tooltip behaviour to `target`. */
export function bindTooltip(target: HTMLElement, lines: () => TooltipLine[] | null): () => void {
  const enter = (e: PointerEvent) => {
    const l = lines();
    if (l?.length) showTooltip(l, e.clientX, e.clientY);
  };
  const move = (e: PointerEvent) => moveTooltip(e.clientX, e.clientY);
  const leave = () => hideTooltip();
  target.addEventListener('pointerenter', enter);
  target.addEventListener('pointermove', move);
  target.addEventListener('pointerleave', leave);
  target.addEventListener('pointerdown', leave);
  return () => {
    target.removeEventListener('pointerenter', enter);
    target.removeEventListener('pointermove', move);
    target.removeEventListener('pointerleave', leave);
    target.removeEventListener('pointerdown', leave);
  };
}

export function disposeTooltip(): void {
  tipEl?.remove();
  tipEl = null;
}
