/**
 * "Flights & landings" editor for a selected stair: every flight's steps, going and width, every
 * landing's turn, depth and well gap, plus split / add / remove flights and reset to the preset.
 * The first edit of a preset stair turns it into a custom one (stair.runs).
 */
import { editableRuns, resolveStairRuns } from '../../core/stairs';
import type { DocumentStore } from '../../core/store';
import type { Stair, StairLandingSpec, StairRuns, UnitSystem } from '../../core/types';
import { formatLength, parseLength } from '../../core/units';
import { getLevel } from '../../core/walls';
import { h } from '../dom';

type TurnKey = 'none' | 'left-90' | 'right-90' | 'left-180' | 'right-180';

const TURNS: [TurnKey, string][] = [
  ['none', 'Straight'],
  ['left-90', 'Turn left 90°'],
  ['right-90', 'Turn right 90°'],
  ['left-180', 'U-turn left 180°'],
  ['right-180', 'U-turn right 180°'],
];

const turnKey = (l: { turn: StairLandingSpec['turn']; angle: 90 | 180 }): TurnKey => (l.turn === 'none' ? 'none' : (`${l.turn}-${l.angle}` as TurnKey));

function fromTurnKey(k: TurnKey): Pick<StairLandingSpec, 'turn' | 'angle'> {
  if (k === 'none') return { turn: 'none' };
  const [turn, angle] = k.split('-');
  return { turn: turn as 'left' | 'right', angle: Number(angle) as 90 | 180 };
}

/** Split flight `i` with a straight landing; the riser count (and so the riser height) is unchanged. */
export function splitFlight(runs: StairRuns, i: number): StairRuns {
  const f = runs.flights[i];
  if (!f || f.treads < 3) return runs;
  const a = Math.floor((f.treads - 1) / 2);
  const flights = [...runs.flights];
  flights.splice(i, 1, { ...f, treads: a }, { ...f, treads: f.treads - 1 - a });
  const landings = [...runs.landings];
  landings.splice(i, 0, { turn: 'none' });
  return { flights, landings };
}

/** Remove flight `i` and the landing that joined it to its neighbour. */
export function removeFlight(runs: StairRuns, i: number): StairRuns {
  if (runs.flights.length <= 1) return runs;
  const flights = runs.flights.filter((_, k) => k !== i);
  const landings = [...runs.landings];
  landings.splice(Math.min(i, landings.length - 1), 1);
  return { flights, landings };
}

/** Append a landing (turning like the previous one, or straight) and a short flight. */
export function addFlight(runs: StairRuns): StairRuns {
  const prev = runs.landings[runs.landings.length - 1];
  return { flights: [...runs.flights, { treads: 3 }], landings: [...runs.landings, prev ? { ...prev, depth: undefined } : { turn: 'none' }] };
}

export interface StairRunsSection {
  el: HTMLElement;
  update(): void;
}

