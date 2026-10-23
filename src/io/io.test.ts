// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppContext } from '../app/context';
import { createSampleProject } from '../app/sample';
import { createElement } from '../core/defaults';
import { parseProject, serializeProject } from '../core/serialization';
import { DocumentStore } from '../core/store';
import { Autosaver, AUTOSAVE_KEY, loadAutosave } from './autosave';
import { FileSession, readBlobText, type FileHandleLike, type FilePickers } from './files';
import {
  clearAutosave,
  configureIO,
  currentFileName,
  listRecentProjects,
  loadInitialProject,
  openProjectFile,
  openRecentProject,
  saveProjectFile,
  startAutosave,
} from './index';
import { MAX_RECENT, RECENT_INDEX_KEY, RecentProjects } from './recent';
import { FallbackStore, IndexedDBStore, LocalStorageStore, MemoryStore, type KVStore } from './storage';

/** Storage whose writes can be observed and made to fail. */
class SpyStore extends MemoryStore {
  writes: string[] = [];
  fail = false;
  override async set(key: string, value: string): Promise<void> {
    if (this.fail) throw new Error('quota exceeded');
    this.writes.push(key);
    await super.set(key, value);
  }
}

function addWall(store: DocumentStore, x: number): void {
  store.add(createElement('wall', store.project.levels[0].id, { start: { x, y: 0 }, end: { x: x + 1000, y: 0 } }));
}

describe('Autosaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('debounces writes ~1.5 s after the last change and round-trips the project', async () => {
    const storage = new SpyStore();
    const store = new DocumentStore(createSampleProject());
    const saver = new Autosaver(store, { storage });
    saver.start();
    addWall(store, 0);
    await vi.advanceTimersByTimeAsync(1000);
    addWall(store, 2000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.writes).toEqual([]);
    expect(saver.pending).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(storage.writes).toEqual([AUTOSAVE_KEY]);
    expect(saver.pending).toBe(false);
    const restored = await loadAutosave(storage);
    expect(restored).not.toBeNull();
    expect(Object.keys(restored!.elements).sort()).toEqual(Object.keys(store.project.elements).sort());
    expect(restored!.id).toBe(store.project.id);
    // No change → no further writes.
    await vi.advanceTimersByTimeAsync(5000);
    expect(storage.writes).toHaveLength(1);
    await saver.stop();
  });

  it('flushes immediately when the page is hidden or unloaded', async () => {
    const storage = new SpyStore();
    const store = new DocumentStore(createSampleProject());
    const doc = new EventTarget() as EventTarget & { visibilityState: DocumentVisibilityState };
    doc.visibilityState = 'visible';
    const win = new EventTarget();
    const saver = new Autosaver(store, { storage, document: doc, window: win });
    saver.start();
    addWall(store, 0);
    doc.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(storage.writes).toHaveLength(0); // still visible
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.writes).toHaveLength(1);
    addWall(store, 5000);
    win.dispatchEvent(new Event('pagehide'));
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.writes).toHaveLength(2);
    await saver.stop();
    addWall(store, 9000);
    await vi.advanceTimersByTimeAsync(3000);
    expect(storage.writes).toHaveLength(2); // stopped
  });

  it('reports failures and keeps working', async () => {
    const storage = new SpyStore();
    const errors: unknown[] = [];
    const store = new DocumentStore(createSampleProject());
    const saver = new Autosaver(store, { storage, delay: 100, onError: (e) => errors.push(e) });
    saver.start();
    storage.fail = true;
    addWall(store, 0);
    await vi.advanceTimersByTimeAsync(200);
    expect(errors).toHaveLength(1);
    storage.fail = false;
    addWall(store, 3000);
    await vi.advanceTimersByTimeAsync(200);
    expect(storage.writes).toEqual([AUTOSAVE_KEY]);
    expect(saver.saves).toBe(1);
    await saver.stop();
  });

  it('ignores unreadable autosaves', async () => {
    const storage = new MemoryStore();
    expect(await loadAutosave(storage)).toBeNull();
    await storage.set(AUTOSAVE_KEY, '{"broken": ');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(await loadAutosave(storage)).toBeNull();
    await storage.set(AUTOSAVE_KEY, JSON.stringify({ format: 'crafting-project', project: { levels: [] } }));
    expect(await loadAutosave(storage)).toBeNull();
  });
});

