/**
 * Export dialog: every registered exporter grouped by kind, with the options that format uses
 * (levels, drawing scale, paper, orientation, content toggles, raster size / dpi).
 */
import { PAPER_SIZES, type PaperSize } from '../../drawing/types';
import { EXPORTERS, exportFilename, runExport, type ExportFormat, type ExportOptions, type Exporter } from '../../export';
import { downloadBlob } from '../../io';
import { errorMessage } from '../actions';
import { h, prefs } from '../dom';
import { formatElevation } from '../format';
import { icon } from '../icons';
import { levelsTopDown } from '../level-ops';
import type { Shell } from '../types';
import { openModal, type ModalHandle } from './modal';

export const KIND_LABELS: Record<Exporter['kind'], string> = {
  bim: 'BIM',
  '3d': '3D models',
  '2d': '2D drawings',
  image: 'Images',
  project: 'Project',
};
const KIND_ORDER: Exporter['kind'][] = ['bim', '2d', '3d', 'image', 'project'];
export const SCALES = [20, 50, 100, 200, 500];
export const PAPERS = Object.keys(PAPER_SIZES) as PaperSize[];
const PNG_SIZES: [number, number, string][] = [
  [1280, 720, 'HD 1280 × 720'],
  [1920, 1080, 'Full HD 1920 × 1080'],
  [2560, 1440, 'QHD 2560 × 1440'],
  [3840, 2160, '4K 3840 × 2160'],
  [1080, 1080, 'Square 1080 × 1080'],
];
const DPIS = [96, 150, 200, 300];

/** Which option groups a format uses. */
export function exportOptionGroups(e: Pick<Exporter, 'format' | 'kind'>): { levels: boolean; drawing: boolean; paper: boolean; content: boolean; pixels: boolean; dpi: boolean } {
  const two = e.kind === '2d' || e.format === 'png-plan';
  return {
    levels: e.kind !== 'project' && e.format !== 'png-3d',
    drawing: two,
    paper: e.format === 'pdf' || e.format === 'svg' || e.format === 'png-plan',
    content: two || e.kind === '3d' || e.kind === 'bim',
    pixels: e.format === 'png-3d',
    dpi: e.format === 'png-plan',
  };
}

/** Default level selection: 2D formats → the active level; 3D / BIM → every level. */
export function defaultExportLevels(e: Pick<Exporter, 'kind' | 'format'>, allLevelIds: string[], activeLevelId: string): string[] {
  return e.kind === '2d' || e.format === 'png-plan' ? [activeLevelId] : [...allLevelIds];
}

interface SavedOptions {
  format: ExportFormat;
  scale: number;
  paper: PaperSize;
  orientation: 'landscape' | 'portrait';
  includeFurniture: boolean;
  includeAnnotations: boolean;
  size: number;
  dpi: number;
}

const DEFAULTS: SavedOptions = {
  format: 'ifc',
  scale: 100,
  paper: 'A3',
  orientation: 'landscape',
  includeFurniture: true,
  includeAnnotations: true,
  size: 1,
  dpi: 150,
};

