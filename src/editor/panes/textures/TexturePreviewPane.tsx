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

import { Button } from "@/components/ui/primitives/button";
import { cn } from "@/lib/utils";
import { useTexturePreviewStore } from "@/editor/panes/textures/store";
import { useWorkspaceStore } from "@/store/app";
import {
  TEXTURE_CHANNELS,
  sortedTextureSockets,
  type TextureChannelInfo,
} from "@/editor/panes/textures/channels";
import type { MaterialAppServices } from "@/components/app/services";
import type { PbrSocket } from "@/runtime";

const PREVIEW_READ_SIZE = 256;
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
  const images = useTexturePreviewStore((state) => state.images);
  const seams = useTexturePreviewStore((state) => state.seams);
  const tileSize = useTexturePreviewStore((state) => state.tileSize);
  const zoom = useTexturePreviewStore((state) => state.zoom);
  const setImageError = useTexturePreviewStore((state) => state.setImageError);
  const setImageLoading = useTexturePreviewStore((state) => state.setImageLoading);
  const setImageReady = useTexturePreviewStore((state) => state.setImageReady);
  const setZoom = useTexturePreviewStore((state) => state.setZoom);
  const materialGraphEvent = useWorkspaceStore((state) => state.materialGraphEvent);
  const [connectedSockets, setConnectedSockets] = useState<PbrSocket[]>(() =>
    readConnectedSockets(services),
  );
  const [selectedSocket, setSelectedSocket] = useState<PbrSocket | null>(
    () => readConnectedSockets(services)[0] ?? null,
  );
  const readerReady = servicesSnapshot.textureReady;
  // Single-flight coalescing (mirrors TexturedSurface.pump): at most one refresh round bakes at a
  // time, and every event that arrives mid-round collapses into ONE trailing round. Without this the
  // pane fired a fresh readImage bake per event onto the shared serial bake queue, flooding it during
  // a slider drag so the preview lagged far behind the graph.
  const pumpRef = useRef({ inFlight: false, pending: false });

  const bakeConnectedChannels = useCallback(async () => {
    if (!services.getSnapshot().textureReady) return;

    const nextSockets = readConnectedSockets(services);
    setConnectedSockets(nextSockets);
    const channels = textureChannelsForSockets(nextSockets);
    const currentImages = useTexturePreviewStore.getState().images;

    // readImage awaits GPU completion, so awaiting the whole round gives real back-pressure — the next
    // round can't enqueue until this one's GPU work drains.
    await Promise.all(
      channels.map(async (channel) => {
        const requestId = currentImages[channel.socket].requestId + 1;
        setImageLoading(channel.socket, requestId);
        try {
          const image = await services.readTexturePreview(channel.socket, PREVIEW_READ_SIZE);
          setImageReady(channel.socket, requestId, image);
        } catch (error: unknown) {
          setImageError(
            channel.socket,
            requestId,
            error instanceof Error ? error.message : String(error),
          );
        }
      }),
    );
  }, [services, setImageError, setImageLoading, setImageReady]);

  const refreshConnectedImages = useCallback(() => {
    const pump = pumpRef.current;
    if (pump.inFlight) {
      pump.pending = true;
      return;
    }
    pump.inFlight = true;
    void (async () => {
      try {
        do {
          pump.pending = false;
          await bakeConnectedChannels();
        } while (pump.pending);
      } finally {
        pump.inFlight = false;
      }
    })();
  }, [bakeConnectedChannels]);

  useEffect(() => {
    refreshConnectedImages();
  }, [refreshConnectedImages, servicesSnapshot.textureReady]);

  useEffect(() => {
    if (!materialGraphEvent || materialGraphEvent.change.kind === "layout") return;
    refreshConnectedImages();
  }, [materialGraphEvent, refreshConnectedImages]);

  const channels = textureChannelsForSockets(connectedSockets);
  const generated = new Set(connectedSockets);
  const selectedChannel = channels.find((channel) => channel.socket === selectedSocket) ?? channels[0];
  const selectedImageState = selectedChannel ? images[selectedChannel.socket] : null;

  useEffect(() => {
    if (channels.length === 0) {
      setSelectedSocket(null);
      return;
    }
    if (!selectedSocket || !channels.some((channel) => channel.socket === selectedSocket)) {
      setSelectedSocket(channels[0].socket);
    }
  }, [channels, selectedSocket]);

  return (
    <div className="texture-preview-pane">
      <div className="texture-preview-grid">
        {readerReady && selectedChannel && selectedImageState ? (
          <>
            <div className="texture-preview-main">
              <InteractiveTextureCanvas
                image={selectedImageState.image}
                imageLabel={selectedChannel.label}
                loading={selectedImageState.loading}
                seams={seams}
                tileSize={tileSize}
                zoom={zoom}
                onZoom={setZoom}
              />
            </div>
            <div className="texture-preview-thumbnails">
              {TEXTURE_CHANNELS.map((channel) => {
                const state = images[channel.socket];
                const isGenerated = generated.has(channel.socket);

                return (
                  <Button
                    key={channel.id}
                    className={cn(
                      "texture-preview-thumb",
                      selectedChannel.socket === channel.socket && "texture-preview-thumb--selected",
                      !isGenerated && "texture-preview-thumb--disabled",
                    )}
                    title={isGenerated ? channel.label : `${channel.label} (not generated)`}
                    type="button"
                    size="icon"
                    variant="ghost"
                    disabled={!isGenerated}
                    onClick={() => {
                      if (isGenerated) setSelectedSocket(channel.socket);
                    }}
                  >
                    <StaticTextureCanvas
                      image={state.image}
                      label={channel.label}
                      loading={state.loading}
                    />
                    <span>{channel.label}</span>
                  </Button>
                );
              })}
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
  image,
  imageLabel,
  loading,
  seams,
  tileSize,
  onZoom,
  zoom,
}: {
  image: ImageData | null;
  imageLabel: string;
  loading: boolean;
  onZoom: (zoom: number) => void;
  seams: boolean;
  tileSize: number;
  zoom: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ origin: PanOffset; pointerId: number; start: PanOffset } | null>(null);
  const [pan, setPan] = useState<PanOffset>({ x: 0, y: 0 });
  const size = useElementSize(hostRef);

  useEffect(() => {
    drawTexturePreview(canvasRef.current, {
      image,
      pan,
      seams,
      size,
      tileSize: tileSize * zoom,
    });
  }, [image, pan, seams, size, tileSize, zoom]);

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!image) return;
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

  // Wheel-to-zoom needs a NON-passive native listener: React attaches its `onWheel` as passive, so the
  // preventDefault() that stops the page from scrolling is ignored (and logs a console warning). Bind it
  // manually with { passive: false }. Re-bound when the closed-over zoom/tile/size/image change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const onWheel = (event: globalThis.WheelEvent) => {
      if (!image) return;
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
  }, [image, zoom, tileSize, size, onZoom]);

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
      {!image ? <TexturePlaceholder label={loading ? "Loading texture" : "No image"} loading={loading} /> : null}
      {loading && image ? <LoadingBadge /> : null}
    </div>
  );
}

