/**
 * Schema-driven property editing: which fields each element type exposes, how a field reads and
 * writes element values, how user input is parsed (unit strings), and read-only computed info.
 *
 * The Properties panel renders these definitions; every edit goes through `applyFieldEdit`,
 * which commits ONE store transaction for all selected elements.
 */
import { getFurniture } from '../core/catalog';
import { distance, polygonArea, polygonPerimeter } from '../core/math2d';
import { DEFAULT_MATERIAL_FOR, getMaterial } from '../core/materials';
import { computeStairLayout } from '../core/stairs';
import { slabHoles } from '../core/stairwells';
import type { DocumentStore } from '../core/store';
import type { Element, ElementOfType, ElementType, Project, UnitSystem, Vec2 } from '../core/types';
import { formatArea, formatLength, formatVolume, parseLength } from '../core/units';
import { getLevel, openingFits, openingsOfWall, wallDirection, wallHeight, wallLength } from '../core/walls';
import { displayAngle, displayLength, normalizeDeg, parseAngle, parseNumber } from './format';
import { elementName } from './labels';
import { columnVolume, elementVolume, slabArea, wallQuantity } from './quantities';

export type FieldKind = 'length' | 'number' | 'angle' | 'select' | 'checkbox' | 'text' | 'textarea' | 'material' | 'furniture' | 'level';
export type FieldValue = string | number | boolean | undefined;
export type Section = 'Identity' | 'Dimensions' | 'Placement' | 'Appearance' | 'Options';
export const SECTION_ORDER: Section[] = ['Identity', 'Dimensions', 'Placement', 'Appearance', 'Options'];

export interface FieldOption {
  value: string;
  label: string;
}

export type ProjectView = Pick<Project, 'elements' | 'levels' | 'settings'>;

/** One editable property. Methods are declared bivariantly so typed defs fit the generic list. */
export interface FieldDef<E extends Element = Element> {
  /** Unique key; also the element property written when no custom `set` is given. */
  key: string;
  label: string;
  kind: FieldKind;
  section: Section;
  options?: FieldOption[];
  min?: number;
  max?: number;
  /** Arrow-key increment (mm for lengths, degrees for angles). */
  step?: number;
  /** Empty input is allowed and stores `undefined` (the value is inherited). */
  optional?: boolean;
  /** Label of the "inherit" choice for optional materials ("Default", "None"). */
  optionalLabel?: string;
  /** Rotation-like angles wrap into [0, 360). */
  wrap?: boolean;
  /** Unit suffix for plain numbers (e.g. paper "mm"). */
  suffix?: string;
  hint?: string;
  placeholder?(el: E, project: ProjectView, units: UnitSystem): string;
  get?(el: E, project: ProjectView): FieldValue;
  set?(el: E, value: FieldValue, project: ProjectView): Partial<Element> | null;
  visible?(el: E): boolean;
}

export interface ElementSchema {
  type: ElementType;
  title: string;
  fields: FieldDef[];
}

const opts = (pairs: [string, string][]): FieldOption[] => pairs.map(([value, label]) => ({ value, label }));

const levelHeightOf = (p: ProjectView, el: Element) => getLevel(p, el.levelId)?.height ?? p.settings.levelHeight;

/** Field editing one axis of a nested Vec2/Vec3 property, e.g. position.x. */
function axisField<E extends Element>(prop: string, axis: 'x' | 'y' | 'z', label: string, section: Section = 'Placement'): FieldDef<E> {
  return {
    key: `${prop}.${axis}`,
    label,
    kind: 'length',
    section,
    step: 100,
    get: (el) => (Reflect.get(el, prop) as Record<string, number> | undefined)?.[axis],
    set: (el, v) => {
      const cur = Reflect.get(el, prop) as Record<string, number>;
      return { [prop]: { ...cur, [axis]: Number(v) } } as Partial<Element>;
    },
  };
}

