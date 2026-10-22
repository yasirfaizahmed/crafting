/** Handle returned by mountPlanEditor(). */
export interface PlanHandle {
  resize(): void;
  setActive(active: boolean): void;
  /** Zoom to the given elements (or everything on the active level). */
  frame(ids?: string[]): void;
  dispose(): void;
}