function StaticTextureCanvas({
  image,
  label,
  loading,
}: {
  image: ImageData | null;
  label: string;
  loading: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const size = useElementSize(hostRef);

  useEffect(() => {
    drawTexturePreview(canvasRef.current, {
      image,
      pan: { x: 0, y: 0 },
      seams: false,
      size,
      tileSize: Math.max(48, Math.min(size.width, size.height)),
    });
  }, [image, size]);

  return (
    <div ref={hostRef} className="texture-preview-thumb-canvas">
      <canvas ref={canvasRef} aria-label={`${label} thumbnail`} className="texture-preview-canvas" />
      {!image ? <TexturePlaceholder label="" loading={loading} compact /> : null}
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

function LoadingBadge() {
  return (
    <div className="texture-preview-loading-badge">
      <Loader2 className="size-3 animate-spin" />
      <span>Baking</span>
    </div>
  );
}

function useElementSize(ref: RefObject<HTMLElement | null>): CanvasSize {
  const [size, setSize] = useState<CanvasSize>({ height: 0, width: 0 });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    const update = () =>
      setSize({
        height: Math.max(0, Math.floor(node.clientHeight)),
        width: Math.max(0, Math.floor(node.clientWidth)),
      });
    const observer = new ResizeObserver(update);
    update();
    observer.observe(node);

    return () => observer.disconnect();
  }, [ref]);

  return size;
}

function drawTexturePreview(
  canvas: HTMLCanvasElement | null,
  {
    image,
    pan,
    seams,
    size,
    tileSize,
  }: {
    image: ImageData | null;
    pan: PanOffset;
    seams: boolean;
    size: CanvasSize;
    tileSize: number;
  },
): void {
  if (!canvas || size.width <= 0 || size.height <= 0) return;

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
  drawChecker(ctx, size.width, size.height);

  if (!image) return;

  const source = document.createElement("canvas");
  source.width = image.width;
  source.height = image.height;
  const sourceCtx = source.getContext("2d");
  if (!sourceCtx) return;
  sourceCtx.putImageData(image, 0, 0);

  const tile = Math.max(8, Math.round(tileSize));
  const offsetX = modulo(pan.x, tile) - tile;
  const offsetY = modulo(pan.y, tile) - tile;

  ctx.imageSmoothingEnabled = false;
  for (let y = offsetY; y < size.height + tile; y += tile) {
    for (let x = offsetX; x < size.width + tile; x += tile) {
      ctx.drawImage(source, Math.round(x), Math.round(y), tile, tile);
    }
  }

  if (!seams) return;

  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(0,0,0,0.72)";
  for (let x = offsetX; x < size.width + tile; x += tile) {
    const px = Math.round(x) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, size.height);
    ctx.stroke();
  }
  for (let y = offsetY; y < size.height + tile; y += tile) {
    const py = Math.round(y) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(size.width, py);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.86)";
  for (let x = offsetX; x < size.width + tile; x += tile) {
    const px = Math.round(x + 1) + 0.5;
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, size.height);
    ctx.stroke();
  }
  for (let y = offsetY; y < size.height + tile; y += tile) {
    const py = Math.round(y + 1) + 0.5;
    ctx.beginPath();
    ctx.moveTo(0, py);
    ctx.lineTo(size.width, py);
    ctx.stroke();
  }
}

function drawChecker(ctx: CanvasRenderingContext2D, width: number, height: number): void {
  const cell = 16;
  ctx.fillStyle = "hsl(0 0% 10%)";
  ctx.fillRect(0, 0, width, height);
  for (let y = 0; y < height; y += cell) {
    for (let x = 0; x < width; x += cell) {
      ctx.fillStyle = (x / cell + y / cell) % 2 === 0 ? "hsl(0 0% 15%)" : "hsl(0 0% 20%)";
      ctx.fillRect(x, y, cell, cell);
    }
  }
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
