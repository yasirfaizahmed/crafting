/**
 * Project persistence & import. Public API used by the UI shell.
 *
 * NOTE: phase-0 baseline. Functions marked TODO are implemented by the io owner without changing
 * their signatures.
 */
import type { AppContext } from '../app/state';
import type { Element, Project } from '../core/types';

/** Project to open on startup (the autosaved session), or null to show the sample/welcome. */
export async function loadInitialProject(): Promise<Project | null> {
  return null; // TODO autosave restore
}

/** Start debounced autosave of ctx.store; returns a stop function. */
export function startAutosave(_ctx: AppContext): () => void {
  return () => undefined; // TODO
}

export async function clearAutosave(): Promise<void> {
  // TODO
}

/** Let the user pick a .craft file. Resolves null when cancelled. Throws on invalid files. */
export async function openProjectFile(): Promise<{ project: Project; fileName: string } | null> {
  return null; // TODO
}

/** Save the project to a .craft file (Save As prompts for a location when supported). */
export async function saveProjectFile(_project: Project, _options: { saveAs?: boolean } = {}): Promise<boolean> {
  return false; // TODO
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
  return f ? { name: f.name, text: await f.text() } : null;
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

export interface RecentProject {
  id: string;
  name: string;
  modified: string;
  /** Optional PNG data URL. */
  thumbnail?: string;
}

export async function listRecentProjects(): Promise<RecentProject[]> {
  return []; // TODO
}

export async function openRecentProject(_id: string): Promise<Project | null> {
  return null; // TODO
}

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
}

export function listDXFLayers(_text: string): DXFLayerInfo[] {
  return []; // TODO
}

/** Convert DXF linework into walls (not yet added to the store). */
export function importDXF(_text: string, _options: DXFImportOptions): Element[] {
  return []; // TODO
}
