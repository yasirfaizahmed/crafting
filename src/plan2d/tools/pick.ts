/**
 * Pointing tools: eraser (delete what you point at), eyedropper (pick its catalog item into the
 * current hotbar slot) and paint (apply a material; on walls the clicked side's finish).
 */
import { catalogItemForElement } from '../../core/catalog';
import { getMaterial } from '../../core/materials';
import type { Element, Wall } from '../../core/types';
import { projectOntoWall } from '../../core/walls';
import type { HoverTone } from '../editor-types';
import type { PlanTool, ToolHost, ToolPointer } from './types';

const TYPE_NAMES: Partial<Record<Element['type'], string>> = { door: 'door', window: 'window', wall: 'wall', furniture: 'furniture' };

function describe(el: Element): string {
  return el.name || (el.type === 'room' ? el.name : '') || TYPE_NAMES[el.type] || el.type;
}

abstract class PointTool implements PlanTool {
  abstract readonly name: string;
  protected abstract tone: HoverTone;
  protected abstract cursor: string;
  protected target: Element | undefined;

  constructor(protected host: ToolHost) {}

  protected pick(e: ToolPointer): Element | undefined {
    return this.host.hit(e.world);
  }

  pointerMove(e: ToolPointer): void {
    this.target = this.pick(e);
    this.host.setHover(this.target?.id ?? null, this.tone);
    this.host.setCursor(this.target ? this.cursor : 'default');
    this.host.setOverlay(this.target ? [{ t: 'tag', p: e.world, text: this.label(this.target, e), tone: this.tone === 'erase' ? 'error' : this.tone === 'paint' ? 'success' : 'accent', dy: 24 }] : []);
  }

  protected abstract label(el: Element, e: ToolPointer): string;
  protected abstract apply(el: Element, e: ToolPointer): void;

  pointerDown(e: ToolPointer): void {
    if (e.button !== 0) return;
    const el = this.pick(e);
    if (el) this.apply(el, e);
    this.pointerMove(e);
  }

  leave(): void {
    this.host.setHover(null);
    this.host.setOverlay([]);
  }

  deactivate(): void {
    this.leave();
  }
}

export class EraserTool extends PointTool {
  readonly name = 'eraser';
  protected tone: HoverTone = 'erase';
  protected cursor = 'crosshair';

  activate(): void {
    this.host.setHint('Eraser: click an element to remove it');
  }

  protected label(el: Element): string {
    return el.locked ? 'Locked' : `Remove ${describe(el)}`;
  }

  protected apply(el: Element): void {
    if (el.locked) {
      this.host.toast('That element is locked', 'warning');
      return;
    }
    this.host.transact(`Erase ${el.type}`, (tx) => tx.remove(el.id));
  }
}

export class EyedropperTool extends PointTool {
  readonly name = 'eyedropper';
  protected tone: HoverTone = 'pick';
  protected cursor = 'copy';

  activate(): void {
    this.host.setHint('Pick block: click an element to put its type in the current hotbar slot');
  }

  protected label(el: Element): string {
    const it = catalogItemForElement(el as unknown as { type: string } & Record<string, unknown>);
    return it ? `Pick ${it.name}` : `No item for ${el.type}`;
  }

  protected apply(el: Element): void {
    const it = catalogItemForElement(el as unknown as { type: string } & Record<string, unknown>);
    if (!it) {
      this.host.toast(`Nothing in the catalog matches this ${el.type}`, 'warning');
      return;
    }
    const ui = this.host.app.ui.get();
    const hotbar = [...ui.hotbar];
    hotbar[ui.hotbarIndex] = it.id;
    this.host.app.ui.set({ hotbar });
    this.host.toast(`Picked ${it.name}`, 'success');
  }
}

export class PaintTool extends PointTool {
  readonly name = 'paint';
  protected tone: HoverTone = 'paint';
  protected cursor = 'cell';

  activate(): void {
    this.host.setHint(`${this.host.item.name}: click an element to apply · on walls the clicked side gets the finish`);
  }

  private get materialId(): string | undefined {
    const m = this.host.item.template?.materialId;
    return typeof m === 'string' ? m : undefined;
  }

  private wallSide(w: Wall, e: ToolPointer): 'left' | 'right' {
    return projectOntoWall(w, e.world).lateral >= 0 ? 'left' : 'right';
  }

  protected label(el: Element, e: ToolPointer): string {
    const name = getMaterial(this.materialId).name;
    if (el.type === 'wall') return `${name} → ${this.wallSide(el, e)} face`;
    if (el.type === 'room') return `${name} → floor`;
    return `${name} → ${describe(el)}`;
  }

  protected apply(el: Element, e: ToolPointer): void {
    const id = this.materialId;
    if (!id) return;
    const host = this.host;
    if (el.type === 'wall') {
      const side = this.wallSide(el, e);
      host.transact(`Paint wall ${side} face`, (tx) => tx.update<Wall>(el.id, side === 'left' ? { leftFinishId: id } : { rightFinishId: id }));
    } else if (el.type === 'room') {
      host.transact('Paint room floor', (tx) => tx.update(el.id, { floorMaterialId: id }));
    } else host.transact(`Paint ${el.type}`, (tx) => tx.update(el.id, { materialId: id }));
  }
}
