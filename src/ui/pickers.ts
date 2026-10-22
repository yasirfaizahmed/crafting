/**
 * Popover pickers for the Properties panel: materials (swatches by category) and furniture models.
 */
import { CATEGORY_LABELS, FURNITURE, type FurnitureDef } from '../core/catalog';
import { getMaterial, hasMaterial, materialsByCategory, type MaterialCategory, type MaterialDef } from '../core/materials';
import { h } from './dom';
import { icon } from './icons';
import { materialSwatchBackground } from './item-tile';

const MATERIAL_CATEGORY_LABELS: Record<MaterialCategory, string> = {
  masonry: 'Masonry',
  concrete: 'Concrete',
  wood: 'Wood',
  metal: 'Metal',
  glass: 'Glass',
  stone: 'Stone',
  tile: 'Tile',
  paint: 'Paint & Plaster',
  fabric: 'Fabric & Leather',
  roofing: 'Roofing',
  ground: 'Ground & Landscape',
  plastic: 'Plastic & Ceramic',
  light: 'Light',
};

let openClose: (() => void) | null = null;

/** Close any open picker popover. */
export function closePicker(): void {
  openClose?.();
}

function openPopover(anchor: HTMLElement, content: HTMLElement, cls: string, onClose?: () => void): () => void {
  closePicker();
  const pop = h('div', { class: `cr-popover ${cls}`, role: 'dialog', 'aria-label': anchor.getAttribute('aria-label') ?? 'Picker' }, content);
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  const vw = window.innerWidth || 1024;
  const vh = window.innerHeight || 768;
  const w = Math.min(340, vw - 16);
  pop.style.width = `${w}px`;
  const left = Math.max(8, Math.min(r.right - w, vw - w - 8));
  pop.style.left = `${left}px`;
  const below = vh - r.bottom;
  if (below < 300 && r.top > below) {
    pop.style.bottom = `${vh - r.top + 4}px`;
    pop.style.maxHeight = `${Math.max(160, r.top - 16)}px`;
  } else {
    pop.style.top = `${r.bottom + 4}px`;
    pop.style.maxHeight = `${Math.max(160, below - 16)}px`;
  }
  const onDown = (e: PointerEvent) => {
    if (!pop.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      anchor.focus();
    }
  };
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    pop.remove();
    anchor.setAttribute('aria-expanded', 'false');
    if (openClose === close) openClose = null;
    onClose?.();
  };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  anchor.setAttribute('aria-expanded', 'true');
  openClose = close;
  return close;
}

export interface PickerOptions {
  value: string | undefined;
  /** Offer an "inherit" choice with this label (value undefined). */
  optionalLabel?: string;
  onPick(value: string | undefined): void;
}

export function materialSwatch(mat: MaterialDef | undefined, cls = ''): HTMLElement {
  const sw = h('span', { class: `cr-swatch ${cls}`.trim(), 'aria-hidden': 'true' });
  if (mat) sw.style.background = materialSwatchBackground(mat);
  else sw.classList.add('is-none');
  return sw;
}

export function openMaterialPicker(anchor: HTMLElement, opts: PickerOptions): () => void {
  const search = h('input', { class: 'cr-input', type: 'search', placeholder: 'Search materials…', 'aria-label': 'Search materials' });
  const list = h('div', { class: 'cr-picker-list' });
  const content = h('div', { class: 'cr-picker' }, h('label', { class: 'cr-search-field' }, icon('search'), search), list);
  const close = openPopover(anchor, content, 'cr-material-popover');
  const pick = (v: string | undefined) => {
    close();
    opts.onPick(v);
    anchor.focus();
  };
  const render = () => {
    const q = search.value.trim().toLowerCase();
    list.textContent = '';
    if (opts.optionalLabel && !q) {
      const b = h('button', { class: `cr-picker-none ${opts.value === undefined ? 'is-on' : ''}`, type: 'button' }, materialSwatch(undefined), opts.optionalLabel);
      b.addEventListener('click', () => pick(undefined));
      list.appendChild(b);
    }
    for (const [cat, mats] of materialsByCategory()) {
      const hits = mats.filter((m) => !q || m.name.toLowerCase().includes(q) || cat.includes(q) || m.id.includes(q));
      if (!hits.length) continue;
      const grid = h('div', { class: 'cr-swatch-grid' });
      for (const m of hits) {
        const b = h(
          'button',
          { class: `cr-swatch-btn ${m.id === opts.value ? 'is-on' : ''}`, type: 'button', title: m.name, 'aria-label': m.name, 'data-material': m.id },
          materialSwatch(m),
          h('span', { class: 'cr-swatch-name' }, m.name.replace(/^[^—]*—\s*/, '')),
        );
        b.addEventListener('click', () => pick(m.id));
        grid.appendChild(b);
      }
      list.append(h('div', { class: 'cr-picker-cat' }, MATERIAL_CATEGORY_LABELS[cat] ?? cat), grid);
    }
    if (!list.children.length) list.appendChild(h('div', { class: 'cr-empty' }, 'No materials match.'));
  };
  search.addEventListener('input', render);
  render();
  setTimeout(() => {
    const on = list.querySelector<HTMLElement>('.is-on');
    on?.scrollIntoView?.({ block: 'center' });
    search.focus();
  }, 0);
  return close;
}

export function openFurniturePicker(anchor: HTMLElement, opts: PickerOptions): () => void {
  const search = h('input', { class: 'cr-input', type: 'search', placeholder: 'Search furniture…', 'aria-label': 'Search furniture' });
  const list = h('div', { class: 'cr-picker-list' });
  const content = h('div', { class: 'cr-picker' }, h('label', { class: 'cr-search-field' }, icon('search'), search), list);
  const close = openPopover(anchor, content, 'cr-furniture-popover');
  const render = () => {
    const q = search.value.trim().toLowerCase();
    list.textContent = '';
    const byCat = new Map<FurnitureDef['category'], FurnitureDef[]>();
    for (const f of FURNITURE) {
      if (q && !f.name.toLowerCase().includes(q) && !f.category.includes(q)) continue;
      byCat.set(f.category, [...(byCat.get(f.category) ?? []), f]);
    }
    for (const [cat, defs] of byCat) {
      const grid = h('div', { class: 'cr-furn-grid' });
      for (const f of defs) {
        const b = h(
          'button',
          { class: `cr-furn-btn ${f.id === opts.value ? 'is-on' : ''}`, type: 'button', title: f.name, 'data-furniture': f.id },
          h('span', { class: 'cr-furn-ic', 'aria-hidden': 'true' }, f.icon),
          h('span', { class: 'cr-furn-name' }, f.name),
        );
        b.addEventListener('click', () => {
          close();
          opts.onPick(f.id);
          anchor.focus();
        });
        grid.appendChild(b);
      }
      list.append(h('div', { class: 'cr-picker-cat' }, CATEGORY_LABELS[cat]), grid);
    }
    if (!list.children.length) list.appendChild(h('div', { class: 'cr-empty' }, 'No furniture matches.'));
  };
  search.addEventListener('input', render);
  render();
  setTimeout(() => search.focus(), 0);
  return close;
}

/** Label for a material id (or the optional label when unset). */
export function materialLabel(id: string | undefined, optionalLabel = 'Default'): string {
  return id && hasMaterial(id) ? getMaterial(id).name : optionalLabel;
}
