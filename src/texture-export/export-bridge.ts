import type { PbrSocket } from "@/runtime";

export type TextureExportOptions = {
  channels: PbrSocket[];
  size: number;
};

export type TextureExportHandler = (options: TextureExportOptions) => Promise<void>;

let textureExportHandler: TextureExportHandler | null = null;

export function setTextureExportHandler(handler: TextureExportHandler | null): void {
  textureExportHandler = handler;
}

export function getTextureExportHandler(): TextureExportHandler | null {
  return textureExportHandler;
}