const nameField: FieldDef = {
  key: 'name',
  label: 'Name',
  kind: 'text',
  section: 'Identity',
  placeholder: (el) => elementName(el),
  get: (el) => (el.type === 'room' ? el.name : el.name ?? ''),
  set: (el, v) => {
    const s = String(v ?? '').trim();
    if (el.type === 'room') return { name: s || 'Room' } as Partial<Element>;
    return { name: s || undefined };
  },
};

const levelField: FieldDef = { key: 'levelId', label: 'Level', kind: 'level', section: 'Identity' };

const materialField = (key = 'materialId', label = 'Material', optional = false, optionalLabel?: string): FieldDef => ({
  key,
  label,
  kind: 'material',
  section: 'Appearance',
  optional,
  optionalLabel,
  get: (el) => {
    const v = Reflect.get(el, key) as string | undefined;
    return v ?? (optional ? undefined : DEFAULT_MATERIAL_FOR[el.type]);
  },
});

const rotationField = (label = 'Rotation'): FieldDef => ({ key: 'rotation', label, kind: 'angle', section: 'Placement', step: 15, wrap: true });

function typed<T extends ElementType>(type: T, title: string, fields: FieldDef<ElementOfType<NoInfer<T>>>[]): ElementSchema {
  return { type, title, fields: fields as unknown as FieldDef[] };
}

