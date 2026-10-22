/**
 * Welcome screen: start a blueprint, jump into the 3D world, open the sample / a file, import a
 * DXF or trace an image, plus the recent projects list.
 */
import { listRecentProjects, openRecentProject, type RecentProject } from '../../io';
import { confirmDiscard, errorMessage, loadProject, newProject, openProject, openSample, traceImage } from '../actions';
import { h, prefs } from '../dom';
import { timeAgo } from '../format';
import { icon } from '../icons';
import type { Shell } from '../types';
import { openModal, type ModalHandle } from './modal';

interface StartCard {
  id: string;
  title: string;
  text: string;
  art: string;
  tone: string;
  run: () => unknown;
  big?: boolean;
}

export function openWelcomeDialog(shell: Shell): ModalHandle {
  const project = shell.ctx.store.project;
  let modal: ModalHandle | null = null;
  const go = (fn: () => unknown) => () => {
    modal?.close();
    void Promise.resolve(fn()).catch((err) => shell.toast(errorMessage(err), 'error'));
  };
  const cards: StartCard[] = [
    {
      id: 'blueprint',
      title: 'Start with a 2D Blueprint',
      text: 'Draw walls, rooms, doors and stairs floor by floor, then press Generate 3D.',
      art: '📐',
      tone: 'is-blue',
      big: true,
      run: () => newProject(shell, 'plan'),
    },
    {
      id: 'world',
      title: 'Jump into the 3D World',
      text: 'Fly around and build Minecraft-style: right-click places, left-click breaks.',
      art: '🧱',
      tone: 'is-green',
      big: true,
      run: () => newProject(shell, '3d'),
    },
    { id: 'sample', title: 'Open the Sample House', text: 'A furnished two-storey house to explore.', art: '🏡', tone: 'is-amber', run: () => openSample(shell) },
    { id: 'open', title: 'Open Project…', text: 'Continue a .craft project file.', art: '📂', tone: 'is-slate', run: () => openProject(shell) },
    { id: 'dxf', title: 'Import DXF Blueprint…', text: 'Turn CAD linework into walls.', art: '📏', tone: 'is-violet', run: () => shell.openDialog('dxf-import') },
    { id: 'trace', title: 'Trace a Blueprint Image…', text: 'Scale a scan or photo, then draw over it.', art: '🖼️', tone: 'is-rose', run: () => traceImage(shell) },
  ];

  const cardEl = (c: StartCard) =>
    h(
      'button',
      { class: `cr-start-card ${c.tone} ${c.big ? 'is-big' : ''}`, type: 'button', 'data-start': c.id, onClick: go(c.run) },
      h('span', { class: 'cr-start-art', 'aria-hidden': 'true' }, c.art),
      h('span', { class: 'cr-start-text' }, h('strong', null, c.title), h('span', null, c.text)),
      c.big ? h('span', { class: 'cr-start-go', 'aria-hidden': 'true' }, icon('chevronRight')) : null,
    );

  const recentList = h('ul', { class: 'cr-recent-list' }, h('li', { class: 'cr-recent-empty' }, 'Loading…'));
  const renderRecent = (items: RecentProject[]) => {
    recentList.textContent = '';
    if (!items.length) {
      recentList.appendChild(h('li', { class: 'cr-recent-empty' }, 'Projects you open or save will appear here.'));
      return;
    }
    for (const r of items.slice(0, 6)) {
      const b = h(
        'button',
        { class: 'cr-recent-item', type: 'button', title: `Open ${r.name}` },
        r.thumbnail ? h('img', { class: 'cr-recent-thumb', src: r.thumbnail, alt: '' }) : h('span', { class: 'cr-recent-thumb is-blank', 'aria-hidden': 'true' }, '🏠'),
        h('span', { class: 'cr-recent-meta' }, h('strong', null, r.name), h('span', null, timeAgo(r.modified))),
      );
      b.addEventListener('click', async () => {
        if (!(await confirmDiscard(shell, 'open another project'))) return;
        try {
          const p = await openRecentProject(r.id);
          if (!p) {
            shell.toast(`“${r.name}” is no longer available`, 'warning');
            return;
          }
          modal?.close();
          loadProject(shell, p);
          shell.toast(`Opened ${r.name}`, 'success');
        } catch (err) {
          shell.toast(`Could not open “${r.name}”: ${errorMessage(err)}`, 'error');
        }
      });
      recentList.appendChild(h('li', null, b));
    }
  };
  listRecentProjects()
    .then(renderRecent)
    .catch(() => renderRecent([]));

  const showOnStart = h('input', { type: 'checkbox', checked: prefs.get('welcomeOnStart', true) });
  showOnStart.addEventListener('change', () => prefs.set('welcomeOnStart', showOnStart.checked));
  const cont = h('button', { class: 'cr-btn is-primary', type: 'button' }, `Continue with “${project.info.name}”`, icon('chevronRight'));

  const body = h(
    'div',
    { class: 'cr-welcome' },
    h(
      'div',
      { class: 'cr-welcome-hero' },
      h('div', { class: 'cr-welcome-logo', 'aria-hidden': 'true' }, logoMark()),
      h(
        'div',
        null,
        h('h2', { class: 'cr-welcome-title' }, 'Welcome to Crafting'),
        h('p', { class: 'cr-welcome-tag' }, 'Design real buildings the way you play Minecraft creative mode — and export real BIM: IFC, DXF, PDF, glTF.'),
      ),
    ),
    h(
      'div',
      { class: 'cr-welcome-grid' },
      h('div', { class: 'cr-start-big' }, ...cards.filter((c) => c.big).map(cardEl)),
      h('div', { class: 'cr-start-small' }, ...cards.filter((c) => !c.big).map(cardEl)),
      h('section', { class: 'cr-recent' }, h('h3', { class: 'cr-recent-title' }, icon('folderOpen'), 'Recent projects'), recentList),
    ),
  );
  modal = openModal({
    title: 'Welcome to Crafting',
    bare: true,
    size: 'xl',
    className: 'cr-welcome-modal',
    body,
    footer: [
      h('label', { class: 'cr-check' }, showOnStart, h('span', null, 'Show on startup')),
      h('span', { class: 'cr-flex' }),
      h('span', { class: 'cr-welcome-keys' }, h('kbd', null, 'E'), ' inventory · ', h('kbd', null, 'Tab'), ' switch views · ', h('kbd', null, 'F1'), ' help'),
      cont,
    ],
    initialFocus: '[data-start="blueprint"]',
  });
  cont.addEventListener('click', () => modal?.close());
  return modal;
}

/** The Crafting cube mark (isometric block with a blueprint grid face). */
export function logoMark(): SVGSVGElement {
  const t = document.createElement('template');
  t.innerHTML = `<svg viewBox="0 0 64 64" width="56" height="56" aria-hidden="true" class="cr-logo-svg">
    <path d="M32 4 58 18v28L32 60 6 46V18z" fill="#2a6fd6"/>
    <path d="M32 4 58 18 32 32 6 18z" fill="#6fb6ff"/>
    <path d="M6 18 32 32v28L6 46z" fill="#3d8ef0"/>
    <path d="M32 32 58 18v28L32 60z" fill="#1d58b3"/>
    <path d="M12 21.5l20 10.5M19 18l20 10.5M25.5 14.5l20 10.5M38.5 11 18.5 21.5M45 14.5 25 25M51.5 18l-20 10.5" stroke="#d6ecff" stroke-opacity=".55" stroke-width="1.1"/>
    <path d="M14 30v12l8 4.3V34.2z" fill="#9ed0ff" fill-opacity=".9"/>
    <path d="M40 36.5l10-5.4v8.6l-10 5.4z" fill="#ffd36b"/>
  </svg>`;
  return t.content.firstElementChild as SVGSVGElement;
}