export function stairRunsSection(store: DocumentStore, stairId: string, units: () => UnitSystem, disabled: boolean): StairRunsSection {
  const el = h('div', { class: 'cr-prop-section cr-stair-runs' });
  let signature = '';

  const stair = () => store.getElement(stairId) as Stair | undefined;
  const levelHeight = (s: Stair) => getLevel(store.project, s.levelId)?.height ?? store.project.settings.levelHeight;

  const commit = (label: string, edit: (r: StairRuns) => StairRuns) => {
    const s = stair();
    if (!s) return;
    const runs = editableRuns(s, levelHeight(s));
    if (!runs) return;
    store.update<Stair>(s.id, { runs: edit(runs) }, label);
  };

  const lengthInput = (value: number | undefined, placeholder: number, onCommit: (v: number | undefined) => void, min: number) => {
    const input = h('input', { class: 'cr-input is-num', type: 'text', inputmode: 'decimal', disabled, placeholder: formatLength(placeholder, units()), 'aria-label': 'length' });
    input.value = value === undefined ? '' : formatLength(value, units());
    const done = () => {
      const t = input.value.trim();
      if (!t) return onCommit(undefined);
      const v = parseLength(t, units());
      if (v === null || v < min) {
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      input.removeAttribute('aria-invalid');
      onCommit(Math.round(v));
    };
    input.addEventListener('change', done);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
    return input;
  };

  const stepper = (value: number, min: number, onCommit: (v: number) => void, label: string) => {
    const input = h('input', { class: 'cr-input is-num cr-stair-steps', type: 'number', min: String(min), step: '1', disabled, 'aria-label': label });
    input.value = String(value);
    input.addEventListener('change', () => {
      const v = Math.round(Number(input.value));
      if (Number.isFinite(v) && v >= min) onCommit(v);
      else input.value = String(value);
    });
    return input;
  };

  const button = (text: string, title: string, run: () => void, cls = '') => {
    const b = h('button', { class: `cr-btn is-sm ${cls}`.trim(), type: 'button', title, disabled }, text);
    b.addEventListener('click', run);
    return b;
  };

  function render(): void {
    const s = stair();
    el.textContent = '';
    if (!s) return;
    const resolved = resolveStairRuns(s, levelHeight(s));
    if (!resolved) return;
    const custom = !!s.runs;
    const head = h(
      'div',
      { class: 'cr-stair-runs-head' },
      h('h4', { class: 'cr-prop-section-title' }, 'Flights & landings'),
      custom ? button('Reset to preset', 'Discard the custom flights and use the shape preset again', () => store.update<Stair>(s.id, { runs: undefined }, 'Reset stair flights')) : h('span', { class: 'cr-stair-runs-tag' }, 'Preset'),
    );
    el.appendChild(head);

    const list = h('div', { class: 'cr-stair-runs-list' });
    resolved.flights.forEach((f, i) => {
      const spec = s.runs?.flights[i];
      const row = h(
        'div',
        { class: 'cr-stair-flight' },
        h('span', { class: 'cr-stair-badge', title: `Flight ${i + 1}` }, String(i + 1)),
        h(
          'label',
          { class: 'cr-stair-field' },
          h('span', null, 'Steps'),
          stepper(f.treads, i === 0 ? 1 : 0, (v) => commit('Change flight steps', (r) => ({ ...r, flights: r.flights.map((x, k) => (k === i ? { ...x, treads: v } : x)) })), `Flight ${i + 1} steps`),
        ),
        h(
          'label',
          { class: 'cr-stair-field' },
          h('span', null, 'Going'),
          lengthInput(spec?.going, s.tread, (v) => commit('Change flight going', (r) => ({ ...r, flights: r.flights.map((x, k) => (k === i ? { ...x, going: v } : x)) })), 150),
        ),
        h(
          'label',
          { class: 'cr-stair-field' },
          h('span', null, 'Width'),
          lengthInput(spec?.width, s.width, (v) => commit('Change flight width', (r) => ({ ...r, flights: r.flights.map((x, k) => (k === i ? { ...x, width: v } : x)) })), 300),
        ),
        h(
          'span',
          { class: 'cr-stair-actions' },
          f.treads >= 3 ? button('Split', 'Add a landing in the middle of this flight (riser height stays the same)', () => commit('Add landing', (r) => splitFlight(r, i))) : null,
          resolved.flights.length > 1 ? button('✕', 'Remove this flight', () => commit('Remove flight', (r) => removeFlight(r, i)), 'is-danger') : null,
        ),
      );
      list.appendChild(row);
      const landing = resolved.landings[i];
      if (!landing) return;
      const lspec = s.runs?.landings[i];
      const select = h('select', { class: 'cr-select', disabled, 'aria-label': `Landing ${i + 1} turn` });
      for (const [k, label] of TURNS) select.appendChild(h('option', { value: k }, label));
      select.value = turnKey(landing);
      select.addEventListener('change', () =>
        commit('Change landing turn', (r) => ({ ...r, landings: r.landings.map((x, k) => (k === i ? { ...x, ...fromTurnKey(select.value as TurnKey), depth: undefined } : x)) })),
      );
      const fields: (HTMLElement | null)[] = [
        h('span', { class: 'cr-stair-badge is-landing', title: `Landing ${i + 1}` }, '↳'),
        h('label', { class: 'cr-stair-field is-wide' }, h('span', null, 'Landing'), select),
        h(
          'label',
          { class: 'cr-stair-field' },
          h('span', null, 'Depth'),
          lengthInput(lspec?.depth, landing.depth, (v) => commit('Change landing depth', (r) => ({ ...r, landings: r.landings.map((x, k) => (k === i ? { ...x, depth: v } : x)) })), 300),
        ),
        landing.turn !== 'none' && landing.angle === 180
          ? h(
              'label',
              { class: 'cr-stair-field' },
              h('span', null, 'Well gap'),
              lengthInput(lspec?.gap, landing.gap, (v) => commit('Change well gap', (r) => ({ ...r, landings: r.landings.map((x, k) => (k === i ? { ...x, gap: v } : x)) })), 0),
            )
          : null,
      ];
      list.appendChild(h('div', { class: 'cr-stair-landing' }, ...fields));
    });
    el.appendChild(list);
    el.appendChild(
      h(
        'div',
        { class: 'cr-stair-runs-foot' },
        button('+ Add flight', 'Add a landing and another flight at the top', () => commit('Add flight', addFlight)),
        h('span', { class: 'cr-stair-runs-hint' }, 'Empty fields follow the stair’s width and going'),
      ),
    );
  }

  // Never re-render under the user's cursor while they type; catch up when focus leaves.
  const typing = () => {
    const a = document.activeElement;
    return !!a && el.contains(a) && a.tagName === 'INPUT';
  };
  const api: StairRunsSection = {
    el,
    update() {
      const s = stair();
      const sig = s ? JSON.stringify([s.runs, s.shape, s.width, s.tread, s.turn, s.rise, s.maxRiser, s.firstFlightTreads, s.secondFlightTreads, units()]) : '';
      if (sig === signature || typing()) return;
      signature = sig;
      render();
    },
  };
  el.addEventListener('focusout', () => queueMicrotask(() => api.update()));
  return api;
}
