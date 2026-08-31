import type { Texture } from "three";
import { MeshBasicNodeMaterial, QuadMesh, RenderTarget, type WebGPURenderer } from "three/webgpu";
import { texture as tslTexture, uniform, uv, vec2, vec3 } from "three/tsl";
import { createFrameScheduler, type FrameScheduler } from "@/lib/frame-scheduler";
import type { TextureChannelView } from "@/editor/panes/textures/channels";

// Zero-readback 2D texture preview. The 2D preview pane used to re-bake the graph and read pixels back to
// the CPU on every edit; instead this samples the surface's ALREADY-BAKED channel texture directly on the
// GPU. A second WebGPURenderer cannot sample the main renderer's render targets (three tracks each render
// target's GPUTexture only in the backend that created it), so the MAIN renderer — which owns the baked
// textures — draws the tiled/zoomed/panned quad into a small per-canvas RenderTarget, then a same-device
// `copyTextureToTexture` blits it into that canvas's own WebGPU context. No re-bake, no readback, and the
// baked texture object is stable across bakes so a redraw only re-reads its (updated-in-place) pixels.

// The canvas is configured with the device-PREFERRED format so the browser doesn't insert an extra copy
// on present (the "different format than preferred" warning). The per-canvas RenderTarget is then forced
// to this SAME GPUTextureFormat (via texture.internalFormat in attach) — copyTextureToTexture requires
// both textures to share a format, otherwise it's a silent no-op (blank canvas).
function preferredCanvasFormat(): GPUTextureFormat {
  return typeof navigator !== "undefined" && navigator.gpu
    ? navigator.gpu.getPreferredCanvasFormat()
    : "rgba8unorm";
}
// GPUTextureUsage flag bits (COPY_DST=0x02, RENDER_ATTACHMENT=0x10) — spelled out to avoid depending on the
// ambient `GPUTextureUsage` runtime const, which isn't reliably declared as a value in this typings setup.
const CANVAS_USAGE = 0x02 | 0x10;

export type PreviewLayout = {
  cssWidth: number;
  cssHeight: number;
  dpr: number;
  tilePx: number; // one texture tile in CSS px (tileSize * zoom)
  panX: number; // CSS px
  panY: number; // CSS px
};

function createSurfaceState(canvas: HTMLCanvasElement, ctx: GPUCanvasContext, rt: RenderTarget) {
  const material = new MeshBasicNodeMaterial();
  material.toneMapped = false; // preview shows raw baked values, not the tone-mapped scene
  return {
    canvas,
    ctx,
    rt,
    material,
    quad: new QuadMesh(material),
    uTiles: uniform(vec2(1, 1)),
    uPan: uniform(vec2(0, 0)),
    boundTex: null as Texture | null,
    boundView: "rgb" as TextureChannelView,
    wPx: 1,
    hPx: 1,
    // Latest requested draw, rendered when the coalesced frame fires (see requestRender). The scheduler is
    // assigned in attach() where `this.renderNow` is reachable.
    pendingTex: null as Texture | null,
    pendingView: "rgb" as TextureChannelView,
    pendingLayout: null as PreviewLayout | null,
    scheduler: null as FrameScheduler | null,
  };
}
type Surface = ReturnType<typeof createSurfaceState>;

type RendererWithBackend = WebGPURenderer & {
  backend: { device: GPUDevice; get(object: unknown): { texture?: GPUTexture } | undefined };
};

export class TexturePreviewGpu {
  private readonly surfaces = new Map<HTMLCanvasElement, Surface>();

  constructor(private readonly renderer: RendererWithBackend) {}

  private get device(): GPUDevice {
    return this.renderer.backend.device;
  }

  hasCanvas(canvas: HTMLCanvasElement): boolean {
    return this.surfaces.has(canvas);
  }

