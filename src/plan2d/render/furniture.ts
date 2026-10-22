/**
 * Furniture plan symbols, drawn in the element's local frame (mm): width along x, depth along y,
 * centred on the origin; the BACK is +y (against the wall), the front −y.
 */
import type { FurniturePlanSymbol } from '../../core/catalog';
import type { Painter } from './painter';
import { PAL, type Palette } from './style';

type Draw = (p: Painter, w: number, d: number, pal: Palette) => void;

const rect = (p: Painter, x0: number, y0: number, x1: number, y1: number) => {
  p.g.beginPath();
  p.g.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
};

function rrect(p: Painter, x0: number, y0: number, x1: number, y1: number, r: number): void {
  const g = p.g;
  const x = Math.min(x0, x1);
  const y = Math.min(y0, y1);
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.arcTo(x + w, y, x + w, y + rr, rr);
  g.lineTo(x + w, y + h - rr);
  g.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  g.lineTo(x + rr, y + h);
  g.arcTo(x, y + h, x, y + h - rr, rr);
  g.lineTo(x, y + rr);
  g.arcTo(x, y, x + rr, y, rr);
  g.closePath();
}

function ellipse(p: Painter, cx: number, cy: number, rx: number, ry: number): void {
  p.g.beginPath();
  p.g.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
}

function fs(p: Painter, pal: Palette, fill = true): void {
  if (fill) {
    p.g.fillStyle = pal.furnitureFill;
    p.g.fill();
  }
  p.g.strokeStyle = pal.furniture;
  p.g.stroke();
}

function seg(p: Painter, x0: number, y0: number, x1: number, y1: number): void {
  p.g.beginPath();
  p.g.moveTo(x0, y0);
  p.g.lineTo(x1, y1);
  p.g.stroke();
}

const box: Draw = (p, w, d, pal) => {
  rect(p, -w / 2, -d / 2, w / 2, d / 2);
  fs(p, pal);
};

