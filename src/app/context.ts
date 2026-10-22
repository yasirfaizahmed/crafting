import { DocumentStore } from '../core/store';
import type { Project } from '../core/types';
import { CommandRegistry, EventBus, initialUIState, Observable, Selection, type AppContext } from './state';

export function createAppContext(project: Project): AppContext {
  const store = new DocumentStore(project);
  const ui = new Observable(initialUIState(project.levels[0].id));
  const selection = new Selection();
  const ctx: AppContext = { store, ui, selection, events: new EventBus(), commands: new CommandRegistry() };

  // Keep UI state consistent with the document.
  store.subscribe((change) => {
    selection.prune((id) => !!store.getElement(id));
    const levels = store.project.levels;
    if (!levels.some((l) => l.id === ui.get().activeLevelId)) ui.set({ activeLevelId: levels[0].id });
    if (change.settingsChanged) ui.set({ displayUnits: store.project.settings.units });
  });
  return ctx;
}
