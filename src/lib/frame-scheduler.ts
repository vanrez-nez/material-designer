// On-demand render scheduling. Both the 3D scene preview (editor/panes/preview/boot.ts) and the 2D
// texture preview (editor/panes/textures/TexturePreviewGpu.ts) render only when something changes rather
// than on a continuous rAF loop. This is the shared coalescing primitive they both use: many `request()`
// calls in the same frame collapse to a single `requestAnimationFrame`, and the provided `render` callback
// runs once when that frame fires. The callback is responsible for reading the latest state at fire time,
// so bursts (a drag, a stream of bake-finish events) draw exactly one up-to-date frame.

export interface FrameScheduler {
  // Ensure a render happens on the next animation frame. Idempotent within a frame — extra calls are no-ops
  // until the scheduled frame fires.
  request(): void;
  // Cancel any pending frame (e.g. on unmount/dispose) so the callback can't run after teardown.
  cancel(): void;
}

export function createFrameScheduler(render: () => void): FrameScheduler {
  let raf = 0;
  return {
    request() {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        render();
      });
    },
    cancel() {
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
  };
}
