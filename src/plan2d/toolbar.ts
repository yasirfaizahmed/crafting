/**
 * Floating plan toolbar (top-left overlay): level chip with level switcher, zoom, snap toggles and
 * the blueprint workflow buttons (Generate 3D with options, Add floor above, Trace image), plus a
 * contextual bar for the blueprint image of the active level.
 */
import type { RoofShape } from '../core/types';
import { formatLength } from '../core/units';
import { importUnderlay, runAddFloor, runGenerate3D, setUnderlay } from './commands';
import type { PlanEditor } from './editor';
import { rotateUnderlay } from './underlay';

const svg = (d: string, extra = '') =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}${extra}</svg>`;

export const ICONS = {
  grid: svg('<path d="M2.5 2.5h11v11h-11zM6.2 2.5v11M9.8 2.5v11M2.5 6.2h11M2.5 9.8h11"/>'),
  magnet: svg('<path d="M3 2.5h3v5.5a2 2 0 0 0 4 0V2.5h3V8a5 5 0 0 1-10 0z"/><path d="M3 5.2h3M10 5.2h3"/>'),
  angle: svg('<path d="M2 13.5h12M2 13.5 11.5 4"/><path d="M7 13.5a5 5 0 0 0-1.6-3.6"/>'),
  cube: svg('<path d="M8 1.8 13.8 5v6L8 14.2 2.2 11V5z"/><path d="M2.2 5 8 8.2 13.8 5M8 8.2v6"/>'),
  layers: svg('<path d="M7 2.2 12.5 5 7 7.8 1.5 5z"/><path d="M1.5 8.6 7 11.4l2-1"/><path d="M12.5 9.5v5M10 12h5"/>'),
  image: svg('<rect x="2" y="3" width="12" height="10" rx="1.6"/><circle cx="6" cy="6.6" r="1.2"/><path d="m2.6 12 3.9-3.8 2.8 2.7 1.9-1.8 2.3 2.3"/>'),
  fit: svg('<path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/>'),
  plus: svg('<path d="M8 3.5v9M3.5 8h9"/>'),
  minus: svg('<path d="M3.5 8h9"/>'),
  caret: svg('<path d="m4.5 6.5 3.5 3.5 3.5-3.5"/>'),
  eye: svg('<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
  ruler: svg('<path d="m2 11 9-9 3 3-9 9z"/><path d="m5 8 1.4 1.4M7 6l1.4 1.4M9 4l1.4 1.4"/>'),
  move: svg('<path d="M8 1.8v12.4M1.8 8h12.4M8 1.8 6.2 3.6M8 1.8l1.8 1.8M8 14.2l-1.8-1.8M8 14.2l1.8-1.8M1.8 8l1.8-1.8M1.8 8l1.8 1.8M14.2 8l-1.8-1.8M14.2 8l-1.8 1.8"/>'),
  rotL: svg('<path d="M3 8a5 5 0 1 0 1.5-3.5M3 2.2v3h3"/>'),
  rotR: svg('<path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.2v3h-3"/>'),
  trash: svg('<path d="M3 4.2h10M6.2 4.2V2.6h3.6v1.6M4.5 4.2l.7 9.2h5.6l.7-9.2"/>'),
  stack: svg('<path d="M8 2 14 5 8 8 2 5z"/><path d="m2 8 6 3 6-3M2 11l6 3 6-3"/>'),
};

const ROOFS: { id: RoofShape | 'none'; label: string }[] = [
  { id: 'gable', label: 'Gable' },
  { id: 'hip', label: 'Hip' },
  { id: 'shed', label: 'Shed' },
  { id: 'pyramid', label: 'Pyramid' },
  { id: 'flat', label: 'Flat' },
  { id: 'none', label: 'No roof' },
];

/** "±0.000", "+3.000", "−1.200" (metres, architectural level marker style). */
export function formatElevation(mm: number, units: 'metric' | 'imperial' = 'metric'): string {
  if (units === 'imperial') return `${mm >= 0 ? '+' : '−'}${formatLength(Math.abs(mm), 'imperial')}`;
  if (Math.abs(mm) < 0.5) return '±0.000';
  return `${mm > 0 ? '+' : '−'}${(Math.abs(mm) / 1000).toFixed(3)}`;
}

export class Toolbar {
  readonly el: HTMLDivElement;
  private ubar: HTMLDivElement;
  private banner: HTMLDivElement;
  private top: HTMLDivElement;
  private pop: HTMLDivElement | null = null;
  private offView: () => void;
  private onDocDown = (e: PointerEvent) => {
    if (this.pop && !this.pop.contains(e.target as Node) && !(e.target as HTMLElement).closest?.('[data-pop]')) this.closePop();
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.pop) {
      this.closePop();
      e.preventDefault();
      e.stopPropagation();
      this.ed.root.focus({ preventScroll: true });
    }
  };

  constructor(private ed: PlanEditor) {
    const el = (this.el = document.createElement('div'));
    el.className = 'p2d-toolbar';
    el.innerHTML = `
      <div class="p2d-group p2d-level-group">
        <button class="p2d-level" data-pop="levels" title="Active level — click to switch">
          <span class="p2d-level-name"></span><span class="p2d-level-elev"></span>${ICONS.caret}
        </button>
      </div>
      <div class="p2d-group">
        <button class="p2d-icon" data-act="zoom-out" title="Zoom out">${ICONS.minus}</button>
        <button class="p2d-zoom" data-act="fit" title="Zoom to fit (Home)"></button>
        <button class="p2d-icon" data-act="zoom-in" title="Zoom in">${ICONS.plus}</button>
      </div>
      <div class="p2d-group p2d-snaps" role="group" aria-label="Snapping">
        <button class="p2d-toggle" data-toggle="snapGrid" title="Snap to grid (G)">${ICONS.grid}<span>Grid</span></button>
        <button class="p2d-toggle" data-toggle="snapObjects" title="Snap to walls, ends, midpoints and alignment guides">${ICONS.magnet}<span>Snap</span></button>
        <button class="p2d-toggle" data-toggle="snapAngle" title="15° angle snap (hold Shift to draw freely)">${ICONS.angle}<span>15°</span></button>
      </div>
      <div class="p2d-group p2d-actions">
        <div class="p2d-split">
          <button class="p2d-btn p2d-primary" data-act="generate" title="Generate rooms, floors, foundation and roof from the walls (one undo step)">${ICONS.cube}<span>Generate 3D</span></button>
          <button class="p2d-btn p2d-primary p2d-caret" data-pop="generate" title="Generate options">${ICONS.caret}</button>
        </div>
        <div class="p2d-split">
          <button class="p2d-btn" data-act="add-floor" title="Add a level above this one with copies of its exterior walls">${ICONS.layers}<span>Add floor above</span></button>
          <button class="p2d-btn p2d-caret" data-pop="floor" title="Add floor options">${ICONS.caret}</button>
        </div>
        <button class="p2d-btn" data-act="trace" title="Place a scanned blueprint image under this level to trace over">${ICONS.image}<span>Trace image</span></button>
      </div>`;
    this.ubar = document.createElement('div');
    this.ubar.className = 'p2d-underlay-bar';
    this.ubar.innerHTML = `
      <span class="p2d-ubar-title">${ICONS.image}<span>Blueprint</span></span>
      <button class="p2d-icon p2d-toggle" data-uact="visible" title="Show / hide the image">${ICONS.eye}</button>
      <label class="p2d-opacity" title="Image opacity"><input type="range" min="5" max="100" step="5" data-uact="opacity" aria-label="Image opacity"><span></span></label>
      <button class="p2d-btn" data-uact="calibrate" title="Set the scale: click two points of a known distance">${ICONS.ruler}<span>Calibrate</span></button>
      <button class="p2d-btn p2d-toggle" data-uact="move" title="Drag the image into place">${ICONS.move}<span>Move</span></button>
      <button class="p2d-icon" data-uact="rotl" title="Rotate 90° left">${ICONS.rotL}</button>
      <button class="p2d-icon" data-uact="rotr" title="Rotate 90° right">${ICONS.rotR}</button>
      <button class="p2d-icon" data-uact="remove" title="Remove the image">${ICONS.trash}</button>`;
    this.banner = document.createElement('div');
    this.banner.className = 'p2d-banner';
    this.top = document.createElement('div');
    this.top.className = 'p2d-top';
    this.top.append(el, this.ubar);
    ed.root.append(this.top, this.banner);
    for (const n of [el, this.ubar, this.banner]) {
      // The toolbar is part of the plan: keep pointer events away from the canvas.
      n.addEventListener('pointerdown', (e) => e.stopPropagation());
      n.addEventListener('wheel', (e) => e.stopPropagation());
    }
    el.addEventListener('click', (e) => this.onClick(e));
    this.ubar.addEventListener('click', (e) => this.onUnderlayClick(e));
    const range = this.ubar.querySelector<HTMLInputElement>('input[type=range]')!;
    range.addEventListener('input', () => {
      const u = ed.level.underlay;
      if (!u) return;
      ed.underlayPreview = { ...u, opacity: Number(range.value) / 100 };
      this.ubar.querySelector('.p2d-opacity span')!.textContent = `${range.value}%`;
      ed.invalidate();
    });
    range.addEventListener('change', () => {
      ed.underlayPreview = null;
      setUnderlay(ed, { opacity: Number(range.value) / 100 }, 'Blueprint opacity');
    });
    range.addEventListener('keydown', (e) => e.stopPropagation());
    document.addEventListener('pointerdown', this.onDocDown, true);
    ed.root.addEventListener('keydown', this.onKey, true);
    this.offView = ed.onViewChange(() => this.update());
    this.update();
  }

  private onClick(e: MouseEvent): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!t) return;
    const ed = this.ed;
    const ui = ed.app.ui;
    if (t.dataset.toggle) {
      const k = t.dataset.toggle as 'snapGrid' | 'snapObjects' | 'snapAngle';
      ui.set({ [k]: !ui.get()[k] });
      return;
    }
    if (t.dataset.pop) {
      this.togglePop(t.dataset.pop, t);
      return;
    }
    switch (t.dataset.act) {
      case 'zoom-in':
        ed.zoomBy(1.4);
        break;
      case 'zoom-out':
        ed.zoomBy(1 / 1.4);
        break;
      case 'fit':
        ed.zoomToFit();
        break;
      case 'generate':
        runGenerate3D(ed);
        break;
      case 'add-floor':
        runAddFloor(ed, 'exterior');
        break;
      case 'trace':
        void importUnderlay(ed);
        break;
    }
    ed.root.focus({ preventScroll: true });
  }

  private onUnderlayClick(e: MouseEvent): void {
    const t = (e.target as HTMLElement).closest<HTMLElement>('button');
    const ed = this.ed;
    const u = ed.level.underlay;
    if (!t || !u) return;
    const size = ed.underlaySize() ?? { w: 1000, h: 1000 };
    switch (t.dataset.uact) {
      case 'visible':
        setUnderlay(ed, { visible: !u.visible }, u.visible ? 'Hide blueprint image' : 'Show blueprint image');
        break;
      case 'calibrate':
        ed.startCalibration();
        break;
      case 'move':
        if (ed.overrideActive === 'move-underlay') ed.endOverride();
        else ed.startMoveUnderlay();
        break;
      case 'rotl':
        ed.transact('Rotate blueprint image', (tx) => tx.updateLevel(ed.levelId, { underlay: rotateUnderlay(u, 90, size.w, size.h) }));
        break;
      case 'rotr':
        ed.transact('Rotate blueprint image', (tx) => tx.updateLevel(ed.levelId, { underlay: rotateUnderlay(u, -90, size.w, size.h) }));
        break;
      case 'remove':
        ed.endOverride();
        ed.transact('Remove blueprint image', (tx) => tx.updateLevel(ed.levelId, { underlay: undefined }));
        break;
    }
    this.update();
  }

  private togglePop(kind: string, anchor: HTMLElement): void {
    if (this.pop?.dataset.kind === kind) {
      this.closePop();
      return;
    }
    this.closePop();
    const pop = document.createElement('div');
    pop.className = 'p2d-popover';
    pop.dataset.kind = kind;
    pop.addEventListener('pointerdown', (e) => e.stopPropagation());
    pop.addEventListener('keydown', (e) => e.stopPropagation());
    if (kind === 'generate') this.fillGenerate(pop);
    else if (kind === 'floor') this.fillFloor(pop);
    else this.fillLevels(pop);
    this.ed.root.appendChild(pop);
    const r = anchor.getBoundingClientRect();
    const rr = this.ed.root.getBoundingClientRect();
    pop.style.left = `${Math.max(8, Math.min(r.left - rr.left, rr.width - 280))}px`;
    pop.style.top = `${r.bottom - rr.top + 6}px`;
    this.pop = pop;
  }

  closePop(): void {
    this.pop?.remove();
    this.pop = null;
  }

  private fillGenerate(pop: HTMLDivElement): void {
    const ed = this.ed;
    const o = ed.generateOptions;
    const check = (k: 'rooms' | 'floors' | 'ceilings' | 'foundation', label: string, hint: string) =>
      `<label class="p2d-check"><input type="checkbox" data-k="${k}" ${o[k] ? 'checked' : ''}><span>${label}<small>${hint}</small></span></label>`;
    pop.innerHTML = `
      <h4>Generate 3D from blueprint</h4>
      ${check('rooms', 'Rooms', 'Name every enclosed area')}
      ${check('floors', 'Floor slabs', 'Finish by room type (tiles in kitchens & baths)')}
      ${check('ceilings', 'Ceilings', 'Under the floor above / roof')}
      ${check('foundation', 'Foundation', 'Under the ground floor footprint')}
      <div class="p2d-row"><span>Roof</span><select data-k="roof">${ROOFS.map((r) => `<option value="${r.id}" ${o.roof === r.id ? 'selected' : ''}>${r.label}</option>`).join('')}</select>
        <input type="number" min="0" max="75" step="1" data-k="pitch" value="${o.roofPitch ?? ''}" placeholder="auto" title="Roof pitch (°)"><span>°</span></div>
      <div class="p2d-row"><span>Levels</span><select data-k="scope"><option value="all" ${ed.generateScope === 'all' ? 'selected' : ''}>All levels</option><option value="active" ${ed.generateScope === 'active' ? 'selected' : ''}>Active level only</option></select></div>
      <p class="p2d-note">Re-running replaces what was generated before. One undo step.</p>
      <button class="p2d-btn p2d-primary p2d-wide" data-go="1">${ICONS.cube}<span>Generate</span></button>`;
    const read = () => {
      const get = (k: string) => pop.querySelector<HTMLInputElement>(`[data-k=${k}]`)!;
      const pitch = parseFloat(get('pitch').value);
      ed.setGenerateOptions(
        {
          rooms: get('rooms').checked,
          floors: get('floors').checked,
          ceilings: get('ceilings').checked,
          foundation: get('foundation').checked,
          roof: (pop.querySelector<HTMLSelectElement>('[data-k=roof]')!.value as RoofShape | 'none') ?? 'gable',
          roofPitch: Number.isFinite(pitch) ? Math.min(75, Math.max(0, pitch)) : undefined,
        },
        pop.querySelector<HTMLSelectElement>('[data-k=scope]')!.value === 'active' ? 'active' : 'all',
      );
    };
    pop.addEventListener('change', read);
    pop.querySelector('[data-go]')!.addEventListener('click', () => {
      read();
      this.closePop();
      runGenerate3D(ed);
    });
  }

  private fillFloor(pop: HTMLDivElement): void {
    pop.innerHTML = `
      <h4>Add floor above</h4>
      <button class="p2d-menu-item" data-copy="exterior">${ICONS.layers}<span>Copy exterior walls<small>Outer walls and their windows</small></span></button>
      <button class="p2d-menu-item" data-copy="all">${ICONS.stack}<span>Copy all walls<small>Every wall with doors and windows</small></span></button>
      <button class="p2d-menu-item" data-copy="none">${ICONS.plus}<span>Empty floor<small>Start the level from scratch</small></span></button>`;
    pop.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-copy]');
      if (!b) return;
      this.closePop();
      runAddFloor(this.ed, b.dataset.copy as 'exterior' | 'all' | 'none');
    });
  }

  private fillLevels(pop: HTMLDivElement): void {
    const ed = this.ed;
    const ui = ed.app.ui.get();
    const levels = [...ed.app.store.project.levels].sort((a, b) => b.elevation - a.elevation);
    pop.innerHTML = `<h4>Levels</h4>${levels
      .map(
        (l) =>
          `<button class="p2d-menu-item ${l.id === ui.activeLevelId ? 'active' : ''}" data-level="${l.id}"><span>${escapeHtml(l.name)}<small>${formatElevation(l.elevation, ui.displayUnits)} · ${ed.app.store.elementsOnLevel(l.id).length} elements</small></span></button>`,
      )
      .join('')}
      <label class="p2d-check"><input type="checkbox" data-below ${ui.showLevelBelow ? 'checked' : ''}><span>Show level below<small>Faded under the active level</small></span></label>`;
    pop.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-level]');
      if (!b) return;
      ed.app.ui.set({ activeLevelId: b.dataset.level! });
      this.closePop();
    });
    pop.querySelector<HTMLInputElement>('[data-below]')!.addEventListener('change', (e) => ed.app.ui.set({ showLevelBelow: (e.target as HTMLInputElement).checked }));
  }

  update(): void {
    const ed = this.ed;
    const ui = ed.app.ui.get();
    const level = ed.level;
    this.el.querySelector('.p2d-level-name')!.textContent = level.name;
    this.el.querySelector('.p2d-level-elev')!.textContent = formatElevation(level.elevation, ui.displayUnits);
    const zoom = this.el.querySelector<HTMLElement>('.p2d-zoom')!;
    zoom.textContent = `${ed.view.zoomPercent}%`;
    zoom.title = `Zoom to fit (Home) · ≈ 1:${Math.round(ed.view.drawingScale)} on screen`;
    for (const b of this.el.querySelectorAll<HTMLElement>('[data-toggle]')) {
      const on = !!ui[b.dataset.toggle as 'snapGrid' | 'snapObjects' | 'snapAngle'];
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    this.el.classList.toggle('p2d-compact', ed.view.width < 980);
    this.el.classList.toggle('p2d-tiny', ed.view.width < 560);
    // Blueprint image bar.
    const u = ed.level.underlay;
    this.ubar.hidden = !u;
    if (u) {
      const range = this.ubar.querySelector<HTMLInputElement>('input[type=range]')!;
      if (!ed.underlayPreview) range.value = String(Math.round(u.opacity * 100));
      this.ubar.querySelector('.p2d-opacity span')!.textContent = `${range.value}%`;
      this.ubar.querySelector('[data-uact=visible]')!.classList.toggle('on', u.visible);
      this.ubar.querySelector('[data-uact=move]')!.classList.toggle('on', ed.overrideActive === 'move-underlay');
    }
    // Mode banner.
    const mode = ed.overrideActive;
    this.banner.hidden = !mode;
    if (mode) this.banner.innerHTML = mode === 'calibrate' ? `${ICONS.ruler}<span>Calibrating the blueprint — click two points of a known distance · <kbd>Esc</kbd> to stop</span>` : `${ICONS.move}<span>Moving the blueprint — drag the image · <kbd>Esc</kbd> when done</span>`;
  }

  dispose(): void {
    this.offView();
    document.removeEventListener('pointerdown', this.onDocDown, true);
    this.ed.root.removeEventListener('keydown', this.onKey, true);
    this.closePop();
    this.top.remove();
    this.banner.remove();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
