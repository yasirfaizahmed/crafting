/**
 * Grid, tool overlays (snap glyphs, tracking guides, live dimensions, pills), handles and HUD.
 */
import { add, distance, normalize, scale, sub } from '../../core/math2d';
import type { LevelUnderlay, UnitSystem, Vec2 } from '../../core/types';
import { formatLength } from '../../core/units';
import type { Handle, OverlayItem, Tone } from '../editor-types';
import { gridSteps, scaleBar, shortLength } from '../grid';
import type { SnapKind } from '../snapping';
import type { Painter } from './painter';
import { TONE_BG, UI } from './style';

export function drawGrid(p: Painter, gridSize: number): void {
  const v = p.view;
  const g = p.g;
  const { minor, major } = gridSteps(gridSize, v.scale);
  const vb = v.visibleBounds();
  p.screen();
  g.setLineDash([]);
  g.lineWidth = 1;
  const lines = (step: number, color: string, skip?: number) => {
    g.beginPath();
    const kx0 = Math.ceil(vb.minX / step);
    const kx1 = Math.floor(vb.maxX / step);
    if (kx1 - kx0 > 2000) return;
    for (let k = kx0; k <= kx1; k++) {
      const x = k * step;
      if (skip && Math.abs(x / skip - Math.round(x / skip)) < 1e-9) continue;
      const sx = Math.round(v.toScreen({ x, y: 0 }).x) + 0.5;
      g.moveTo(sx, 0);
      g.lineTo(sx, v.height);
    }
    const ky0 = Math.ceil(vb.minY / step);
    const ky1 = Math.floor(vb.maxY / step);
    if (ky1 - ky0 > 2000) return;
    for (let k = ky0; k <= ky1; k++) {
      const y = k * step;
      if (skip && Math.abs(y / skip - Math.round(y / skip)) < 1e-9) continue;
      const sy = Math.round(v.toScreen({ x: 0, y }).y) + 0.5;
      g.moveTo(0, sy);
      g.lineTo(v.width, sy);
    }
    g.strokeStyle = color;
    g.stroke();
  };
  if (minor !== major) lines(minor, UI.gridMinor, major);
  lines(major, UI.gridMajor);
  // Origin axes.
  const o = v.toScreen({ x: 0, y: 0 });
  g.lineWidth = 1;
  g.strokeStyle = UI.axisX;
  g.beginPath();
  g.moveTo(0, Math.round(o.y) + 0.5);
  g.lineTo(v.width, Math.round(o.y) + 0.5);
  g.stroke();
  g.strokeStyle = UI.axisY;
  g.beginPath();
  g.moveTo(Math.round(o.x) + 0.5, 0);
  g.lineTo(Math.round(o.x) + 0.5, v.height);
  g.stroke();
}

export function drawUnderlay(p: Painter, img: CanvasImageSource, u: LevelUnderlay): void {
  const g = p.g;
  p.world();
  g.save();
  g.globalAlpha = Math.max(0, Math.min(1, u.opacity));
  g.translate(u.x, u.y);
  g.rotate((u.rotation * Math.PI) / 180);
  g.scale(u.mmPerPixel, -u.mmPerPixel);
  g.imageSmoothingEnabled = true;
  g.drawImage(img, 0, 0);
  g.restore();
}

const SNAP_LABEL: Partial<Record<SnapKind, string>> = {
  endpoint: 'Endpoint',
  midpoint: 'Midpoint',
  intersection: 'Intersection',
  center: 'Center',
  perpendicular: 'Perpendicular',
  nearest: 'On wall',
  alignment: 'Aligned',
  extension: 'Extension',
};

