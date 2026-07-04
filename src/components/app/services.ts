import type { Texture } from "three";
import type { WebGPURenderer } from "three/webgpu";

import type { PbrSocket } from "@/runtime";

export type TextureExportOptions = {
  channels: PbrSocket[];
  size: number;
};

export type MaterialTextureApi = {
  exportTextureZip: (options: TextureExportOptions) => Promise<void>;
  readConnectedTextureChannels: () => PbrSocket[];
  // GPU-direct preview: hand the consumer the surface's already-baked channel texture, the main renderer
  // (whose device owns those textures), and a signal fired whenever the bake re-renders — the preview draws
  // the shared texture directly, no re-bake and no CPU readback.
  getChannelTexture: (channel: PbrSocket) => Texture | null;
  getRenderer: () => WebGPURenderer | null;
  onTexturesUpdated: (cb: () => void) => () => void;
};

export type MaterialAppServicesSnapshot = {
  textureReady: boolean;
};

type ServicesListener = () => void;

export class MaterialAppServices {
  private listeners = new Set<ServicesListener>();
  private snapshot: MaterialAppServicesSnapshot = { textureReady: false };
  private textureApi: MaterialTextureApi | null = null;

  getSnapshot(): MaterialAppServicesSnapshot {
    return this.snapshot;
  }

  setTextureApi(textureApi: MaterialTextureApi): void {
    this.textureApi = textureApi;
    this.snapshot = { textureReady: true };
    this.emit();
  }

  subscribe(listener: ServicesListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  readConnectedTextureChannels(): PbrSocket[] {
    return this.textureApi?.readConnectedTextureChannels() ?? [];
  }

  getChannelTexture(channel: PbrSocket): Texture | null {
    return this.textureApi?.getChannelTexture(channel) ?? null;
  }

  getRenderer(): WebGPURenderer | null {
    return this.textureApi?.getRenderer() ?? null;
  }

  onTexturesUpdated(cb: () => void): () => void {
    return this.textureApi?.onTexturesUpdated(cb) ?? (() => {});
  }

  exportTextureZip(options: TextureExportOptions): Promise<void> {
    if (!this.textureApi) throw new Error("Texture exporter is not ready yet.");
    return this.textureApi.exportTextureZip(options);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
