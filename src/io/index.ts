/**
 * Project persistence & import. Public API used by the UI shell.
 *
 *  - autosave: IndexedDB (fallback localStorage), debounced 1.5 s after store changes and flushed
 *    when the page is hidden; restored by loadInitialProject (validated by parseProject);
 *  - .craft open/save through the File System Access API (handle kept for Save) with
 *    <input type=file> / download fallbacks;
 *  - recent projects: last 10 snapshots with name, modification date and a plan thumbnail;
 *  - DXF import: linework → walls (double-line detection, welding, joins).
 */
import type { AppContext } from '../app/state';
import type { DocumentStore } from '../core/store';
import type { Element, Project } from '../core/types';
import { Autosaver, clearAutosaveIn, loadAutosave } from './autosave';
import { dxfToWalls, inspectDXF } from './dxf';
import { FileSession, readBlobText, type FilePickers } from './files';
import { RecentProjects, type RecentProject } from './recent';
import { createDefaultStore, type KVStore } from './storage';
import { planThumbnail } from './thumbnail';

export type { RecentProject } from './recent';
export type { KVStore } from './storage';
export { MemoryStore } from './storage';
export { inspectDXF, type DXFInspection, type DXFUnitsInfo } from './dxf';

// --- module state ------------------------------------------------------------------------------

interface IOState {
  storage: KVStore;
  recents: RecentProjects;
  files: FileSession;
  /** Store whose project autosave tracks (for markSaved after Save). */
  store: DocumentStore | null;
  autosaver: Autosaver | null;
  thumb: { projectId: string; at: number; url?: string } | null;
}

let state: IOState | null = null;

function io(): IOState {
  if (!state) {
    const storage = createDefaultStore();
    state = {
      storage,
      recents: new RecentProjects(storage),
      files: new FileSession(
        () => (typeof window !== 'undefined' ? (window as unknown as FilePickers) : {}),
        (accept) => pickTextFile(accept),
        (blob, name) => downloadBlob(blob, name),
      ),
      store: null,
      autosaver: null,
      thumb: null,
    };
  }
  return state;
}

/**
 * Replace the persistence backend (tests, embedding). Resets file handles and recent caches;
 * stops a running autosave.
 */
export function configureIO(opts: { storage?: KVStore; pickers?: FilePickers } = {}): void {
  void state?.autosaver?.stop();
  const storage = opts.storage ?? createDefaultStore();
  state = {
    storage,
    recents: new RecentProjects(storage),
    files: new FileSession(
      () => opts.pickers ?? (typeof window !== 'undefined' ? (window as unknown as FilePickers) : {}),
      (accept) => pickTextFile(accept),
      (blob, name) => downloadBlob(blob, name),
    ),
    store: null,
    autosaver: null,
    thumb: null,
  };
}

const THUMB_INTERVAL_MS = 20_000;

/** Plan thumbnail, regenerated at most every 20 s per project (autosave runs often). */
function thumbnailFor(project: Project, force = false): string | undefined {
  const s = io();
  const now = Date.now();
  if (!force && s.thumb && s.thumb.projectId === project.id && now - s.thumb.at < THUMB_INTERVAL_MS) return s.thumb.url;
  let url: string | undefined;
  try {
    url = planThumbnail(project);
  } catch {
    url = undefined;
  }
  s.thumb = { projectId: project.id, at: now, url };
  return url;
}

async function remember(project: Project, forceThumb = false): Promise<void> {
  try {
    await io().recents.add(project, thumbnailFor(project, forceThumb));
  } catch (err) {
    console.warn('Crafting: could not update recent projects', err);
  }
}

// --- autosave ----------------------------------------------------------------------------------

/** Project to open on startup (the autosaved session), or null to show the sample/welcome. */
export async function loadInitialProject(): Promise<Project | null> {
  return loadAutosave(io().storage);
}

/** Start debounced autosave of ctx.store; returns a stop function. */
export function startAutosave(ctx: AppContext): () => void {
  const s = io();
  if (s.autosaver && s.store === ctx.store) return () => undefined; // already running for this store
  void s.autosaver?.stop();
  const autosaver = new Autosaver(ctx.store, {
    storage: s.storage,
    document: typeof document !== 'undefined' ? document : undefined,
    window: typeof window !== 'undefined' ? window : undefined,
    onSaved: (p) => remember(p),
  });
  s.autosaver = autosaver;
  s.store = ctx.store;
  autosaver.start();
  return () => {
    void autosaver.stop();
    if (s.autosaver === autosaver) {
      s.autosaver = null;
      s.store = null;
    }
  };
}

export async function clearAutosave(): Promise<void> {
  await clearAutosaveIn(io().storage);
}

// --- files -------------------------------------------------------------------------------------

/** Let the user pick a .craft file. Resolves null when cancelled. Throws on invalid files. */
export async function openProjectFile(): Promise<{ project: Project; fileName: string } | null> {
  const res = await io().files.open();
  if (res) await remember(res.project, true);
  return res;
}

/** Save the project to a .craft file (Save As prompts for a location when supported). */
export async function saveProjectFile(project: Project, options: { saveAs?: boolean } = {}): Promise<boolean> {
  const s = io();
  const ok = await s.files.save(project, options.saveAs ?? false);
  if (!ok) return false;
  if (s.store && s.store.project.id === project.id) s.store.markSaved();
  await remember(project, true);
  return true;
}

/** Name of the .craft file the given (or current) project was opened from / saved to. */
export function currentFileName(projectId?: string): string | null {
  return io().files.fileName(projectId);
}

/** Trigger a browser download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

export async function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  const f = await pickFile(accept);
  return f ? { name: f.name, text: await readBlobText(f) } : null;
}

export async function pickImageFile(): Promise<{ name: string; dataUrl: string; width: number; height: number } | null> {
  const f = await pickFile('image/*');
  if (!f) return null;
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  return { name: f.name, dataUrl, width: img.naturalWidth, height: img.naturalHeight };
}

// --- recent projects ---------------------------------------------------------------------------

export async function listRecentProjects(): Promise<RecentProject[]> {
  return io().recents.list();
}

export async function openRecentProject(id: string): Promise<Project | null> {
  const project = await io().recents.open(id);
  if (project) {
    io().files.forget();
    await remember(project);
  }
  return project;
}

// --- DXF -----------------------------------------------------------------------------------------

export interface DXFLayerInfo {
  name: string;
  entityCount: number;
}

export interface DXFImportOptions {
  levelId: string;
  /** Only import entities on these layers (default: all). */
  layers?: string[];
  /** Multiply DXF coordinates by this to get mm (1 = mm, 10 = cm, 1000 = m, 25.4 = inch). Default from $INSUNITS. */
  unitScale?: number;
  /** Thickness for walls created from single lines, mm. */
  wallThickness: number;
  /** Detect pairs of parallel lines (double-line walls) and convert them to one wall of that thickness. */
  detectDoubleLines: boolean;
  /** Ignore segments shorter than this (mm). */
  minLength?: number;
  /** Move drawings with far-away (survey) coordinates next to the origin. Default: only when > 100 m away. */
  recenter?: boolean;
}

export function listDXFLayers(text: string): DXFLayerInfo[] {
  return inspectDXF(text).layers;
}

/** Convert DXF linework into walls (not yet added to the store). */
export function importDXF(text: string, options: DXFImportOptions): Element[] {
  return dxfToWalls(text, options);
}