function snapGlyph(p: Painter, s: Vec2, kind: SnapKind): void {
  const g = p.g;
  const r = 6;
  const shape = () => {
    g.beginPath();
    switch (kind) {
      case 'endpoint':
        g.rect(s.x - r, s.y - r, r * 2, r * 2);
        break;
      case 'midpoint':
        g.moveTo(s.x, s.y - r - 1);
        g.lineTo(s.x + r + 1, s.y + r);
        g.lineTo(s.x - r - 1, s.y + r);
        g.closePath();
        break;
      case 'intersection':
        g.moveTo(s.x - r, s.y - r);
        g.lineTo(s.x + r, s.y + r);
        g.moveTo(s.x + r, s.y - r);
        g.lineTo(s.x - r, s.y + r);
        break;
      case 'center':
        g.arc(s.x, s.y, r, 0, Math.PI * 2);
        break;
      case 'perpendicular':
        g.moveTo(s.x - r, s.y + r);
        g.lineTo(s.x + r, s.y + r);
        g.moveTo(s.x - r, s.y + r);
        g.lineTo(s.x - r, s.y - r);
        g.moveTo(s.x - r, s.y);
        g.lineTo(s.x, s.y);
        g.lineTo(s.x, s.y + r);
        break;
      case 'nearest':
        g.moveTo(s.x - r, s.y - r);
        g.lineTo(s.x + r, s.y - r);
        g.lineTo(s.x - r, s.y + r);
        g.lineTo(s.x + r, s.y + r);
        g.closePath();
        break;
      case 'grid':
        g.moveTo(s.x - 4, s.y);
        g.lineTo(s.x + 4, s.y);
        g.moveTo(s.x, s.y - 4);
        g.lineTo(s.x, s.y + 4);
        break;
      default:
        g.moveTo(s.x - 4, s.y - 4);
        g.lineTo(s.x + 4, s.y + 4);
        g.moveTo(s.x + 4, s.y - 4);
        g.lineTo(s.x - 4, s.y + 4);
    }
  };
  shape();
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 4;
  g.stroke();
  shape();
  g.strokeStyle = kind === 'grid' ? 'rgba(60,70,85,0.8)' : UI.snap;
  g.lineWidth = 1.7;
  g.stroke();
  const label = SNAP_LABEL[kind];
  if (label) p.textScreen({ x: s.x + 11, y: s.y + 15 }, label, { size: 10.5, weight: 600, color: '#b26200', align: 'left', halo: 'rgba(255,255,255,0.95)' });
}

export function drawPill(p: Painter, s: Vec2, text: string, tone: Tone = 'info', subText?: string): void {
  const g = p.g;
  p.screen();
  const size = 11.5;
  const w1 = p.measure(text, size, 650);
  const w2 = subText ? p.measure(subText, 10.5, 500) + 8 : 0;
  const w = w1 + w2 + 14;
  const h = 21;
  const x = Math.round(s.x);
  const y = Math.round(s.y - h / 2);
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.18)';
  g.shadowBlur = 6;
  g.shadowOffsetY = 1;
  p.roundRect(x, y, w, h, 6);
  g.fillStyle = TONE_BG[tone];
  g.fill();
  g.restore();
  p.textScreen({ x: x + 7, y: y + h / 2 + 0.5 }, text, { size, weight: 650, color: '#fff', align: 'left' });
  if (subText) p.textScreen({ x: x + 7 + w1 + 8, y: y + h / 2 + 0.5 }, subText, { size: 10.5, weight: 500, color: 'rgba(255,255,255,0.72)', align: 'left' });
}

