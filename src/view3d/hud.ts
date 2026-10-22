/**
 * DOM heads-up display over the 3D canvas: crosshair (fly), storey + elevation, camera mode,
 * compass, hovered-element card, tool hint, key legend, item-name popup, a floating measurement
 * label and the "Click to resume building" overlay shown while pointer lock is released.
 */
import type { ElementInfo } from './info';

export type HudMode = 'orbit' | 'fly' | 'walk';

const COMPASS_SVG = `
<svg viewBox="-32 -32 64 64" width="64" height="64" aria-hidden="true">
  <circle r="29" class="v3d-compass-bg"/>
  <g class="v3d-compass-dial">
    <circle r="23" class="v3d-compass-ring"/>
    ${Array.from({ length: 16 }, (_, i) => {
      const a = (i * Math.PI) / 8;
      const r0 = i % 4 === 0 ? 17 : 20;
      return `<line x1="${(Math.sin(a) * r0).toFixed(2)}" y1="${(-Math.cos(a) * r0).toFixed(2)}" x2="${(Math.sin(a) * 23).toFixed(2)}" y2="${(-Math.cos(a) * 23).toFixed(2)}" class="v3d-compass-tick"/>`;
    }).join('')}
    <path d="M0,-15 L4.2,0 L0,-2.5 L-4.2,0 Z" class="v3d-compass-north"/>
    <path d="M0,15 L4.2,0 L0,2.5 L-4.2,0 Z" class="v3d-compass-south"/>
    <text y="-24.5" class="v3d-compass-n">N</text>
    <text x="26" y="3.5" class="v3d-compass-l">E</text>
    <text y="31" class="v3d-compass-l">S</text>
    <text x="-26" y="3.5" class="v3d-compass-l">W</text>
  </g>
</svg>`;

const KEYS: Record<HudMode, string> = {
  orbit: 'F fly · E inventory · RMB place · LMB break · MMB pick · RMB-drag orbit · MMB-drag pan · wheel zoom',
  fly: 'F orbit · E inventory · RMB place · LMB break · MMB pick · WASD move · Space/Shift up/down · Ctrl sprint · 2×Space walk · wheel hotbar',
  walk: 'F orbit · E inventory · RMB place · LMB break · MMB pick · WASD walk · Space jump · Ctrl sprint · 2×Space fly · wheel hotbar',
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  parent?.appendChild(e);
  return e;
}

export class Hud {
  readonly root: HTMLDivElement;
  private readonly crosshair: HTMLDivElement;
  private readonly levelName: HTMLSpanElement;
  private readonly levelElev: HTMLSpanElement;
  private readonly modeChip: HTMLDivElement;
  private readonly dial: SVGGElement | null;
  private readonly info: HTMLDivElement;
  private readonly infoTitle: HTMLDivElement;
  private readonly infoSub: HTMLDivElement;
  private readonly infoDetails: HTMLDivElement;
  private readonly toolHint: HTMLDivElement;
  private readonly keys: HTMLDivElement;
  private readonly item: HTMLDivElement;
  private readonly label: HTMLDivElement;
  private readonly overlay: HTMLDivElement;
  private itemTimer: ReturnType<typeof setTimeout> | null = null;
  private lastHeading = NaN;
  private lastLabel = '';

  constructor(container: HTMLElement, onResume: () => void) {
    this.root = el('div', 'v3d-hud', container);
    this.crosshair = el('div', 'v3d-crosshair', this.root);
    const tl = el('div', 'v3d-topleft', this.root);
    const lvl = el('div', 'v3d-chip v3d-level', tl);
    lvl.title = 'Active level';
    this.levelName = el('span', 'v3d-level-name', lvl);
    this.levelElev = el('span', 'v3d-level-elev', lvl);
    this.modeChip = el('div', 'v3d-chip v3d-mode', tl);
    this.toolHint = el('div', 'v3d-toolhint', tl);
    this.info = el('div', 'v3d-info', tl);
    this.infoTitle = el('div', 'v3d-info-title', this.info);
    this.infoSub = el('div', 'v3d-info-sub', this.info);
    this.infoDetails = el('div', 'v3d-info-details', this.info);
    const compass = el('div', 'v3d-compass', this.root);
    compass.title = 'North';
    compass.innerHTML = COMPASS_SVG;
    this.dial = compass.querySelector('.v3d-compass-dial');
    this.keys = el('div', 'v3d-keys', this.root);
    this.item = el('div', 'v3d-item', this.root);
    this.label = el('div', 'v3d-label', this.root);
    this.overlay = el('div', 'v3d-overlay', this.root);
    this.overlay.innerHTML = `<div class="v3d-overlay-card"><div class="v3d-overlay-title">Click to resume building</div><div class="v3d-overlay-sub">Esc releases the mouse · F switches to orbit view</div></div>`;
    this.overlay.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onResume();
    });
    this.overlay.addEventListener('contextmenu', (e) => e.preventDefault());
    this.setMode('orbit');
    this.setHover(null);
    this.showOverlay(false);
  }

  setMode(mode: HudMode): void {
    this.root.dataset.mode = mode;
    this.modeChip.textContent = mode === 'orbit' ? 'Orbit' : mode === 'fly' ? 'Flying' : 'Walking';
    this.crosshair.style.display = mode === 'orbit' ? 'none' : '';
    this.keys.textContent = KEYS[mode];
  }

  setLevel(name: string, elevation: string): void {
    this.levelName.textContent = name;
    this.levelElev.textContent = elevation;
  }

  setHover(info: ElementInfo | null): void {
    if (!info) {
      this.info.classList.remove('v3d-show');
      return;
    }
    this.infoTitle.textContent = info.title;
    this.infoSub.textContent = info.subtitle;
    this.infoSub.style.display = info.subtitle ? '' : 'none';
    this.infoDetails.replaceChildren(
      ...info.details.map((d) => {
        const row = document.createElement('div');
        row.textContent = d;
        return row;
      }),
    );
    this.info.classList.add('v3d-show');
  }

  /** Compass heading, degrees clockwise from north. */
  setHeading(deg: number): void {
    if (Math.abs(deg - this.lastHeading) < 0.2) return;
    this.lastHeading = deg;
    this.dial?.setAttribute('transform', `rotate(${(-deg).toFixed(1)})`);
  }

  setToolHint(text: string): void {
    if (this.toolHint.textContent === text) return;
    this.toolHint.textContent = text;
    this.toolHint.classList.toggle('v3d-show', !!text);
  }

  /** Briefly show the name of the item in hand (Minecraft style). */
  showItem(name: string): void {
    this.item.textContent = name;
    this.item.classList.add('v3d-show');
    if (this.itemTimer) clearTimeout(this.itemTimer);
    this.itemTimer = setTimeout(() => this.item.classList.remove('v3d-show'), 1600);
  }

  /** Floating label at container pixel coordinates (null hides it). */
  setLabel(text: string | null, x = 0, y = 0): void {
    if (!text) {
      if (this.lastLabel) {
        this.label.classList.remove('v3d-show');
        this.lastLabel = '';
      }
      return;
    }
    if (text !== this.lastLabel) {
      this.label.textContent = text;
      this.lastLabel = text;
    }
    this.label.classList.add('v3d-show');
    this.label.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -120%)`;
  }

  showOverlay(v: boolean): void {
    this.overlay.classList.toggle('v3d-show', v);
  }

  get overlayVisible(): boolean {
    return this.overlay.classList.contains('v3d-show');
  }

  dispose(): void {
    if (this.itemTimer) clearTimeout(this.itemTimer);
    this.root.remove();
  }
}
