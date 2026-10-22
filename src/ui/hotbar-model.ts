/**
 * Pure hotbar / inventory slot logic. The hotbar is 9 catalog ids; '' is an empty slot
 * (an empty slot in hand behaves like the Select tool).
 */
import type { UIState } from '../app/state';
import { getCatalogItem } from '../core/catalog';

export const HOTBAR_SIZE = 9;

/** Exactly 9 entries, unknown ids become empty slots. */
export function normalizeHotbar(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < HOTBAR_SIZE; i++) {
    const id = ids[i] ?? '';
    out.push(id && getCatalogItem(id) ? id : '');
  }
  return out;
}

export function setSlot(hotbar: readonly string[], index: number, itemId: string): string[] {
  const out = normalizeHotbar(hotbar);
  if (index >= 0 && index < HOTBAR_SIZE) out[index] = itemId;
  return out;
}

export function clearSlot(hotbar: readonly string[], index: number): string[] {
  return setSlot(hotbar, index, '');
}

/** Swap two slots (drag & drop reorder). */
export function moveSlot(hotbar: readonly string[], from: number, to: number): string[] {
  const out = normalizeHotbar(hotbar);
  if (from === to || from < 0 || to < 0 || from >= HOTBAR_SIZE || to >= HOTBAR_SIZE) return out;
  [out[from], out[to]] = [out[to], out[from]];
  return out;
}

/** Wrap-around slot stepping (mouse wheel). */
export function cycleIndex(index: number, delta: number, size = HOTBAR_SIZE): number {
  return (((index + delta) % size) + size) % size;
}

/** First empty slot searching forward from `start` (wrapping), or -1. */
export function firstEmptySlot(hotbar: readonly string[], start = 0): number {
  const hb = normalizeHotbar(hotbar);
  for (let k = 0; k < HOTBAR_SIZE; k++) {
    const i = (start + k) % HOTBAR_SIZE;
    if (!hb[i]) return i;
  }
  return -1;
}

/**
 * Shift-click target: the next empty slot after the current one; when the hotbar is full,
 * the slot after the current one is replaced.
 */
export function shiftClickSlot(hotbar: readonly string[], currentIndex: number): number {
  const empty = firstEmptySlot(hotbar, (currentIndex + 1) % HOTBAR_SIZE);
  return empty >= 0 ? empty : cycleIndex(currentIndex, 1);
}

/** Inventory click: put `itemId` into the current slot. */
export function putInCurrentSlot(ui: Pick<UIState, 'hotbar' | 'hotbarIndex'>, itemId: string): Pick<UIState, 'hotbar' | 'hotbarIndex'> {
  return { hotbar: setSlot(ui.hotbar, ui.hotbarIndex, itemId), hotbarIndex: ui.hotbarIndex };
}

/** Inventory shift-click: put `itemId` into the next empty slot (selection unchanged). */
export function putInNextEmptySlot(ui: Pick<UIState, 'hotbar' | 'hotbarIndex'>, itemId: string): Pick<UIState, 'hotbar' | 'hotbarIndex'> & { slot: number } {
  const slot = shiftClickSlot(ui.hotbar, ui.hotbarIndex);
  return { hotbar: setSlot(ui.hotbar, slot, itemId), hotbarIndex: ui.hotbarIndex, slot };
}

/** "Put in hand" (palette, pick block): select the slot that already holds it, else use the current slot. */
export function holdItem(ui: Pick<UIState, 'hotbar' | 'hotbarIndex'>, itemId: string): Pick<UIState, 'hotbar' | 'hotbarIndex'> {
  const existing = ui.hotbar.indexOf(itemId);
  if (existing >= 0 && existing < HOTBAR_SIZE) return { hotbar: normalizeHotbar(ui.hotbar), hotbarIndex: existing };
  return putInCurrentSlot(ui, itemId);
}