export const ELEMENT_SCHEMAS: Record<ElementType, ElementSchema> = {
  wall: typed('wall', 'Wall', [
    nameField,
    levelField,
    {
      key: 'length',
      label: 'Length',
      kind: 'length',
      section: 'Dimensions',
      min: 1,
      step: 100,
      get: (w) => wallLength(w),
      set: (w, v) => {
        const len = Number(v);
        if (!(len > 0)) return null;
        const d = wallLength(w) > 0 ? wallDirection(w) : { x: 1, y: 0 };
        return { end: { x: w.start.x + d.x * len, y: w.start.y + d.y * len } };
      },
    },
    { key: 'thickness', label: 'Thickness', kind: 'length', section: 'Dimensions', min: 10, max: 5000, step: 10 },
    {
      key: 'height',
      label: 'Height',
      kind: 'length',
      section: 'Dimensions',
      optional: true,
      min: 1,
      step: 100,
      hint: 'Leave empty to follow the level height',
      placeholder: (w, p, u) => `Level · ${formatLength(levelHeightOf(p, w), u)}`,
    },
    { key: 'baseOffset', label: 'Base offset', kind: 'length', section: 'Placement', step: 50 },
    { key: 'justification', label: 'Location line', kind: 'select', section: 'Placement', options: opts([['center', 'Wall centreline'], ['left', 'Left face'], ['right', 'Right face']]) },
    axisField('start', 'x', 'Start X'),
    axisField('start', 'y', 'Start Y'),
    axisField('end', 'x', 'End X'),
    axisField('end', 'y', 'End Y'),
    materialField('materialId', 'Core material') as FieldDef<ElementOfType<'wall'>>,
    materialField('leftFinishId', 'Left finish', true, 'None') as FieldDef<ElementOfType<'wall'>>,
    materialField('rightFinishId', 'Right finish', true, 'None') as FieldDef<ElementOfType<'wall'>>,
    { key: 'structural', label: 'Load-bearing (structural)', kind: 'checkbox', section: 'Options' },
  ]),
  door: typed('door', 'Door', [
    nameField,
    {
      key: 'style',
      label: 'Style',
      kind: 'select',
      section: 'Identity',
      options: opts([['single', 'Single swing'], ['double', 'Double swing'], ['sliding', 'Sliding'], ['pocket', 'Pocket'], ['garage', 'Garage / overhead'], ['opening', 'Opening (no leaf)']]),
    },
    { key: 'width', label: 'Width', kind: 'length', section: 'Dimensions', min: 100, step: 50 },
    { key: 'height', label: 'Height', kind: 'length', section: 'Dimensions', min: 100, step: 50 },
    { key: 'sill', label: 'Threshold / sill', kind: 'length', section: 'Dimensions', min: 0, step: 10 },
    { key: 'offset', label: 'Position along wall', kind: 'length', section: 'Placement', step: 50, hint: 'Distance from the wall start to the door centre' },
    { key: 'hinge', label: 'Hinge side', kind: 'select', section: 'Placement', options: opts([['left', 'Left'], ['right', 'Right']]) },
    { key: 'flip', label: 'Swing to the other side', kind: 'checkbox', section: 'Placement' },
    materialField('materialId', 'Leaf material') as FieldDef<ElementOfType<'door'>>,
    materialField('frameMaterialId', 'Frame material', true, 'Default') as FieldDef<ElementOfType<'door'>>,
  ]),
  window: typed('window', 'Window', [
    nameField,
    {
      key: 'style',
      label: 'Style',
      kind: 'select',
      section: 'Identity',
      options: opts([['casement', 'Casement'], ['sliding', 'Sliding'], ['fixed', 'Fixed / picture'], ['awning', 'Awning'], ['double-hung', 'Double-hung']]),
    },
    { key: 'width', label: 'Width', kind: 'length', section: 'Dimensions', min: 100, step: 50 },
    { key: 'height', label: 'Height', kind: 'length', section: 'Dimensions', min: 100, step: 50 },
    { key: 'sill', label: 'Sill height', kind: 'length', section: 'Dimensions', min: 0, step: 50 },
    { key: 'offset', label: 'Position along wall', kind: 'length', section: 'Placement', step: 50, hint: 'Distance from the wall start to the window centre' },
    materialField('materialId', 'Glazing') as FieldDef<ElementOfType<'window'>>,
    materialField('frameMaterialId', 'Frame material', true, 'Default') as FieldDef<ElementOfType<'window'>>,
  ]),
  slab: typed('slab', 'Slab', [
    nameField,
    levelField,
    { key: 'kind', label: 'Kind', kind: 'select', section: 'Identity', options: opts([['floor', 'Floor'], ['ceiling', 'Ceiling'], ['foundation', 'Foundation'], ['terrace', 'Terrace / deck']]) },
    { key: 'thickness', label: 'Thickness', kind: 'length', section: 'Dimensions', min: 10, step: 10 },
    { key: 'topOffset', label: 'Top offset', kind: 'length', section: 'Placement', step: 50, hint: 'Top of slab relative to the level' },
    {
      key: 'stairOpenings',
      label: 'Cut openings for stairs',
      kind: 'checkbox',
      section: 'Options',
      hint: 'Stairs rising through this slab leave an opening automatically',
      get: (el) => el.stairOpenings !== false,
      set: (_el, v) => ({ stairOpenings: v === true }),
    },
    materialField() as FieldDef<ElementOfType<'slab'>>,
  ]),
  roof: typed('roof', 'Roof', [
    nameField,
    levelField,
    { key: 'shape', label: 'Shape', kind: 'select', section: 'Identity', options: opts([['flat', 'Flat'], ['gable', 'Gable'], ['hip', 'Hip'], ['shed', 'Shed (mono-pitch)'], ['pyramid', 'Pyramid']]) },
    { key: 'pitch', label: 'Pitch', kind: 'angle', section: 'Dimensions', min: 0, max: 75, step: 5, visible: (r) => r.shape !== 'flat' },
    { key: 'overhang', label: 'Overhang', kind: 'length', section: 'Dimensions', min: 0, step: 50 },
    { key: 'thickness', label: 'Thickness', kind: 'length', section: 'Dimensions', min: 10, step: 10 },
    {
      key: 'baseOffset',
      label: 'Eave height',
      kind: 'length',
      section: 'Placement',
      optional: true,
      step: 100,
      placeholder: (r, p, u) => `Level · ${formatLength(levelHeightOf(p, r), u)}`,
    },
    { key: 'ridgeAngle', label: 'Ridge direction', kind: 'angle', section: 'Placement', step: 90, wrap: true, visible: (r) => r.shape !== 'flat' && r.shape !== 'pyramid' },
    materialField() as FieldDef<ElementOfType<'roof'>>,
  ]),
  stair: typed('stair', 'Stair', [
    nameField,
    levelField,
    {
      key: 'shape',
      label: 'Shape',
      kind: 'select',
      section: 'Identity',
      options: opts([['straight', 'Straight'], ['l-shape', 'L-shape (quarter landing)'], ['u-shape', 'U-shape (half landing)'], ['spiral', 'Spiral']]),
    },
    { key: 'width', label: 'Width', kind: 'length', section: 'Dimensions', min: 300, step: 50 },
    { key: 'tread', label: 'Going (tread)', kind: 'length', section: 'Dimensions', min: 150, max: 500, step: 5 },
    { key: 'maxRiser', label: 'Max riser height', kind: 'length', section: 'Dimensions', min: 100, max: 250, step: 5 },
    {
      key: 'rise',
      label: 'Total rise',
      kind: 'length',
      section: 'Dimensions',
      optional: true,
      min: 100,
      step: 50,
      placeholder: (s, p, u) => `Level · ${formatLength(levelHeightOf(p, s), u)}`,
    },
    { key: 'innerRadius', label: 'Centre column radius', kind: 'length', section: 'Dimensions', min: 0, step: 10, optional: true, placeholder: () => '100 mm', visible: (s) => s.shape === 'spiral' },
    { key: 'turn', label: 'Turn', kind: 'select', section: 'Placement', options: opts([['left', 'Left'], ['right', 'Right']]), visible: (s) => s.shape !== 'straight' },
    rotationField('Direction (up)') as FieldDef<ElementOfType<'stair'>>,
    axisField('position', 'x', 'X'),
    axisField('position', 'y', 'Y'),
    materialField() as FieldDef<ElementOfType<'stair'>>,
  ]),
  column: typed('column', 'Column', [
    nameField,
    levelField,
    { key: 'shape', label: 'Shape', kind: 'select', section: 'Identity', options: opts([['rect', 'Rectangular'], ['round', 'Round']]) },
    { key: 'width', label: 'Width / Ø', kind: 'length', section: 'Dimensions', min: 20, step: 10 },
    { key: 'depth', label: 'Depth', kind: 'length', section: 'Dimensions', min: 20, step: 10, visible: (c) => c.shape === 'rect' },
    { key: 'height', label: 'Height', kind: 'length', section: 'Dimensions', optional: true, min: 10, step: 100, placeholder: (c, p, u) => `Level · ${formatLength(levelHeightOf(p, c), u)}` },
    { key: 'baseOffset', label: 'Base offset', kind: 'length', section: 'Placement', step: 50 },
    { ...(rotationField() as FieldDef<ElementOfType<'column'>>), visible: (c) => c.shape === 'rect' },
    axisField('position', 'x', 'X'),
    axisField('position', 'y', 'Y'),
    materialField() as FieldDef<ElementOfType<'column'>>,
  ]),
  beam: typed('beam', 'Beam', [
    nameField,
    levelField,
    { key: 'width', label: 'Width', kind: 'length', section: 'Dimensions', min: 20, step: 10 },
    { key: 'depth', label: 'Depth', kind: 'length', section: 'Dimensions', min: 20, step: 10 },
    { key: 'topOffset', label: 'Top offset', kind: 'length', section: 'Placement', optional: true, step: 50, placeholder: (b, p, u) => `Level · ${formatLength(levelHeightOf(p, b), u)}` },
    axisField('start', 'x', 'Start X'),
    axisField('start', 'y', 'Start Y'),
    axisField('end', 'x', 'End X'),
    axisField('end', 'y', 'End Y'),
    materialField() as FieldDef<ElementOfType<'beam'>>,
  ]),
  furniture: typed('furniture', 'Furniture', [
    nameField,
    levelField,
    {
      key: 'catalogId',
      label: 'Model',
      kind: 'furniture',
      section: 'Identity',
      set: (_f, v) => ({ catalogId: String(v), width: undefined, depth: undefined, height: undefined }) as Partial<Element>,
    },
    { key: 'width', label: 'Width', kind: 'length', section: 'Dimensions', optional: true, min: 10, step: 50, placeholder: (f, _p, u) => defDim(f.catalogId, 'width', u) },
    { key: 'depth', label: 'Depth', kind: 'length', section: 'Dimensions', optional: true, min: 10, step: 50, placeholder: (f, _p, u) => defDim(f.catalogId, 'depth', u) },
    { key: 'height', label: 'Height', kind: 'length', section: 'Dimensions', optional: true, min: 10, step: 50, placeholder: (f, _p, u) => defDim(f.catalogId, 'height', u) },
    { key: 'elevation', label: 'Elevation', kind: 'length', section: 'Placement', step: 50 },
    rotationField() as FieldDef<ElementOfType<'furniture'>>,
    axisField('position', 'x', 'X'),
    axisField('position', 'y', 'Y'),
    { key: 'mirrored', label: 'Mirrored', kind: 'checkbox', section: 'Placement' },
    materialField('materialId', 'Primary material', true, 'Default') as FieldDef<ElementOfType<'furniture'>>,
  ]),
  room: typed('room', 'Room', [
    nameField,
    levelField,
    { key: 'number', label: 'Number', kind: 'text', section: 'Identity', set: (_r, v) => ({ number: String(v ?? '').trim() || undefined }) as Partial<Element> },
    materialField('floorMaterialId', 'Floor finish', true, 'Default') as FieldDef<ElementOfType<'room'>>,
  ]),
  block: typed('block', 'Block', [
    nameField,
    levelField,
    { key: 'shape', label: 'Shape', kind: 'select', section: 'Identity', options: opts([['box', 'Box'], ['cylinder', 'Cylinder'], ['wedge', 'Wedge'], ['sphere', 'Sphere']]) },
    { ...axisField<ElementOfType<'block'>>('size', 'x', 'Width', 'Dimensions'), min: 10 },
    { ...axisField<ElementOfType<'block'>>('size', 'y', 'Depth', 'Dimensions'), min: 10 },
    { ...axisField<ElementOfType<'block'>>('size', 'z', 'Height', 'Dimensions'), min: 10 },
    axisField('position', 'x', 'X'),
    axisField('position', 'y', 'Y'),
    axisField('position', 'z', 'Elevation'),
    rotationField() as FieldDef<ElementOfType<'block'>>,
    materialField() as FieldDef<ElementOfType<'block'>>,
  ]),
  railing: typed('railing', 'Railing', [
    nameField,
    levelField,
    { key: 'style', label: 'Style', kind: 'select', section: 'Identity', options: opts([['bars', 'Balusters'], ['glass', 'Glass panels'], ['solid', 'Solid']]) },
    { key: 'height', label: 'Height', kind: 'length', section: 'Dimensions', min: 100, step: 50 },
    { key: 'baseOffset', label: 'Base offset', kind: 'length', section: 'Placement', step: 50 },
    materialField() as FieldDef<ElementOfType<'railing'>>,
  ]),
  dimension: typed('dimension', 'Dimension', [nameField, levelField, { key: 'offset', label: 'Line offset', kind: 'length', section: 'Placement', step: 100 }]),
  label: typed('label', 'Text label', [
    levelField,
    { key: 'text', label: 'Text', kind: 'text', section: 'Identity', set: (_l, v) => ({ text: String(v ?? '') }) as Partial<Element> },
    {
      key: 'size',
      label: 'Text height (paper)',
      kind: 'select',
      section: 'Appearance',
      options: opts([['2.5', '2.5 mm — notes'], ['3.5', '3.5 mm — standard'], ['5', '5 mm — titles'], ['7', '7 mm — headings']]),
      get: (l) => String(l.size),
      set: (_l, v) => ({ size: parseFloat(String(v)) }) as Partial<Element>,
    },
    rotationField() as FieldDef<ElementOfType<'label'>>,
    axisField('position', 'x', 'X'),
    axisField('position', 'y', 'Y'),
  ]),
};

