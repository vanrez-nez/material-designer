import type { PbrSocket } from "@/runtime";

export type TextureExportOptions = {
  channels: PbrSocket[];
  size: number;
};

export type MaterialTextureApi = {
  exportTextureZip: (options: TextureExportOptions) => Promise<void>;
  readConnectedTextureChannels: () => PbrSocket[];
  readTexturePreview: (channel: PbrSocket, size: number) => Promise<ImageData | null>;
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

  readTexturePreview(channel: PbrSocket, size: number): Promise<ImageData | null> {
    return this.textureApi?.readTexturePreview(channel, size) ?? Promise.resolve(null);
  }

  readConnectedTextureChannels(): PbrSocket[] {
    return this.textureApi?.readConnectedTextureChannels() ?? [];
  }

  exportTextureZip(options: TextureExportOptions): Promise<void> {
    if (!this.textureApi) throw new Error("Texture exporter is not ready yet.");
    return this.textureApi.exportTextureZip(options);
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
