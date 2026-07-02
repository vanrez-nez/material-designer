import type { PbrSocket } from "@/runtime";

export type TexturePreviewReader = (channel: PbrSocket, size: number) => Promise<ImageData | null>;

export const TEXTURE_PREVIEW_READER_EVENT = "material-designer:texture-preview-reader";

let reader: TexturePreviewReader | null = null;

export function setTexturePreviewReader(nextReader: TexturePreviewReader | null): void {
  reader = nextReader;
  window.dispatchEvent(new CustomEvent(TEXTURE_PREVIEW_READER_EVENT));
}

export function getTexturePreviewReader(): TexturePreviewReader | null {
  return reader;
}
