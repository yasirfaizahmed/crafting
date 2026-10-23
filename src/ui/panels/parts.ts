/**
 * "Parts" section: the material of every part of the selected element's 3D model (a door's frame,
 * leaf and handle, a window's glass, a sofa's seat and legs, a stair's handrail…), each one
 * overridable on its own (Element.partMaterials).
 */
import { getMaterial, hasMaterial } from '../../core/materials';
import type { DocumentStore } from '../../core/store';
import type { Element, Project } from '../../core/types';
import { buildElementGeometry, createGeometryContext, partKey } from '../../geometry';
import { h } from '../dom';
import { icon } from '../icons';
import { materialSwatch, openMaterialPicker } from '../pickers';

/** Friendlier names for common part keys. */
const LABELS: Record<string, string> = {
  body: 'Body',
  frame: 'Frame',
  panel: 'Leaf / panels',
  glass: 'Glass',
  detail: 'Hardware & trim',
  finish: 'Finish',
  light: 'Light',
  top: 'Top finish',
  soffit: 'Soffit',
  fascia: 'Fascia',
  infill: 'Gable infill',
  treads: 'Treads',
  risers: 'Risers',
  stringers: 'Stringers',
  landings: 'Landings',
  posts: 'Posts',
  balusters: 'Balusters',
  handrail: 'Handrail',
};

export function partLabel(key: string): string {
  return LABELS[key] ?? key.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** Distinct parts of an element's model with the material each currently shows. */
export function elementParts(project: Project, el: Element): { key: string; materialId: string }[] {
  const seen = new Map<string, string>();
  for (const p of buildElementGeometry(createGeometryContext(project), el).parts) {
    const k = partKey(p);
    if (!seen.has(k)) seen.set(k, p.materialId);
  }
  return [...seen].map(([key, materialId]) => ({ key, materialId }));
}

export interface PartsSection {
  el: HTMLElement;
  update(): void;
}

export function partsSection(store: DocumentStore, id: string, disabled: boolean): PartsSection {
  const el = h('div', { class: 'cr-prop-section cr-parts' });
  let signature = '';
  const render = () => {
    const cur = store.getElement(id);
    el.textContent = '';
    if (!cur) return;
    const parts = elementParts(store.project as Project, cur);
    if (parts.length < 2) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.appendChild(h('h4', { class: 'cr-prop-section-title' }, 'Parts & materials'));
    for (const part of parts) {
      const override = cur.partMaterials?.[part.key];
      const btn = h('button', { type: 'button', class: 'cr-picker-btn', disabled, 'aria-label': `${partLabel(part.key)} material` });
      btn.append(materialSwatch(hasMaterial(part.materialId) ? getMaterial(part.materialId) : undefined), h('span', { class: 'cr-picker-label' }, getMaterial(part.materialId).name), icon('chevronDown', 'cr-picker-chev'));
      btn.addEventListener('click', () =>
        openMaterialPicker(btn, {
          value: override,
          optionalLabel: 'Default for this part',
          onPick: (v) => {
            const next = { ...(cur.partMaterials ?? {}) };
            if (v) next[part.key] = v;
            else delete next[part.key];
            store.update(id, { partMaterials: Object.keys(next).length ? next : undefined }, `${partLabel(part.key)} material`);
          },
        }),
      );
      const row = h('div', { class: `cr-prop-row is-material${override ? ' is-overridden' : ''}` }, h('span', { class: 'cr-prop-label' }, partLabel(part.key)), btn);
      el.appendChild(row);
    }
  };
  return {
    el,
    update() {
      const cur = store.getElement(id);
      const sig = cur ? JSON.stringify(cur) : '';
      if (sig === signature) return;
      signature = sig;
      render();
    },
  };
}
