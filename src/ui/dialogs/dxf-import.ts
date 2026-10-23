/**
 * DXF import: pick a file, choose layers and units, then convert linework to walls on a level
 * (io.listDXFLayers / io.importDXF) and add them to the store in one transaction.
 */
import type { Element } from '../../core/types';
import { parseLength } from '../../core/units';
import { importDXF, inspectDXF, pickTextFile, type DXFImportOptions, type DXFLayerInfo } from '../../io';
import { formatLength } from '../../core/units';
import { errorMessage } from '../actions';
import { h } from '../dom';
import { displayLength, pluralize } from '../format';
import { icon } from '../icons';
import { levelsTopDown } from '../level-ops';
import type { Shell } from '../types';
import { openModal, type ModalHandle } from './modal';

export const DXF_UNITS: { value: string; label: string; scale?: number }[] = [
  { value: 'auto', label: 'From file ($INSUNITS)' },
  { value: '1', label: 'Millimetres', scale: 1 },
  { value: '10', label: 'Centimetres', scale: 10 },
  { value: '1000', label: 'Metres', scale: 1000 },
  { value: '25.4', label: 'Inches', scale: 25.4 },
  { value: '304.8', label: 'Feet', scale: 304.8 },
];

/** Layers that usually hold walls are pre-selected; others only when nothing looks like a wall layer. */
export function defaultDXFLayers(layers: readonly DXFLayerInfo[]): string[] {
  const wallish = layers.filter((l) => /wall|mur|wand|a-wall|^0$/i.test(l.name) && l.entityCount > 0).map((l) => l.name);
  return wallish.length ? wallish : layers.filter((l) => l.entityCount > 0).map((l) => l.name);
}

/** Add imported elements as one undo step, retargeted to `levelId`. Returns the count added. */
export function addImportedElements(shell: Shell, elements: Element[], levelId: string, fileName: string): number {
  const els = elements.filter((e) => e && typeof e.id === 'string' && !shell.ctx.store.getElement(e.id));
  if (!els.length) return 0;
  shell.ctx.store.transact(`Import DXF ${fileName}`, (tx) => els.forEach((e) => tx.add({ ...e, levelId })));
  return els.length;
}