export function openExportDialog(shell: Shell, options: { format?: string } = {}): ModalHandle {
  const { store, ui } = shell.ctx;
  const saved: SavedOptions = { ...DEFAULTS, ...prefs.get<Partial<SavedOptions>>('export', {}) };
  const requested = EXPORTERS.find((e) => e.format === options.format);
  let current: Exporter = requested ?? EXPORTERS.find((e) => e.format === saved.format) ?? EXPORTERS[0];
  const levels = levelsTopDown(store.project);
  let levelIds = defaultExportLevels(current, levels.map((l) => l.id), ui.get().activeLevelId);

  // --- format list --------------------------------------------------------------
  const list = h('div', { class: 'cr-export-list', role: 'radiogroup', 'aria-label': 'Format' });
  const formatBtns = new Map<ExportFormat, HTMLButtonElement>();
  for (const kind of KIND_ORDER) {
    const group = EXPORTERS.filter((e) => e.kind === kind);
    if (!group.length) continue;
    list.appendChild(h('div', { class: 'cr-export-kind' }, KIND_LABELS[kind]));
    for (const e of group) {
      const b = h(
        'button',
        { class: 'cr-export-format', type: 'button', role: 'radio', 'data-format': e.format, 'aria-checked': 'false' },
        h('span', { class: 'cr-export-ext' }, e.extension.toUpperCase()),
        h('span', { class: 'cr-export-text' }, h('strong', null, e.label), h('span', null, e.description)),
      );
      b.addEventListener('click', () => select(e));
      formatBtns.set(e.format, b);
      list.appendChild(b);
    }
  }
  list.addEventListener('keydown', (ev) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const all = [...formatBtns.values()];
    const i = all.findIndex((b) => b.dataset.format === current.format);
    const next = all[(i + (ev.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length];
    next.focus();
    select(EXPORTERS.find((e) => e.format === next.dataset.format)!);
  });

  // --- options --------------------------------------------------------------------
  const field = (label: string, control: HTMLElement, hint?: string) =>
    h('label', { class: 'cr-field' }, h('span', { class: 'cr-field-label' }, label), control, hint ? h('span', { class: 'cr-field-hint' }, hint) : null);
  const selectEl = (opts: [string, string][], value: string) => {
    const s = h('select', { class: 'cr-select' });
    for (const [v, l] of opts) s.appendChild(h('option', { value: v }, l));
    s.value = value;
    return s;
  };
  const scale = selectEl(SCALES.map((s) => [String(s), `1:${s}`]), String(saved.scale));
  const paper = selectEl(PAPERS.map((p) => [p, `${p} — ${PAPER_SIZES[p][0]} × ${PAPER_SIZES[p][1]} mm`]), saved.paper);
  const orientation = selectEl([['landscape', 'Landscape'], ['portrait', 'Portrait']], saved.orientation);
  const size = selectEl(PNG_SIZES.map((p, i) => [String(i), p[2]] as [string, string]), String(saved.size));
  const dpi = selectEl(DPIS.map((d) => [String(d), `${d} dpi${d === 300 ? ' (print)' : d === 96 ? ' (screen)' : ''}`]), String(saved.dpi));
  const furn = h('input', { type: 'checkbox', checked: saved.includeFurniture });
  const anno = h('input', { type: 'checkbox', checked: saved.includeAnnotations });

  const levelList = h('div', { class: 'cr-check-list' });
  const levelBoxes = new Map<string, HTMLInputElement>();
  for (const l of levels) {
    const box = h('input', { type: 'checkbox', value: l.id });
    box.addEventListener('change', () => {
      levelIds = levels.filter((x) => levelBoxes.get(x.id)!.checked).map((x) => x.id);
      validate();
    });
    levelBoxes.set(l.id, box);
    levelList.appendChild(
      h('label', { class: 'cr-check' }, box, h('span', null, l.name), h('span', { class: 'cr-check-meta' }, formatElevation(l.elevation, ui.get().displayUnits))),
    );
  }
  const allBtn = h('button', { class: 'cr-link-btn', type: 'button' }, 'All');
  const activeBtn = h('button', { class: 'cr-link-btn', type: 'button' }, 'Active only');
  allBtn.addEventListener('click', () => setLevels(levels.map((l) => l.id)));
  activeBtn.addEventListener('click', () => setLevels([ui.get().activeLevelId]));
  const setLevels = (ids: string[]) => {
    levelIds = ids;
    levelBoxes.forEach((b, id) => (b.checked = ids.includes(id)));
    validate();
  };

  const sections = {
    levels: h('fieldset', { class: 'cr-fieldset' }, h('legend', null, 'Levels', h('span', { class: 'cr-legend-tools' }, allBtn, activeBtn)), levelList),
    drawing: h('fieldset', { class: 'cr-fieldset' }, h('legend', null, 'Drawing'), h('div', { class: 'cr-field-row' }, field('Scale', scale))),
    paper: h('fieldset', { class: 'cr-fieldset' }, h('legend', null, 'Sheet'), h('div', { class: 'cr-field-row' }, field('Paper size', paper), field('Orientation', orientation))),
    content: h(
      'fieldset',
      { class: 'cr-fieldset' },
      h('legend', null, 'Content'),
      h('label', { class: 'cr-check' }, furn, h('span', null, 'Furniture & fixtures')),
      h('label', { class: 'cr-check' }, anno, h('span', null, 'Annotations (dimensions, labels, room tags)')),
    ),
    pixels: h('fieldset', { class: 'cr-fieldset' }, h('legend', null, 'Image'), field('Size', size, 'Rendered from the current 3D camera')),
    dpi: h('fieldset', { class: 'cr-fieldset' }, h('legend', null, 'Resolution'), field('Print resolution', dpi)),
  };
  const noOptions = h('p', { class: 'cr-export-none' }, 'No options — the complete project is saved, ready to reopen in Crafting.');
  const heading = h('div', { class: 'cr-export-head' });
  const fileName = h('code', { class: 'cr-export-file' });
  const error = h('p', { class: 'cr-field-error', role: 'alert', hidden: true });
  const panel = h('div', { class: 'cr-export-options' }, heading, ...Object.values(sections), noOptions, error);

  const exportBtn = h('button', { class: 'cr-btn is-primary', type: 'button' }, icon('download'), 'Export');
  const cancelBtn = h('button', { class: 'cr-btn', type: 'button' }, 'Cancel');

  function validate(): boolean {
    const g = exportOptionGroups(current);
    const msg = g.levels && !levelIds.length ? 'Choose at least one level' : '';
    error.hidden = !msg;
    error.textContent = msg;
    exportBtn.disabled = !!msg;
    return !msg;
  }

  function select(e: Exporter): void {
    const kindChanged = e.kind !== current.kind || e.format === 'png-plan' || current.format === 'png-plan';
    current = e;
    if (kindChanged) setLevels(defaultExportLevels(e, levels.map((l) => l.id), ui.get().activeLevelId));
    formatBtns.forEach((b, f) => {
      const on = f === e.format;
      b.setAttribute('aria-checked', String(on));
      b.classList.toggle('is-on', on);
      b.tabIndex = on ? 0 : -1;
    });
    const g = exportOptionGroups(e);
    (Object.keys(sections) as (keyof typeof sections)[]).forEach((k) => (sections[k].hidden = !g[k]));
    noOptions.hidden = Object.values(g).some(Boolean);
    heading.textContent = '';
    heading.append(h('strong', null, e.label), h('span', null, e.description));
    fileName.textContent = exportFilename(store.project, e);
    exportBtn.lastChild!.textContent = `Export ${e.extension.toUpperCase()}`;
    validate();
  }

  const collect = (): ExportOptions => {
    const g = exportOptionGroups(current);
    const o: ExportOptions = {};
    if (g.levels) o.levelIds = [...levelIds];
    if (g.drawing) o.scale = Number(scale.value);
    if (g.paper) {
      o.paper = paper.value as PaperSize;
      o.orientation = orientation.value as 'landscape' | 'portrait';
    }
    if (g.content) {
      o.includeFurniture = furn.checked;
      o.includeAnnotations = anno.checked;
    }
    if (g.pixels) {
      const [w, ht] = PNG_SIZES[Number(size.value)] ?? PNG_SIZES[1];
      o.width = w;
      o.height = ht;
    }
    if (g.dpi) o.dpi = Number(dpi.value);
    return o;
  };

  const run = async () => {
    if (!validate()) return;
    const options = collect();
    prefs.set('export', {
      format: current.format,
      scale: Number(scale.value),
      paper: paper.value as PaperSize,
      orientation: orientation.value as 'landscape' | 'portrait',
      includeFurniture: furn.checked,
      includeAnnotations: anno.checked,
      size: Number(size.value),
      dpi: Number(dpi.value),
    } satisfies SavedOptions);
    modal.setBusy(true, `Exporting ${current.label}…`);
    exportBtn.disabled = true;
    try {
      const { blob, filename } = await runExport(current.format, store.snapshot(), options, { activeLevelId: ui.get().activeLevelId, viewport: shell.viewport ?? undefined });
      downloadBlob(blob, filename);
      modal.setBusy(false);
      modal.close();
      shell.toast(`Exported ${filename} (${formatBytes(blob.size)})`, 'success');
    } catch (err) {
      modal.setBusy(false);
      exportBtn.disabled = false;
      shell.toast(friendlyExportError(current, err), 'error');
    }
  };
  exportBtn.addEventListener('click', () => void run());

  const modal = openModal({
    title: 'Export',
    subtitle: 'Drawings, BIM and 3D models from your project',
    size: 'lg',
    className: 'cr-export-modal',
    body: h('div', { class: 'cr-export' }, list, panel),
    footer: [h('span', { class: 'cr-export-filewrap' }, icon('fileText'), fileName), h('span', { class: 'cr-flex' }), cancelBtn, exportBtn],
    initialFocus: exportBtn,
  });
  cancelBtn.addEventListener('click', () => modal.close());
  setLevels(levelIds);
  select(current);
  formatBtns.get(current.format)?.scrollIntoView?.({ block: 'nearest' });
  return modal;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** A readable message for exporter failures (unfinished formats, missing 3D view…). */
export function friendlyExportError(e: Pick<Exporter, 'label'>, err: unknown): string {
  const msg = errorMessage(err);
  if (/not implemented/i.test(msg)) return `${e.label} export is not available in this build yet — try another format.`;
  return `${e.label} export failed: ${msg}`;
}
