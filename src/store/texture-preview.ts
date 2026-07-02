import { create } from "zustand";

import type { PbrSocket } from "@/runtime";

export type TexturePreviewChannel = {
  id: string;
  label: string;
  socket: PbrSocket;
};

export type TexturePreviewColumns = 2 | 3 | 4;

export const TEXTURE_PREVIEW_CHANNELS = [
  { id: "basecolor", label: "Base Color", socket: "baseColor" },
  { id: "normal", label: "Normal", socket: "normal" },
  { id: "ao", label: "AO", socket: "ambientOcclusion" },
  { id: "roughness", label: "Roughness", socket: "roughness" },
] as const satisfies readonly TexturePreviewChannel[];

export type TexturePreviewChannelId = (typeof TEXTURE_PREVIEW_CHANNELS)[number]["id"];

type TexturePreviewImageState = {
  error: string | null;
  image: ImageData | null;
  loading: boolean;
  requestId: number;
};

export type TexturePreviewStore = {
  columns: TexturePreviewColumns;
  images: Record<TexturePreviewChannelId, TexturePreviewImageState>;
  selectedChannel: TexturePreviewChannelId;
  seams: boolean;
  tileSize: number;
  zoom: number;
  setColumns: (columns: TexturePreviewColumns) => void;
  setImageError: (channel: TexturePreviewChannelId, requestId: number, error: string) => void;
  setImageLoading: (channel: TexturePreviewChannelId, requestId: number) => void;
  setImageReady: (
    channel: TexturePreviewChannelId,
    requestId: number,
    image: ImageData | null,
  ) => void;
  setSeams: (seams: boolean) => void;
  setSelectedChannel: (channel: TexturePreviewChannelId) => void;
  setTileSize: (tileSize: number) => void;
  setZoom: (zoom: number) => void;
};

const emptyImageState = (): TexturePreviewImageState => ({
  error: null,
  image: null,
  loading: false,
  requestId: 0,
});

const createInitialImages = (): Record<TexturePreviewChannelId, TexturePreviewImageState> =>
  Object.fromEntries(
    TEXTURE_PREVIEW_CHANNELS.map((channel) => [channel.id, emptyImageState()]),
  ) as Record<TexturePreviewChannelId, TexturePreviewImageState>;

export const useTexturePreviewStore = create<TexturePreviewStore>()((set) => ({
  columns: 4,
  images: createInitialImages(),
  seams: false,
  selectedChannel: "basecolor",
  tileSize: 160,
  zoom: 1,
  setColumns: (columns) => set({ columns }),
  setImageError: (channel, requestId, error) =>
    set((state) => {
      if (state.images[channel].requestId !== requestId) return state;

      return {
        images: {
          ...state.images,
          [channel]: { ...state.images[channel], error, loading: false },
        },
      };
    }),
  setImageLoading: (channel, requestId) =>
    set((state) => ({
      images: {
        ...state.images,
        [channel]: {
          ...state.images[channel],
          error: null,
          loading: true,
          requestId,
        },
      },
    })),
  setImageReady: (channel, requestId, image) =>
    set((state) => {
      if (state.images[channel].requestId !== requestId) return state;

      return {
        images: {
          ...state.images,
          [channel]: { ...state.images[channel], error: null, image, loading: false },
        },
      };
    }),
  setSeams: (seams) => set({ seams }),
  setSelectedChannel: (selectedChannel) => set({ selectedChannel }),
  setTileSize: (tileSize) => set({ tileSize }),
  setZoom: (zoom) => set({ zoom }),
}));