function defDim(catalogId: string, k: 'width' | 'depth' | 'height', u: UnitSystem): string {
  const def = getFurniture(catalogId);
  return def ? `Default · ${formatLength(def[k], u)}` : 'Default';
}

export function schemaFor(type: ElementType): ElementSchema {
  return ELEMENT_SCHEMAS[type];
}

export function isFieldVisible(field: FieldDef, el: Element): boolean {
  return field.visible ? field.visible(el) : true;
}

/** Fields editable for all `elements` at once (same key and kind, visible for each). */
export function commonFields(elements: readonly Element[]): FieldDef[] {
  if (!elements.length) return [];
  const [first, ...rest] = elements;
  return schemaFor(first.type).fields.filter((f) => {
    if (!isFieldVisible(f, first)) return false;
    return rest.every((el) => {
      const g = schemaFor(el.type).fields.find((x) => x.key === f.key);
      return !!g && g.kind === f.kind && isFieldVisible(g, el);
    });
  });
}

/** Field definition of `key` for an element's own type (multi-selection mixes types). */
export function fieldFor(el: Element, key: string): FieldDef | undefined {
  return schemaFor(el.type).fields.find((f) => f.key === key);
}

export function getFieldValue(field: FieldDef, el: Element, project: ProjectView): FieldValue {
  if (field.get) return field.get(el, project);
  return Reflect.get(el, field.key) as FieldValue;
}

