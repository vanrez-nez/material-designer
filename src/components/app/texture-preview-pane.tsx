import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
  type RefObject,
  type WheelEvent,
} from "react";
import { ImageIcon, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/primitives/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/primitives/select";
import { Slider } from "@/components/ui/primitives/slider";
import { Switch } from "@/components/ui/primitives/switch";
import { cn } from "@/lib/utils";
import {
  TEXTURE_PREVIEW_CHANNELS,
  useTexturePreviewStore,
  type TexturePreviewChannelId,
  type TexturePreviewColumns,
} from "@/store/texture-preview";
import { useWorkspaceStore } from "@/store/app";
import {
  getTexturePreviewReader,
  TEXTURE_PREVIEW_READER_EVENT,
} from "@/texture-preview/preview-bridge";

const PREVIEW_READ_SIZE = 256;
const COLUMN_OPTIONS: TexturePreviewColumns[] = [2, 3, 4];

type CanvasSize = {
  height: number;
  width: number;
};

type PanOffset = {
  x: number;
  y: number;
};

export function TexturePreviewPane() {
  const columns = useTexturePreviewStore((state) => state.columns);
  const images = useTexturePreviewStore((state) => state.images);
  const selectedChannel = useTexturePreviewStore((state) => state.selectedChannel);
  const seams = useTexturePreviewStore((state) => state.seams);
  const tileSize = useTexturePreviewStore((state) => state.tileSize);
  const zoom = useTexturePreviewStore((state) => state.zoom);
  const setColumns = useTexturePreviewStore((state) => state.setColumns);
  const setImageError = useTexturePreviewStore((state) => state.setImageError);
  const setImageLoading = useTexturePreviewStore((state) => state.setImageLoading);
  const setImageReady = useTexturePreviewStore((state) => state.setImageReady);
  const setSeams = useTexturePreviewStore((state) => state.setSeams);
  const setSelectedChannel = useTexturePreviewStore((state) => state.setSelectedChannel);
  const setTileSize = useTexturePreviewStore((state) => state.setTileSize);
  const setZoom = useTexturePreviewStore((state) => state.setZoom);
  const materialGraphEvent = useWorkspaceStore((state) => state.materialGraphEvent);
  const [readerVersion, setReaderVersion] = useState(0);
  const readerReady = getTexturePreviewReader() !== null;
  const selectedImageState = images[selectedChannel];

  const selectedChannelConfig = useMemo(
    () => TEXTURE_PREVIEW_CHANNELS.find((channel) => channel.id === selectedChannel),
    [selectedChannel],
  );

  const refreshImages = useCallback(() => {
    const reader = getTexturePreviewReader();
    if (!reader) return;

    const currentImages = useTexturePreviewStore.getState().images;
    for (const channel of TEXTURE_PREVIEW_CHANNELS) {
      const requestId = currentImages[channel.id].requestId + 1;
      setImageLoading(channel.id, requestId);
      void reader(channel.socket, PREVIEW_READ_SIZE)
        .then((image) => setImageReady(channel.id, requestId, image))
        .catch((error: unknown) => {
          setImageError(
            channel.id,
            requestId,
            error instanceof Error ? error.message : String(error),
          );
        });
    }
  }, [setImageError, setImageLoading, setImageReady]);

  useEffect(() => {
    const handleReader = () => setReaderVersion((version) => version + 1);
    window.addEventListener(TEXTURE_PREVIEW_READER_EVENT, handleReader);

    return () => window.removeEventListener(TEXTURE_PREVIEW_READER_EVENT, handleReader);
  }, []);

  useEffect(() => {
    refreshImages();
  }, [readerVersion, refreshImages]);

  useEffect(() => {
    if (!materialGraphEvent || materialGraphEvent.change.kind === "layout") return;
    refreshImages();
  }, [materialGraphEvent, refreshImages]);

  return (
    <div className="texture-preview-pane">
      <div className="texture-preview-toolbar">
        <div className="texture-preview-toolbar__group">
          <Select
            value={selectedChannel}
            onValueChange={(value) => setSelectedChannel(value as TexturePreviewChannelId)}
          >
            <SelectTrigger
              aria-label="Texture channel"
              className="texture-preview-select"
              size="xs"
            >
              <SelectValue placeholder="Channel" />
            </SelectTrigger>
            <SelectContent>
              {TEXTURE_PREVIEW_CHANNELS.map((channel) => (
                <SelectItem key={channel.id} value={channel.id}>
                  {channel.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={String(columns)}
            onValueChange={(value) => setColumns(Number(value) as TexturePreviewColumns)}
          >
            <SelectTrigger aria-label="Thumbnail columns" className="w-[5rem]" size="xs">
              <SelectValue placeholder="Cols" />
            </SelectTrigger>
            <SelectContent>
              {COLUMN_OPTIONS.map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {value} cols
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <LabeledSlider
          label="Zoom"
          max={4}
          min={0.5}
          step={0.05}
          value={zoom}
          onChange={setZoom}
        />
        <LabeledSlider
          label="Tile"
          max={320}
          min={64}
          step={4}
          value={tileSize}
          onChange={setTileSize}
        />
        <label className="texture-preview-switch">
          <Switch checked={seams} size="sm" onCheckedChange={setSeams} />
          <span>Seams</span>
        </label>
      </div>
      <div className="texture-preview-grid">
        <div className="texture-preview-main">
          {readerReady ? (
            <InteractiveTextureCanvas
              image={selectedImageState.image}
              imageLabel={selectedChannelConfig?.label ?? "Texture"}
              loading={selectedImageState.loading}
              seams={seams}
              tileSize={tileSize}
              zoom={zoom}
            />
          ) : (
            <TexturePlaceholder label="Preview unavailable" loading />
          )}
        </div>
        <div
          className="texture-preview-thumbnails"
          style={{ "--texture-preview-columns": columns } as CSSProperties}
        >
          {TEXTURE_PREVIEW_CHANNELS.map((channel) => {
            const state = images[channel.id];

            return (
              <Button
                key={channel.id}
                className={cn(
                  "texture-preview-thumb",
                  selectedChannel === channel.id && "texture-preview-thumb--selected",
                )}
                title={channel.label}
                type="button"
                variant="ghost"
                onClick={() => setSelectedChannel(channel.id)}
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
      </div>
    </div>
  );
}

function LabeledSlider({
  label,
  max,
  min,
  step,
  value,
  onChange,
}: {
  label: string;
  max: number;
  min: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="texture-preview-slider">
      <span>{label}</span>
      <Slider
        max={max}
        min={min}
        step={step}
        value={[value]}
        onValueChange={(nextValue) => onChange(nextValue[0] ?? value)}
      />
      <output>{formatNumber(value)}</output>
    </label>
  );
}

function InteractiveTextureCanvas({
  image,
  imageLabel,
  loading,
  seams,
  tileSize,
  zoom,
}: {
  image: ImageData | null;
  imageLabel: string;
  loading: boolean;
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

  const handleWheel = (event: WheelEvent<HTMLCanvasElement>) => {
    if (!image) return;
    setPan((current) => ({
      x: current.x - event.deltaX,
      y: current.y - event.deltaY,
    }));
  };

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
        onWheel={handleWheel}
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

  const tile = Math.max(8, tileSize);
  const offsetX = modulo(pan.x, tile) - tile;
  const offsetY = modulo(pan.y, tile) - tile;

  ctx.imageSmoothingEnabled = false;
  for (let y = offsetY; y < size.height + tile; y += tile) {
    for (let x = offsetX; x < size.width + tile; x += tile) {
      ctx.drawImage(source, x, y, tile, tile);
    }
  }

  if (!seams) return;

  ctx.strokeStyle = "rgba(255,255,255,0.34)";
  ctx.lineWidth = 1;
  for (let x = offsetX; x < size.width + tile; x += tile) {
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, size.height);
    ctx.stroke();
  }
  for (let y = offsetY; y < size.height + tile; y += tile) {
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y) + 0.5);
    ctx.lineTo(size.width, Math.round(y) + 0.5);
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

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