export function drawOverlay(p: Painter, items: OverlayItem[], _units: UnitSystem): void {
  const g = p.g;
  const v = p.view;
  // Geometry first, glyphs and pills last (on top).
  for (const it of items) {
    switch (it.t) {
      case 'guide': {
        p.screen();
        const a = v.toScreen(it.a);
        const b = v.toScreen(it.b);
        const d = normalize(sub(b, a));
        const len = distance(a, b);
        const ext = len > 0.5 ? add(b, scale(d, 40)) : b;
        g.setLineDash([5, 4]);
        g.lineWidth = 1;
        g.strokeStyle = UI.guide;
        g.beginPath();
        g.moveTo(a.x, a.y);
        g.lineTo(ext.x, ext.y);
        g.stroke();
        g.setLineDash([]);
        g.beginPath();
        g.moveTo(a.x - 3, a.y - 3);
        g.lineTo(a.x + 3, a.y + 3);
        g.moveTo(a.x + 3, a.y - 3);
        g.lineTo(a.x - 3, a.y + 3);
        g.stroke();
        break;
      }
      case 'line': {
        p.world();
        g.strokeStyle = it.color ?? UI.accent;
        p.lw(it.width ?? 1.2);
        p.dash(it.dash ?? null);
        p.line(it.a, it.b);
        p.dash(null);
        break;
      }
      case 'poly': {
        if (it.pts.length < 2) break;
        p.world();
        p.path(it.pts, it.closed ?? true);
        if (it.fill) {
          g.fillStyle = it.fill;
          g.fill();
        }
        g.strokeStyle = it.color ?? UI.accent;
        p.lw(it.width ?? 1.2);
        p.dash(it.dash ?? null);
        g.stroke();
        p.dash(null);
        break;
      }
      case 'arc': {
        p.world();
        g.strokeStyle = it.color ?? UI.guide;
        p.lw(1);
        g.setLineDash([]);
        g.beginPath();
        g.arc(it.c.x, it.c.y, p.px(it.r), (it.a0 * Math.PI) / 180, (it.a1 * Math.PI) / 180, it.a1 < it.a0);
        g.stroke();
        break;
      }
      case 'point': {
        p.screen();
        const s = v.toScreen(it.p);
        g.beginPath();
        g.arc(s.x, s.y, it.r ?? 3.5, 0, Math.PI * 2);
        g.fillStyle = it.color ?? UI.accent;
        g.fill();
        g.strokeStyle = '#fff';
        g.lineWidth = 1.5;
        g.stroke();
        break;
      }
      case 'box': {
        p.screen();
        const x = Math.min(it.a.x, it.b.x);
        const y = Math.min(it.a.y, it.b.y);
        const w = Math.abs(it.a.x - it.b.x);
        const h = Math.abs(it.a.y - it.b.y);
        const win = it.mode === 'window';
        g.fillStyle = win ? 'rgba(47,124,246,0.08)' : 'rgba(18,161,80,0.08)';
        g.fillRect(x, y, w, h);
        g.strokeStyle = win ? 'rgba(47,124,246,0.9)' : 'rgba(18,161,80,0.9)';
        g.lineWidth = 1;
        g.setLineDash(win ? [] : [5, 3]);
        g.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
        g.setLineDash([]);
        break;
      }
      case 'dim':
        drawLiveDim(p, it.a, it.b, it.offset, it.text, it.tone ?? 'accent');
        break;
      default:
        break;
    }
  }
  for (const it of items) {
    if (it.t === 'snap') {
      p.screen();
      snapGlyph(p, v.toScreen(it.p), it.kind);
    }
  }
  for (const it of items) {
    if (it.t === 'tag') {
      const s = v.toScreen(it.p);
      drawPill(p, { x: s.x + (it.dx ?? 14), y: s.y + (it.dy ?? -18) }, it.text, it.tone ?? 'info', it.sub);
    }
  }
}

export function drawLiveDim(p: Painter, a: Vec2, b: Vec2, offsetPx: number, text: string, tone: Tone): void {
  const v = p.view;
  const g = p.g;
  const sa = v.toScreen(a);
  const sb = v.toScreen(b);
  const len = distance(sa, sb);
  if (len < 4) return;
  p.screen();
  const d = normalize(sub(sb, sa));
  // Screen-space left normal (y down → rotate the other way).
  const n = { x: d.y, y: -d.x };
  const o = scale(n, offsetPx);
  const a2 = add(sa, o);
  const b2 = add(sb, o);
  g.strokeStyle = 'rgba(37,108,225,0.85)';
  g.lineWidth = 1;
  g.setLineDash([]);
  g.beginPath();
  g.moveTo(sa.x + n.x * 3 * Math.sign(offsetPx), sa.y + n.y * 3 * Math.sign(offsetPx));
  g.lineTo(a2.x + n.x * 4 * Math.sign(offsetPx), a2.y + n.y * 4 * Math.sign(offsetPx));
  g.moveTo(sb.x + n.x * 3 * Math.sign(offsetPx), sb.y + n.y * 3 * Math.sign(offsetPx));
  g.lineTo(b2.x + n.x * 4 * Math.sign(offsetPx), b2.y + n.y * 4 * Math.sign(offsetPx));
  g.moveTo(a2.x, a2.y);
  g.lineTo(b2.x, b2.y);
  g.stroke();
  const tk = scale(normalize(add(d, n)), 4.5);
  g.lineWidth = 1.6;
  g.beginPath();
  for (const q of [a2, b2]) {
    g.moveTo(q.x - tk.x, q.y - tk.y);
    g.lineTo(q.x + tk.x, q.y + tk.y);
  }
  g.stroke();
  const mid = scale(add(a2, b2), 0.5);
  const w = p.measure(text, 11.5, 650) + 14;
  drawPill(p, { x: mid.x - w / 2 + n.x * 2, y: mid.y + n.y * 2 }, text, tone);
}

