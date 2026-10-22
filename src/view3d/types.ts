export interface CaptureOptions {
  width?: number;
  height?: number;
  /** 'image/png' (default) or 'image/jpeg'. */
  mime?: string;
}

/** Handle returned by mountViewport(). */
export interface ViewportHandle {
  /** Re-measure the container (call after layout changes). */
  resize(): void;
  /** Pause/resume rendering when the view is hidden/shown. */
  setActive(active: boolean): void;
  /** Render the current camera view to an image. */
  captureImage(options?: CaptureOptions): Promise<Blob>;
  /** Frame the given elements (or the whole model when empty/undefined). */
  frame(ids?: string[]): void;
  dispose(): void;
}