/** Shared value across elements, or `mixed` when they differ. */
export function commonValue(field: FieldDef, elements: readonly Element[], project: ProjectView): { value: FieldValue; mixed: boolean } {
  const values = elements.map((el) => getFieldValue(fieldFor(el, field.key) ?? field, el, project));
  const first = values[0];
  const same = values.every((v) => (typeof v === 'number' && typeof first === 'number' ? Math.abs(v - first) < 1e-6 : v === first));
  return { value: same ? first : undefined, mixed: !same };
}

/** Text shown in an input for a value. */
export function formatFieldValue(field: FieldDef, value: FieldValue, units: UnitSystem): string {
  if (value === undefined || value === null) return '';
  switch (field.kind) {
    case 'length':
      return typeof value === 'number' ? displayLength(value, units) : String(value);
    case 'angle':
      return typeof value === 'number' ? displayAngle(value) : String(value);
    case 'number':
      return typeof value === 'number' ? `${Math.round(value * 1000) / 1000}${field.suffix ? ` ${field.suffix}` : ''}` : String(value);
    default:
      return String(value);
  }
}

export type ParseResult = { ok: true; value: FieldValue } | { ok: false; error: string };

/** Parse user input for a field (lengths accept unit strings like "2.4m", "8'6\"", "240cm"). */
export function parseFieldInput(field: FieldDef, raw: string, units: UnitSystem): ParseResult {
  const s = raw.trim();
  if (field.kind === 'text' || field.kind === 'textarea') return { ok: true, value: raw };
  if (field.kind === 'checkbox') return { ok: true, value: s === 'true' || s === '1' || s === 'on' };
  if (field.kind === 'select' || field.kind === 'material' || field.kind === 'furniture' || field.kind === 'level') {
    if (!s) return field.optional ? { ok: true, value: undefined } : { ok: false, error: 'Choose a value' };
    if (field.options && !field.options.some((o) => o.value === s)) return { ok: false, error: 'Unknown option' };
    return { ok: true, value: s };
  }
  if (!s) return field.optional ? { ok: true, value: undefined } : { ok: false, error: 'A value is required' };
  let v: number | null;
  if (field.kind === 'length') v = parseLength(s, units);
  else if (field.kind === 'angle') v = parseAngle(s);
  else v = parseNumber(s);
  if (v === null || !Number.isFinite(v)) {
    const example = field.kind === 'length' ? (units === 'imperial' ? `e.g. 8'6" or 30"` : 'e.g. 2400, 2.4m or 240cm') : 'a number';
    return { ok: false, error: `Enter ${field.kind === 'length' ? 'a length' : 'a value'} (${example})` };
  }
  if (field.wrap) v = normalizeDeg(v);
  if (field.min !== undefined && v < field.min - 1e-9) return { ok: false, error: `Minimum is ${formatFieldValue(field, field.min, units)}` };
  if (field.max !== undefined && v > field.max + 1e-9) return { ok: false, error: `Maximum is ${formatFieldValue(field, field.max, units)}` };
  return { ok: true, value: v };
}

