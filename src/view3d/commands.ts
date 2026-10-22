/** View commands registered by the 3D view (menus / command palette / keyboard). */
import type { CommandRegistry } from '../app/state';

export interface ViewCommandActions {
  toggleCamera(): void;
  toggleXray(): void;
  toggleCutAway(): void;
  resetCamera(): void;
  topView(): void;
  frameSelection(): void;
  /** True while the 3D view is focused or pointer-locked. */
  focused(): boolean;
}

/** Command ids and their single-key bindings (handled while the 3D view is focused). */
export const VIEW_KEYS: Record<string, string> = {
  f: 'view.toggleCamera',
  x: 'view.xray',
  c: 'view.cutAway',
};

export function registerViewCommands(commands: CommandRegistry, a: ViewCommandActions): () => void {
  const offs = [
    commands.register({ id: 'view.toggleCamera', label: 'Toggle Fly / Orbit Camera', group: 'View', shortcut: 'F', keys: ['f'], run: a.toggleCamera, when: a.focused }),
    commands.register({ id: 'view.xray', label: 'X-Ray Walls & Roofs', group: 'View', shortcut: 'X', keys: ['x'], run: a.toggleXray, when: a.focused }),
    commands.register({ id: 'view.cutAway', label: 'Cut Away Levels Above Active', group: 'View', shortcut: 'C', keys: ['c'], run: a.toggleCutAway, when: a.focused }),
    commands.register({ id: 'view.resetCamera', label: 'Reset 3D Camera', group: 'View', run: a.resetCamera, when: a.focused }),
    commands.register({ id: 'view.topView', label: '3D Top View', group: 'View', run: a.topView, when: a.focused }),
    commands.register({ id: 'view.frameSelection', label: 'Frame Selection in 3D', group: 'View', run: a.frameSelection, when: a.focused }),
  ];
  return () => offs.forEach((off) => off());
}
