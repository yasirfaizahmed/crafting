import type { Model } from '../model';
import { FRONT_T, FRONT_ZONE, LINEN, METAL, WHITE, clamp, cushion, fronts, legs, softBox, type FurnitureBuilder } from './kit';

export interface BedOptions {
  frame: string;
  bedding: string;
  /** Upholstered headboard panel material (defaults to the bedding). */
  headboard?: string;
}

/** Bed: legs, frame, mattress, duvet with folded edge, pillows and a headboard at +y. */
export function bed(m: Model, w: number, d: number, h: number, o: BedOptions): void {
  const hw = w / 2;
  const hd = d / 2;
  const ht = clamp(d * 0.03, 40, 70);
  const legH = clamp(h * 0.09, 40, 100);
  const frameTop = clamp(h * 0.33, legH + 100, 360);
  const mattH = clamp(h * 0.2, 100, 220);
  const mTop = frameTop - 50 + mattH;
  m.use(o.frame, 'body');
  legs(m, hw, hd - ht / 2, 40, 0, legH, 60);
  m.box(-hw, -hd, legH, hw, hd - ht, frameTop);
  m.box(-hw, hd - ht, 0, hw, hd, h);
  if (h - 60 > mTop) {
    m.use(o.headboard ?? o.bedding, 'body', 'headboard');
    softBox(m, -hw + 50, hd - ht - 30, mTop - 60, hw - 50, hd - ht, h - 60, 25, 2);
  }
  m.use(WHITE, 'body', 'mattress');
  softBox(m, -hw + 25, -hd + 25, frameTop - 50, hw - 25, hd - ht - 10, mTop, 50, 3);
  // Duvet over the front part, slightly wider than the mattress, with a folded-back edge.
  const duvetEnd = Math.max(-hd + 200, hd - ht - Math.min(560, d * 0.3));
  m.use(o.bedding, 'body', 'duvet');
  cushion(m, -hw + 12, hw - 12, -hd + 12, duvetEnd, frameTop + 10, mTop + 30, 40);
  m.cylinderX(-hw + 12, hw - 12, duvetEnd, mTop + 20, 35, 10);
  // Pillows.
  const n = w >= 1300 ? 2 : 1;
  const mw = w - 50;
  const pw = Math.min(750, (mw - 40 * (n + 1)) / n);
  const total = n * pw + (n - 1) * 40;
  m.use(LINEN, 'body', 'pillows');
  for (let i = 0; i < n; i++) {
    const x0 = -total / 2 + i * (pw + 40);
    cushion(m, x0, x0 + pw, hd - ht - 470, hd - ht - 60, mTop - 10, Math.min(h - 10, mTop + 130), 55);
  }
}

const doubleBed: FurnitureBuilder = (m, s) => bed(m, s.w, s.d, s.h, { frame: s.secondary, bedding: s.primary });

const bunkBed: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const h = s.h;
  const post = 70;
  m.use(s.primary, 'body');
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) m.boxC(sx * (hw - post / 2), sy * (hd - post / 2), 0, post, post, h);
  const tiers = [180, Math.max(700, h * 0.58)];
  for (const z of tiers) {
    m.use(s.primary, 'body');
    m.box(-hw + post, -hd, z, hw - post, -hd + 30, z + 140);
    m.box(-hw + post, hd - 30, z, hw - post, hd, z + 140);
    m.box(-hw, -hd + post, z, -hw + 30, hd - post, z + 140);
    m.box(hw - 30, -hd + post, z, hw, hd - post, z + 140);
    m.box(-hw + 30, -hd + 30, z + 20, hw - 30, hd - 30, z + 40);
    m.use(s.secondary, 'body', 'mattress');
    softBox(m, -hw + 40, -hd + 40, z + 40, hw - 40, hd - 40, z + 190, 40, 2);
  }
  const upper = tiers[1];
  m.use(s.primary, 'body');
  // Guard rails: full length on the −x side, up to the ladder on the +x side.
  const gz = Math.min(h - 70, upper + 400);
  m.box(-hw, -hd + post, gz, -hw + 30, hd - post, gz + 60);
  const ladder0 = -hd + 250;
  const ladder1 = ladder0 + 420;
  m.box(hw - 30, ladder1, gz, hw, hd - post, gz + 60);
  // Head and foot boards.
  for (const sy of [-1, 1]) {
    const y0 = sy > 0 ? hd - 25 : -hd;
    m.box(-hw + post, y0, upper + 140, hw - post, y0 + 25, Math.min(h - 40, gz + 60));
    m.box(-hw + post, y0, 320, hw - post, y0 + 25, 650);
  }
  // Ladder in the +x side plane.
  for (const y of [ladder0, ladder1 - 40]) m.box(hw - 40, y, 0, hw, y + 40, gz + 60);
  for (let z = 330; z < upper; z += 270) m.box(hw - 35, ladder0 + 40, z, hw - 5, ladder1 - 40, z + 30);
};