/** Patch for one element (null = nothing to change). */
export function buildPatch(field: FieldDef, el: Element, value: FieldValue, project: ProjectView): Partial<Element> | null {
  const def = fieldFor(el, field.key) ?? field;
  if (def.set) return def.set(el, value, project);
  return { [def.key]: value } as Partial<Element>;
}

/**
 * Apply a field edit to every element in `ids` as ONE undo step.
 * Moving a wall to another level carries its hosted openings along.
 * Returns the number of elements changed.
 */
export function applyFieldEdit(store: DocumentStore, ids: readonly string[], field: FieldDef, value: FieldValue): number {
  const project = store.project as Project;
  const targets = ids.map((id) => store.getElement(id)).filter((e): e is Element => !!e && !e.locked);
  if (!targets.length) return 0;
  const label = targets.length === 1 ? `Edit ${schemaFor(targets[0].type).title.toLowerCase()} ${field.label.toLowerCase()}` : `Edit ${field.label.toLowerCase()} of ${targets.length} elements`;
  let changed = 0;
  store.transact(label, (tx) => {
    for (const el of targets) {
      const cur = tx.get(el.id);
      if (!cur) continue;
      const patch = buildPatch(field, cur, value, project);
      if (!patch) continue;
      tx.update(el.id, patch);
      changed++;
      if (field.key === 'levelId' && cur.type === 'wall' && typeof value === 'string') {
        for (const o of openingsOfWall(project, cur.id)) tx.update(o.id, { levelId: value });
      }
    }
  });
  return changed;
}

