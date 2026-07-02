import { PBR_SOCKETS, type PbrSocket } from "@/runtime";

export type TextureChannelInfo = {
  filename: string;
  id: string;
  label: string;
  socket: PbrSocket;
};

export const TEXTURE_CHANNELS = [
  { id: "basecolor", label: "Base Color", socket: "baseColor", filename: "basecolor.png" },
  { id: "normal", label: "Normal", socket: "normal", filename: "normal.png" },
  { id: "emission", label: "Emission", socket: "emission", filename: "emission.png" },
  { id: "roughness", label: "Roughness", socket: "roughness", filename: "roughness.png" },
  { id: "metallic", label: "Metallic", socket: "metallic", filename: "metallic.png" },
  { id: "ao", label: "AO", socket: "ambientOcclusion", filename: "ao.png" },
] as const satisfies readonly TextureChannelInfo[];

export type TextureChannelId = (typeof TEXTURE_CHANNELS)[number]["id"];

export function textureChannelForSocket(socket: PbrSocket): TextureChannelInfo {
  return TEXTURE_CHANNELS.find((channel) => channel.socket === socket) ?? {
    filename: `${socket}.png`,
    id: socket,
    label: socket,
    socket,
  };
}

export function sortedTextureSockets(sockets: Iterable<PbrSocket>): PbrSocket[] {
  const selected = new Set(sockets);
  return PBR_SOCKETS.filter((socket) => selected.has(socket));
}