export function openDXFImportDialog(shell: Shell): ModalHandle {
  const { store, ui } = shell.ctx;
  const units = ui.get().displayUnits;
  let file: { name: string; text: string } | null = null;
  let layers: DXFLayerInfo[] = [];

  const drop = h(
    'div',
    { class: 'cr-dropzone', tabindex: '0', role: 'button', 'aria-label': 'Choose a DXF file' },
    h('span', { class: 'cr-dropzone-ic', 'aria-hidden': 'true' }, '📏'),
    h('strong', null, 'Choose a DXF file'),
    h('span', null, 'or drop it here · AutoCAD R12–2018 ASCII DXF'),
  );
  const fileInfo = h('div', { class: 'cr-dxf-file', hidden: true });
  const layerList = h('div', { class: 'cr-check-list is-scroll' });
  const layerBox = h('fieldset', { class: 'cr-fieldset', hidden: true }, h('legend', null, 'Layers'), layerList);
  const unitSel = h('select', { class: 'cr-select' }, ...DXF_UNITS.map((u) => h('option', { value: u.value }, u.label)));
  const levelSel = h('select', { class: 'cr-select' }, ...levelsTopDown(store.project).map((l) => h('option', { value: l.id }, l.name)));
  levelSel.value = ui.get().activeLevelId;
  const thick = h('input', { class: 'cr-input', type: 'text', value: displayLength(store.project.settings.wallThickness, units), inputmode: 'decimal' });
  const doubles = h('input', { type: 'checkbox', checked: true });
  const minLen = h('input', { class: 'cr-input', type: 'text', value: displayLength(100, units), inputmode: 'decimal' });
  const err = h('p', { class: 'cr-field-error', role: 'alert', hidden: true });
  const field = (label: string, control: HTMLElement, hint?: string) => h('label', { class: 'cr-field' }, h('span', { class: 'cr-field-label' }, label), control, hint ? h('span', { class: 'cr-field-hint' }, hint) : null);
  const options = h(
    'fieldset',
    { class: 'cr-fieldset' },
    h('legend', null, 'Conversion'),
    h(
      'div',
      { class: 'cr-form-grid' },
      field('Drawing units', unitSel),
      field('Target level', levelSel),
      field('Wall thickness', thick, 'For walls drawn as single lines'),
      field('Ignore segments shorter than', minLen),
    ),
    h('label', { class: 'cr-check' }, doubles, h('span', null, 'Merge parallel double lines into single walls')),
  );
  const importBtn = h('button', { class: 'cr-btn is-primary', type: 'button', disabled: true }, icon('upload'), 'Import walls');
  const cancel = h('button', { class: 'cr-btn', type: 'button' }, 'Cancel');

  const showError = (msg: string | null) => {
    err.hidden = !msg;
    err.textContent = msg ?? '';
  };

  const load = (f: { name: string; text: string }) => {
    showError(null);
    file = f;
    let size = '';
    try {
      const info = inspectDXF(f.text);
      layers = info.layers;
      const label = DXF_UNITS.find((u) => u.scale !== undefined && Math.abs(u.scale - info.units.unitScale) < 1e-9)?.label ?? `${info.units.unitScale} mm per unit`;
      unitSel.options[0].textContent = `Detected — ${label}${info.units.source === 'header' ? '' : ' (guessed)'}`;
      if (info.extents) {
        const k = info.units.unitScale;
        size = ` · ${formatLength((info.extents.maxX - info.extents.minX) * k, units)} × ${formatLength((info.extents.maxY - info.extents.minY) * k, units)}`;
      }
    } catch (e) {
      layers = [];
      showError(`Could not read “${f.name}”: ${errorMessage(e)}`);
    }
    fileInfo.hidden = false;
    fileInfo.textContent = '';
    const total = layers.reduce((a, l) => a + l.entityCount, 0);
    fileInfo.append(icon('fileText'), h('strong', null, f.name), h('span', null, layers.length ? `${pluralize(layers.length, 'layer')} · ${pluralize(total, 'entity', 'entities')}${size}` : 'no layers found'));
    drop.classList.add('is-compact');
    layerList.textContent = '';
    const picked = new Set(defaultDXFLayers(layers));
    for (const l of [...layers].sort((a, b) => a.name.localeCompare(b.name))) {
      layerList.appendChild(
        h('label', { class: 'cr-check' }, h('input', { type: 'checkbox', value: l.name, checked: picked.has(l.name) }), h('span', null, l.name), h('span', { class: 'cr-check-meta' }, String(l.entityCount))),
      );
    }
    layerBox.hidden = !layers.length;
    importBtn.disabled = false;
  };

  const choose = async () => {
    try {
      const f = await pickTextFile('.dxf,image/vnd.dxf,application/dxf');
      if (f) load(f);
    } catch (e) {
      showError(`Could not open the file: ${errorMessage(e)}`);
    }
  };
  drop.addEventListener('click', () => void choose());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      void choose();
    }
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    const f = e.dataTransfer?.files?.[0];
    if (f) void f.text().then((text) => load({ name: f.name, text }));
  });

  const run = () => {
    if (!file) return;
    const wallThickness = parseLength(thick.value, units);
    const minLength = parseLength(minLen.value, units);
    if (wallThickness === null || wallThickness <= 0) return showError('Enter a valid wall thickness');
    if (minLength === null || minLength < 0) return showError('Enter a valid minimum length');
    const chosen = [...layerList.querySelectorAll<HTMLInputElement>('input:checked')].map((b) => b.value);
    if (layers.length && !chosen.length) return showError('Choose at least one layer');
    const unit = DXF_UNITS.find((u) => u.value === unitSel.value);
    const opts: DXFImportOptions = {
      levelId: levelSel.value,
      layers: layers.length ? chosen : undefined,
      unitScale: unit?.scale,
      wallThickness,
      detectDoubleLines: doubles.checked,
      minLength,
    };
    let els: Element[];
    try {
      els = importDXF(file.text, opts);
    } catch (e) {
      return showError(`Import failed: ${errorMessage(e)}`);
    }
    if (!els.length) return showError('No walls were found in the selected layers. Try other layers or units.');
    try {
      const n = addImportedElements(shell, els, opts.levelId, file.name);
      modal.close();
      ui.set({ activeLevelId: opts.levelId, viewMode: ui.get().viewMode === '3d' ? 'split' : ui.get().viewMode });
      shell.toast(`Imported ${pluralize(n, 'element')} from ${file.name} — Build → Generate 3D to add floors and a roof`, 'success');
      setTimeout(() => shell.ctx.events.emit('zoom-to', { ids: [] }), 50);
    } catch (e) {
      showError(`Could not add the walls: ${errorMessage(e)}`);
    }
  };
  importBtn.addEventListener('click', run);

  const modal = openModal({
    title: 'Import DXF Blueprint',
    subtitle: 'Convert CAD linework into walls on a level',
    size: 'md',
    className: 'cr-dxf-modal',
    body: h('div', { class: 'cr-dxf' }, drop, fileInfo, layerBox, options, err),
    footer: [h('span', { class: 'cr-flex' }), cancel, importBtn],
    initialFocus: drop,
  });
  cancel.addEventListener('click', () => modal.close());
  return modal;
}
