import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type PointerEvent,
  type RefObject,
} from "react";
import { ImageIcon, Loader2 } from "lucide-react";
import { NoColorSpace } from "three";

import { Button } from "@/components/ui/primitives/button";
import { cn } from "@/lib/utils";
import { useTexturePreviewStore } from "@/editor/panes/textures/store";
import { useWorkspaceStore } from "@/store/app";
import {
  TEXTURE_CHANNELS,
  sortedTextureSockets,
  type TextureChannelInfo,
} from "@/editor/panes/textures/channels";
import { TexturePreviewGpu } from "@/editor/panes/textures/TexturePreviewGpu";
import type { MaterialAppServices } from "@/components/app/services";
import type { PbrSocket } from "@/runtime";

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const WHEEL_LINE_DELTA_PX = 16;
const WHEEL_PAGE_DELTA_PX = 100;
const WHEEL_ZOOM_BASE = 0.95;
const WHEEL_ZOOM_SPEED = 1;

type CanvasSize = {
  height: number;
  width: number;
};

type PanOffset = {
  x: number;
  y: number;
};

export function TexturePreviewPane({ services }: { services: MaterialAppServices }) {
  const servicesSnapshot = useSyncExternalStore(
    (listener) => services.subscribe(listener),
    () => services.getSnapshot(),
    () => services.getSnapshot(),
  );
  const seams = useTexturePreviewStore((state) => state.seams);
  const tileSize = useTexturePreviewStore((state) => state.tileSize);
  const zoom = useTexturePreviewStore((state) => state.zoom);
  const setZoom = useTexturePreviewStore((state) => state.setZoom);
  const materialGraphEvent = useWorkspaceStore((state) => state.materialGraphEvent);
  const readerReady = servicesSnapshot.textureReady;

  const [connectedSockets, setConnectedSockets] = useState<PbrSocket[]>(() =>
    readConnectedSockets(services),
  );
  const [selectedSocket, setSelectedSocket] = useState<PbrSocket | null>(
    () => readConnectedSockets(services)[0] ?? null,
  );
  // Bumped on every bake re-render so the preview canvases redraw the (in-place updated) baked textures.
  const [bakeGeneration, setBakeGeneration] = useState(0);

  // ONE shared GPU preview renderer (wraps the main WebGPURenderer, which owns the baked textures), created
  // once the renderer exists and disposed on unmount. All preview canvases draw through it.
  const gpuRef = useRef<TexturePreviewGpu | null>(null);
  const [gpuReady, setGpuReady] = useState(false);
  useEffect(() => {
    if (!readerReady) return undefined;
    const renderer = services.getRenderer();
    if (!renderer) return undefined;
    const gpu = new TexturePreviewGpu(renderer as never);
    gpuRef.current = gpu;
    setGpuReady(true);
    return () => {
      gpu.dispose();
      gpuRef.current = null;
      setGpuReady(false);
    };
  }, [services, readerReady]);

  // Redraw + refresh the connected-channel list whenever the surface finishes a bake (structural OR uniform
  // re-render). The baked texture objects are stable across bakes, so this only re-reads their new content —
  // no re-bake, no readback.
  const refresh = useCallback(() => {
    setConnectedSockets(readConnectedSockets(services));
    setBakeGeneration((generation) => generation + 1);
  }, [services]);

  useEffect(() => {
    if (!readerReady) return undefined;
    refresh();
    return services.onTexturesUpdated(refresh);
  }, [services, readerReady, refresh]);

  // A layout-only edit doesn't re-bake (no onTexturesUpdated), but the connected set can't change on it
  // either, so nothing to do; other edits refresh via onTexturesUpdated above. Kept for immediate list
  // refresh on the very first event before the surface signal is wired.
  useEffect(() => {
    if (!materialGraphEvent || materialGraphEvent.change.kind === "layout") return;
    refresh();
  }, [materialGraphEvent, refresh]);

  const channels = textureChannelsForSockets(connectedSockets);
  const selectedChannel = channels.find((channel) => channel.socket === selectedSocket) ?? channels[0];

  useEffect(() => {
    if (channels.length === 0) {
      setSelectedSocket(null);
      return;
    }
    if (!selectedSocket || !channels.some((channel) => channel.socket === selectedSocket)) {
      setSelectedSocket(channels[0].socket);
    }
  }, [channels, selectedSocket]);

  const gpu = gpuReady ? gpuRef.current : null;
  const ready = readerReady && gpu !== null;

  return (
    <div className="texture-preview-pane">
      <div className="texture-preview-grid">
        {ready && selectedChannel ? (
          <>
            <div className="texture-preview-main">
              <InteractiveTextureCanvas
                gpu={gpu}
                services={services}
                socket={selectedChannel.socket}
                imageLabel={selectedChannel.label}
                seams={seams}
                tileSize={tileSize}
                zoom={zoom}
                onZoom={setZoom}
                bakeGeneration={bakeGeneration}
              />
            </div>
            <div className="texture-preview-thumbnails">
              {/* Only channels the current graph actually outputs get a thumb; empty channels are hidden
                  entirely (and when none are connected, the empty-state text below is shown instead). */}
              {channels.map((channel) => (
                <Button
                  key={channel.id}
                  className={cn(
                    "texture-preview-thumb",
                    selectedChannel.socket === channel.socket && "texture-preview-thumb--selected",
                  )}
                  title={channel.label}
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setSelectedSocket(channel.socket)}
                >
                  <StaticTextureCanvas
                    gpu={gpu}
                    services={services}
                    socket={channel.socket}
                    label={channel.label}
                    generated
                    bakeGeneration={bakeGeneration}
                  />
                  <span>{channel.label}</span>
                </Button>
              ))}
            </div>
          </>
        ) : (
          <div className="texture-preview-empty">
            <TexturePlaceholder
              label={readerReady ? "No connected texture outputs" : "Preview unavailable"}
              loading={!readerReady}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function InteractiveTextureCanvas({
  gpu,
  services,
  socket,
  imageLabel,
  seams,
  tileSize,
  onZoom,
  zoom,
  bakeGeneration,
}: {
  gpu: TexturePreviewGpu;
  services: MaterialAppServices;
  socket: PbrSocket;
  imageLabel: string;
  onZoom: (zoom: number) => void;
  seams: boolean;
  tileSize: number;
  zoom: number;
  bakeGeneration: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const seamsRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ origin: PanOffset; pointerId: number; start: PanOffset } | null>(null);
  const [pan, setPan] = useState<PanOffset>({ x: 0, y: 0 });
  const size = useElementSize(hostRef);
  const hasImage = services.getChannelTexture(socket) !== null;

  // Attach this canvas to the shared GPU renderer once; detach on unmount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const tex = services.getChannelTexture(socket);
    gpu.attach(canvas, tex?.colorSpace ?? NoColorSpace);
    return () => gpu.detach(canvas);
  }, [gpu, services, socket]);

  // Draw: re-render the baked texture (tiled/zoomed/panned) + the seam overlay whenever anything changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const tex = services.getChannelTexture(socket);
    if (tex) gpu.setColorSpace(canvas, tex.colorSpace);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    gpu.requestRender(canvas, tex, {
      cssWidth: size.width,
      cssHeight: size.height,
      dpr,
      tilePx: tileSize * zoom,
      panX: pan.x,
      panY: pan.y,
    });
    drawSeamsOverlay(seamsRef.current, size, tileSize * zoom, pan, seams);
  }, [gpu, services, socket, size, tileSize, zoom, pan, seams, bakeGeneration]);

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!hasImage) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      origin: { x: event.clientX, y: event.clientY },
      pointerId: event.pointerId,
      start: pan,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({
      x: drag.start.x + event.clientX - drag.origin.x,
      y: drag.start.y + event.clientY - drag.origin.y,
    });
  };

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  // Wheel-to-zoom needs a NON-passive native listener (React attaches onWheel as passive → preventDefault is
  // ignored). Bind manually; re-bound when the closed-over zoom/tile/size change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const onWheel = (event: globalThis.WheelEvent) => {
      if (!hasImage) return;
      const deltaY = normalizedWheelDelta(event.deltaY, event.deltaMode);
      if (event.altKey || event.metaKey || !Number.isFinite(deltaY) || deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const scale = wheelZoomScale(deltaY);
      const nextZoom = deltaY > 0 ? zoom * scale : zoom / scale;
      const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      if (clampedZoom === zoom) return;
      const currentTile = tileSize * zoom;
      const nextTile = tileSize * clampedZoom;
      const center = { x: size.width * 0.5, y: size.height * 0.5 };
      const ratio = nextTile / currentTile;
      setPan((current) => ({
        x: center.x - (center.x - current.x) * ratio,
        y: center.y - (center.y - current.y) * ratio,
      }));
      onZoom(clampedZoom);
    };

    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [hasImage, zoom, tileSize, size, onZoom]);

  return (
    <div ref={hostRef} className="texture-preview-canvas-host">
      <canvas
        ref={canvasRef}
        aria-label={`${imageLabel} preview`}
        className="texture-preview-canvas texture-preview-canvas--interactive"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      <canvas ref={seamsRef} className="texture-preview-seams" aria-hidden="true" />
      {!hasImage ? <TexturePlaceholder label="No image" loading={false} /> : null}
    </div>
  );
}

