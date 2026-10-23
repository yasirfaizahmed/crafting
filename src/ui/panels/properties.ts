/**
 * Properties panel: schema-driven editor for the selection (src/ui/schema.ts), or project info
 * when nothing is selected. Every edit is one store transaction; values refresh in place on
 * store changes without clobbering the field being typed in.
 */
import { catalogItemForElement, getFurniture } from '../../core/catalog';
import { getMaterial, hasMaterial } from '../../core/materials';
import type { Element, Project, UnitSystem } from '../../core/types';
import { deleteSelection, duplicateSelection, flipSelectedStairs, holdCatalogItem } from '../actions';
import { batched, domId, h } from '../dom';
import { formatTime, pluralize } from '../format';
import { icon, type IconName } from '../icons';
import { elementIcon, elementName, elementDetail } from '../labels';
import { levelsTopDown } from '../level-ops';
import { materialLabel, materialSwatch, openFurniturePicker, openMaterialPicker } from '../pickers';
import { TYPE_LABELS } from '../quantities';
import {
  applyFieldEdit,
  commonFields,
  commonValue,
  computedInfo,
  formatFieldValue,
  parseFieldInput,
  schemaFor,
  SECTION_ORDER,
  type FieldDef,
  type FieldValue,
  type InfoRow,
  type Section,
} from '../schema';
import type { Shell } from '../types';

export interface PropertiesHandle {
  el: HTMLElement;
  dispose(): void;
}

interface ControlSpec {
  field: FieldDef;
  read(): { value: FieldValue; mixed: boolean; placeholder?: string };
  write(value: FieldValue): void;
  disabled?: boolean;
}

interface Control {
  row: HTMLElement;
  update(): void;
}

