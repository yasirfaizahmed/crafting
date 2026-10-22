/**
 * Door / window tool: hover a wall to preview the opening snapped along it (valid / invalid
 * feedback with distances to the clear wall ends), the cursor side picks the swing side, R flips
 * the hinge, click places.
 */
import type { Door, Opening, Vec2, Window } from '../../core/types';
import { openingFits, openingOverlaps, pointAtOffset } from '../../core/walls';
import type { OverlayItem } from '../editor-types';
import { makeFromItem, wallClearSpan } from './common';
import type { PlanTool, ToolHost, ToolPointer } from './types';

export interface OpeningPlacement {
  opening: Opening;
  valid: boolean;
  reason?: string;
  /** Clear span of the host wall [start, end] along its location line. */
  span: [number, number];
}

export class OpeningTool implements PlanTool {
  readonly name: string;
  private hinge: 'left' | 'right';
  private placement: OpeningPlacement | null = null;

  constructor(private host: ToolHost) {
    this.name = host.item.tool;
    const t = host.item.template ?? {};
    this.hinge = t.hinge === 'right' ? 'right' : 'left';
  }

  activate(): void {
    const kind = this.host.item.tool === 'door' ? 'door' : 'window';
    this.host.setHint(`${this.host.item.name}: hover a wall and click to place · the cursor side sets the swing${kind === 'door' ? ' · R flips the hinge' : ''}`);
  }

  /** Compute where the opening would go for a pointer at `p` (null when no wall is near). */
  placementAt(p: Vec2): OpeningPlacement | null {
    const host = this.host;
    const hit = host.wallAt(p, 14);
    if (!hit) return null;
    const { wall } = hit;
    const isDoor = host.item.tool === 'door';
    const proto = makeFromItem<Opening>(host, { hostId: wall.id, offset: 0 });
    const width = proto.width;
    const span = wallClearSpan(wall, host.footprints());
    const ui = host.app.ui.get();
    let offset = hit.offset;
    const mid = (span.start + span.end) / 2;
    if (Math.abs(offset - mid) <= host.tol(10)) offset = mid;
    else if (ui.snapGrid) offset = Math.round(offset / 50) * 50;
    const lo = span.start + width / 2;
    const hi = span.end - width / 2;
    let valid = true;
    let reason: string | undefined;
    if (hi < lo) {
      valid = false;
      reason = `Wall too short for a ${host.fmt(width)} ${isDoor ? 'door' : 'window'}`;
      offset = mid;
    } else offset = Math.min(Math.max(offset, lo), hi);
    const opening = {
      ...proto,
      offset,
      ...(isDoor ? { flip: hit.lateral < 0, hinge: this.hinge } : {}),
    } as Opening;
    if (valid && !openingFits(host.app.store.project, wall, opening)) {
      valid = false;
      reason = 'Taller than the wall';
    }
    if (valid && openingOverlaps(host.app.store.project, opening)) {
      valid = false;
      reason = 'Overlaps another opening';
    }
    if (valid) {
      const a = offset - width / 2;
      const b = offset + width / 2;
      if (span.blocked.some(([c, d]) => a < d - 1 && c + 1 < b)) {
        valid = false;
        reason = 'Clashes with a joining wall';
      }
    }
    return { opening, valid, reason, span: [span.start, span.end] };
  }

  pointerMove(e: ToolPointer): void {
    const host = this.host;
    const pl = (this.placement = this.placementAt(e.world));
    if (!pl) {
      host.setGhosts([]);
      host.setOverlay([{ t: 'tag', p: e.world, text: `Hover a wall to place the ${host.item.tool}`, tone: 'info' }]);
      host.setCursor('default');
      return;
    }
    const op = pl.opening;
    host.setGhosts([{ ...op, id: '__ghost_opening' }], pl.valid ? 'valid' : 'invalid');
    host.setCursor(pl.valid ? 'copy' : 'not-allowed');
    const wall = host.app.store.getElement(op.hostId);
    const items: OverlayItem[] = [];
    if (wall?.type === 'wall') {
      const at = (s: number) => pointAtOffset(wall, s);
      const a = op.offset - op.width / 2;
      const b = op.offset + op.width / 2;
      const off = (wall.thickness / 2) * host.view.scale + 18;
      if (pl.valid) {
        if (a - pl.span[0] > 1) items.push({ t: 'dim', a: at(pl.span[0]), b: at(a), offset: -off, text: host.fmt(a - pl.span[0]), tone: 'info' });
        if (pl.span[1] - b > 1) items.push({ t: 'dim', a: at(b), b: at(pl.span[1]), offset: -off, text: host.fmt(pl.span[1] - b), tone: 'info' });
      }
    }
    items.push(
      pl.valid
        ? { t: 'tag', p: e.world, text: `${host.item.name}`, sub: `${host.fmt(op.width)} × ${host.fmt(op.height)}`, tone: 'success' }
        : { t: 'tag', p: e.world, text: pl.reason ?? 'Does not fit', tone: 'error' },
    );
    host.setOverlay(items);
  }

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const host = this.host;
    const pl = this.placementAt(e.world);
    if (!pl) {
      host.toast(`Click on a wall to place the ${host.item.tool}`, 'info');
      return;
    }
    if (!pl.valid) {
      host.toast(pl.reason ?? 'The opening does not fit here', 'warning');
      return;
    }
    const el = makeFromItem<Door | Window>(host, { ...stripId(pl.opening) });
    host.transact(`Place ${el.type}`, (tx) => tx.add(el));
    this.pointerMove(e);
  }

  keyDown(e: KeyboardEvent): boolean {
    if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey && this.host.item.tool === 'door') {
      this.hinge = this.hinge === 'left' ? 'right' : 'left';
      if (this.placement) this.host.setGhosts([{ ...this.placement.opening, hinge: this.hinge, id: '__ghost_opening' } as Door], this.placement.valid ? 'valid' : 'invalid');
      return true;
    }
    return false;
  }

  leave(): void {
    this.placement = null;
    this.host.setGhosts([]);
    this.host.setOverlay([]);
  }

  deactivate(): void {
    this.leave();
  }
}

function stripId<T extends { id: string }>(el: T): Omit<T, 'id'> {
  const { id: _id, ...rest } = el;
  return rest;
}