function StaticTextureCanvas({
  gpu,
  services,
  socket,
  label,
  generated,
  bakeGeneration,
}: {
  gpu: TexturePreviewGpu;
  services: MaterialAppServices;
  socket: PbrSocket;
  label: string;
  generated: boolean;
  bakeGeneration: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const size = useElementSize(hostRef);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const tex = services.getChannelTexture(socket);
    gpu.attach(canvas, tex?.colorSpace ?? NoColorSpace);
    return () => gpu.detach(canvas);
  }, [gpu, services, socket]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const tex = generated ? services.getChannelTexture(socket) : null;
    if (tex) gpu.setColorSpace(canvas, tex.colorSpace);
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const tilePx = Math.max(48, Math.min(size.width, size.height));
    gpu.requestRender(canvas, tex, {
      cssWidth: size.width,
      cssHeight: size.height,
      dpr,
      tilePx,
      panX: 0,
      panY: 0,
    });
  }, [gpu, services, socket, generated, size, bakeGeneration]);

  return (
    <div ref={hostRef} className="texture-preview-thumb-canvas">
      <canvas ref={canvasRef} aria-label={`${label} thumbnail`} className="texture-preview-canvas" />
      {!generated ? <TexturePlaceholder label="" loading={false} compact /> : null}
    </div>
  );
}