describe('storage backends', () => {
  it('localStorage store prefixes keys', async () => {
    const s = new LocalStorageStore(window.localStorage);
    await s.set('a', '1');
    expect(window.localStorage.getItem('crafting:a')).toBe('1');
    expect(await s.get('a')).toBe('1');
    await s.delete('a');
    expect(await s.get('a')).toBeNull();
  });

  it('falls back when IndexedDB cannot be opened', async () => {
    const broken = {
      open() {
        const req: Record<string, unknown> = {};
        setTimeout(() => (req.onerror as () => void)?.(), 0);
        return req;
      },
    } as unknown as IDBFactory;
    const fallback = new MemoryStore();
    const s = new FallbackStore(new IndexedDBStore(broken), fallback);
    await s.set('k', 'v');
    expect(fallback.data.get('k')).toBe('v');
    expect(await s.get('k')).toBe('v');
    expect(s.kind).toBe('memory');
    await s.delete('k');
    expect(await s.get('k')).toBeNull();
  });

  it('falls back when the primary store rejects a write', async () => {
    const failing: KVStore = {
      kind: 'indexeddb',
      get: async () => null,
      set: async () => {
        throw new Error('QuotaExceededError');
      },
      delete: async () => undefined,
    };
    const fallback = new MemoryStore();
    const s = new FallbackStore(null, fallback);
    // Wrap the failing store as primary through a minimal IndexedDBStore look-alike.
    Object.assign(s as unknown as { primary: KVStore }, { primary: failing });
    await s.set('x', 'y');
    expect(fallback.data.get('x')).toBe('y');
    expect(await s.get('x')).toBe('y');
  });
});

describe('RecentProjects', () => {
  it('keeps the last 10 snapshots, most recent first, and evicts old ones', async () => {
    const storage = new MemoryStore();
    const recents = new RecentProjects(storage);
    const projects = Array.from({ length: 12 }, (_, i) => {
      const p = createSampleProject();
      p.info.name = `House ${i}`;
      return p;
    });
    for (const p of projects) await recents.add(p, i(p) === 3 ? 'data:image/png;base64,AAA' : undefined);
    function i(p: { info: { name: string } }) {
      return Number(p.info.name.split(' ')[1]);
    }
    const list = await recents.list();
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0].name).toBe('House 11');
    expect(list.map((r) => r.name)).not.toContain('House 0');
    expect(list.find((r) => r.name === 'House 3')?.thumbnail).toBe('data:image/png;base64,AAA');
    expect(await storage.get(`recent:project:${projects[0].id}`)).toBeNull();
    // Re-adding moves to the top and keeps the thumbnail.
    await recents.add(projects[3]);
    const again = await recents.list();
    expect(again[0].id).toBe(projects[3].id);
    expect(again[0].thumbnail).toBe('data:image/png;base64,AAA');
    expect(again).toHaveLength(MAX_RECENT);
    const opened = await recents.open(projects[5].id);
    expect(opened?.info.name).toBe('House 5');
    expect(Object.keys(opened!.elements)).toHaveLength(Object.keys(projects[5].elements).length);
  });

  it('drops entries whose snapshot is missing and survives a corrupt index', async () => {
    const storage = new MemoryStore();
    const recents = new RecentProjects(storage);
    const p = createSampleProject();
    await recents.add(p);
    await storage.delete(`recent:project:${p.id}`);
    expect(await recents.open(p.id)).toBeNull();
    expect(await recents.list()).toEqual([]);
    await storage.set(RECENT_INDEX_KEY, 'nonsense');
    expect(await recents.list()).toEqual([]);
    await storage.set(RECENT_INDEX_KEY, JSON.stringify([{ id: 1 }, { id: 'a', name: 'A', modified: 'x' }]));
    expect(await recents.list()).toEqual([{ id: 'a', name: 'A', modified: 'x' }]);
  });

  it('serialises concurrent adds', async () => {
    const recents = new RecentProjects(new MemoryStore());
    const ps = [createSampleProject(), createSampleProject(), createSampleProject()];
    await Promise.all(ps.map((p) => recents.add(p)));
    expect((await recents.list()).map((r) => r.id).sort()).toEqual(ps.map((p) => p.id).sort());
  });
});

// --- File System Access API fakes ---------------------------------------------------------------

class FakeHandle implements FileHandleLike {
  content = '';
  writes = 0;
  constructor(
    readonly name: string,
    content = '',
    public permission: PermissionState = 'granted',
  ) {
    this.content = content;
  }
  async getFile(): Promise<File> {
    return new File([this.content], this.name, { type: 'application/json' });
  }
  async createWritable() {
    let buf = '';
    return {
      write: async (d: string | Blob) => {
        buf += typeof d === 'string' ? d : await readBlobText(d);
      },
      close: async () => {
        this.content = buf;
        this.writes++;
      },
    };
  }
  async queryPermission() {
    return this.permission;
  }
  async requestPermission() {
    return this.permission;
  }
}

const abort = () => Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' });

