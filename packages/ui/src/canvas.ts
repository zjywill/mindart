export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const MIN_SCALE = 0.12;
export const MAX_SCALE = 2.5;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function screenToWorld(
  viewport: Viewport,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: (screenX - viewport.x) / viewport.scale,
    y: (screenY - viewport.y) / viewport.scale,
  };
}

/** Zoom keeping the world point under the cursor fixed on screen. */
export function zoomAt(
  viewport: Viewport,
  screenX: number,
  screenY: number,
  factor: number,
): Viewport {
  const scale = clampScale(viewport.scale * factor);
  const applied = scale / viewport.scale;
  return {
    scale,
    x: screenX - (screenX - viewport.x) * applied,
    y: screenY - (screenY - viewport.y) * applied,
  };
}

/** Fit world bounds into a screen box, centred, never zooming in past 1:1. */
export function fitViewport(
  bounds: Bounds,
  width: number,
  height: number,
  padding = 72,
): Viewport {
  const worldWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const worldHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const scale = clampScale(
    Math.min(
      (width - padding * 2) / worldWidth,
      (height - padding * 2) / worldHeight,
      1,
    ),
  );
  return {
    scale,
    x: (width - worldWidth * scale) / 2 - bounds.minX * scale,
    y: (height - worldHeight * scale) / 2 - bounds.minY * scale,
  };
}

/**
 * Pointer-driven pan/zoom over a transformed layer. The controller owns the
 * viewport state; the app reads it to place things and to convert pointer
 * positions into world coordinates.
 */
export class CanvasController {
  viewport: Viewport = { x: 0, y: 0, scale: 1 };
  onchange: () => void = () => undefined;
  /** Called for a plain pointerdown on the canvas background. */
  onbackgrounddown: (event: PointerEvent) => void = () => undefined;

  readonly #region: HTMLElement;
  readonly #layer: HTMLElement;
  #panning: { pointerId: number; startX: number; startY: number } | null = null;

  constructor(region: HTMLElement, layer: HTMLElement) {
    this.#region = region;
    this.#layer = layer;

    region.addEventListener("wheel", (event) => this.#handleWheel(event), {
      passive: false,
    });
    region.addEventListener("pointerdown", (event) => {
      // Anything inside a card handles its own pointers.
      if ((event.target as HTMLElement).closest("[data-node-id]")) return;
      if (event.button !== 0 && event.button !== 1) return;
      this.onbackgrounddown(event);
      this.#panning = {
        pointerId: event.pointerId,
        startX: event.clientX - this.viewport.x,
        startY: event.clientY - this.viewport.y,
      };
      region.setPointerCapture(event.pointerId);
    });
    region.addEventListener("pointermove", (event) => {
      if (this.#panning?.pointerId !== event.pointerId) return;
      this.viewport.x = event.clientX - this.#panning.startX;
      this.viewport.y = event.clientY - this.#panning.startY;
      this.apply();
    });
    const endPan = (event: PointerEvent) => {
      if (this.#panning?.pointerId !== event.pointerId) return;
      this.#panning = null;
      if (region.hasPointerCapture(event.pointerId)) {
        region.releasePointerCapture(event.pointerId);
      }
    };
    region.addEventListener("pointerup", endPan);
    region.addEventListener("pointercancel", endPan);
  }

  #handleWheel(event: WheelEvent): void {
    event.preventDefault();
    const rect = this.#region.getBoundingClientRect();
    const screenX = event.clientX - rect.left;
    const screenY = event.clientY - rect.top;
    if (event.ctrlKey || event.metaKey) {
      // Trackpad pinches arrive as ctrl+wheel.
      const factor = Math.exp(-event.deltaY * 0.0022);
      this.viewport = zoomAt(this.viewport, screenX, screenY, factor);
    } else {
      this.viewport.x -= event.deltaX;
      this.viewport.y -= event.deltaY;
    }
    this.apply();
  }

  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.#region.getBoundingClientRect();
    return screenToWorld(
      this.viewport,
      clientX - rect.left,
      clientY - rect.top,
    );
  }

  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
    this.apply();
  }

  fitTo(bounds: Bounds): void {
    const rect = this.#region.getBoundingClientRect();
    this.setViewport(fitViewport(bounds, rect.width, rect.height));
  }

  zoomBy(factor: number): void {
    const rect = this.#region.getBoundingClientRect();
    this.viewport = zoomAt(
      this.viewport,
      rect.width / 2,
      rect.height / 2,
      factor,
    );
    this.apply();
  }

  apply(): void {
    const { x, y, scale } = this.viewport;
    this.#layer.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    this.onchange();
  }
}