// -----------------------------------------------------------------------------
// Computed (read-only) information
// -----------------------------------------------------------------------------

export interface InfoRow {
  label: string;
  value: string;
  tone?: 'ok' | 'warn';
  hint?: string;
}

const pathLength = (pts: Vec2[]) => pts.reduce((a, p, i) => (i ? a + distance(pts[i - 1], p) : a), 0);

export function computedInfo(el: Element, project: ProjectView, units: UnitSystem): InfoRow[] {
  const L = (mm: number) => formatLength(mm, units);
  const A = (mm2: number) => formatArea(mm2, units);
  const V = (mm3: number) => formatVolume(mm3, units);
  switch (el.type) {
    case 'wall': {
      const q = wallQuantity(project, el);
      const n = openingsOfWall(project, el.id).length;
      return [
        { label: 'Length', value: L(q.length) },
        { label: 'Height', value: L(wallHeight(project, el)) + (el.height === undefined ? ' (level)' : '') },
        { label: 'Gross area', value: A(q.grossArea) },
        { label: 'Openings', value: n ? `${n} · ${A(q.openingArea)}` : 'none' },
        { label: 'Net area', value: A(q.netArea) },
        { label: 'Volume', value: V(q.volume) },
        { label: 'Material', value: getMaterial(el.materialId ?? DEFAULT_MATERIAL_FOR.wall).name },
      ];
    }
    case 'door':
    case 'window': {
      const host = project.elements[el.hostId];
      const rows: InfoRow[] = [{ label: 'Opening area', value: A(el.width * el.height) }];
      if (host?.type === 'wall') {
        const fits = openingFits(project, host, el);
        rows.push({ label: 'Host wall', value: `${elementName(host)} · ${L(wallLength(host))}` });
        rows.push({ label: 'Fits host', value: fits ? 'Yes' : 'Outside wall bounds', tone: fits ? 'ok' : 'warn' });
        if (el.type === 'window') rows.push({ label: 'Head height', value: L(el.sill + el.height) });
      } else rows.push({ label: 'Host wall', value: 'Missing', tone: 'warn' });
      return rows;
    }
    case 'slab': {
      const a = slabArea(el, project);
      return [
        { label: 'Area', value: A(a) },
        { label: 'Perimeter', value: L(polygonPerimeter(el.outline)) },
        { label: 'Openings', value: String(slabHoles(project, el).length) },
        { label: 'Volume', value: V(a * el.thickness) },
      ];
    }
    case 'roof':
      return [
        { label: 'Footprint', value: A(polygonArea(el.outline)) },
        { label: 'Eave perimeter', value: L(polygonPerimeter(el.outline)) },
      ];
    case 'stair': {
      const lay = computeStairLayout(el, levelHeightOf(project, el));
      const pitch = (Math.atan2(lay.riserHeight, el.tread) * 180) / Math.PI;
      const blondel = 2 * lay.riserHeight + el.tread;
      const ok = blondel >= 550 && blondel <= 700;
      return [
        { label: 'Risers', value: `${lay.riserCount} × ${L(lay.riserHeight)}` },
        { label: 'Treads', value: `${lay.treads.length} × ${L(el.tread)}` },
        { label: 'Landings', value: String(lay.landings.length) },
        { label: 'Total rise', value: L(lay.rise) },
        { label: 'Pitch', value: `${pitch.toFixed(1)}°`, tone: pitch <= 42 ? 'ok' : 'warn' },
        { label: '2R + G', value: `${Math.round(blondel)} mm`, tone: ok ? 'ok' : 'warn', hint: 'Comfort rule: 550–700 mm (Blondel)' },
      ];
    }
    case 'column':
      return [
        { label: 'Height', value: L(el.height ?? levelHeightOf(project, el)) + (el.height === undefined ? ' (level)' : '') },
        { label: 'Volume', value: V(columnVolume(project, el)) },
      ];
    case 'beam': {
      const len = distance(el.start, el.end);
      return [
        { label: 'Length', value: L(len) },
        { label: 'Volume', value: V(len * el.width * el.depth) },
      ];
    }
    case 'furniture': {
      const def = getFurniture(el.catalogId);
      if (!def) return [{ label: 'Model', value: el.catalogId, tone: 'warn' }];
      return [
        { label: 'Model', value: def.name },
        { label: 'Size', value: `${L(el.width ?? def.width)} × ${L(el.depth ?? def.depth)} × ${L(el.height ?? def.height)}` },
      ];
    }
    case 'room':
      return el.outline.length >= 3
        ? [
            { label: 'Area', value: A(polygonArea(el.outline)) },
            { label: 'Perimeter', value: L(polygonPerimeter(el.outline)) },
          ]
        : [{ label: 'Area', value: 'No boundary', tone: 'warn' }];
    case 'block':
      return [{ label: 'Volume', value: V(elementVolume(project, el)) }];
    case 'railing':
      return [{ label: 'Length', value: L(pathLength(el.path)) }];
    case 'dimension':
      return [{ label: 'Measured', value: L(distance(el.a, el.b)) }];
    default:
      return [];
  }
}
