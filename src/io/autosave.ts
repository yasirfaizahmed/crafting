/**
 * Debounced autosave of the document store into a KVStore, flushed immediately when the page is
 * hidden or unloaded. The serialised project is validated with parseProject on restore.
 */
import { parseProject, serializeProject } from '../core/serialization';
import type { DocumentStore } from '../core/store';
import type { Project } from '../core/types';
import type { KVStore } from './storage';

export const AUTOSAVE_KEY = 'autosave';
export const AUTOSAVE_DELAY = 1500;

type Listenable = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export interface AutosaveEnv {
  storage: KVStore;
  /** Debounce delay after the last change, ms. */
  delay?: number;
  /** Source of `visibilitychange` (the document). */
  document?: Listenable & { visibilityState?: DocumentVisibilityState };
  /** Source of `pagehide` (the window). */
  window?: Listenable;
  /** Called after each successful write with the saved snapshot. */
  onSaved?: (project: Project) => void | Promise<void>;
  onError?: (err: unknown) => void;
}

export class Autosaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private queue: Promise<void> = Promise.resolve();
  private unsubscribe: (() => void) | null = null;
  /** Number of completed writes (diagnostics / tests). */
  saves = 0;

  constructor(
    private readonly store: Pick<DocumentStore, 'subscribe' | 'snapshot'>,
    private readonly env: AutosaveEnv,
  ) {}

  private readonly onVisibility = () => {
    if (this.env.document?.visibilityState === 'hidden') void this.flush();
  };

  private readonly onPageHide = () => void this.flush();

  start(): () => void {
    if (this.unsubscribe) return () => this.stop();
    this.unsubscribe = this.store.subscribe(() => this.schedule());
    this.env.document?.addEventListener('visibilitychange', this.onVisibility);
    this.env.window?.addEventListener('pagehide', this.onPageHide);
    return () => this.stop();
  }

  /** Stop listening; a pending change is still written. */
  stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.env.document?.removeEventListener('visibilitychange', this.onVisibility);
    this.env.window?.removeEventListener('pagehide', this.onPageHide);
    return this.flush();
  }

  get pending(): boolean {
    return this.dirty;
  }

  schedule(): void {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.env.delay ?? AUTOSAVE_DELAY);
  }

  /** Write now if there are unsaved changes; resolves when all queued writes finished. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty) {
      this.dirty = false;
      const snapshot = this.store.snapshot();
      const text = serializeProject(snapshot);
      this.queue = this.queue
        .then(() => this.env.storage.set(AUTOSAVE_KEY, text))
        .then(async () => {
          this.saves++;
          await this.env.onSaved?.(snapshot);
        })
        .catch((err) => {
          if (this.env.onError) this.env.onError(err);
          else console.warn('Crafting: autosave failed', err);
        });
    }
    return this.queue;
  }
}

/** Restore the autosaved project, or null when there is none or it is unreadable. */
export async function loadAutosave(storage: KVStore): Promise<Project | null> {
  let text: string | null;
  try {
    text = await storage.get(AUTOSAVE_KEY);
  } catch {
    return null;
  }
  if (!text) return null;
  try {
    return parseProject(text);
  } catch (err) {
    console.warn('Crafting: ignoring an unreadable autosave', err);
    return null;
  }
}

export async function clearAutosaveIn(storage: KVStore): Promise<void> {
  await storage.delete(AUTOSAVE_KEY);
}
