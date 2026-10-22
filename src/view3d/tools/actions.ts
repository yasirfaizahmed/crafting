/** Actions shared by every tool: break (LMB), pick block (MMB). */
import { catalogItemForElement } from '../../core/catalog';
import { materialFor } from '../../core/materials';
import type { Element } from '../../core/types';
import type { PickHit, ToolEnv } from './types';

const TYPE_NAMES: Record<Element['type'], string> = {
  wall: 'wall',
  door: 'door',
  window: 'window',
  slab: 'slab',
  roof: 'roof',
  stair: 'stair',
  column: 'column',
  beam: 'beam',
  furniture: 'furniture',
  room: 'room',
  block: 'block',
  railing: 'railing',
  dimension: 'dimension',
  label: 'label',
};

export function typeName(el: Element): string {
  return TYPE_NAMES[el.type];
}

/** Remove the pointed element (one undo step). Locked elements are refused with a toast. */
export function breakAt(env: Pick<ToolEnv, 'ctx' | 'toast' | 'effect'>, hit: PickHit | null): boolean {
  if (!hit?.elementId) return false;
  const { store, selection } = env.ctx;
  const el = store.getElement(hit.elementId);
  if (!el) return false;
  if (el.locked) {
    env.toast(`This ${typeName(el)} is locked`, 'warning');
    return false;
  }
  const label = el.type === 'furniture' ? `Break ${el.name ?? 'furniture'}` : `Break ${typeName(el)}`;
  store.transact(label, (tx) => tx.remove(el.id));
  if (selection.has(el.id)) selection.set(selection.get().filter((id) => id !== el.id));
  env.effect('break', { point: hit.point, elevation: hit.elevation }, hit.materialId ?? materialFor(el).id);
  return true;
}

/**
 * Minecraft "pick block": put the inventory item matching the pointed element into the current
 * hotbar slot (or switch to the slot that already holds it).
 */
export function pickBlockAt(env: Pick<ToolEnv, 'ctx' | 'toast'>, hit: PickHit | null): boolean {
  if (!hit?.elementId) return false;
  const el = env.ctx.store.getElement(hit.elementId);
  if (!el) return false;
  const item = catalogItemForElement(el as unknown as { type: string } & Record<string, unknown>);
  if (!item) {
    env.toast(`No inventory item for this ${typeName(el)}`, 'info');
    return false;
  }
  const ui = env.ctx.ui.get();
  const slot = ui.hotbar.indexOf(item.id);
  if (slot >= 0) {
    env.ctx.ui.set({ hotbarIndex: slot });
  } else {
    const hotbar = [...ui.hotbar];
    hotbar[ui.hotbarIndex] = item.id;
    env.ctx.ui.set({ hotbar });
  }
  return true;
}