export function drawHandles(p: Painter, handles: Handle[], hotId: string | null): void {
  const g = p.g;
  const v = p.view;
  p.screen();
  g.setLineDash([]);
  for (const h of handles) {
    const s = v.toScreen(h.p);
    const hot = h.id === hotId;
    const r = h.shape === 'diamond' ? 4.5 : hot ? 6 : 5;
    g.beginPath();
    if (h.shape === 'circle') g.arc(s.x, s.y, r, 0, Math.PI * 2);
    else if (h.shape === 'diamond') {
      g.moveTo(s.x, s.y - r);
      g.lineTo(s.x + r, s.y);
      g.lineTo(s.x, s.y + r);
      g.lineTo(s.x - r, s.y);
      g.closePath();
    } else g.rect(Math.round(s.x - r) + 0.5, Math.round(s.y - r) + 0.5, r * 2, r * 2);
    g.fillStyle = hot ? UI.accent : h.shape === 'diamond' ? 'rgba(47,124,246,0.55)' : UI.handleFill;
    g.fill();
    g.strokeStyle = h.shape === 'diamond' ? '#fff' : UI.accent;
    g.lineWidth = 1.5;
    g.stroke();
  }
}

export interface HudInfo {
  units: UnitSystem;
  cursor: Vec2 | null;
  northAngle: number;
}

export function drawHUD(p: Painter, info: HudInfo): void {
  const g = p.g;
  const v = p.view;
  p.screen();
  g.setLineDash([]);
  // Scale bar (bottom-left).
  const sb = scaleBar(v.scale, 120);
  const px = sb.length * v.scale;
  const x0 = 16;
  const y0 = v.height - 20;
  const seg = px / sb.divisions;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillRect(x0 - 6, y0 - 22, px + 12 + p.measure(shortLength(sb.length), 10.5, 600) + 6, 32);
  for (let i = 0; i < sb.divisions; i++) {
    g.fillStyle = i % 2 ? '#ffffff' : '#2b3340';
    g.fillRect(x0 + i * seg, y0, seg, 5);
  }
  g.strokeStyle = '#2b3340';
  g.lineWidth = 1;
  g.strokeRect(x0 + 0.5, y0 + 0.5, px, 5);
  p.textScreen({ x: x0, y: y0 - 8 }, '0', { size: 10.5, weight: 600, color: '#2b3340', align: 'center' });
  p.textScreen({ x: x0 + px, y: y0 - 8 }, shortLength(sb.length), { size: 10.5, weight: 600, color: '#2b3340', align: 'center' });

  // Cursor coordinates (bottom-right).
  if (info.cursor) {
    const t = `X ${formatLength(info.cursor.x, info.units)}   Y ${formatLength(info.cursor.y, info.units)}`;
    const w = p.measure(t, 11, 600) + 18;
    p.roundRect(v.width - w - 12, v.height - 32, w, 22, 6);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fill();
    g.strokeStyle = 'rgba(30,40,55,0.12)';
    g.stroke();
    p.textScreen({ x: v.width - w / 2 - 12, y: v.height - 21 }, t, { size: 11, weight: 600, color: '#2b3340' });
  }

  // North arrow (top-right).
  const c = { x: v.width - 30, y: 34 };
  g.save();
  g.translate(c.x, c.y);
  g.beginPath();
  g.arc(0, 0, 15, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,0.88)';
  g.fill();
  g.strokeStyle = 'rgba(30,40,55,0.25)';
  g.lineWidth = 1;
  g.stroke();
  g.rotate((-info.northAngle * Math.PI) / 180);
  g.beginPath();
  g.moveTo(0, -11);
  g.lineTo(5, 5);
  g.lineTo(0, 2);
  g.lineTo(-5, 5);
  g.closePath();
  g.fillStyle = '#2b3340';
  g.fill();
  g.restore();
  const nd = { x: -Math.sin((info.northAngle * Math.PI) / 180), y: -Math.cos((info.northAngle * Math.PI) / 180) };
  p.textScreen({ x: c.x + nd.x * 24, y: c.y + nd.y * 24 }, 'N', { size: 10, weight: 700, color: '#2b3340', halo: 'rgba(255,255,255,0.9)' });
}