const crib: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const h = s.h;
  const post = 45;
  m.use(s.primary, 'body');
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) m.boxC(sx * (hw - post / 2), sy * (hd - post / 2), 0, post, post, h);
  const rail = (z0: number, z1: number) => {
    m.box(-hw + post, -hd, z0, hw - post, -hd + 30, z1);
    m.box(-hw + post, hd - 30, z0, hw - post, hd, z1);
    m.box(-hw, -hd + post, z0, -hw + 30, hd - post, z1);
    m.box(hw - 30, -hd + post, z0, hw, hd - post, z1);
  };
  const zb = clamp(h * 0.25, 120, 300);
  rail(zb, zb + 45);
  rail(h - 45, h);
  m.box(-hw + 30, -hd + 30, zb, hw - 30, hd - 30, zb + 25);
  const slat = 22;
  const spacing = 80;
  const slats = (len: number, place: (t: number) => void) => {
    const n = Math.max(1, Math.round(len / spacing));
    for (let i = 1; i < n; i++) place(-len / 2 + (i * len) / n);
  };
  slats(s.w - 2 * post, (x) => {
    m.boxC(x, -hd + 15, zb + 45, slat, slat, h - 45 - zb - 45);
    m.boxC(x, hd - 15, zb + 45, slat, slat, h - 45 - zb - 45);
  });
  slats(s.d - 2 * post, (y) => {
    m.boxC(-hw + 15, y, zb + 45, slat, slat, h - 45 - zb - 45);
    m.boxC(hw - 15, y, zb + 45, slat, slat, h - 45 - zb - 45);
  });
  m.use(s.secondary, 'body', 'mattress');
  softBox(m, -hw + 32, -hd + 32, zb + 25, hw - 32, hd - 32, zb + 125, 30, 2);
};

const nightstand: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const legH = clamp(s.h * 0.2, 50, 150);
  m.use(s.primary, 'body');
  legs(m, hw, hd, 15, 0, legH, 32);
  m.box(-hw, -hd + FRONT_ZONE, legH, hw, hd, s.h - 22);
  m.box(-hw, -hd + FRONT_T + 4, s.h - 22, hw, hd, s.h);
  fronts(m, { x0: -hw + 3, x1: hw - 3, z0: legH + 3, z1: s.h - 25, yFace: -hd + FRONT_ZONE, cols: 1, rows: 2, frontMat: s.primary, handleMat: METAL, handle: 'knob' });
};

const wardrobe: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  m.use(s.primary, 'body');
  m.box(-hw, -hd + FRONT_ZONE, 0, hw, hd, s.h - 30);
  m.box(-hw, -hd + FRONT_T + 4, s.h - 30, hw, hd, s.h);
  m.use('paint-charcoal', 'detail');
  m.box(-hw + 10, -hd + FRONT_ZONE - 2, 0, hw - 10, -hd + FRONT_ZONE, 90);
  const cols = Math.max(1, Math.round(s.w / 600));
  fronts(m, { x0: -hw + 2, x1: hw - 2, z0: 95, z1: s.h - 32, yFace: -hd + FRONT_ZONE, cols, rows: 1, frontMat: s.primary, handleMat: METAL, handle: 'bar-v', handleAt: 'middle', pairs: cols % 2 === 0 });
};

const dresser: FurnitureBuilder = (m, s) => {
  const hw = s.w / 2;
  const hd = s.d / 2;
  const legH = clamp(s.h * 0.16, 60, 180);
  m.use(s.primary, 'body');
  legs(m, hw, hd, 20, 0, legH, 40);
  m.box(-hw, -hd + FRONT_ZONE, legH, hw, hd, s.h - 25);
  m.box(-hw, -hd + FRONT_T + 4, s.h - 25, hw, hd, s.h);
  fronts(m, {
    x0: -hw + 3,
    x1: hw - 3,
    z0: legH + 3,
    z1: s.h - 28,
    yFace: -hd + FRONT_ZONE,
    cols: s.w > 900 ? 2 : 1,
    rows: 3,
    frontMat: s.primary,
    handleMat: METAL,
    handle: 'bar-h',
  });
};

export const BEDROOM: Record<string, FurnitureBuilder> = {
  'bed-king': doubleBed,
  'bed-double': doubleBed,
  'bed-single': doubleBed,
  'bunk-bed': bunkBed,
  crib,
  nightstand,
  wardrobe,
  dresser,
};
