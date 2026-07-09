import { PBR_SOCKETS, type MaterialGraphDocument, type PbrSocket } from "@/runtime";

// Nodes that expose the PBR channel inputs (baseColor/roughness/metallic/normal/…). A channel counts as a
// real "texture output" only when something in the graph is wired into one of these inputs — an unconnected
// input falls back to its param slider (Blender's model), which is a constant material value, not a texture.
const SHADER_INPUT_NODE_TYPES = new Set(["shader-material", "principled-bsdf"]);

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

// The PBR channels the document actually WIRES into the material — i.e. that have an incoming edge on a
// shader node's channel input. Excludes channels left on their param slider (constant, not a texture), so
// the texture preview/export list only real graph-generated outputs. See TexturePreviewPane.
export function connectedTextureSockets(doc: MaterialGraphDocument): Set<PbrSocket> {
  const shaderIds = new Set(
    doc.nodes.filter((node) => SHADER_INPUT_NODE_TYPES.has(node.type)).map((node) => node.id),
  );
  const pbr = new Set<string>(PBR_SOCKETS);
  const wired = new Set<PbrSocket>();
  for (const edge of doc.edges) {
    if (shaderIds.has(edge.toNode) && pbr.has(edge.toInput)) wired.add(edge.toInput as PbrSocket);
  }
  return wired;
}
