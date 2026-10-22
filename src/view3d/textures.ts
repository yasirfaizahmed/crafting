/**
 * Procedural, seamless material textures drawn on 2D canvases (no binary assets).
 *
 * One texture tile represents ONE pattern repeat of `MaterialDef.patternSize` mm, so the 3D view
 * sets `texture.repeat = 1000 / patternSize` on metre-based UVs. Colours are baked into the image
 * (mortar, grout and seams have their own colours); a matching grayscale height image drives
 * bump mapping for masonry, tiles, planks and roofing. Everything is deterministic per material id.
 */
import type { MaterialDef, TexturePattern } from '../core/materials';

export interface PatternImage {
  color: HTMLCanvasElement;
  bump?: HTMLCanvasElement;
}

type RGB = [number, number, number];
type Ctx = CanvasRenderingContext2D;

let support: boolean | null = null;

/** True when 2D canvases can be drawn (false in Node and jsdom). */
export function canvas2DSupported(): boolean {
  if (support !== null) return support;
  try {
    if (typeof document === 'undefined' || typeof navigator === 'undefined' || /jsdom/i.test(navigator.userAgent)) {
      support = false;
    } else {
      support = !!document.createElement('canvas').getContext('2d');
    }
  } catch {
    support = false;
  }
  return support;
}

