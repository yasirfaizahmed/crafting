import { describe, expect, it } from 'vitest';
import { CLICK_THRESHOLD, ClickTracker, isTypingTarget } from './input';

describe('click vs drag detection', () => {
  it('a press and release within the threshold is a click', () => {
    const c = new ClickTracker();
    c.down(2, 100, 100);
    c.moveTo(102, 103);
    expect(c.isDrag(2)).toBe(false);
    expect(c.up(2, 103, 102)).toBe(true);
    expect(c.isPressed(2)).toBe(false);
  });

  it('moving 5 px or more turns it into a drag (even if it comes back)', () => {
    const c = new ClickTracker();
    c.down(0, 10, 10);
    c.moveTo(10 + CLICK_THRESHOLD, 10);
    expect(c.isDrag(0)).toBe(true);
    c.moveTo(10, 10);
    expect(c.up(0, 10, 10)).toBe(false);
  });

  it('accumulates relative motion under pointer lock', () => {
    const c = new ClickTracker();
    c.down(0, 0, 0);
    c.moveBy(2, 0);
    c.moveBy(-2, 0);
    expect(c.up(0)).toBe(true);
    c.down(0, 0, 0);
    c.moveBy(3, 0);
    c.moveBy(-3, 0);
    expect(c.up(0)).toBe(false);
  });

  it('tracks buttons independently and ignores unknown releases', () => {
    const c = new ClickTracker();
    c.down(0, 0, 0);
    c.down(2, 0, 0);
    expect(c.anyPressed).toBe(true);
    expect(c.up(1)).toBe(false);
    expect(c.up(0, 1, 1)).toBe(true);
    expect(c.up(2, 50, 0)).toBe(false);
    expect(c.anyPressed).toBe(false);
    c.down(0, 0, 0);
    c.reset();
    expect(c.anyPressed).toBe(false);
  });

  it('never steals keys from text fields', () => {
    expect(isTypingTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget({ tagName: 'CANVAS' } as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
