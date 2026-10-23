/** Recently opened / saved / edited projects: the last 10 snapshots with name, date and thumbnail. */
import { parseProject, serializeProject } from '../core/serialization';
import type { Project } from '../core/types';
import type { KVStore } from './storage';

export interface RecentProject {
  id: string;
  name: string;
  modified: string;
  /** Optional PNG data URL. */
  thumbnail?: string;
}

export const RECENT_INDEX_KEY = 'recent:index';
export const MAX_RECENT = 10;
const snapshotKey = (id: string) => `recent:project:${id}`;

function validEntry(x: unknown): x is RecentProject {
  const r = x as RecentProject;
  return !!r && typeof r.id === 'string' && typeof r.name === 'string' && typeof r.modified === 'string';
}

export class RecentProjects {
  /** Serialises index updates so concurrent adds never lose entries. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly storage: KVStore,
    private readonly max = MAX_RECENT,
  ) {}

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async readIndex(): Promise<RecentProject[]> {
    try {
      const raw = await this.storage.get(RECENT_INDEX_KEY);
      const list: unknown = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list.filter(validEntry) : [];
    } catch {
      return [];
    }
  }

  /** Most recent first. */
  list(): Promise<RecentProject[]> {
    return this.run(() => this.readIndex());
  }

  /** Store a snapshot and move the project to the top of the list (keeps the old thumbnail if none given). */
  add(project: Project, thumbnail?: string): Promise<void> {
    return this.run(async () => {
      const list = await this.readIndex();
      const prev = list.find((r) => r.id === project.id);
      const entry: RecentProject = {
        id: project.id,
        name: project.info.name || 'Untitled Project',
        modified: project.info.modified || new Date().toISOString(),
        ...(thumbnail ?? prev?.thumbnail ? { thumbnail: thumbnail ?? prev?.thumbnail } : {}),
      };
      await this.storage.set(snapshotKey(project.id), serializeProject(project));
      const next = [entry, ...list.filter((r) => r.id !== project.id)];
      const evicted = next.splice(this.max);
      await this.storage.set(RECENT_INDEX_KEY, JSON.stringify(next));
      await Promise.all(evicted.map((r) => this.storage.delete(snapshotKey(r.id)).catch(() => undefined)));
    });
  }

  /** Load a recent project; drops the entry and returns null when its snapshot is missing or corrupt. */
  open(id: string): Promise<Project | null> {
    return this.run(async () => {
      const text = await this.storage.get(snapshotKey(id));
      if (text) {
        try {
          return parseProject(text);
        } catch {
          /* fall through: forget the broken entry */
        }
      }
      const list = await this.readIndex();
      if (list.some((r) => r.id === id)) await this.storage.set(RECENT_INDEX_KEY, JSON.stringify(list.filter((r) => r.id !== id)));
      return null;
    });
  }

  remove(id: string): Promise<void> {
    return this.run(async () => {
      const list = await this.readIndex();
      await this.storage.set(RECENT_INDEX_KEY, JSON.stringify(list.filter((r) => r.id !== id)));
      await this.storage.delete(snapshotKey(id));
    });
  }
}
