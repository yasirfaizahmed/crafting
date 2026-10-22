/**
 * Project persistence: open/save .craft files, autosave/restore, recent projects.
 *
 * NOTE: phase-0 baseline. The io owner implements autosave (IndexedDB/localStorage), file
 * open/save (File System Access API with download/upload fallback) and recovery.
 */
import type { Project } from '../core/types';

/** Project to open on startup (e.g. the autosaved session), or null for the sample project. */
export async function loadInitialProject(): Promise<Project | null> {
  return null;
}
