import type { Texture } from "three";
import { MeshBasicNodeMaterial, QuadMesh, RenderTarget, type WebGPURenderer } from "three/webgpu";
import { texture as tslTexture, uniform, uv, vec2 } from "three/tsl";

// Zero-readback 2D texture preview. The 2D preview pane used to re-bake the graph and read pixels back to
// the CPU on every edit; instead this samples the surface's ALREADY-BAKED channel texture directly on the
// GPU. A second WebGPURenderer cannot sample the main renderer's render targets (three tracks each render
// target's GPUTexture only in the backend that created it), so the MAIN renderer — which owns the baked
// textures — draws the tiled/zoomed/panned quad into a small per-canvas RenderTarget, then a same-device
// `copyTextureToTexture` blits it into that canvas's own WebGPU context. No re-bake, no readback, and the
// baked texture object is stable across bakes so a redraw only re-reads its (updated-in-place) pixels.

// MUST match the RenderTarget's format or copyTextureToTexture is a silent no-op (blank canvas).
const CANVAS_FORMAT: GPUTextureFormat = "rgba8unorm";
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
    wPx: 1,
    hPx: 1,
    raf: 0,
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
    ctx.configure({
      device: this.device,
      format: CANVAS_FORMAT,
      alphaMode: "opaque",
      usage: CANVAS_USAGE,
    });
    const rt = new RenderTarget(1, 1);
    rt.texture.colorSpace = colorSpace; // set so the quad's write re-encodes to the source channel's bytes
    this.surfaces.set(canvas, createSurfaceState(canvas, ctx, rt));
    return true;
  }

  detach(canvas: HTMLCanvasElement): void {
    const s = this.surfaces.get(canvas);
    if (!s) return;
    if (s.raf) cancelAnimationFrame(s.raf);
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
  requestRender(canvas: HTMLCanvasElement, tex: Texture | null, layout: PreviewLayout): void {
    const s = this.surfaces.get(canvas);
    if (!s || s.raf) return;
    s.raf = requestAnimationFrame(() => {
      s.raf = 0;
      this.renderNow(s, tex, layout);
    });
  }

  private renderNow(s: Surface, tex: Texture | null, layout: PreviewLayout): void {
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
    // Rebuild the sampling node only when the displayed texture OBJECT changes (channel switch) — not per
    // bake: the surface re-renders the SAME texture object in place, so only the uniforms below change.
    if (s.boundTex !== tex) {
      s.boundTex = tex;
      // Sample at (u, 1-v) so the render target's bottom-up content displays top-down (as the old readback
      // did after its row flip). Tiling/zoom via uTiles, pan via uPan — both in tile units.
      const coord = vec2(uv().x, uv().y.oneMinus()).mul(s.uTiles).add(s.uPan);
      s.material.colorNode = tslTexture(tex, coord);
      s.material.needsUpdate = true;
    }
    const tilePxDevice = Math.max(0.0001, tilePx * dpr);
    s.uTiles.value.set(wPx / tilePxDevice, hPx / tilePxDevice);
    s.uPan.value.set(-(panX * dpr) / tilePxDevice, (panY * dpr) / tilePxDevice);

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
