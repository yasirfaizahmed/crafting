import type { AppContext } from '../app/state';
import type { PlanHandle } from '../plan2d/types';
import type { ViewportHandle } from '../view3d/types';
import type { ClipboardData } from './clipboard';
import type { ConfirmOptions } from './dialogs/modal';
import type { ToastKind } from './toasts';

export type SidebarSide = 'left' | 'right';

/** Services shared by the shell's components (menus, panels, dialogs, commands). */
export interface Shell {
  ctx: AppContext;
  root: HTMLElement;
  /** Mounted views (null when a view failed to start, e.g. no WebGL). */
  plan: PlanHandle | null;
  viewport: ViewportHandle | null;
  toast(message: string, kind?: ToastKind): void;
  confirm(opts: ConfirmOptions): Promise<boolean>;
  /** 'welcome' | 'export' | 'project' | 'settings' | 'help' | 'shortcuts' | 'levels' | 'dxf-import' | 'palette' | 'about'. */
  openDialog(name: string, options?: Record<string, unknown>): void;
  toggleSidebar(side: SidebarSide, open?: boolean): void;
  isSidebarOpen(side: SidebarSide): boolean;
  /** Show a right-sidebar tab ('properties' | 'quantities'). */
  showTab(tab: 'properties' | 'quantities'): void;
  clipboard: { data: ClipboardData | null; pastes: number };
  /** Re-render chrome that depends on non-observable state (e.g. the store's dirty flag after a save). */
  refresh(): void;
}

export interface MountOptions {
  /** Show the welcome screen after mounting (default: only on a first run without autosave). */
  showWelcome?: boolean;
  /** Start io autosave (default true). */
  autosave?: boolean;
  /** View factories (tests inject stubs; defaults are the real plan editor and 3D viewport). */
  mountPlan?: (container: HTMLElement, ctx: AppContext) => PlanHandle;
  mountViewport?: (container: HTMLElement, ctx: AppContext) => ViewportHandle;
}
