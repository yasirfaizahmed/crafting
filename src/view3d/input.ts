/** Pointer helpers: click-vs-drag detection per mouse button. */

/** A press + release that moved less than this many pixels is a click. */
export const CLICK_THRESHOLD = 5;

interface Press {
  x: number;
  y: number;
  travel: number;
}

/**
 * Tracks each pressed mouse button. Absolute moves (`moveTo`) measure the distance from the press
 * point; relative moves (`moveBy`, pointer lock) accumulate travel.
 */
export class ClickTracker {
  private readonly presses = new Map<number, Press>();

  constructor(private readonly threshold = CLICK_THRESHOLD) {}

  down(button: number, x: number, y: number): void {
    this.presses.set(button, { x, y, travel: 0 });
  }

  moveTo(x: number, y: number): void {
    for (const p of this.presses.values()) p.travel = Math.max(p.travel, Math.hypot(x - p.x, y - p.y));
  }

  moveBy(dx: number, dy: number): void {
    for (const p of this.presses.values()) p.travel += Math.hypot(dx, dy);
  }

  isPressed(button: number): boolean {
    return this.presses.has(button);
  }

  /** True once the button has moved far enough to be a drag. */
  isDrag(button: number): boolean {
    const p = this.presses.get(button);
    return !!p && p.travel >= this.threshold;
  }

  get anyPressed(): boolean {
    return this.presses.size > 0;
  }

  /** Release; returns true when the press counts as a click. */
  up(button: number, x?: number, y?: number): boolean {
    const p = this.presses.get(button);
    if (!p) return false;
    if (x !== undefined && y !== undefined) p.travel = Math.max(p.travel, Math.hypot(x - p.x, y - p.y));
    this.presses.delete(button);
    return p.travel < this.threshold;
  }

  reset(): void {
    this.presses.clear();
  }
}

/** True when keyboard input targets a text field (never steal typing). */
export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true;
}