export function mountProperties(container: HTMLElement, shell: Shell): PropertiesHandle {
  const { store, ui, selection, events } = shell.ctx;
  const el = h('section', { class: 'cr-panel cr-props', 'aria-label': 'Properties' });
  container.appendChild(el);
  const units = (): UnitSystem => ui.get().displayUnits;
  let controls: Control[] = [];
  let infoHost: HTMLElement | null = null;
  let headerUpdate: (() => void) | null = null;
  let structureKey = '';

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  function buildControl(spec: ControlSpec): Control {
    const { field } = spec;
    const id = domId('prop');
    const errId = `${id}-err`;
    const label = h('label', { class: 'cr-prop-label', for: id, title: field.hint ?? field.label }, field.label);
    const err = h('div', { class: 'cr-field-error', id: errId, role: 'alert', hidden: true });
    const row = h('div', { class: `cr-prop-row is-${field.kind}`, 'data-field': field.key });
    const showError = (msg: string | null) => {
      err.hidden = !msg;
      err.textContent = msg ?? '';
    };

    if (field.kind === 'checkbox') {
      const input = h('input', { id, type: 'checkbox', class: 'cr-switch', disabled: !!spec.disabled });
      input.addEventListener('change', () => spec.write(input.checked));
      row.append(h('span', { class: 'cr-prop-label' }), h('label', { class: 'cr-check' }, input, h('span', null, field.label)));
      return {
        row,
        update() {
          const r = spec.read();
          input.indeterminate = r.mixed;
          input.checked = !r.mixed && !!r.value;
        },
      };
    }

    if (field.kind === 'select' || field.kind === 'level') {
      const select = h('select', { id, class: 'cr-select', disabled: !!spec.disabled, 'aria-describedby': errId });
      const fill = (value: FieldValue, mixed: boolean) => {
        const options =
          field.kind === 'level'
            ? levelsTopDown(store.project).map((l) => ({ value: l.id, label: l.name }))
            : [...(field.options ?? [])];
        if (value !== undefined && !mixed && !options.some((o) => o.value === String(value))) options.push({ value: String(value), label: String(value) });
        select.textContent = '';
        if (mixed) select.appendChild(h('option', { value: '', disabled: true }, '— mixed —'));
        for (const o of options) select.appendChild(h('option', { value: o.value }, o.label));
        select.value = mixed ? '' : String(value ?? '');
      };
      select.addEventListener('change', () => {
        if (select.value) spec.write(select.value);
      });
      row.append(label, select);
      return {
        row,
        update() {
          if (document.activeElement === select) return;
          const r = spec.read();
          fill(r.value, r.mixed);
        },
      };
    }

    if (field.kind === 'material' || field.kind === 'furniture') {
      const btn = h('button', { id, type: 'button', class: 'cr-picker-btn', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-label': field.label, disabled: !!spec.disabled });
      const paint = () => {
        const r = spec.read();
        btn.textContent = '';
        if (r.mixed) btn.append(materialSwatch(undefined), h('span', { class: 'cr-picker-label' }, '— mixed —'));
        else if (field.kind === 'material') {
          const v = r.value as string | undefined;
          btn.append(materialSwatch(v && hasMaterial(v) ? getMaterial(v) : undefined), h('span', { class: 'cr-picker-label' }, materialLabel(v, field.optionalLabel)));
        } else {
          const def = getFurniture(String(r.value ?? ''));
          btn.append(h('span', { class: 'cr-furn-ic' }, def?.icon ?? '❔'), h('span', { class: 'cr-picker-label' }, def?.name ?? String(r.value ?? '')));
        }
        btn.append(icon('chevronDown', 'cr-picker-chev'));
      };
      btn.addEventListener('click', () => {
        const r = spec.read();
        const opts = { value: r.mixed ? undefined : (r.value as string | undefined), optionalLabel: field.optional ? field.optionalLabel ?? 'Default' : undefined, onPick: (v: string | undefined) => spec.write(v) };
        if (field.kind === 'material') openMaterialPicker(btn, opts);
        else openFurniturePicker(btn, opts);
      });
      row.append(label, btn);
      return { row, update: paint };
    }

    // Text-like inputs: length / number / angle / text / textarea.
    const input =
      field.kind === 'textarea'
        ? h('textarea', { id, class: 'cr-input cr-textarea', rows: '3', disabled: !!spec.disabled, 'aria-describedby': errId })
        : h('input', {
            id,
            type: 'text',
            class: `cr-input ${field.kind === 'text' ? '' : 'is-num'}`,
            inputmode: field.kind === 'text' ? undefined : 'decimal',
            autocomplete: 'off',
            spellcheck: 'false',
            disabled: !!spec.disabled,
            'aria-describedby': errId,
          });
    let shown = '';
    const commit = () => {
      if (input.value === shown) {
        showError(null);
        input.removeAttribute('aria-invalid');
        return;
      }
      const res = parseFieldInput(field, input.value, units());
      if (!res.ok) {
        showError(res.error);
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      showError(null);
      input.removeAttribute('aria-invalid');
      shown = input.value;
      spec.write(res.value);
    };
    input.addEventListener('keydown', (e) => {
      const ke = e as KeyboardEvent;
      if (ke.key === 'Enter' && !(field.kind === 'textarea' && ke.shiftKey)) {
        e.preventDefault();
        commit();
        if (input.getAttribute('aria-invalid') !== 'true') input.select?.();
      } else if (ke.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        input.value = shown;
        showError(null);
        input.removeAttribute('aria-invalid');
        input.blur();
      } else if ((ke.key === 'ArrowUp' || ke.key === 'ArrowDown') && field.kind !== 'text' && field.kind !== 'textarea') {
        const r = spec.read();
        if (r.mixed || typeof r.value !== 'number') return;
        e.preventDefault();
        const step = (field.step ?? (field.kind === 'angle' ? 1 : 10)) * (ke.shiftKey ? 10 : 1) * (ke.key === 'ArrowUp' ? 1 : -1);
        let v = r.value + step;
        if (field.min !== undefined) v = Math.max(field.min, v);
        if (field.max !== undefined) v = Math.min(field.max, v);
        if (field.wrap) v = ((v % 360) + 360) % 360;
        spec.write(v);
      }
    });
    input.addEventListener('blur', commit);
    input.addEventListener('focus', () => (input as HTMLInputElement).select?.());
    row.append(label, input, err);
    return {
      row,
      update() {
        const r = spec.read();
        const text = r.mixed ? '' : formatFieldValue(field, r.value, units());
        input.placeholder = r.mixed ? 'Mixed' : r.placeholder ?? '';
        // Never overwrite what the user is typing.
        if (document.activeElement === input && input.value !== shown) return;
        shown = text;
        input.value = text;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Selection editor
  // ---------------------------------------------------------------------------

  function headerButton(ic: IconName, label: string, run: () => void, cls = ''): HTMLButtonElement {
    const b = h('button', { class: `cr-icon-btn ${cls}`.trim(), type: 'button', title: label, 'aria-label': label }, icon(ic));
    b.addEventListener('click', run);
    return b;
  }

  function renderSelection(elements: Element[]): void {
    const ids = elements.map((e) => e.id);
    const single = elements.length === 1 ? elements[0] : null;
    const locked = elements.some((e) => e.locked);
    const hidden = elements.every((e) => e.hidden);

    const title = h('h3', { class: 'cr-props-title' });
    const sub = h('div', { class: 'cr-props-sub' });
    const glyph = h('span', { class: 'cr-props-glyph', 'aria-hidden': 'true' });
    const lockBtn = headerButton(locked ? 'lock' : 'unlock', locked ? 'Unlock' : 'Lock', () => toggleFlag('locked'));
    const hideBtn = headerButton(hidden ? 'eyeOff' : 'eye', hidden ? 'Show' : 'Hide', () => toggleFlag('hidden'));
    const actions = h(
      'div',
      { class: 'cr-props-actions' },
      headerButton('frame', 'Zoom to selection', () => events.emit('zoom-to', { ids })),
      single
        ? headerButton('pick', 'Pick into hotbar (like middle-click)', () => {
            const item = catalogItemForElement(single as unknown as { type: string } & Record<string, unknown>);
            if (item) {
              holdCatalogItem(shell, item.id);
              shell.toast(`${item.name} is now in your hand`, 'info');
            } else shell.toast('No inventory item matches this element', 'warning');
          })
        : null,
      lockBtn,
      hideBtn,
      ...(elements.some((e) => e.type === 'stair')
        ? [
            headerButton('mirror', 'Mirror stair — flip left/right (M)', () => void flipSelectedStairs(shell, 'mirror')),
            headerButton('flipDirection', 'Flip stair direction — up/down (Shift+M)', () => void flipSelectedStairs(shell, 'reverse')),
          ]
        : []),
      headerButton('copy', 'Duplicate (Ctrl+D)', () => duplicateSelection(shell)),
      headerButton('trash', 'Delete (Del)', () => deleteSelection(shell), 'is-danger'),
    );
    const toggleFlag = (flag: 'locked' | 'hidden') => {
      const cur = selection.get().map((id) => store.getElement(id)).filter((e): e is Element => !!e);
      const value = !cur.every((e) => e[flag]);
      store.transact(`${flag === 'locked' ? (value ? 'Lock' : 'Unlock') : value ? 'Hide' : 'Show'} ${cur.length === 1 ? elementName(cur[0]) : `${cur.length} elements`}`, (tx) =>
        cur.forEach((e) => tx.update(e.id, { [flag]: value || undefined })),
      );
    };
    headerUpdate = () => {
      const cur = selection.get().map((id) => store.getElement(id)).filter((e): e is Element => !!e);
      if (!cur.length) return;
      const one = cur.length === 1 ? cur[0] : null;
      glyph.textContent = one ? elementIcon(one) : '▦';
      if (one) {
        title.textContent = elementName(one);
        sub.textContent = [schemaFor(one.type).title, elementDetail(one, units(), store.project), store.getLevel(one.levelId)?.name].filter(Boolean).join(' · ');
      } else {
        title.textContent = `${cur.length} elements`;
        const byType = new Map<string, number>();
        cur.forEach((e) => byType.set(e.type, (byType.get(e.type) ?? 0) + 1));
        sub.textContent = [...byType.entries()].map(([t, n]) => `${n} ${TYPE_LABELS[t as Element['type']][n === 1 ? 0 : 1].toLowerCase()}`).join(', ');
      }
    };
    headerUpdate();

    const body = h('div', { class: 'cr-props-body' });
    if (locked)
      body.appendChild(
        h(
          'div',
          { class: 'cr-banner is-warn' },
          icon('lock'),
          h('span', null, elements.length === 1 ? 'This element is locked.' : 'Some elements are locked.'),
          (() => {
            const b = h('button', { class: 'cr-btn is-sm', type: 'button' }, 'Unlock');
            b.addEventListener('click', () => toggleFlag('locked'));
            return b;
          })(),
        ),
      );

    const fields = commonFields(elements);
    const bySection = new Map<Section, FieldDef[]>();
    for (const f of fields) bySection.set(f.section, [...(bySection.get(f.section) ?? []), f]);
    for (const section of SECTION_ORDER) {
      const fs = bySection.get(section);
      if (!fs?.length) continue;
      const sec = h('div', { class: 'cr-prop-section' }, h('h4', { class: 'cr-prop-section-title' }, section));
      for (const f of fs) {
        const control = buildControl({
          field: f,
          disabled: locked,
          read: () => {
            const cur = ids.map((id) => store.getElement(id)).filter((e): e is Element => !!e);
            const r = commonValue(f, cur, store.project as Project);
            const placeholder = cur.length === 1 && f.placeholder ? f.placeholder(cur[0], store.project as Project, units()) : undefined;
            return { ...r, placeholder };
          },
          write: (v) => {
            applyFieldEdit(store, ids, f, v);
          },
        });
        controls.push(control);
        sec.appendChild(control.row);
      }
      body.appendChild(sec);
    }

    infoHost = h('div', { class: 'cr-prop-section is-info' });
    body.appendChild(infoHost);
    el.append(h('header', { class: 'cr-props-head' }, glyph, h('div', { class: 'cr-props-titles' }, title, sub), actions), body);
  }

  function renderInfo(elements: Element[]): void {
    if (!infoHost) return;
    infoHost.textContent = '';
    const rows: InfoRow[] =
      elements.length === 1
        ? computedInfo(elements[0], store.project as Project, units())
        : [{ label: 'Selected', value: pluralize(elements.length, 'element') }];
    if (!rows.length) return;
    infoHost.appendChild(h('h4', { class: 'cr-prop-section-title' }, elements.length === 1 ? 'Quantities & checks' : 'Selection'));
    const dl = h('dl', { class: 'cr-info' });
    for (const r of rows) dl.append(h('dt', { title: r.hint ?? '' }, r.label), h('dd', { class: r.tone ? `is-${r.tone}` : '' }, r.value));
    infoHost.appendChild(dl);
  }

  // ---------------------------------------------------------------------------
  // Project info (nothing selected)
  // ---------------------------------------------------------------------------

  function renderProject(): void {
    const p = () => store.project;
    const infoField = (key: 'name' | 'author' | 'address' | 'description', label: string, kind: 'text' | 'textarea' = 'text'): Control =>
      buildControl({
        field: { key, label, kind, section: 'Identity' },
        read: () => ({ value: p().info[key], mixed: false, placeholder: key === 'name' ? 'Untitled Project' : '' }),
        write: (v) => {
          const s = String(v ?? '');
          const value = key === 'name' ? s.trim() || 'Untitled Project' : s;
          if (value !== p().info[key]) store.transact(`Edit project ${label.toLowerCase()}`, (tx) => tx.updateInfo({ [key]: value }));
        },
      });
    const settingField = (field: FieldDef & { key: 'gridSize' | 'wallThickness' | 'levelHeight' | 'northAngle' | 'units' }): Control =>
      buildControl({
        field,
        read: () => ({ value: p().settings[field.key], mixed: false }),
        write: (v) => {
          if (v === undefined || v === p().settings[field.key]) return;
          store.transact(`Edit ${field.label.toLowerCase()}`, (tx) => tx.updateSettings({ [field.key]: v }));
          if (field.key === 'units') ui.set({ displayUnits: v as UnitSystem });
        },
      });
    const info = [infoField('name', 'Project name'), infoField('author', 'Author'), infoField('address', 'Site address'), infoField('description', 'Description', 'textarea')];
    const settings = [
      settingField({ key: 'units', label: 'Units', kind: 'select', section: 'Options', options: [{ value: 'metric', label: 'Metric (mm, m)' }, { value: 'imperial', label: 'Imperial (ft, in)' }] }),
      settingField({ key: 'gridSize', label: 'Grid size', kind: 'length', section: 'Options', min: 1, step: 50 }),
      settingField({ key: 'wallThickness', label: 'Wall thickness', kind: 'length', section: 'Options', min: 10, step: 10 }),
      settingField({ key: 'levelHeight', label: 'Level height', kind: 'length', section: 'Options', min: 500, step: 100 }),
      settingField({ key: 'northAngle', label: 'True north', kind: 'angle', section: 'Options', step: 5, wrap: true, hint: 'Angle of geographic north from plan +Y (IFC TrueNorth)' }),
    ];
    controls.push(...info, ...settings);
    const stats = h('dl', { class: 'cr-info' });
    headerUpdate = () => {
      const pr = p();
      stats.textContent = '';
      const rows: [string, string][] = [
        ['Levels', String(pr.levels.length)],
        ['Elements', String(Object.keys(pr.elements).length)],
        ['Created', formatTime(pr.info.created)],
        ['Modified', formatTime(pr.info.modified)],
      ];
      for (const [k, v] of rows) stats.append(h('dt', null, k), h('dd', null, v));
    };
    headerUpdate();
    el.append(
      h(
        'header',
        { class: 'cr-props-head' },
        h('span', { class: 'cr-props-glyph', 'aria-hidden': 'true' }, '🏗️'),
        h('div', { class: 'cr-props-titles' }, h('h3', { class: 'cr-props-title' }, 'Project'), h('div', { class: 'cr-props-sub' }, 'Nothing selected — click an element to edit it')),
        (() => {
          const b = h('button', { class: 'cr-icon-btn', type: 'button', title: 'Project settings…', 'aria-label': 'Project settings' }, icon('settings'));
          b.addEventListener('click', () => shell.openDialog('project'));
          return b;
        })(),
      ),
      h(
        'div',
        { class: 'cr-props-body' },
        h('div', { class: 'cr-prop-section' }, h('h4', { class: 'cr-prop-section-title' }, 'Project information'), ...info.map((c) => c.row)),
        h('div', { class: 'cr-prop-section' }, h('h4', { class: 'cr-prop-section-title' }, 'Settings'), ...settings.map((c) => c.row)),
        h('div', { class: 'cr-prop-section is-info' }, h('h4', { class: 'cr-prop-section-title' }, 'Summary'), stats),
        h('p', { class: 'cr-panel-tip' }, 'Tip: select elements in the plan, the 3D world or the outliner. Lengths accept units like ', h('kbd', null, '2.4m'), ', ', h('kbd', null, '240cm'), ' or ', h('kbd', null, `8'6"`), '.'),
      ),
    );
  }

  // ---------------------------------------------------------------------------

  const selected = () => selection.get().map((id) => store.getElement(id)).filter((e): e is Element => !!e);
  const keyOf = (els: Element[]) => (els.length ? els.map((e) => `${e.id}:${e.type}:${e.locked ? 1 : 0}:${e.hidden ? 1 : 0}:${(e as { shape?: string; style?: string }).shape ?? ''}${(e as { style?: string }).style ?? ''}`).join('|') : `project:${store.project.id}`);

  const render = batched(() => {
    const els = selected();
    const key = keyOf(els) + `|${units()}`;
    if (key !== structureKey) {
      structureKey = key;
      el.textContent = '';
      controls = [];
      infoHost = null;
      headerUpdate = null;
      if (els.length) renderSelection(els);
      else renderProject();
    }
    headerUpdate?.();
    controls.forEach((c) => c.update());
    if (els.length) renderInfo(els);
  });
  render.flush();

  const unsubs = [
    store.subscribe(() => render.schedule()),
    selection.subscribe(() => render.schedule()),
    ui.subscribe((n, p) => {
      if (n.displayUnits !== p.displayUnits || n.activeLevelId !== p.activeLevelId) render.schedule();
    }),
  ];
  return {
    el,
    dispose() {
      render.cancel();
      unsubs.forEach((u) => u());
      el.remove();
    },
  };
}