const SYMBOLS: Record<FurniturePlanSymbol, Draw> = {
  rect: box,
  round: (p, w, d, pal) => {
    ellipse(p, 0, 0, w / 2, d / 2);
    fs(p, pal);
  },
  bed: (p, w, d, pal) => {
    rrect(p, -w / 2, -d / 2, w / 2, d / 2, 40);
    fs(p, pal);
    const head = Math.min(80, d * 0.05);
    rect(p, -w / 2, d / 2 - head, w / 2, d / 2);
    p.g.fillStyle = pal.furniture;
    p.g.globalAlpha *= 0.55;
    p.g.fill();
    p.g.globalAlpha /= 0.55;
    const pd = Math.min(380, d * 0.2);
    const top = d / 2 - head - 70;
    const n = w >= 1200 ? 2 : 1;
    const gap = 70;
    const pw = (w - 2 * 90 - (n - 1) * gap) / n;
    for (let i = 0; i < n; i++) {
      const x0 = -w / 2 + 90 + i * (pw + gap);
      rrect(p, x0, top - pd, x0 + pw, top, 90);
      fs(p, pal);
    }
    // Duvet turn-down with a folded corner.
    const fold = top - pd - 140;
    seg(p, -w / 2, fold, w / 2, fold);
    seg(p, -w / 2, fold - 90, w / 2, fold - 90);
    const c = Math.min(420, w * 0.3);
    p.g.beginPath();
    p.g.moveTo(w / 2, -d / 2 + c);
    p.g.lineTo(w / 2 - c, -d / 2);
    p.g.stroke();
  },
  sofa: (p, w, d, pal) => {
    rrect(p, -w / 2, -d / 2, w / 2, d / 2, 60);
    fs(p, pal);
    const back = Math.min(d * 0.25, 230);
    const arm = Math.min(w * 0.1, 200);
    rrect(p, -w / 2, d / 2 - back, w / 2, d / 2, 50);
    fs(p, pal);
    rrect(p, -w / 2, -d / 2, -w / 2 + arm, d / 2 - back, 50);
    fs(p, pal);
    rrect(p, w / 2 - arm, -d / 2, w / 2, d / 2 - back, 50);
    fs(p, pal);
    const n = w > 1900 ? 3 : 2;
    const x0 = -w / 2 + arm;
    const cw = (w - 2 * arm) / n;
    for (let i = 1; i < n; i++) seg(p, x0 + i * cw, -d / 2 + 40, x0 + i * cw, d / 2 - back);
  },
  chair: (p, w, d, pal) => {
    const back = Math.max(60, d * 0.17);
    const arms = w >= 650;
    rrect(p, -w / 2, -d / 2, w / 2, d / 2, Math.min(w, d) * 0.12);
    fs(p, pal);
    rrect(p, -w / 2, d / 2 - back, w / 2, d / 2, back / 2);
    fs(p, pal);
    if (arms) {
      const a = Math.max(70, w * 0.13);
      rrect(p, -w / 2, -d / 2, -w / 2 + a, d / 2 - back, a / 2);
      fs(p, pal);
      rrect(p, w / 2 - a, -d / 2, w / 2, d / 2 - back, a / 2);
      fs(p, pal);
    }
  },
  table: (p, w, d, pal) => {
    rrect(p, -w / 2, -d / 2, w / 2, d / 2, 20);
    fs(p, pal);
    const i = Math.min(45, Math.min(w, d) * 0.06);
    rect(p, -w / 2 + i, -d / 2 + i, w / 2 - i, d / 2 - i);
    p.g.strokeStyle = pal.thin;
    p.g.stroke();
  },
  toilet: (p, w, d, pal) => {
    const tank = Math.min(200, d * 0.28);
    rrect(p, -w / 2, d / 2 - tank, w / 2, d / 2, 30);
    fs(p, pal);
    const by = (d / 2 - tank - (-d / 2)) / 2;
    const cy = -d / 2 + by;
    ellipse(p, 0, cy, w * 0.44, by);
    fs(p, pal);
    ellipse(p, 0, cy - by * 0.12, w * 0.27, by * 0.62);
    p.g.strokeStyle = pal.thin;
    p.g.stroke();
  },
  sink: (p, w, d, pal) => {
    rrect(p, -w / 2, -d / 2, w / 2, d / 2, 30);
    fs(p, pal);
    const wide = w > d * 1.3 && w >= 800;
    const cy = -d * 0.05;
    if (wide) rrect(p, -Math.min(w * 0.3, 300), cy - d * 0.3, Math.min(w * 0.3, 300), cy + d * 0.28, 60);
    else ellipse(p, 0, cy, Math.min(w * 0.36, 260), d * 0.3);
    p.g.strokeStyle = pal.furniture;
    p.g.stroke();
    p.circle({ x: 0, y: d / 2 - Math.min(70, d * 0.14) }, Math.min(25, w * 0.05));
    p.g.stroke();
  },
  bathtub: (p, w, d, pal) => {
    rrect(p, -w / 2, -d / 2, w / 2, d / 2, 40);
    fs(p, pal);
    const i = Math.min(70, d * 0.1);
    rrect(p, -w / 2 + i, -d / 2 + i, w / 2 - i, d / 2 - i, Math.min(d / 2 - i, 260));
    p.g.strokeStyle = pal.furniture;
    p.g.stroke();
    p.circle({ x: -w / 2 + i + 150, y: 0 }, 30);
    p.g.stroke();
  },
  shower: (p, w, d, pal) => {
    rect(p, -w / 2, -d / 2, w / 2, d / 2);
    fs(p, pal);
    p.g.strokeStyle = pal.thin;
    seg(p, -w / 2, -d / 2, w / 2, d / 2);
    seg(p, -w / 2, d / 2, w / 2, -d / 2);
    p.circle({ x: 0, y: 0 }, 45);
    p.g.fillStyle = pal.paper;
    p.g.fill();
    p.g.strokeStyle = pal.furniture;
    p.g.stroke();
  },
  stove: (p, w, d, pal) => {
    rect(p, -w / 2, -d / 2, w / 2, d / 2);
    fs(p, pal);
    const r = Math.min(w, d) * 0.15;
    for (const [sx, sy, k] of [
      [-1, 1, 1],
      [1, 1, 0.8],
      [-1, -1, 0.8],
      [1, -1, 1],
    ]) {
      const c = { x: (sx * w) / 4.2, y: (sy * d) / 4.2 + d * 0.03 };
      p.circle(c, r * k);
      p.g.stroke();
      p.circle(c, r * k * 0.45);
      p.g.stroke();
    }
  },
  fridge: (p, w, d, pal) => {
    rect(p, -w / 2, -d / 2, w / 2, d / 2);
    fs(p, pal);
    const i = Math.min(40, w * 0.06);
    rect(p, -w / 2 + i, -d / 2 + i * 2, w / 2 - i, d / 2 - i);
    p.g.strokeStyle = pal.thin;
    p.g.stroke();
    seg(p, -w / 2, -d / 2 + i * 2, w / 2, -d / 2 + i * 2);
    p.g.strokeStyle = pal.thin;
    seg(p, -w / 2 + i, -d / 2 + i * 2, w / 2 - i, d / 2 - i);
  },
  tree: (p, w, d, pal) => {
    const R = Math.min(w, d) / 2;
    const g = p.g;
    g.beginPath();
    const n = 72;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = R * (0.92 + 0.08 * Math.abs(Math.cos(a * 6)));
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i) g.lineTo(x, y);
      else g.moveTo(x, y);
    }
    g.closePath();
    g.fillStyle = pal === PAL ? 'rgba(96,150,84,0.13)' : pal.furnitureFill;
    g.fill();
    g.strokeStyle = pal.furniture;
    g.stroke();
    g.strokeStyle = pal.thin;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3;
      seg(p, Math.cos(a) * R * 0.08, Math.sin(a) * R * 0.08, Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.62);
    }
    p.circle({ x: 0, y: 0 }, R * 0.08);
    g.strokeStyle = pal.furniture;
    g.stroke();
  },
  car: (p, w, d, pal) => {
    // Length along local y; front at −y.
    rrect(p, -w / 2, -d / 2, w / 2, d / 2, Math.min(w * 0.22, 380));
    fs(p, pal);
    const g = p.g;
    g.strokeStyle = pal.furniture;
    const ws0 = -d / 2 + d * 0.26;
    const ws1 = -d / 2 + d * 0.38;
    g.beginPath();
    g.moveTo(-w * 0.4, ws0);
    g.lineTo(w * 0.4, ws0);
    g.lineTo(w * 0.34, ws1);
    g.lineTo(-w * 0.34, ws1);
    g.closePath();
    g.stroke();
    const rw0 = d / 2 - d * 0.22;
    const rw1 = d / 2 - d * 0.3;
    g.beginPath();
    g.moveTo(-w * 0.38, rw0);
    g.lineTo(w * 0.38, rw0);
    g.lineTo(w * 0.33, rw1);
    g.lineTo(-w * 0.33, rw1);
    g.closePath();
    g.stroke();
    rect(p, -w * 0.34, ws1, w * 0.34, rw1);
    g.strokeStyle = pal.thin;
    g.stroke();
    rect(p, -w / 2 - 90, ws0 - 60, -w / 2, ws0 + 60);
    fs(p, pal);
    rect(p, w / 2, ws0 - 60, w / 2 + 90, ws0 + 60);
    fs(p, pal);
  },
  lamp: (p, w, d, pal) => {
    const r = (Math.min(w, d) / 2) * 0.75;
    p.circle({ x: 0, y: 0 }, r);
    fs(p, pal);
    const k = r * 0.7071;
    seg(p, -k, -k, k, k);
    seg(p, -k, k, k, -k);
  },
  counter: (p, w, d, pal) => {
    rect(p, -w / 2, -d / 2, w / 2, d / 2);
    fs(p, pal);
    p.g.strokeStyle = pal.thin;
    const i = Math.min(30, d * 0.08);
    seg(p, -w / 2, -d / 2 + i, w / 2, -d / 2 + i);
  },
  wardrobe: (p, w, d, pal) => {
    rect(p, -w / 2, -d / 2, w / 2, d / 2);
    fs(p, pal);
    p.g.strokeStyle = pal.thin;
    p.dash([6, 4]);
    seg(p, -w / 2 + 40, 0, w / 2 - 40, 0);
    p.dash(null);
    const n = Math.max(2, Math.floor((w - 160) / 160));
    for (let i = 0; i <= n; i++) {
      const x = -w / 2 + 80 + ((w - 160) * i) / n;
      seg(p, x - d * 0.12, -d * 0.28, x + d * 0.12, d * 0.28);
    }
    // Door split lines at the front.
    p.g.strokeStyle = pal.furniture;
    const doors = Math.max(1, Math.round(w / 600));
    for (let i = 1; i < doors; i++) seg(p, -w / 2 + (w * i) / doors, -d / 2, -w / 2 + (w * i) / doors, -d / 2 + 60);
  },
  rug: (p, w, d, pal) => {
    rect(p, -w / 2, -d / 2, w / 2, d / 2);
    p.g.fillStyle = pal === PAL ? 'rgba(214,199,173,0.18)' : pal.furnitureFill;
    p.g.fill();
    p.g.strokeStyle = pal.furniture;
    p.g.stroke();
    const i = Math.min(110, Math.min(w, d) * 0.08);
    p.dash([5, 4]);
    rect(p, -w / 2 + i, -d / 2 + i, w / 2 - i, d / 2 - i);
    p.g.strokeStyle = pal.thin;
    p.g.stroke();
    p.dash(null);
    for (let y = -d / 2 + 60; y <= d / 2 - 60; y += 90) {
      seg(p, -w / 2 - 50, y, -w / 2, y);
      seg(p, w / 2, y, w / 2 + 50, y);
    }
  },
  plant: (p, w, d, pal) => {
    const R = Math.min(w, d) / 2;
    p.circle({ x: 0, y: 0 }, R * 0.42);
    fs(p, pal);
    const g = p.g;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      g.save();
      g.rotate(a);
      g.beginPath();
      g.ellipse(R * 0.62, 0, R * 0.36, R * 0.13, 0, 0, Math.PI * 2);
      g.fillStyle = pal === PAL ? 'rgba(80,140,70,0.16)' : pal.furnitureFill;
      g.fill();
      g.strokeStyle = pal.furniture;
      g.stroke();
      g.restore();
    }
  },
};

export function drawFurnitureSymbol(p: Painter, sym: FurniturePlanSymbol, w: number, d: number, pal: Palette): void {
  (SYMBOLS[sym] ?? box)(p, w, d, pal);
}