/** Testing hook: force canvas support detection to re-run. */
export function resetCanvasSupport(): void {
  support = null;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Small fast deterministic PRNG returning [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function parseHex(hex: string): RGB {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

const clamp255 = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
const shade = (c: RGB, f: number): RGB => [clamp255(c[0] * f), clamp255(c[1] * f), clamp255(c[2] * f)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const css = (c: RGB, a = 1): string => (a >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`);
const lum = (c: RGB): number => (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;

/** Tileable value noise on a px × py lattice over the unit square. */
class PeriodicNoise {
  private readonly v: Float32Array;

  constructor(
    rng: () => number,
    private readonly px: number,
    private readonly py: number,
  ) {
    this.v = new Float32Array(px * py);
    for (let i = 0; i < this.v.length; i++) this.v[i] = rng();
  }

  /** u, v in tile units (wraps); returns [0, 1]. */
  at(u: number, v: number): number {
    const x = (((u % 1) + 1) % 1) * this.px;
    const y = (((v % 1) + 1) % 1) * this.py;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const x1 = (x0 + 1) % this.px;
    const y1 = (y0 + 1) % this.py;
    const r0 = y0 * this.px;
    const r1 = y1 * this.px;
    const a = this.v[r0 + x0] + (this.v[r0 + x1] - this.v[r0 + x0]) * sx;
    const b = this.v[r1 + x0] + (this.v[r1 + x1] - this.v[r1 + x0]) * sx;
    return a + (b - a) * sy;
  }
}

/** Fractal (fbm) tileable noise built from several PeriodicNoise octaves. */
class Fbm {
  private readonly octaves: PeriodicNoise[] = [];

  constructor(rng: () => number, px: number, py: number, count: number) {
    for (let i = 0; i < count; i++) this.octaves.push(new PeriodicNoise(rng, px << i, py << i));
  }

  at(u: number, v: number): number {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (const o of this.octaves) {
      sum += o.at(u, v) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  }
}

function makeCanvas(size: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  return c;
}

/** Multiply every pixel's brightness by 1 + (noise − 0.5) · amount. */
function modulate(g: Ctx, S: number, noise: { at(u: number, v: number): number }, amount: number): void {
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const f = 1 + (noise.at(x / S, y / S) - 0.5) * amount;
      const i = (y * S + x) * 4;
      d[i] = clamp255(d[i] * f);
      d[i + 1] = clamp255(d[i + 1] * f);
      d[i + 2] = clamp255(d[i + 2] * f);
    }
  }
  g.putImageData(img, 0, 0);
}

/** Per-pixel random grain (film-grain style speckle). */
function grain(g: Ctx, S: number, rng: () => number, amount: number): void {
  const img = g.getImageData(0, 0, S, S);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const f = 1 + (rng() - 0.5) * amount;
    d[i] = clamp255(d[i] * f);
    d[i + 1] = clamp255(d[i + 1] * f);
    d[i + 2] = clamp255(d[i + 2] * f);
  }
  g.putImageData(img, 0, 0);
}

/** Draw `fn` at x and wrapped copies so shapes crossing an edge continue on the other side. */
function wrapX(S: number, x: number, w: number, fn: (x: number) => void): void {
  fn(x);
  if (x < 0) fn(x + S);
  if (x + w > S) fn(x - S);
}

function wrapXY(S: number, x: number, y: number, r: number, fn: (x: number, y: number) => void): void {
  for (const dx of [0, -S, S]) {
    for (const dy of [0, -S, S]) {
      if (x + dx + r < 0 || x + dx - r > S || y + dy + r < 0 || y + dy - r > S) continue;
      fn(x + dx, y + dy);
    }
  }
}

interface DrawArgs {
  g: Ctx;
  b: Ctx | null;
  S: number;
  base: RGB;
  rng: () => number;
  def: MaterialDef;
}

const JOINT_H = 70;
const FACE_H = 225;

/** Running-bond masonry: `rows` courses with `cols` units per course. */
function masonry({ g, b, S, base, rng }: DrawArgs, rows: number, cols: number, jointMm: number, patternMm: number, tintRange: number, mortar: RGB): void {
  g.fillStyle = css(mortar);
  g.fillRect(0, 0, S, S);
  if (b) {
    b.fillStyle = css([JOINT_H, JOINT_H, JOINT_H]);
    b.fillRect(0, 0, S, S);
  }
  const rowH = S / rows;
  const unitW = S / cols;
  const j = Math.max(1.5, (S * jointMm) / patternMm);
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (unitW / 2);
    const tints: RGB[] = [];
    for (let k = 0; k < cols; k++) {
      const f = 1 - tintRange / 2 + rng() * tintRange;
      const warm = (rng() - 0.5) * 0.08;
      const c = shade(base, f);
      tints.push([clamp255(c[0] * (1 + warm)), c[1], clamp255(c[2] * (1 - warm))]);
    }
    for (let k = -1; k <= cols; k++) {
      const idx = ((k % cols) + cols) % cols;
      const x = k * unitW + off + j / 2;
      const y = r * rowH + j / 2;
      g.fillStyle = css(tints[idx]);
      g.fillRect(x, y, unitW - j, rowH - j);
      // Soft arris shading: lighter top edge, darker bottom edge.
      g.fillStyle = css(shade(tints[idx], 1.12), 0.5);
      g.fillRect(x, y, unitW - j, Math.max(1, j * 0.35));
      g.fillStyle = css(shade(tints[idx], 0.78), 0.45);
      g.fillRect(x, y + rowH - j - Math.max(1, j * 0.4), unitW - j, Math.max(1, j * 0.4));
      if (b) {
        b.fillStyle = css([FACE_H, FACE_H, FACE_H]);
        b.fillRect(x, y, unitW - j, rowH - j);
      }
    }
  }
}

function drawBrick(a: DrawArgs): void {
  masonry(a, 6, 2, 10, a.def.patternSize, 0.32, mix(a.base, [214, 208, 196], 0.78));
  modulate(a.g, a.S, new Fbm(a.rng, 8, 8, 3), 0.22);
  grain(a.g, a.S, a.rng, 0.12);
}

function drawBlock(a: DrawArgs): void {
  masonry(a, 4, 2, 10, a.def.patternSize, 0.1, shade(a.base, 0.86));
  modulate(a.g, a.S, new Fbm(a.rng, 16, 16, 2), 0.16);
  grain(a.g, a.S, a.rng, 0.22);
}

/** Coursed ashlar with irregular stone lengths. */
function drawStone(a: DrawArgs): void {
  const { g, b, S, base, rng } = a;
  const mortar = shade(mix(base, [190, 186, 178], 0.5), 0.8);
  g.fillStyle = css(mortar);
  g.fillRect(0, 0, S, S);
  if (b) {
    b.fillStyle = css([JOINT_H, JOINT_H, JOINT_H]);
    b.fillRect(0, 0, S, S);
  }
  const j = Math.max(2, (S * 12) / a.def.patternSize);
  const rowWeights = [0.8 + rng() * 0.5, 0.8 + rng() * 0.5, 0.8 + rng() * 0.5];
  const rowSum = rowWeights.reduce((s, w) => s + w, 0);
  let y = 0;
  for (const rw of rowWeights) {
    const h = (rw / rowSum) * S;
    const n = 2 + Math.floor(rng() * 2);
    const ws = Array.from({ length: n }, () => 0.7 + rng() * 0.8);
    const wsum = ws.reduce((s, w) => s + w, 0);
    let x = rng() * S;
    for (const ww of ws) {
      const w = (ww / wsum) * S;
      const tint = shade(mix(base, rng() < 0.5 ? [150, 140, 125] : [235, 228, 215], rng() * 0.25), 0.85 + rng() * 0.3);
      wrapX(S, x, w, (xx) => {
        g.fillStyle = css(tint);
        g.fillRect(xx + j / 2, y + j / 2, w - j, h - j);
        g.fillStyle = css(shade(tint, 1.1), 0.4);
        g.fillRect(xx + j / 2, y + j / 2, w - j, Math.max(1, j * 0.5));
        if (b) {
          b.fillStyle = css([FACE_H, FACE_H, FACE_H]);
          b.fillRect(xx + j / 2, y + j / 2, w - j, h - j);
        }
      });
      x += w;
      if (x > S) x -= S;
    }
    y += h;
  }
  modulate(g, S, new Fbm(rng, 6, 6, 4), 0.35);
  grain(g, S, rng, 0.14);
  if (b) modulate(b, S, new Fbm(rng, 8, 8, 2), 0.3);
}

/** One square tile per repeat with grout lines on its edges. */
function drawTiles(a: DrawArgs): void {
  const { g, b, S, base, rng, def } = a;
  const groutMm = def.patternSize <= 150 ? 2 : 3;
  const j = Math.max(2, (S * groutMm) / def.patternSize);
  const grout = lum(base) > 0.55 ? shade(base, 0.78) : mix(base, [210, 210, 205], 0.55);
  g.fillStyle = css(grout);
  g.fillRect(0, 0, S, S);
  const inset = j / 2;
  const grad = g.createLinearGradient(0, 0, S, S);
  grad.addColorStop(0, css(shade(base, 1.06)));
  grad.addColorStop(1, css(shade(base, 0.95)));
  g.fillStyle = grad;
  g.fillRect(inset, inset, S - j, S - j);
  g.fillStyle = css(shade(base, 1.15), 0.5);
  g.fillRect(inset, inset, S - j, Math.max(1, j * 0.4));
  g.fillRect(inset, inset, Math.max(1, j * 0.4), S - j);
  if (b) {
    b.fillStyle = css([JOINT_H, JOINT_H, JOINT_H]);
    b.fillRect(0, 0, S, S);
    b.fillStyle = css([FACE_H, FACE_H, FACE_H]);
    b.fillRect(inset, inset, S - j, S - j);
  }
  modulate(g, S, new Fbm(rng, 4, 4, 3), 0.06);
  grain(g, S, rng, 0.04);
}

function grainLines(g: Ctx, x: number, y: number, w: number, h: number, c: RGB, rng: () => number, count: number): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  for (let i = 0; i < count; i++) {
    const yy = y + rng() * h;
    const amp = rng() * h * 0.08;
    const freq = 1 + rng() * 3;
    const phase = rng() * Math.PI * 2;
    g.strokeStyle = css(shade(c, 0.7 + rng() * 0.15), 0.12 + rng() * 0.2);
    g.lineWidth = 0.6 + rng() * 1.1;
    g.beginPath();
    for (let s = 0; s <= 24; s++) {
      const xx = x + (w * s) / 24;
      const v = yy + Math.sin((s / 24) * Math.PI * freq + phase) * amp;
      if (s === 0) g.moveTo(xx, v);
      else g.lineTo(xx, v);
    }
    g.stroke();
  }
  g.restore();
}

/** Floor boards: staggered planks with per-board tint and grain. */
function drawPlanks(a: DrawArgs): void {
  const { g, b, S, base, rng } = a;
  const rows = 8;
  const rowH = S / rows;
  const seam = shade(base, 0.45);
  g.fillStyle = css(seam);
  g.fillRect(0, 0, S, S);
  if (b) {
    b.fillStyle = css([JOINT_H, JOINT_H, JOINT_H]);
    b.fillRect(0, 0, S, S);
  }
  const sw = Math.max(1, S / 340);
  for (let r = 0; r < rows; r++) {
    const j1 = rng() * S;
    const j2 = j1 + S * (0.35 + rng() * 0.3);
    const pieces: [number, number][] = [
      [j1, j2],
      [j2, j1 + S],
    ];
    for (const [x0, x1] of pieces) {
      const tint = shade(mix(base, rng() < 0.5 ? [120, 80, 50] : [225, 190, 140], rng() * 0.18), 0.88 + rng() * 0.22);
      const w = x1 - x0;
      wrapX(S, x0 % S, w, (xx) => {
        g.fillStyle = css(tint);
        g.fillRect(xx + sw / 2, r * rowH + sw / 2, w - sw, rowH - sw);
        grainLines(g, xx + sw / 2, r * rowH + sw / 2, w - sw, rowH - sw, tint, rng, 7);
        if (b) {
          b.fillStyle = css([FACE_H, FACE_H, FACE_H]);
          b.fillRect(xx + sw / 2, r * rowH + sw / 2, w - sw, rowH - sw);
        }
      });
    }
  }
  modulate(g, S, new Fbm(rng, 2, 16, 3), 0.12);
  grain(g, S, rng, 0.05);
}

/** Continuous timber grain (furniture, joinery). */
function drawWoodGrain(a: DrawArgs): void {
  const { g, S, base, rng } = a;
  g.fillStyle = css(base);
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 46; i++) {
    const y0 = rng() * S;
    const k = 1 + Math.floor(rng() * 3);
    const amp = 1 + rng() * S * 0.02;
    const phase = rng() * Math.PI * 2;
    const dark = rng() < 0.7;
    g.strokeStyle = css(shade(base, dark ? 0.7 + rng() * 0.15 : 1.12), 0.1 + rng() * 0.18);
    g.lineWidth = 0.6 + rng() * 2.2;
    for (const dy of [0, -S, S]) {
      g.beginPath();
      for (let s = 0; s <= 48; s++) {
        const x = (S * s) / 48;
        const y = y0 + dy + Math.sin((s / 48) * Math.PI * 2 * k + phase) * amp;
        if (s === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
  }
  modulate(g, S, new Fbm(rng, 2, 24, 3), 0.18);
  grain(g, S, rng, 0.04);
}

/** Roof courses: shingles / clay tiles / slates in staggered rows with course shadows. */
function drawShingles(a: DrawArgs): void {
  const { g, b, S, base, rng, def } = a;
  const clay = def.id.includes('clay');
  const rows = 4;
  const cols = clay ? 4 : 2;
  const rowH = S / rows;
  const colW = S / cols;
  g.fillStyle = css(shade(base, 0.45));
  g.fillRect(0, 0, S, S);
  if (b) {
    b.fillStyle = css([40, 40, 40]);
    b.fillRect(0, 0, S, S);
  }
  const gap = Math.max(1, S / 200);
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (colW / 2);
    const tints: RGB[] = [];
    for (let k = 0; k < cols; k++) tints.push(shade(base, 0.86 + rng() * 0.26));
    for (let k = -1; k <= cols; k++) {
      const t = tints[((k % cols) + cols) % cols];
      const x = k * colW + off + gap / 2;
      const y = r * rowH;
      const w = colW - gap;
      if (clay) {
        const gr = g.createLinearGradient(x, 0, x + w, 0);
        gr.addColorStop(0, css(shade(t, 0.72)));
        gr.addColorStop(0.45, css(shade(t, 1.1)));
        gr.addColorStop(1, css(shade(t, 0.68)));
        g.fillStyle = gr;
      } else g.fillStyle = css(t);
      g.fillRect(x, y, w, rowH - gap);
      // Shadow cast by the course above.
      const sh = g.createLinearGradient(0, y, 0, y + rowH * 0.35);
      sh.addColorStop(0, 'rgba(0,0,0,0.38)');
      sh.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sh;
      g.fillRect(x, y, w, rowH * 0.35);
      g.fillStyle = css(shade(t, 1.18), 0.55);
      g.fillRect(x, y + rowH - gap - Math.max(1, gap), w, Math.max(1, gap));
      if (b) {
        const bg = b.createLinearGradient(0, y, 0, y + rowH);
        bg.addColorStop(0, css([90, 90, 90]));
        bg.addColorStop(1, css([235, 235, 235]));
        b.fillStyle = bg;
        b.fillRect(x, y, w, rowH - gap);
      }
    }
  }
  modulate(g, S, new Fbm(rng, 8, 8, 3), 0.16);
  grain(g, S, rng, 0.1);
}

/** Standing-seam metal: one raised seam per repeat. */
function drawMetalSeam(a: DrawArgs): void {
  const { g, b, S, base, rng } = a;
  g.fillStyle = css(base);
  g.fillRect(0, 0, S, S);
  const grad = g.createLinearGradient(0, 0, S, 0);
  grad.addColorStop(0, css(shade(base, 0.92)));
  grad.addColorStop(0.5, css(shade(base, 1.06)));
  grad.addColorStop(1, css(shade(base, 0.92)));
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const w = Math.max(2, S / 64);
  g.fillStyle = css(shade(base, 1.45));
  g.fillRect(S / 2 - w, 0, w, S);
  g.fillStyle = css(shade(base, 0.55));
  g.fillRect(S / 2, 0, w, S);
  if (b) {
    b.fillStyle = css([110, 110, 110]);
    b.fillRect(0, 0, S, S);
    b.fillStyle = css([255, 255, 255]);
    b.fillRect(S / 2 - w, 0, w * 2, S);
  }
  modulate(g, S, new Fbm(rng, 1, 32, 2), 0.06);
}

function drawGrass(a: DrawArgs): void {
  const { g, S, base, rng } = a;
  g.fillStyle = css(base);
  g.fillRect(0, 0, S, S);
  modulate(g, S, new Fbm(rng, 16, 16, 3), 0.3);
  const blades = Math.round((S * S) / 26);
  for (let i = 0; i < blades; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const len = 2 + rng() * (S / 64);
    const ang = -Math.PI / 2 + (rng() - 0.5) * 1.2;
    const tone = rng();
    const c = tone < 0.4 ? shade(base, 0.78) : tone < 0.7 ? shade(mix(base, [160, 170, 90], 0.3), 1.05) : shade(base, 1.12);
    g.strokeStyle = css(c, 0.45);
    g.lineWidth = 0.7 + rng() * 0.6;
    wrapXY(S, x, y, len, (xx, yy) => {
      g.beginPath();
      g.moveTo(xx, yy);
      g.lineTo(xx + Math.cos(ang) * len, yy + Math.sin(ang) * len);
      g.stroke();
    });
  }
}

function drawGravel(a: DrawArgs): void {
  const { g, b, S, base, rng } = a;
  g.fillStyle = css(shade(base, 0.6));
  g.fillRect(0, 0, S, S);
  if (b) {
    b.fillStyle = css([50, 50, 50]);
    b.fillRect(0, 0, S, S);
  }
  const pxPerMm = S / a.def.patternSize;
  const count = Math.round((S * S) / 60);
  for (let i = 0; i < count; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = (3 + rng() * 7) * pxPerMm + 0.8;
    const c = shade(mix(base, rng() < 0.5 ? [120, 105, 90] : [200, 198, 192], rng() * 0.5), 0.75 + rng() * 0.5);
    const rot = rng() * Math.PI;
    const sq = 0.6 + rng() * 0.4;
    wrapXY(S, x, y, r, (xx, yy) => {
      g.fillStyle = css(c);
      g.beginPath();
      g.ellipse(xx, yy, r, r * sq, rot, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = css(shade(c, 1.25), 0.45);
      g.beginPath();
      g.ellipse(xx - r * 0.25, yy - r * 0.25, r * 0.45, r * 0.3 * sq, rot, 0, Math.PI * 2);
      g.fill();
      if (b) {
        b.fillStyle = css([220, 220, 220]);
        b.beginPath();
        b.ellipse(xx, yy, r, r * sq, rot, 0, Math.PI * 2);
        b.fill();
      }
    });
  }
}

function drawFabric(a: DrawArgs): void {
  const { g, S, base, rng } = a;
  g.fillStyle = css(base);
  g.fillRect(0, 0, S, S);
  const step = Math.max(2, Math.round(S / 128));
  for (let y = 0; y < S; y += step) {
    g.fillStyle = css(shade(base, 1.12), 0.18);
    g.fillRect(0, y, S, 1);
  }
  for (let x = 0; x < S; x += step) {
    g.fillStyle = css(shade(base, 0.82), 0.16);
    g.fillRect(x, 0, 1, S);
  }
  modulate(g, S, new Fbm(rng, 8, 8, 3), 0.14);
  grain(g, S, rng, 0.08);
}

function drawMarble(a: DrawArgs): void {
  const { g, S, base, rng } = a;
  const n = new Fbm(rng, 3, 3, 5);
  const n2 = new Fbm(rng, 5, 5, 4);
  const vein: RGB = mix(shade(base, 0.55), [95, 105, 120], 0.4);
  const img = g.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const t = Math.sin(Math.PI * 2 * (u + 2 * v + n.at(u, v) * 2.2));
      const t2 = Math.sin(Math.PI * 2 * (2 * u - v + n2.at(u, v) * 3.0));
      const veins = Math.pow(1 - Math.abs(t), 9) * 0.75 + Math.pow(1 - Math.abs(t2), 14) * 0.45;
      const cloud = 0.96 + (n2.at(u * 2, v * 2) - 0.5) * 0.08;
      const k = Math.min(1, veins);
      const c = mix(shade(base, cloud), vein, k);
      const i = (y * S + x) * 4;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
}

/** Cast-in-place concrete: mottling, pores, formwork panel joints and tie holes. */
function drawConcrete(a: DrawArgs): void {
  const { g, b, S, base, rng } = a;
  g.fillStyle = css(base);
  g.fillRect(0, 0, S, S);
  modulate(g, S, new Fbm(rng, 3, 3, 5), 0.2);
  grain(g, S, rng, 0.1);
  if (b) {
    b.fillStyle = css([200, 200, 200]);
    b.fillRect(0, 0, S, S);
  }
  const pores = Math.round((S * S) / 700);
  for (let i = 0; i < pores; i++) {
    const x = rng() * S;
    const y = rng() * S;
    const r = 0.4 + rng() * 1.1;
    g.fillStyle = css(shade(base, 0.55), 0.35 + rng() * 0.3);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = css(shade(base, 0.78), 0.5);
  g.fillRect(0, 0, S, 1);
  g.fillRect(0, 0, 1, S);
  if (b) {
    b.fillStyle = css([120, 120, 120]);
    b.fillRect(0, 0, S, 1);
    b.fillRect(0, 0, 1, S);
  }
  for (const fx of [0.25, 0.75]) {
    for (const fy of [0.25, 0.75]) {
      const x = fx * S;
      const y = fy * S;
      const r = Math.max(1.5, S / 170);
      g.fillStyle = css(shade(base, 1.08), 0.8);
      g.beginPath();
      g.arc(x, y, r * 1.8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = css(shade(base, 0.5));
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      if (b) {
        b.fillStyle = css([60, 60, 60]);
        b.beginPath();
        b.arc(x, y, r, 0, Math.PI * 2);
        b.fill();
      }
    }
  }
}

const DRAWERS: Partial<Record<TexturePattern, (a: DrawArgs) => void>> = {
  brick: drawBrick,
  block: drawBlock,
  stone: drawStone,
  tiles: drawTiles,
  planks: drawPlanks,
  'wood-grain': drawWoodGrain,
  shingles: drawShingles,
  'metal-seam': drawMetalSeam,
  grass: drawGrass,
  gravel: drawGravel,
  fabric: drawFabric,
  marble: drawMarble,
  concrete: drawConcrete,
};

const BUMPED = new Set<TexturePattern>(['brick', 'block', 'stone', 'tiles', 'planks', 'shingles', 'metal-seam', 'gravel', 'concrete']);
const LARGE = new Set<TexturePattern>(['brick', 'stone', 'planks', 'concrete', 'marble', 'grass', 'gravel', 'shingles']);

/** Patterns that have a procedural drawer. */
export const PROCEDURAL_PATTERNS = Object.keys(DRAWERS) as TexturePattern[];

/** Texture tile size (px) used for a pattern. */
export function patternResolution(pattern: TexturePattern): number {
  return LARGE.has(pattern) ? 512 : 256;
}

/** Draw the colour (and bump) image for a material, or null if it has no pattern / no canvas. */
export function drawPattern(def: MaterialDef, size?: number): PatternImage | null {
  const drawer = DRAWERS[def.pattern];
  if (!drawer || !canvas2DSupported()) return null;
  try {
    const S = size ?? patternResolution(def.pattern);
    const color = makeCanvas(S);
    const g = color.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    const bump = BUMPED.has(def.pattern) ? makeCanvas(S) : undefined;
    const b = bump?.getContext('2d', { willReadFrequently: true }) ?? null;
    drawer({ g, b, S, base: parseHex(def.color), rng: mulberry32(hashString(def.id)), def });
    return { color, bump: b ? bump : undefined };
  } catch (err) {
    console.warn('Procedural texture failed for', def.id, err);
    return null;
  }
}

/** Low-frequency tileable brightness variation (ground patches), as a grayscale canvas. */
export function drawVariation(seed: number, size = 256): HTMLCanvasElement | null {
  if (!canvas2DSupported()) return null;
  const c = makeCanvas(size);
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  const n = new Fbm(mulberry32(seed), 4, 4, 4);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = 255 * Math.min(1, Math.max(0, (n.at(x / size, y / size) - 0.5) * 2.4 + 0.5));
      const i = (y * size + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v;
      img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}