  attach(canvas: HTMLCanvasElement, colorSpace: string): boolean {
    if (this.surfaces.has(canvas)) return true;
    const ctx = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!ctx) return false;
    const format = preferredCanvasFormat();
    ctx.configure({
      device: this.device,
      format,
      alphaMode: "opaque",
      usage: CANVAS_USAGE,
    });
    const rt = new RenderTarget(1, 1);
    rt.texture.colorSpace = colorSpace; // set so the quad's write re-encodes to the source channel's bytes
    // Match the canvas so copyTextureToTexture stays a same-format blit. three types `internalFormat` as
    // WebGL2 names, but its WebGPU backend reads it as a raw GPUTextureFormat (WebGPUTextureUtils: the RT
    // GPUTexture is allocated as `texture.internalFormat || …`), so the cast is the intended override.
    (rt.texture as unknown as { internalFormat: GPUTextureFormat }).internalFormat = format;
    const s = createSurfaceState(canvas, ctx, rt);
    // Same coalescing primitive the 3D scene uses (see @/lib/frame-scheduler): the callback renders this
    // surface's LATEST pending draw when the single scheduled frame fires.
    s.scheduler = createFrameScheduler(() => {
      if (s.pendingLayout) this.renderNow(s, s.pendingTex, s.pendingLayout, s.pendingView);
    });
    this.surfaces.set(canvas, s);
    return true;
  }

  detach(canvas: HTMLCanvasElement): void {
    const s = this.surfaces.get(canvas);
    if (!s) return;
    s.scheduler?.cancel();
    s.rt.dispose();
    s.material.dispose();
    try {
      s.ctx.unconfigure();
    } catch {
      /* context may already be gone */
    }
    this.surfaces.delete(canvas);
  }

  // The source channel's colorSpace can change when the interactive canvas switches channels (color↔data).
  setColorSpace(canvas: HTMLCanvasElement, colorSpace: string): void {
    const s = this.surfaces.get(canvas);
    if (!s || s.rt.texture.colorSpace === colorSpace) return;
    s.rt.texture.colorSpace = colorSpace;
    s.rt.texture.needsUpdate = true;
  }

  // Draw `tex` into `canvas`, tiled/zoomed/panned per `layout`. rAF-coalesced so bursts (pan/zoom, or a
  // stream of bake-finish events) collapse to one draw per frame. No-op if the canvas isn't attached.
  // `view` picks the displayed component (see TextureChannelView): "rgb" shows the texture as-is, a single
  // component renders as grayscale — how a packed-ARM channel gets its own separate preview.
  requestRender(
    canvas: HTMLCanvasElement,
    tex: Texture | null,
    layout: PreviewLayout,
    view: TextureChannelView = "rgb",
  ): void {
    const s = this.surfaces.get(canvas);
    if (!s) return;
    // Coalesce to the LATEST request, not the first. During a pan/zoom `pan` changes several times per
    // frame and the seam overlay redraws synchronously on each change; if we rendered the frame's FIRST
    // captured layout the texture would visibly lag the overlay (seams "move independently"). Store the
    // newest layout and render that when the single scheduled frame fires.
    s.pendingTex = tex;
    s.pendingView = view;
    s.pendingLayout = layout;
    s.scheduler?.request();
  }

  private renderNow(
    s: Surface,
    tex: Texture | null,
    layout: PreviewLayout,
    view: TextureChannelView,
  ): void {
    const { cssWidth, cssHeight, dpr, tilePx, panX, panY } = layout;
    if (!tex || cssWidth <= 0 || cssHeight <= 0) return;
    const wPx = Math.max(1, Math.round(cssWidth * dpr));
    const hPx = Math.max(1, Math.round(cssHeight * dpr));
    if (s.canvas.width !== wPx || s.canvas.height !== hPx) {
      s.canvas.width = wPx;
      s.canvas.height = hPx;
    }
    // Resize the RT only when the canvas size actually changes — never per bake (that would reintroduce the
    // per-edit GPU allocation this refactor removes).
    if (s.wPx !== wPx || s.hPx !== hPx) {
      s.rt.setSize(wPx, hPx);
      s.wPx = wPx;
      s.hPx = hPx;
    }
    // Rebuild the sampling node only when the displayed texture OBJECT or the view changes (channel switch)
    // — not per bake: the surface re-renders the SAME texture object in place, so only the uniforms below
    // change. The view is part of the key because packed-ARM channels SHARE one texture object — identity
    // alone would keep showing the previous channel's component.
    if (s.boundTex !== tex || s.boundView !== view) {
      s.boundTex = tex;
      s.boundView = view;
      // Sample at (u, 1-v) so the render target's bottom-up content displays top-down (as the old readback
      // did after its row flip). Tiling/zoom via uTiles, pan via uPan — both in tile units.
      const coord = vec2(uv().x, uv().y.oneMinus()).mul(s.uTiles).add(s.uPan);
      const sampled = tslTexture(tex, coord);
      // Single-component views broadcast to grayscale (the separate per-channel look of a packed texture).
      s.material.colorNode =
        view === "rgb"
          ? sampled
          : vec3(view === "r" ? sampled.r : view === "g" ? sampled.g : sampled.b);
      s.material.needsUpdate = true;
    }
    const tilePxDevice = Math.max(0.0001, tilePx * dpr);
    s.uTiles.value.set(wPx / tilePxDevice, hPx / tilePxDevice);
    // Pan. X maps straight through: coord.x = (sxDevice - panX*dpr) / tilePxDevice.
    // Y is sampled through the (1 - uv.y) flip above (upright display), which both reverses the pan frame
    // and shifts it by the canvas height. To land the Y tile boundaries at screen y = panY — matching the
    // seam overlay's `pan.y + n*tile` — keep panY POSITIVE (natural drag: content follows the cursor) and
    // subtract the flip's hPx offset. That yields coord.y = (panY*dpr - syDevice) / tilePxDevice, whose
    // boundaries sit at panY (mod tile) with a +1 pan slope, matching the overlay and centering wheel-zoom.
    s.uPan.value.set(-(panX * dpr) / tilePxDevice, (panY * dpr - hPx) / tilePxDevice);

    // 1) main renderer draws the tiled quad into this surface's RT (it owns `tex`, so sampling works).
    const prevRT = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(s.rt);
    s.quad.render(this.renderer);
    this.renderer.setRenderTarget(prevRT);

    // 2) same-device copy of the RT into the canvas's WebGPU context — zero readback.
    const rtGPU = this.renderer.backend.get(s.rt.texture)?.texture;
    if (!rtGPU) return;
    const dst = s.ctx.getCurrentTexture();
    const enc = this.device.createCommandEncoder();
    enc.copyTextureToTexture(
      { texture: rtGPU },
      { texture: dst },
      { width: wPx, height: hPx, depthOrArrayLayers: 1 },
    );
    this.device.queue.submit([enc.finish()]);
  }

  dispose(): void {
    for (const canvas of [...this.surfaces.keys()]) this.detach(canvas);
  }
}