describe('FileSession (File System Access API)', () => {
  it('saves to a picked file, then re-uses the handle until Save As', async () => {
    const handles: FakeHandle[] = [];
    const pickers: FilePickers = {
      showSaveFilePicker: async (o) => {
        const h = new FakeHandle(o.suggestedName ?? 'x.craft');
        handles.push(h);
        return h;
      },
    };
    const fs = new FileSession(() => pickers, async () => null, () => undefined);
    const p = createSampleProject();
    expect(await fs.save(p)).toBe(true);
    expect(handles).toHaveLength(1);
    expect(handles[0].name).toBe('Sample-House.craft');
    expect(parseProject(handles[0].content).id).toBe(p.id);
    p.info.name = 'Renamed';
    expect(await fs.save(p)).toBe(true);
    expect(handles).toHaveLength(1);
    expect(handles[0].writes).toBe(2);
    expect(parseProject(handles[0].content).info.name).toBe('Renamed');
    expect(await fs.save(p, true)).toBe(true);
    expect(handles).toHaveLength(2);
    // A different project never overwrites the previous file.
    expect(await fs.save(createSampleProject())).toBe(true);
    expect(handles).toHaveLength(3);
  });

  it('returns false when the picker is cancelled or permission denied', async () => {
    const fs = new FileSession(
      () => ({ showSaveFilePicker: async () => Promise.reject(abort()) }),
      async () => null,
      () => undefined,
    );
    expect(await fs.save(createSampleProject())).toBe(false);
    const denied = new FileSession(() => ({ showSaveFilePicker: async () => new FakeHandle('a.craft', '', 'denied') }), async () => null, () => undefined);
    expect(await denied.save(createSampleProject())).toBe(false);
    const broken = new FileSession(() => ({ showSaveFilePicker: async () => Promise.reject(new Error('disk full')) }), async () => null, () => undefined);
    await expect(broken.save(createSampleProject())).rejects.toThrow('disk full');
  });

  it('opens a picked file and validates it', async () => {
    const p = createSampleProject();
    const good = new FakeHandle('house.craft', serializeProject(p));
    const fs = new FileSession(() => ({ showOpenFilePicker: async () => [good], showSaveFilePicker: async () => new FakeHandle('other.craft') }), async () => null, () => undefined);
    const res = await fs.open();
    expect(res?.fileName).toBe('house.craft');
    expect(res?.project.id).toBe(p.id);
    // Save now writes back to the opened file.
    expect(await fs.save(res!.project)).toBe(true);
    expect(good.writes).toBe(1);
    const bad = new FileSession(() => ({ showOpenFilePicker: async () => [new FakeHandle('bad.craft', 'not json')] }), async () => null, () => undefined);
    await expect(bad.open()).rejects.toThrow();
    const cancelled = new FileSession(() => ({ showOpenFilePicker: async () => Promise.reject(abort()) }), async () => null, () => undefined);
    expect(await cancelled.open()).toBeNull();
  });

  it('falls back to <input type=file> and downloads', async () => {
    const p = createSampleProject();
    const downloads: { blob: Blob; name: string }[] = [];
    const fs = new FileSession(
      () => ({}),
      async (accept) => {
        expect(accept).toContain('.craft');
        return { name: 'picked.craft', text: serializeProject(p) };
      },
      (blob, name) => downloads.push({ blob, name }),
    );
    const res = await fs.open();
    expect(res?.fileName).toBe('picked.craft');
    expect(await fs.save(res!.project)).toBe(true);
    expect(downloads).toHaveLength(1);
    expect(downloads[0].name).toBe('picked.craft');
    expect(parseProject(await readBlobText(downloads[0].blob)).id).toBe(p.id);
  });
});

describe('io public API', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('autosaves the app store, restores it on startup and clears it', async () => {
    const storage = new MemoryStore();
    configureIO({ storage, pickers: {} });
    expect(await loadInitialProject()).toBeNull();
    const ctx = createAppContext(createSampleProject());
    const stop = startAutosave(ctx);
    expect(startAutosave(ctx)).toBeTypeOf('function'); // idempotent for the same store
    addWall(ctx.store, 0);
    await vi.advanceTimersByTimeAsync(1600);
    const restored = await loadInitialProject();
    expect(restored?.id).toBe(ctx.store.project.id);
    expect(Object.keys(restored!.elements)).toHaveLength(Object.keys(ctx.store.project.elements).length);
    // The autosaved session shows up in the recent list.
    const recent = await listRecentProjects();
    expect(recent[0]?.id).toBe(ctx.store.project.id);
    expect((await openRecentProject(recent[0].id))?.id).toBe(ctx.store.project.id);
    stop();
    await clearAutosave();
    expect(await loadInitialProject()).toBeNull();
  });

  it('save marks the store clean, remembers the file and updates recent projects', async () => {
    vi.useRealTimers(); // jsdom's FileReader is timer driven
    const storage = new MemoryStore();
    const handle = new FakeHandle('');
    let picks = 0;
    configureIO({
      storage,
      pickers: {
        showSaveFilePicker: async (o) => {
          picks++;
          Object.assign(handle, { name: o.suggestedName });
          return handle;
        },
        showOpenFilePicker: async () => [handle],
      },
    });
    const ctx = createAppContext(createSampleProject());
    const stop = startAutosave(ctx);
    addWall(ctx.store, 0);
    expect(ctx.store.isDirty).toBe(true);
    expect(await saveProjectFile(ctx.store.snapshot())).toBe(true);
    expect(ctx.store.isDirty).toBe(false);
    expect(currentFileName(ctx.store.project.id)).toBe('Sample-House.craft');
    expect(await saveProjectFile(ctx.store.snapshot())).toBe(true);
    expect(picks).toBe(1);
    expect(await saveProjectFile(ctx.store.snapshot(), { saveAs: true })).toBe(true);
    expect(picks).toBe(2);
    expect((await listRecentProjects())[0].name).toBe('Sample House');
    const opened = await openProjectFile();
    expect(opened?.project.id).toBe(ctx.store.project.id);
    stop();
  });
});