function TexturePlaceholder({
  compact = false,
  label,
  loading = false,
}: {
  compact?: boolean;
  label: string;
  loading?: boolean;
}) {
  return (
    <div className={cn("texture-preview-placeholder", compact && "texture-preview-placeholder--compact")}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : <ImageIcon className="size-4" />}
      {label ? <span>{label}</span> : null}
    </div>
  );
}

function useElementSize(ref: RefObject<HTMLElement | null>): CanvasSize {
  const [size, setSize] = useState<CanvasSize>({ height: 0, width: 0 });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    // ResizeObserver fires on sub-pixel border-box changes, so bail when the floored dimensions are
    // unchanged — otherwise a new `size` object identity would re-run the draw effects and re-blit the
    // preview every frame at rest (a persistent idle rAF for no visible change).
    const update = () => {
      const height = Math.max(0, Math.floor(node.clientHeight));
      const width = Math.max(0, Math.floor(node.clientWidth));
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { height, width }));
    };
    const observer = new ResizeObserver(update);
    update();
    observer.observe(node);

    return () => observer.disconnect();
  }, [ref]);

  return size;
}

// The seam overlay is a plain 2D canvas layered over the WebGPU preview canvas — the tile-boundary gridlines
// are cheap and pixel-perfect on a 2D context, so there's no need to fold them into the GPU pass.
function drawSeamsOverlay(
  canvas: HTMLCanvasElement | null,
  size: CanvasSize,
  tileSize: number,
  pan: PanOffset,
  seams: boolean,
): void {
  if (!canvas) return;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const pixelWidth = Math.max(1, Math.floor(size.width * dpr));
  const pixelHeight = Math.max(1, Math.floor(size.height * dpr));
  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size.width, size.height);
  if (!seams || size.width <= 0 || size.height <= 0) return;

  // Exact float period (not Math.round) so seams stay pixel-aligned with the GPU tiling at fractional
  // zoom — a rounded period would drift ~1px per tile and accumulate across the viewport. Each line is
  // still snapped to a crisp pixel below (Math.round(px) + 0.5).
  const tile = Math.max(8, tileSize);
  const offsetX = modulo(pan.x, tile) - tile;
  const offsetY = modulo(pan.y, tile) - tile;

  ctx.lineWidth = 1;
  const stroke = (color: string, shift: number) => {
    ctx.strokeStyle = color;
    for (let x = offsetX; x < size.width + tile; x += tile) {
      const px = Math.round(x + shift) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, size.height);
      ctx.stroke();
    }
    for (let y = offsetY; y < size.height + tile; y += tile) {
      const py = Math.round(y + shift) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(size.width, py);
      ctx.stroke();
    }
  };
  stroke("rgba(0,0,0,0.72)", 0);
  stroke("rgba(255,255,255,0.86)", 1);
}

function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function readConnectedSockets(services: MaterialAppServices): PbrSocket[] {
  try {
    return sortedTextureSockets(services.readConnectedTextureChannels());
  } catch (error) {
    console.warn("[texture-preview] Could not read connected channels.", error);
    return [];
  }
}

function textureChannelsForSockets(sockets: readonly PbrSocket[]): TextureChannelInfo[] {
  const selected = new Set(sockets);
  return TEXTURE_CHANNELS.filter((channel) => selected.has(channel.socket));
}

function normalizedWheelDelta(delta: number, deltaMode: number): number {
  if (deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * WHEEL_LINE_DELTA_PX;
  if (deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * WHEEL_PAGE_DELTA_PX;
  return delta;
}

function wheelZoomScale(deltaY: number): number {
  return Math.pow(WHEEL_ZOOM_BASE, WHEEL_ZOOM_SPEED * Math.abs(deltaY * 0.01));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
